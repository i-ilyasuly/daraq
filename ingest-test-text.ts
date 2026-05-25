import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { ai } from './src/backend/rag/aiClient';
import { qdrant } from './src/backend/db/qdrant';
import 'dotenv/config';

const QDRANT_COLLECTION = 'daraq_books';

async function ingestText(filePath: string, bookName: string) {
  if (!qdrant) return;
  const text = fs.readFileSync(filePath, 'utf8');
  const chunks = text.split('\n').filter(l => l.trim().length > 5);
  
  console.log(`Ingesting ${chunks.length} chunks from ${bookName}`);

  for (let i = 0; i < chunks.length; i++) {
    const chunkText = chunks[i];
    const sa = JSON.parse(fs.readFileSync('gcp-service-account.json', 'utf8'));
    const embeddingResponse = await ai.models.embedContent({
      model: 'gemini-embedding-2',
      contents: chunkText,
      config: {
        taskType: 'RETRIEVAL_DOCUMENT',
        outputDimensionality: 768
      },
      // Pass project and location directly to override if needed, 
      // but aiClient handles it.
    } as any);

    const vector = embeddingResponse.embeddings?.[0]?.values;
    if (!vector) continue;

    await qdrant.upsert(QDRANT_COLLECTION, {
      wait: true,
      points: [{
        id: uuidv4(),
        vector,
        payload: {
          book: bookName,
          page: i + 1,
          text: chunkText,
          imageUrl: '',
          language: 'kk'
        }
      }]
    });
    console.log(`Added chunk ${i+1}`);
  }
}

const args = process.argv.slice(2);
ingestText(args[0], args[1]).then(() => process.exit(0)).catch(console.error);
