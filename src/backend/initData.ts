import { qdrant } from './db/qdrant';
import { ai, embedText } from './rag/aiClient';
import { v4 as uuidv4 } from 'uuid';
import 'dotenv/config';

const QDRANT_COLLECTION = 'daraq_books';

export async function initTestData() {
  if (!qdrant) {
    console.log('Qdrant is not connected. Skipping initTestData.');
    return;
  }

  try {
    const collections = await qdrant.getCollections();
    const exists = collections.collections.some(c => c.name === QDRANT_COLLECTION);
    
    let needsIngest = false;

    if (!exists) {
      console.log(`Collection ${QDRANT_COLLECTION} not found. Creating...`);
      await qdrant.createCollection(QDRANT_COLLECTION, {
        vectors: { size: 1536, distance: 'Cosine' }
      });
      console.log(`Qdrant collection created: ${QDRANT_COLLECTION}`);
      needsIngest = true;
    } else {
      console.log(`Collection ${QDRANT_COLLECTION} exists. Checking if empty...`);
      const info = await qdrant.getCollection(QDRANT_COLLECTION);
      if (info.points_count === 0) {
        console.log(`Collection ${QDRANT_COLLECTION} is empty. Auto-ingesting...`);
        needsIngest = true;
      } else {
        console.log(`Collection ${QDRANT_COLLECTION} already has ${info.points_count} points. Skipping auto-ingest.`);
      }
    }

    if (needsIngest) {
      console.log('Ingesting test data (Auto-Ingest)...');
      
      const testTexts = [
        "Сапар намазы: Ханафи мәзһабында 90 шақырымнан (км) асатын жолға шыққан адам жолаушы (мүсәпір) саналады.",
        "Жолаушы сапар барысында 4 рәкағаттық парыз намаздарды (Бесін, Екінті, Құптан) екі рәкағат етіп қысқартып оқиды. Бұл дініміздегі үлкен жеңілдік.",
        "Ақшам намазы мен таң намазының парыздары, сондай-ақ үтір уәжіп намазы қысқартылмайды, толық оқылады."
      ];

      for (let i = 0; i < testTexts.length; i++) {
        const text = testTexts[i];
        
        const embeddingResponse = await embedText({
          model: 'gemini-embedding-2',
          contents: text,
          config: {
            taskType: 'RETRIEVAL_DOCUMENT',
            outputDimensionality: 1536
          }
        });
        
        let vector = embeddingResponse.embeddings?.[0]?.values;
        if (!vector) continue;

        if (vector.length === 768) {
          vector = [...vector, ...Array(768).fill(0)];
        }

        const chunkId = uuidv4();
        await qdrant.upsert(QDRANT_COLLECTION, {
          wait: true,
          points: [
            {
              id: chunkId,
              vector,
              payload: {
                book: "Сапар фиқһы (Сынақ нұсқа)",
                page: i + 1,
                text: text,
                imageUrl: "", // Бос сурет
                language: "kk",
                source_type: "primary_book",
                reliability: "high"
              }
            }
          ]
        });
      }
      
      console.log('Test data successfully ingested into Qdrant.');
    }
  } catch (error) {
    console.error("Error during auto-ingest test data:", error);
  }
}
