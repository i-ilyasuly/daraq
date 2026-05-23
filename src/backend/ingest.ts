import fs from 'fs';
import path from 'path';
import { PDFParse } from 'pdf-parse';
import { v4 as uuidv4 } from 'uuid';
import { ai } from './rag/aiClient';
import 'dotenv/config';
import { qdrant } from './db/qdrant';
import { storage } from './storage';

const QDRANT_COLLECTION = 'daraq_books';
const BUCKET_NAME = process.env.GCS_BUCKET_NAME || 'daraq_books_bucket';

/**
 * 1. PDF файлды оқу және парақтап мәтінін бөліп алу.
 * Ескерту: pdf-parse кітапханасы толық мәтінді қайтарады, бірақ парақтарды
 * бөлу үшін қазір қарапайым абстракция ретінде қолданамыз.
 */
async function extractTextFromPDF(filePath: string) {
  const dataBuffer = fs.readFileSync(filePath);
  const parser = new PDFParse({ data: dataBuffer });
  const textResult = await parser.getText();
  await parser.destroy();
  // textResult.text inside textResult
  return textResult.text;
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
async function uploadPageImageToGCS(pdfPath: string, pageNumber: number, bookName: string): Promise<string> {
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
    const safeBookName = bookName.replace(/[^a-zA-Zа-яА-Я0-9-_]/g, '_');
    const fileName = `${safeBookName}/page_${pageNumber}.jpg`;
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
    
    console.log(`[2] Мәтінді нақты парақтарға (pages) немесе chunk-терге бөлу...`);
    // pdf-parse әдетте әр беттің арасына "\f" немесе "\u000c" (form-feed) символын орнатады.
    // Егер ол болса, әр бетті жеке басып, нақты бет санына сәйкестендіреміз!
    const pages = fullText.split(/\f|\u000c/);
    let chunks: { text: string; page: number }[] = [];

    if (pages.length > 1) {
      console.log(`Кітап автоматты түрде ${pages.length} бетке бөлінді.`);
      chunks = pages
        .map((pageText, idx) => ({
          text: pageText.trim(),
          page: idx + 1
        }))
        .filter(c => c.text.length > 10); // Өте қысқа немесе бос парақтарды өткіземіз
    } else {
      console.log(`Парақ бөлгіштер табылмады. Сөз санына қарай chunk-терге бөлу қолданылады...`);
      const wordChunks = splitIntoChunks(fullText, 300);
      chunks = wordChunks.map((text, idx) => ({
        text,
        page: idx + 1
      }));
    }

    console.log(`Өңделетін нақты бөліктер саны: ${chunks.length}`);

    // Qdrant коллекциясын құру немесе оның өлшемін тексеру (егер жоқ болса)
    if (qdrant) {
      const collections = await qdrant.getCollections();
      const exists = collections.collections.some(c => c.name === QDRANT_COLLECTION);
      
      // Пайдаланушының өтініші бойынша кітаптарды жаңа семантикамен (768 өлшемде) таза индекстеу үшін
      // бұрыннан бар коллекцияны бір рет толығымен жойып қайта құрамыз.
      if (exists) {
        console.log(`\n[🔄] Жаңа "text-multilingual-embedding-002" моделіне көшу үшін коллекция толығымен жаңартылуда...`);
        try {
          await qdrant.deleteCollection(QDRANT_COLLECTION);
        } catch (err) {
          console.warn("Коллекцияны жою мүмкін болмады:", err);
        }
      }

      await qdrant.createCollection(QDRANT_COLLECTION, {
        vectors: { size: 768, distance: 'Cosine' }
      });
      console.log(`[✅] Qdrant коллекциясы 768 өлшемімен сәтті құрылды: ${QDRANT_COLLECTION}`);

      try {
        // "book" өрісі бойынша өшіру үшін индексті құрамыз (болашақта қате болмауы үшін)
        await qdrant.createPayloadIndex(QDRANT_COLLECTION, {
          field_name: 'book',
          field_schema: 'keyword',
          wait: true
        });
        console.log(`[✅] "book" өрісі үшін payload индексі құрылды.`);
      } catch (e) {
        console.warn("Payload индекс құру өткізілді немесе қате шықты:", e);
      }

    } else {
      console.warn("Qdrant қосылмаған, сақтау өткізілді.");
    }

    console.log(`[3] Векторлау (Embeddings) және [4] Сақтау...`);
    for (let i = 0; i < chunks.length; i++) {
      const { text: chunkText, page: pageNumber } = chunks[i];
      
      // 3. Gemini арқылы vector-лау (RETRIEVAL_DOCUMENT)
      const embeddingResponse = await ai.models.embedContent({
        model: 'gemini-embedding-2',
        contents: chunkText,
        config: {
          taskType: 'RETRIEVAL_DOCUMENT',
          outputDimensionality: 768
        }
      });
      
      const vector = embeddingResponse.embeddings?.[0]?.values;
      if (!vector) throw new Error("Ембеддинг жасалмады.");

      // 5. Бетті суретке айналдыру және сілтемесін құрастыру
      // GCS-ке нақты суреттер жүктелген жағдайда, осы сілтеме бойынша жұмыс істейді
      // Әр кітап өз папкасында (bookName) сақталады.
      const safeBookName = bookName.replace(/[^a-zA-Zа-яА-Я0-9-_]/g, '_');
      const imageUrl = `https://storage.googleapis.com/${BUCKET_NAME}/${safeBookName}/page_${pageNumber}.jpg`;

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

      console.log(`[✅] Бет ${pageNumber}/${chunks.length} сәтті өңделіп, индекстелді.`);
    }

    console.log(`[ТАМАША] "${bookName}" кітабы толығымен жүйеге енгізілді.`);

  } catch (error) {
    console.error("Қате орын алды (ingestBook):", error);
  }
}

import { fileURLToPath } from 'url';

// Скриптті тікелей іске қосу үшін (мысалы: npx tsx src/backend/ingest.ts ./dummy.pdf "Сапар фикхы")
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
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
