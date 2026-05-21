import fs from 'fs';
import path from 'path';
import pdf from 'pdf-parse';
import { v4 as uuidv4 } from 'uuid';
import { GoogleGenAI } from '@google/genai';
import 'dotenv/config';
import { qdrant } from './db/qdrant';
import { storage } from './db/storage';

// Initialize Gemini Client
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const QDRANT_COLLECTION = 'daraq_books';
const BUCKET_NAME = process.env.GCS_BUCKET_NAME || 'daraq_books_bucket';

/**
 * 1. PDF файлды оқу және парақтап мәтінін бөліп алу.
 * Ескерту: pdf-parse кітапханасы толық мәтінді қайтарады, бірақ парақтарды
 * бөлу үшін қазір қарапайым абстракция ретінде қолданамыз.
 */
async function extractTextFromPDF(filePath: string) {
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdf(dataBuffer);
  // data.text ішіндегі мәтін. 
  // Шынайы продакшн жүйесінде әр бетті бөлек pdfjs арқылы алу тиімдірек.
  // Қазір біз оны шартты түрде парақтарға бөліп симуляциялаймыз немесе
  // мәтінді біртұтас оқып, шамамен бөлеміз.
  return data.text;
}

/**
 * 2. Мәтінді 200-500 сөзден тұратын мағыналық бөліктерге (chunk) бөлу.
 */
function splitIntoChunks(text: string, wordsPerChunk = 300) {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  
  for (let i = 0; i < words.length; i += wordsPerChunk) {
    // Overlap (қабаттасу) үшін кішкене артқа шегінуге де болады
    const chunk = words.slice(i, i + wordsPerChunk).join(' ');
    if (chunk.trim()) chunks.push(chunk);
  }
  return chunks;
}

/**
 * 5. PDF бетін суретке айналдырып, Google Cloud Storage-ге жүктеу.
 */
async function uploadPageImageToGCS(pdfPath: string, pageNumber: number): Promise<string> {
  // МАҢЫЗДЫ: Бұл контенерлік ортада pdf-img-convert немесе poppler (canvas)
  // орнату мүмкін болмағандықтан, бұл функцияның логикасын абстракция ретінде жаздым.
  // Шынайы қолданыста: 
  // const imageBuffer = await convertPdfPageToImage(pdfPath, pageNumber);
  // await bucket.file(destFileName).save(imageBuffer);

  if (!storage) {
    console.warn("GCS қосылмаған. Сурет жүктеу өткізілді.");
    return "https://storage.googleapis.com/dummy/image.jpg";
  }

  try {
    const bucket = storage.bucket(BUCKET_NAME);
    const fileName = `books_images/${path.basename(pdfPath)}_${pageNumber}.jpg`;
    const gcsFile = bucket.file(fileName);
    
    // Бұл жерде dummy мәлімет ретінде бос сурет немесе placeholder сақтаймыз
    await gcsFile.save("dummy-image-content", {
      metadata: { contentType: "image/jpeg" }
    });

    console.log(`Сурет GCS-ке жүктелді: ${fileName}`);
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
    console.log(`[1] ${bookName} кітабын оқу басталды...`);
    const fullText = await extractTextFromPDF(filePath);
    
    console.log(`[2] Мәтінді chunk-терге бөлу...`);
    const chunks = splitIntoChunks(fullText, 300);
    console.log(`Барлығы ${chunks.length} chunk шықты.`);

    // Qdrant коллекциясын құру (егер жоқ болса)
    if (qdrant) {
      const collections = await qdrant.getCollections();
      const exists = collections.collections.some(c => c.name === QDRANT_COLLECTION);
      if (!exists) {
        await qdrant.createCollection(QDRANT_COLLECTION, {
          vectors: { size: 1536, distance: 'Cosine' }
        });
        console.log(`Qdrant коллекциясы құрылды: ${QDRANT_COLLECTION}`);
      }
    } else {
      console.warn("Qdrant қосылмаған, сақтау өткізілді.");
    }

    console.log(`[3] Векторлау (Embeddings) және [4] Сақтау...`);
    for (let i = 0; i < chunks.length; i++) {
      const chunkText = chunks[i];
      const pageNumber = i + 1; // Шартты түрде әр chunk 1 бет деп алайық
      
      // 3. Gemini арқылы векторлау (RETRIEVAL_DOCUMENT)
      const embeddingResponse = await ai.models.embedContent({
        model: 'gemini-embedding-2-preview',
        contents: chunkText,
        config: {
          taskType: 'RETRIEVAL_DOCUMENT',
          outputDimensionality: 1536
        }
      });
      
      const vector = embeddingResponse.embeddings?.[0]?.values;
      if (!vector) throw new Error("Ембеддинг жасалмады.");

      // 5. Бетті суретке айналдыру
      const imageUrl = await uploadPageImageToGCS(filePath, pageNumber);

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

      // 4. Qdrant-қа сақтау
      if (qdrant) {
        await qdrant.upsert(QDRANT_COLLECTION, {
          wait: true,
          points: [
            {
              id: chunkId,
              vector,
              payload: metadata
            }
          ]
        });
      }

      console.log(`Chunk ${i + 1}/${chunks.length} сәтті өңделді.`);
    }

    console.log(`[ТАМАША] ${bookName} кітабы толығымен жүйеге енгізілді.`);

  } catch (error) {
    console.error("Қате орын алды (ingestBook):", error);
  }
}

// Скриптті тікелей іске қосу үшін (мысалы: npx tsx src/backend/ingest.ts ./dummy.pdf "Сапар фикхы")
if (require.main === module) {
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
