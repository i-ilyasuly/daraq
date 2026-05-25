import './src/backend/crypto-patch';
import { storage } from './src/backend/storage';
import { ai } from './src/backend/rag/aiClient';

console.log("Storage client initialized successfully?", !!storage);
console.log("AI client initialized successfully?", !!ai);

async function testEmbedding() {
  try {
    console.log("Testing embedding content via 'gemini-embedding-2'...");
    const res = await ai.models.embedContent({
      model: 'gemini-embedding-2',
      contents: 'Сәлем әлем!',
      config: {
        taskType: 'RETRIEVAL_DOCUMENT',
        outputDimensionality: 768
      }
    });
    console.log("Embedding response success! Vector size:", res.embeddings?.[0]?.values?.length);
  } catch (err: any) {
    console.error("Embedding response failed:", err.message || err);
  }
}

testEmbedding();
