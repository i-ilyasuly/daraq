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
    const { text: fullText, pages: pdfPages } = await extractTextFromPDF(filePath);
    
    console.log(`[2] Мәтінді нақты парақтарға (pages) немесе chunk-терге бөлу...`);
    let chunks: { text: string; page: number }[] = [];

    if (pdfPages && pdfPages.length > 0) {
      console.log(`Кітап автоматты түрде ${pdfPages.length} бетке бөлінді.`);
      
      // Әр бетті жеке оқып, егер бет ұзын болса, оны кішігірім chunk-терге бөлеміз.
      // Осылайша бір бетте бірнеше chunk болуы мүмкін, бірақ бәрінің page мәні дұрыс болады!
      for (const p of pdfPages) {
        const pageText = p.text.trim();
        const pageNumber = p.num;
        
        if (pageText.length < 10) continue; // Өте қысқа немесе бос парақтарды өткіземіз
        
        // Бет мәтінін сөз санына қарай бөлшектейміз (әр бөлікке сол беттің нөмірін сақтаймыз)
        const wordChunks = splitIntoChunks(pageText, 300); // Әр chunk ~300 сөз
        for (const chunkText of wordChunks) {
          if (chunkText.trim().length > 10) {
            chunks.push({
              text: chunkText.trim(),
              page: pageNumber
            });
          }
        }
      }
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
      let recreateNeeded = false;

      if (exists) {
        try {
          const info = await qdrant.getCollection(QDRANT_COLLECTION);
          const currentSize = info.config?.params?.vectors?.size;
          if (currentSize !== 1536) {
            console.log(`[🔄] Qdrant коллекция өлшемі сәйкес келмейді: ${currentSize}. 1536 өлшемді жаңа коллекция құру қажет.`);
            await qdrant.deleteCollection(QDRANT_COLLECTION);
            recreateNeeded = true;
          }
        } catch (e) {
          console.warn("Коллекция өлшемін тексеру кезінде қате:", e);
        }
      }

      if (!exists || recreateNeeded) {
        console.log(`[🚀] Коллекция табылмады немесе қайта құрылуда. Жаңадан құрылуда (Өлшем: 1536)...`);
        await qdrant.createCollection(QDRANT_COLLECTION, {
          vectors: { size: 1536, distance: 'Cosine' }
        });
        
        try {
          // "book" өрісі бойынша индексті құрамыз
          await qdrant.createPayloadIndex(QDRANT_COLLECTION, {
            field_name: 'book',
            field_schema: 'keyword',
            wait: true
          });
          console.log(`[✅] "book" өрісі үшін payload индексі құрылды.`);
        } catch (e) {
          console.warn("Payload индекс құру өткізілді:", e);
        }
      } else {
        console.log(`[ℹ️] Коллекция бар (Өлшем: 1536). Бұрынғы мәліметтерді тазаламаймыз.`);
        
        // Маңызды: Егер осы кітап бұрын жүктелген болса, тек соны ғана өшіреміз (duplicates болмауы үшін)
        try {
          console.log(`[🔄] "${bookName}" кітабының ескі нұсқасын тазалау...`);
          await qdrant.delete(QDRANT_COLLECTION, {
            filter: {
              must: [{ key: "book", match: { value: bookName } }]
            }
          });
        } catch (err) {
          console.warn("Ескі нұсқаны өшіру мүмкін болмады:", err);
        }
      }
    } else {
      console.warn("Qdrant қосылмаған, сақтау өткізілді.");
    }

    console.log(`[3] Векторлау (Embeddings) және [4] Сақтау...`);
    for (let i = 0; i < chunks.length; i++) {
      const { text: chunkText, page: pageNumber } = chunks[i];
      
      // Rate-limiting delay to prevent quota issues
      await new Promise(res => setTimeout(res, 1200));

      // 3. Gemini арқылы vector-лау (RETRIEVAL_DOCUMENT) - retry logics on 429 included
      let embeddingResponse;
      let retries = 4;
      let waitMs = 4000;
      while (retries > 0) {
        try {
          embeddingResponse = await ai.models.embedContent({
            model: 'gemini-embedding-2',
            contents: chunkText,
            config: {
              taskType: 'RETRIEVAL_DOCUMENT',
              outputDimensionality: 1536
            }
          });
          break; // Success!
        } catch (err: any) {
          const errorMsg = String(err?.message || err);
          if ((err.status === 429 || errorMsg.includes("429") || errorMsg.toLowerCase().includes("quota")) && retries > 1) {
            console.warn(`[⚠️ Квота/Лимит шектеуі (429)] ${waitMs / 1000} секунд күтіп, қайталап көреміз (Әрекеттер саны қалды: ${retries - 1})...`);
            await new Promise(res => setTimeout(res, waitMs));
            retries--;
            waitMs *= 2; // Exponential backoff
          } else {
            throw err;
          }
        }
      }
      
      const vector = embeddingResponse?.embeddings?.[0]?.values;
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
