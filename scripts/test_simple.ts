import { embedText, GEMINI_EMBEDDING_MODEL } from '../src/backend/rag/aiClient';
import { qdrant } from '../src/backend/db/qdrant';
import 'dotenv/config';

async function testSimple() {
  console.log("Checking ENV vars:");
  console.log("GEMINI_API_KEY exists?", !!process.env.GEMINI_API_KEY);
  console.log("QDRANT_URL:", process.env.QDRANT_URL);
  
  console.log("\n1. Testing Gemini Embedding API...");
  const startEmbed = performance.now();
  try {
    const embedRes1 = await embedText({
      model: GEMINI_EMBEDDING_MODEL,
      contents: "Оразаның денсаулыққа пайдасы қандай?",
      config: {
        taskType: 'RETRIEVAL_QUERY',
        outputDimensionality: 1536
      }
    });
    const endEmbed1 = performance.now();
    console.log("Embedding Success! Time:", (endEmbed1 - startEmbed).toFixed(2), "ms");
    console.log("Vector size:", embedRes1.embeddings?.[0]?.values?.length);
  } catch (err: any) {
    console.error("Embedding Failed! Error:", err.message || err);
  }

  console.log("\n2. Testing Qdrant connectivity...");
  if (qdrant) {
    try {
      const startQdrant = performance.now();
      const collections = await qdrant.getCollections();
      const endQdrant = performance.now();
      console.log("Qdrant Success! Collections:", collections.collections.map(c => c.name), "Time:", (endQdrant - startQdrant).toFixed(2), "ms");
    } catch (err: any) {
      console.error("Qdrant Failed! Error:", err.message || err);
    }
  } else {
    console.log("Qdrant not initialized.");
  }
}

testSimple().then(() => process.exit(0)).catch(e => {
  console.error(e);
  process.exit(1);
});
