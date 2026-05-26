import { qdrant } from '../db/qdrant';
import { ai, embedText } from './aiClient';
import { SearchResult } from './searchService';
import crypto from 'crypto';

const CACHE_COLLECTION = 'daraq_cache';
const CACHE_THRESHOLD = 0.95;

export interface CacheEntry {
  answer: string;
  sources: SearchResult[];
}

export async function checkCache(query: string): Promise<{ hit: CacheEntry | null; vector?: number[] }> {
  if (!qdrant) return { hit: null };

  try {
    const embeddingResponse = await embedText({
      model: 'gemini-embedding-2',
      contents: query,
      config: {
        taskType: 'RETRIEVAL_QUERY',
        outputDimensionality: 1536
      }
    });

    let denseVector = embeddingResponse.embeddings?.[0]?.values;
    if (!denseVector) return { hit: null };

    if (denseVector.length === 768) {
      denseVector = [...denseVector, ...Array(768).fill(0)];
    }

    // Ensure collection exists (lazy create) is not needed for search, it'll just fail gracefully
    const searchResult = await qdrant.search(CACHE_COLLECTION, {
      vector: denseVector,
      limit: 1,
      with_payload: true
    }).catch(err => {
      if (err?.message?.includes('Not found') || err?.status === 404) {
        return []; // Collection doesn't exist yet
      }
      throw err;
    });

    if (searchResult && searchResult.length > 0) {
      const hit = searchResult[0];
      if (hit.score >= CACHE_THRESHOLD) {
        console.log(`[⚡] Кэштен жауап табылды! (Score: ${hit.score})`);
        return {
          hit: {
            answer: String(hit.payload?.answer || ''),
            sources: (hit.payload?.sources as SearchResult[]) || []
          },
          vector: denseVector
        };
      }
    }

    return { hit: null, vector: denseVector };
  } catch (error) {
    console.warn('\n[⚠️] Qdrant кэштен оқу сәтсіз аяқталды:', error);
  }
  return { hit: null }; // Жоқ болса немесе қате болса null
}

export async function writeCache(query: string, answer: string, sources: SearchResult[]) {
  if (!qdrant) return;

  try {
    const embeddingResponse = await embedText({
      model: 'gemini-embedding-2',
      contents: query,
      config: {
        taskType: 'RETRIEVAL_DOCUMENT',
        outputDimensionality: 1536
      }
    });

    let denseVector = embeddingResponse.embeddings?.[0]?.values;
    if (!denseVector) return;

    if (denseVector.length === 768) {
      denseVector = [...denseVector, ...Array(768).fill(0)];
    }

    const id = crypto.randomUUID();
    
    try {
      await qdrant.upsert(CACHE_COLLECTION, {
        points: [
          {
            id,
            vector: denseVector,
            payload: { query, answer, sources }
          }
        ]
      });
    } catch(err: any) {
      // Create collection if missing
      if (err?.message?.includes('Not found') || err?.status === 404) {
        console.log(`[⏳] '${CACHE_COLLECTION}' коллекциясы табылған жоқ. Жаңадан құрылуда...`);
        await qdrant.createCollection(CACHE_COLLECTION, {
          vectors: {
            size: 1536,
            distance: 'Cosine'
          }
        });
        await qdrant.upsert(CACHE_COLLECTION, {
          points: [
            {
              id,
              vector: denseVector,
              payload: { query, answer, sources }
            }
          ]
        });
      } else {
        throw err;
      }
    }
    
    console.log(`[✅] Сұрақ-жауап кэшке сақталды: "${query.substring(0, 50)}..."`);
  } catch (error) {
    console.warn('\n[⚠️] Qdrant кэшке жазу сәтсіз аяқталды:', error);
  }
}
