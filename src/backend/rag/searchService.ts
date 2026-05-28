import { qdrant } from '../db/qdrant';
import { ai, embedText, GEMINI_EMBEDDING_MODEL } from './aiClient';
import 'dotenv/config';
import { tokenizeAndHash } from './textUtils';

const QDRANT_COLLECTION = 'daraq_books';

// Қайтарылатын құрылым (Interface)
export interface SearchResult {
  text: string;
  book: string;
  page: number;
  pages?: number[];
  imageUrl: string;
  score: number;
  isQuran?: boolean;
  url?: string;
}

/**
 * Cohere Multilingual Rerank V3 арқылы іріктелген результаттарды қайта бағалау (Reranker)
 */
async function rerankResults(query: string, documents: SearchResult[]): Promise<SearchResult[]> {
  const apiKey = process.env.COHERE_API_KEY;
  if (!apiKey) {
    console.warn("\n[⚠️] COHERE_API_KEY табылмады, Reranking қадамы өткізілді (Тікелей қайтару).");
    return documents.slice(0, 5); // Fallback: Top-5
  }

  if (documents.length === 0) return [];

  try {
    console.log(`[⏳] Cohere Reranker арқылы (Multilingual V3) нәтижелерді қайта іріктеу (Rerank)...`);
    // Extract purely text contents to send to Cohere
    const docTexts = documents.map(doc => doc.text);

    const response = await fetch('https://api.cohere.ai/v1/rerank', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        model: 'rerank-multilingual-v3.0',
        query: query,
        documents: docTexts,
        top_n: 5,
        return_documents: false
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Cohere API қатесі: ${response.status} - ${errText}`);
    }

    const data: any = await response.json();
    
    const rerankedDocs: SearchResult[] = [];
    for (const res of data.results) {
       const originalDoc = documents[res.index];
       // update score explicitly with reranker's confidence
       originalDoc.score = res.relevance_score;
       rerankedDocs.push(originalDoc);
    }

    console.log(`[✅] Rerank аяқталды. Үздік ${rerankedDocs.length} документ іріктелді.`);
    return rerankedDocs;
  } catch (error) {
    console.error("[❌] Reranker жүйесінде қате орын алды (Fallback іске қосылды):", error);
    // Graceful fallback to Qdrant's best top-5
    return documents.slice(0, 5);
  }
}

/**
 * Пайдаланушының сұрағы бойынша Hybrid Search (BM25 + Dense) жүргізеді, содан соң RRF & Reranker.
 * @param query - Пайдаланушының сұрағы.
 * @param preComputedDenseVector - Алдын ала есептелген Dense вектор (Gemini Embedding сұранысын үнемдеу үшін).
 * @returns Ең ұқсас 5 үзінді (chunk) және олардың метадатасы.
 */
export async function searchAnswers(query: string, preComputedDenseVector?: number[]): Promise<SearchResult[]> {
  try {
    console.log(`\n[🔎] Іздеу басталды. Сұрақ: "${query}"`);

    let denseVector = preComputedDenseVector;

    if (!denseVector) {
      // 1. Сұрақты векторға айналдыру (Dense Vector) - Gemini (Асинхронды жіберу)
      console.log(`[⏳] Сұрақты Dense және Sparse векторға қатар айналдыру...`);
      const embeddingPromise = embedText({
        model: GEMINI_EMBEDDING_MODEL,
        contents: query,
        config: {
          taskType: 'RETRIEVAL_QUERY',
          outputDimensionality: 1536
        }
      });

      // Вектордың келуін күту
      const embeddingResponse = await embeddingPromise;

      denseVector = embeddingResponse.embeddings?.[0]?.values;
      if (!denseVector) {
        throw new Error("Сұрақтан вектор жасалмады.");
      }
      
      // Егер monkey-patch 768 өлшемді модельге түсіп кетсе, 1536 етіп нөлдермен толтырамыз
      if (denseVector.length === 768) {
        denseVector = [...denseVector, ...Array(768).fill(0)];
      }
    } else {
      console.log(`[⚡] Алдын ала есептелген Dense вектор пайдаланылды! Gemini Embedding-ке сұраныс үнемделді.`);
    }

    // 2. Сұрақты Sparse векторға (BM25) айналдыру (Қатар орындау)
    const sparseVector = tokenizeAndHash(query);

    // Qdrant клиентін тексеру
    if (!qdrant) {
      console.warn(`[⚠️] Qdrant қосылмаған. Іздеу нәтижесіз аяқталды.`);
      return [];
    }

    // 3. Qdrant-тан Hybrid Search арқылы Top-30 chunk іздеу (RRF Fusion)
    console.log(`[⏳] Qdrant дерекқорынан Hybrid Search (RRF) арқылы ең ұқсас 30 үзіндіні іздеу...`);
    const searchResponse = await qdrant.query(QDRANT_COLLECTION, {
      prefetch: [
        {
          query: denseVector,
          limit: 30
        },
        {
          query: sparseVector,
          using: 'text_sparse',
          limit: 30
        }
      ],
      query: { fusion: "rrf" },
      limit: 30,
      with_payload: true
    });

    const searchResults = searchResponse.points || [];
    console.log(`[✅] ${searchResults.length} ұқсас үзінді табылды.`);

    // 4. Нәтижелерді массив ретінде шығару
    const formattedResults: SearchResult[] = searchResults.map(hit => {
      const payload = hit.payload || {};
      const pageNum = Number(payload.page || 0);
      const pagesArray = Array.isArray(payload.pages) 
        ? payload.pages.map(Number) 
        : [pageNum];
      
      return {
        text: String(payload.text || ''),
        book: String(payload.book || 'Белгісіз кітап'),
        page: pageNum,
        pages: pagesArray,
        imageUrl: String(payload.imageUrl || ''),
        score: hit.score || 0
      };
    });

    // 5. Reranker арқылы үздік 5-ті іріктеу
    if (formattedResults.length > 0) {
      console.log(`[✅] Qdrant нәтижелерін тікелей қайтару (Top-5)...`);
      return formattedResults.slice(0, 5);
    }
    
    return [];

  } catch (error) {
    // 6. Қателерді ұстау және терминалға шығару
    console.error("\n[❌] Іздеу қызметінде қате орын алды:", error);
    return [];
  }
}
