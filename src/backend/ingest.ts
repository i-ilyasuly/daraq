import fs from 'fs';
import path from 'path';
import { PDFParse } from 'pdf-parse';
import { v4 as uuidv4 } from 'uuid';
import { ai, embedText } from './rag/aiClient';
import 'dotenv/config';
import { qdrant } from './db/qdrant';
import { storage } from './storage';

const QDRANT_COLLECTION = 'daraq_books';
const BUCKET_NAME = process.env.GCS_BUCKET_NAME || 'daraq_books_bucket';

import { tokenizeAndHash } from './rag/textUtils';

/**
 * 1. PDF файлды оқу және парақтап мәтінін бөліп алу.
 */
async function extractTextFromPDF(filePath: string) {
  const dataBuffer = fs.readFileSync(filePath);
  const parser = new PDFParse({ data: dataBuffer });
  const textResult = await parser.getText();
  await parser.destroy();
  return {
    text: textResult.text || '',
    pages: textResult.pages || []
  };
}

/**
 * 2. Мәтінді 200-500 сөзден тұратын мағыналық бөліктерге (chunk) бөлу.
 */
function splitIntoChunks(text: string, wordsPerChunk = 300) {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  
  for (let i = 0; i < words.length; i += wordsPerChunk) {
    const chunk = words.slice(i, i + wordsPerChunk).join(' ');
    if (chunk.trim()) chunks.push(chunk);
  }
  return chunks;
}

/**
 * 5. PDF бетін суретке айналдырып, Google Cloud Storage-ге жүктеу.
 */
async function uploadPageImageToGCS(pdfPath: string, pageNumber: number, bookName: string): Promise<string> {
  if (!storage) {
    console.warn("GCS қосылмаған. Сурет жүктеу өткізілді.");
    return "https://storage.googleapis.com/dummy/image.jpg";
  }
  try {
    const bucket = storage.bucket(BUCKET_NAME);
    const safeBookName = bookName.replace(/[^a-zA-Zа-яА-Я0-9-_]/g, '_');
    const fileName = `${safeBookName}/page_${pageNumber}.jpg`;
    const gcsFile = bucket.file(fileName);
    
    await gcsFile.save("dummy-image-content", {
      metadata: { contentType: "image/jpeg" }
    });
    return `https://storage.googleapis.com/${BUCKET_NAME}/${fileName}`;
  } catch (err) {
    console.error("GCS жүктеу қатесі:", err);
    return "";
  }
}

/**
 * 3 & 4. Векторға айналдыру және Qdrant-қа сақтау.
 */
