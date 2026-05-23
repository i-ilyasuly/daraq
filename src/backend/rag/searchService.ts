import { qdrant } from '../db/qdrant';
import { ai } from './aiClient';
import 'dotenv/config';

const QDRANT_COLLECTION = 'daraq_books';

// Қайтарылатын құрылым (Interface)
export interface SearchResult {
  text: string;
  book: string;
  page: number;
  imageUrl: string;
  score: number;
}

/**
 * Пайдаланушының сұрағы бойынша Dense Search (Семантикалық іздеу) жүргізеді.
 * @param query - Пайдаланушының сұрағы.
 * @returns Ең ұқсас 5 үзінді (chunk) және олардың метадатасы.
 */
export async function searchAnswers(query: string): Promise<SearchResult[]> {
  try {
    console.log(`\n[🔎] Іздеу басталды. Сұрақ: "${query}"`);

    // 1. Сұрақты векторға айналдыру
    console.log(`[⏳] Сұрақты векторға (Embeddings) айналдыру...`);
    const embeddingResponse = await ai.models.embedContent({
      model: 'gemini-embedding-2',
      contents: query,
      config: {
        taskType: 'RETRIEVAL_QUERY',
        outputDimensionality: 768 // Ingest кезіндегі өлшемге сәйкес (text-multilingual-embedding-002)
      }
    });

    const vector = embeddingResponse.embeddings?.[0]?.values;
    if (!vector) {
      throw new Error("Сұрақтан вектор жасалмады.");
    }
    console.log(`[✅] Вектор сәтті құрылды.`);

    // Qdrant клиентін тексеру
    if (!qdrant) {
      console.warn(`[⚠️] Qdrant қосылмаған. Іздеу нәтижесіз аяқталды.`);
      return [];
    }

    // 2. Qdrant-тан Dense Search арқылы Top-5 chunk іздеу
    console.log(`[⏳] Qdrant дерекқорынан ең ұқсас үзінділерді іздеу...`);
    const searchResults = await qdrant.search(QDRANT_COLLECTION, {
      vector: vector,
      limit: 5,
      with_payload: true // Метадатаны қоса алу үшін
    });

    console.log(`[✅] ${searchResults.length} ұқсас үзінді табылды.`);

    // 4. Нәтижелерді таза құрылымдалған массив ретінде шығару
    const formattedResults: SearchResult[] = searchResults.map(hit => {
      const payload = hit.payload || {};
      
      return {
        text: String(payload.text || ''),
        book: String(payload.book || 'Белгісіз кітап'),
        page: Number(payload.page || 0),
        imageUrl: String(payload.imageUrl || ''),
        score: hit.score, // Ұқсастық дәрежесі (Cosine similarity ұпайы)
      };
    });

    return formattedResults;

  } catch (error) {
    // 5. Қателерді ұстау және терминалға шығару
    console.error("\n[❌] Іздеу қызметінде қате орын алды:", error);
    return [];
  }
}
