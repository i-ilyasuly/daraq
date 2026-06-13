import { qdrant } from '../db/qdrant';
import { ai, embedText, GEMINI_EMBEDDING_MODEL } from './aiClient';
import 'dotenv/config';
import { tokenizeAndHash } from './textUtils';

const QDRANT_COLLECTION = 'daraq_books';

// Қайтарылатын құрылым (Interface)
export interface SearchResult {
  text: string;
  parentText?: string;
  book: string;
  page: number;
  pages?: number[];
  imageUrl: string;
  score: number;
  isQuran?: boolean;
  url?: string;
  audio_url?: string;
}

import { GoogleAuth } from 'google-auth-library';

const auth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});

/**
 * Google Cloud Vertex AI (Discovery Engine) Ranking API арқылы іріктелген нәтижелерді қайта бағалау (Reranker)
 */
async function rerankResults(query: string, documents: SearchResult[]): Promise<SearchResult[]> {
  if (documents.length === 0) return [];

  try {
    console.log(`[⏳] Vertex AI Reranker арқылы нәтижелерді қайта іріктеу (Rerank)...`);
    
    // Auth client configuration
    const client = await auth.getClient();
    const projectId = await auth.getProjectId();
    const url = `https://discoveryengine.googleapis.com/v1alpha/projects/${projectId}/locations/global/rankingConfigs/default_config:rank`;

    // Extract purely text contents to send to Vertex AI
    // The Ranking API accepts records with {id, content}
    const docTexts = documents.map((doc, index) => ({
      id: String(index),
      content: doc.text
    }));

    const response = await client.request({
      url,
      method: 'POST',
      data: {
        query: query,
        records: docTexts,
        ignoreRecordDetailsInResponse: false,
        topN: 5
      }
    });

    const MIN_RELEVANCE_SCORE = 0.40;

    const data: any = response.data;
    
    let rerankedDocs: SearchResult[] = [];
    if (data && data.records && Array.isArray(data.records)) {
      for (const res of data.records) {
         const originalIndex = parseInt(res.id, 10);
         const originalDoc = documents[originalIndex];
         const rScore = res.score !== undefined ? res.score : originalDoc.score;
         if (originalDoc) {
           originalDoc.score = rScore;
           rerankedDocs.push(originalDoc);
         }
      }
    }

    // Сотау (ең жоғарғы балл бірінші)
    rerankedDocs.sort((a, b) => (b.score || 0) - (a.score || 0));

    // Егер ешқандай құжат 0.40-тан аспаса, бірақ бәрібір ең жақсы байланысты құжаттар болса, 
    // кем дегенде 0.05-тен асатын алғашқы 3 құжатты аламыз.
    const strictDocs = rerankedDocs.filter(d => (d.score || 0) >= 0.40);
    
    if (strictDocs.length > 0) {
       rerankedDocs = strictDocs;
       console.log(`[✅] Rerank аяқталды. Үздік ${rerankedDocs.length} документ іріктелді (Score >= 0.40).`);
    } else {
       console.warn("[⚠️] Reranker-ден кейін бірде-бір məтін шектен (0.40) өте алмады. Жұмсақ шек қолданылуда (Score >= 0.05).");
       rerankedDocs = rerankedDocs.filter(d => (d.score || 0) >= 0.05).slice(0, 3);
       if (rerankedDocs.length === 0) {
           console.warn("[⚠️] Жұмсақ шектен де (0.05) өте алмады. Бос массив қайтарылады.");
       } else {
           console.log(`[✅] Жұмсақ шекпен үздік ${rerankedDocs.length} документ іріктелді.`);
       }
    }

    return rerankedDocs;
  } catch (error: any) {
    console.error("[❌] Reranker жүйесінде қате орын алды (Fallback іске қосылды):", error.message, error.response?.data);
    // Graceful fallback to Qdrant's best top-5 with a mini threshold
    const FALLBACK_MIN_QDRANT_SCORE = 0.005; // Qdrant RRF values are usually small (e.g. 0.01 - 0.03)
    const validFallbackDocs = documents.filter(doc => doc.score >= FALLBACK_MIN_QDRANT_SCORE);
    
    if (validFallbackDocs.length === 0) {
      console.warn("[⚠️] Fallback кезінде Qdrant нәтижелері де шектен (0.005) төмен болды. Бос массив қайтарылады.");
      return [];
    }
    
    return validFallbackDocs.slice(0, 5);
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
    let sparseVector: { indices: number[], values: number[] } | null = null;
    try {
      sparseVector = tokenizeAndHash(query);
    } catch (e) {
      console.warn(`[⚠️] Sparse вектор жасауда қате кетті, тек Dense іздеу қолданылады:`, e);
    }

    // Qdrant клиентін тексеру
    if (!qdrant) {
      console.warn(`[⚠️] Qdrant қосылмаған. Іздеу нәтижесіз аяқталды.`);
      return [];
    }

    // 3. Qdrant-тан Hybrid Search арқылы Top-30 chunk іздеу (RRF Fusion)
    console.log(`[⏳] Qdrant дерекқорынан Hybrid Search (RRF) арқылы ең ұқсас 30 үзіндіні іздеу...`);
    
    const prefetchRequests: any[] = [
      {
        query: denseVector,
        limit: 30
      }
    ];

    if (sparseVector && sparseVector.values.length > 0) {
      prefetchRequests.push({
        query: sparseVector,
        using: 'text_sparse',
        limit: 30
      });
    }

    const searchResponse = await qdrant.query(QDRANT_COLLECTION, {
      prefetch: prefetchRequests,
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
        parentText: payload.parentText ? String(payload.parentText) : undefined,
        book: String(payload.book || 'Белгісіз кітап'),
        page: pageNum,
        pages: pagesArray,
        imageUrl: String(payload.imageUrl || ''),
        score: hit.score || 0
      };
    });

    // 5. Reranker арқылы үздік 5-ті іріктеу
    if (formattedResults.length > 0) {
      const reranked = await rerankResults(query, formattedResults);
      
      const finalResults: SearchResult[] = [];
      const seenParents = new Set<string>();

      for (const doc of reranked) {
         // LLM контекстіне ең үлкен, толық Parent абзацты жібереміз. Егер ол жоқ болса, өзінің Child мәтінін жібереміз.
         const contentToUse = doc.parentText || doc.text;
         if (!seenParents.has(contentToUse)) {
            seenParents.add(contentToUse);
            finalResults.push({
               ...doc,
               text: contentToUse, // Агентке мәтінді беру үшін
               parentText: undefined // қажеті жоқ бұдан былай
            });
         }
      }
      return finalResults;
    }
    
    return [];

  } catch (error) {
    // 6. Қателерді ұстау және терминалға шығару
    console.error("\n[❌] Іздеу қызметінде қате орын алды:", error);
    return [];
  }
}