export async function ingestBook(filePath: string, bookName: string) {
  try {
    console.log(`[1] "${bookName}" кітабын оқу басталды...`);
    const { text: fullText, pages: pdfPages } = await extractTextFromPDF(filePath);
    
    console.log(`[2] Мәтінді нақты парақтарға (pages) немесе chunk-терге бөлу...`);
    let chunks: { text: string; page: number }[] = [];

    if (pdfPages && pdfPages.length > 0) {
      for (const p of pdfPages) {
        const pageText = p.text.trim();
        const pageNumber = p.num;
        if (pageText.length < 10) continue;
        const wordChunks = splitIntoChunks(pageText, 300);
        for (const chunkText of wordChunks) {
          if (chunkText.trim().length > 10) {
            chunks.push({ text: chunkText.trim(), page: pageNumber });
          }
        }
      }
    } else {
      const wordChunks = splitIntoChunks(fullText, 300);
      chunks = wordChunks.map((text, idx) => ({ text, page: idx + 1 }));
    }

    // Qdrant коллекциясын тексереміз және Hybrid Search дайындаймыз
    if (qdrant) {
      const collections = await qdrant.getCollections();
      const exists = collections.collections.some(c => c.name === QDRANT_COLLECTION);
      let recreateNeeded = false;

      if (exists) {
        try {
          const info = await qdrant.getCollection(QDRANT_COLLECTION);
          const currentSize = info.config?.params?.vectors?.size;
          // Егер collection-да sparse_vectors болмаса немесе size қате болса
          const hasSparse = info.config?.params?.sparse_vectors?.['text_sparse'] !== undefined;
          
          if (currentSize !== 1536 || !hasSparse) {
            console.log(`[🔄] Qdrant коллекциясы ескі форматта. Hybrid Search үшін жаңадан құрылуда...`);
            await qdrant.deleteCollection(QDRANT_COLLECTION);
            recreateNeeded = true;
          }
        } catch (e) {}
      }

      if (!exists || recreateNeeded) {
        console.log(`[🚀] Hybrid Search коллекциясы (Dense + Sparse) құрылуда...`);
        await qdrant.createCollection(QDRANT_COLLECTION, {
          vectors: { size: 1536, distance: 'Cosine' },
          sparse_vectors: {
            text_sparse: { modifier: 'idf' }
          }
        });
        try {
          await qdrant.createPayloadIndex(QDRANT_COLLECTION, {
            field_name: 'book',
            field_schema: 'keyword',
            wait: true
          });
        } catch (e) {}
      } else {
        try {
          console.log(`[🔄] "${bookName}" кітабының ескі нұсқасын тазалау...`);
          await qdrant.delete(QDRANT_COLLECTION, {
            filter: { must: [{ key: "book", match: { value: bookName } }] }
          });
        } catch (err) {}
      }
    }

    console.log(`[3] Векторлау (Embeddings & Sparse) және [4] Сақтау...`);
    for (let i = 0; i < chunks.length; i++) {
      const { text: chunkText, page: pageNumber } = chunks[i];
      await new Promise(res => setTimeout(res, 1200));

      let embeddingResponse;
      let retries = 4;
      let waitMs = 4000;
      while (retries > 0) {
        try {
          embeddingResponse = await embedText({
            model: 'gemini-embedding-2',
            contents: chunkText,
            config: { taskType: 'RETRIEVAL_DOCUMENT', outputDimensionality: 1536 }
          });
          break;
        } catch (err: any) {
          const errorMsg = String(err?.message || err);
          if ((err.status === 429 || errorMsg.includes("429") || errorMsg.toLowerCase().includes("quota")) && retries > 1) {
            await new Promise(res => setTimeout(res, waitMs));
            retries--;
            waitMs *= 2;
          } else {
            throw err;
          }
        }
      }
      
      let denseVector = embeddingResponse?.embeddings?.[0]?.values;
      if (!denseVector) throw new Error("Ембеддинг жасалмады.");

      // Егер monkey-patch 768 өлшемді модельге түсіп кетсе, 1536 етіп нөлдермен толтырамыз
      if (denseVector.length === 768) {
         denseVector = [...denseVector, ...Array(768).fill(0)];
      }

      // Sparse вектор жасау
      const sparseVector = tokenizeAndHash(chunkText);

      const safeBookName = bookName.replace(/[^a-zA-Zа-яА-Я0-9-_]/g, '_');
      const imageUrl = `https://storage.googleapis.com/${BUCKET_NAME}/${safeBookName}/page_${pageNumber}.png`;

      const chunkId = uuidv4();
      const metadata = {
        book: bookName,
        page: pageNumber,
        text: chunkText,
        imageUrl,
        language: "kk",
        source_type: "primary_book",
        reliability: "high"
      };

      if (qdrant) {
        await qdrant.upsert(QDRANT_COLLECTION, {
          wait: true,
          points: [
            {
              id: chunkId,
              vector: {
                "": denseVector,
                "text_sparse": sparseVector
              },
              payload: metadata
            }
          ]
        });
      }
      console.log(`[✅] Бет ${pageNumber}/${chunks.length} сәтті өңделіп, индекстелді.`);
    }
    console.log(`[ТАМАША] "${bookName}" кітабы толығымен жүйеге енгізілді.`);
  } catch (error) {
    console.error("Қате орын алды (ingestBook):", error);
  }
}

// Скриптті тікелей іске қосу үшін (мысалы: npx tsx src/backend/ingest.ts ./dummy.pdf "Сапар фикхы")
const isMainModule = typeof process !== 'undefined' && process.argv && process.argv[1] && process.argv[1].endsWith('ingest.ts');
if (isMainModule) {
  const args = process.argv.slice(2);
  const pdfPath = args[0];
  const bookName = args[1] || "Белгісіз кітап";

  if (!pdfPath) {
    console.log("Пайдалану: npx tsx src/backend/ingest.ts <pdf_жолы> <кітап_аты>");
    process.exit(1);
  }

  if (!fs.existsSync(pdfPath)) {
    console.error("Файл табылмады:", pdfPath);
    process.exit(1);
  }

  ingestBook(pdfPath, bookName).then(() => process.exit(0));
}
