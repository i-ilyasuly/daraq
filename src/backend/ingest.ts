import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { ai, embedText } from './rag/aiClient';
import 'dotenv/config';
import { qdrant } from './db/qdrant';
import { storage } from './storage';

const QDRANT_COLLECTION = 'daraq_books';
const BUCKET_NAME = process.env.GCS_BUCKET_NAME || 'daraq-processed-images';

import { tokenizeAndHash } from './rag/textUtils';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
// @ts-ignore
import { createCanvas } from 'canvas';
// pdfjsLib.GlobalWorkerOptions.workerSrc = 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs';

/**
 * 1. PDF файлды оқу және парақтап мәтінін бөліп алу.
 */
async function extractTextFromPDF(filePath: string) {
  const data = new Uint8Array(fs.readFileSync(filePath));
  const loadingTask = pdfjsLib.getDocument({
    data,
    standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/',
  });
  const pdfDocument = await loadingTask.promise;
  
  let fullText = '';
  const pages: { num: number; text: string }[] = [];

  for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
    const page = await pdfDocument.getPage(pageNum);
    const textContent = await page.getTextContent();
    const pageStrings = textContent.items.map((item: any) => item.str);
    const text = pageStrings.join(' ');
    fullText += text + '\n\n';
    pages.push({ num: pageNum, text });
  }

  return {
    text: fullText,
    pages: pages
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
async function uploadPageImageToGCS(pdfPath: string, pageNumber: number, bookName: string, imageBuffer?: Buffer): Promise<string> {
  if (!storage) {
    console.warn("GCS қосылмаған. Сурет жүктеу өткізілді.");
    return "https://storage.googleapis.com/dummy/image.jpg";
  }
  try {
    const bucket = storage.bucket(BUCKET_NAME);
    const safeBookName = bookName.replace(/[^a-zA-Zа-яА-Я0-9-_]/g, '_');
    const fileName = `${safeBookName}/page_${pageNumber}.png`;
    const gcsFile = bucket.file(fileName);
    
    // Егер шынайы сурет Buffer берілсе, соны салып, GCS-ке жүктейміз
    if (imageBuffer) {
      await gcsFile.save(imageBuffer, {
        resumable: false,
        metadata: { contentType: "image/png" }
      });
    } else {
      await gcsFile.save("dummy-image-content", {
        resumable: false,
        metadata: { contentType: "image/png" }
      });
    }

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

    console.log(`[2.5] Бұлтқа кітап суреттерін және координаттарын (Vision API) талдап жүктеу...`);
    
    const data = new Uint8Array(fs.readFileSync(filePath));
    const loadingTask = pdfjsLib.getDocument({
      data,
      standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/',
      cMapUrl: 'node_modules/pdfjs-dist/cmaps/',
      cMapPacked: true,
    });
    const pdfDocument = await loadingTask.promise;
    
    const uploadedImagesMap = new Map<number, string>();

    for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
      try {
        console.log(` - ${pageNum} бетін суретке айналдыру және өңдеу...`);
        const page = await pdfDocument.getPage(pageNum);
        const viewport = page.getViewport({ scale: 2.0 });
        const canvas = createCanvas(viewport.width, viewport.height);
        const context = canvas.getContext('2d');
        const renderContext = { canvasContext: context as any, viewport: viewport } as any;
        
        await page.render(renderContext).promise;

        // Manual text rendering hack because node-canvas lacks native PDFJS text rendering hooks
        const textContent = await page.getTextContent();
        context.fillStyle = 'black';
        for (const item of textContent.items as any[]) {
          // pdfjs transform matrix mapping to viewport
          const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
          const x = tx[4];
          const y = tx[5];
          // Determine font size roughly based on transform scale
          const fontSize = Math.abs(tx[0]);
          context.font = `${fontSize}px sans-serif`;
          context.fillText(item.str, x, y);
        }

        const imageBuffer = canvas.toBuffer('image/png');

        if (imageBuffer) {
           const imageUrl = await uploadPageImageToGCS(filePath, pageNum, bookName, imageBuffer);
           uploadedImagesMap.set(pageNum, imageUrl);
        }
      } catch (err) {
        console.warn(`[⚠️] ${pageNum} бетті суретке айналдыру қатесі:`, err);
        const imageUrl = await uploadPageImageToGCS(filePath, pageNum, bookName);
        uploadedImagesMap.set(pageNum, imageUrl);
      }
    }

    let concatenatedText = "";
    const offsetMap: { page: number; start: number; end: number }[] = [];

    if (pdfPages && pdfPages.length > 0) {
      for (const p of pdfPages) {
        const pageText = p.text || "";
        const pageNumber = p.num;
        const start = concatenatedText.length;
        concatenatedText += pageText + "\n";
        const end = concatenatedText.length;
        offsetMap.push({ page: pageNumber, start, end });
      }
    } else {
      concatenatedText = fullText || "";
      offsetMap.push({ page: 1, start: 0, end: concatenatedText.length });
    }

    // Split text into contiguous 200-500 word chunks with overlap and trace back to pages
    const wordRegex = /\S+/g;
    const words: { word: string; start: number; end: number }[] = [];
    let wordMatch: RegExpExecArray | null;
    while ((wordMatch = wordRegex.exec(concatenatedText)) !== null) {
      words.push({
        word: wordMatch[0],
        start: wordMatch.index,
        end: wordMatch.index + wordMatch[0].length
      });
    }

    const PARENT_WORDS = 800;
    const PARENT_OVERLAP = 100;
    const CHILD_WORDS = 150;
    const CHILD_OVERLAP = 30;

    interface LocalChunk {
      text: string;
      pages: number[];
      start: number;
      end: number;
    }

    const parentChunks: LocalChunk[] = [];
    if (words.length > 0) {
      const stepParent = PARENT_WORDS - PARENT_OVERLAP > 0 ? PARENT_WORDS - PARENT_OVERLAP : PARENT_WORDS;
      for (let i = 0; i < words.length; i += stepParent) {
        const chunkWords = words.slice(i, i + PARENT_WORDS);
        if (chunkWords.length === 0) break;
        const startChar = chunkWords[0].start;
        const endChar = chunkWords[chunkWords.length - 1].end;
        const chunkText = concatenatedText.substring(startChar, endChar);
        if (chunkText.trim().length > 10) {
          const chunkPages: number[] = [];
          for (const entry of offsetMap) {
            if (entry.start < endChar && entry.end > startChar) {
              chunkPages.push(entry.page);
            }
          }
          if (chunkPages.length === 0) chunkPages.push(1);
          parentChunks.push({ text: chunkText.trim(), pages: chunkPages, start: startChar, end: endChar });
        }
        if (i + PARENT_WORDS >= words.length) break;
      }
    }

    const childChunks: { text: string; pages: number[]; parentText: string }[] = [];
    if (words.length > 0) {
      const stepChild = CHILD_WORDS - CHILD_OVERLAP > 0 ? CHILD_WORDS - CHILD_OVERLAP : CHILD_WORDS;
      for (let i = 0; i < words.length; i += stepChild) {
        const chunkWords = words.slice(i, i + CHILD_WORDS);
        if (chunkWords.length === 0) break;
        const startChar = chunkWords[0].start;
        const endChar = chunkWords[chunkWords.length - 1].end;
        const chunkText = concatenatedText.substring(startChar, endChar);
        
        if (chunkText.trim().length > 10) {
          const chunkPages: number[] = [];
          for (const entry of offsetMap) {
            if (entry.start < endChar && entry.end > startChar) {
              chunkPages.push(entry.page);
            }
          }
          if (chunkPages.length === 0) chunkPages.push(1);

          const childCenter = startChar + (endChar - startChar) / 2;
          const parent = parentChunks.find(p => p.start <= childCenter && childCenter <= p.end) || parentChunks[0] || { text: chunkText.trim() };

          childChunks.push({ text: chunkText.trim(), pages: chunkPages, parentText: parent.text });
        }
        if (i + CHILD_WORDS >= words.length) break;
      }
    }

    let chunks = childChunks;

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
      const { text: chunkText, pages: chunkPages, parentText } = chunks[i];
      const pageNumber = chunkPages[0] || 1;
      await new Promise(res => setTimeout(res, 2200));

      let embeddingResponse;
      let retries = 6;
      let waitMs = 5000;
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
          console.warn(`[⚠️] Embedding failed, retrying in ${waitMs}ms (${retries} entries left)... Error:`, errorMsg);
          if (retries > 1) {
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

      // Егер балама модель өлшемі 1536-дан өзгеше болса (мысалы 3072 немесе 768), оны автоматты түрде реттейміз (Ережелерге сай)
      if (denseVector.length > 1536) {
        denseVector = denseVector.slice(0, 1536);
      } else if (denseVector.length < 1536) {
        denseVector = [...denseVector, ...Array(1536 - denseVector.length).fill(0)];
      }

      const chunkId = uuidv4();
      
      // Sparse вектор жасау
      let sparseVector: { indices: number[], values: number[] } | undefined;
      try {
        sparseVector = tokenizeAndHash(chunkText);
      } catch (e) {
        console.warn(`[⚠️] Sparse вектор жасауда қате кетті, chunkId ${chunkId}:`, e);
        sparseVector = { indices: [], values: [] };
      }

      const safeBookName = bookName.replace(/[^a-zA-Zа-яА-Я0-9-_]/g, '_');
      const imageUrl = `https://storage.googleapis.com/${BUCKET_NAME}/${safeBookName}/page_${pageNumber}.png`;

      const metadata = {
        book: bookName,
        page: pageNumber,
        pages: chunkPages,
        text: chunkText,
        parentText: parentText,
        imageUrl,
        language: "kk",
        source_type: "primary_book",
        reliability: "high"
      };

      if (qdrant) {
        // Егер sparseVector бос болса, vector ішінен алып тастаймыз немесе бос массив жібереміз
        const vectorData: any = {
          "": denseVector
        };
        
        if (sparseVector && sparseVector.values.length > 0) {
          vectorData["text_sparse"] = sparseVector;
        }

        await qdrant.upsert(QDRANT_COLLECTION, {
          wait: true,
          points: [
            {
              id: chunkId,
              vector: vectorData,
              payload: metadata
            }
          ]
        });
      }
      console.log(`[✅] Беттер [${chunkPages.join(', ')}] (бөлік ${i + 1}/${chunks.length}) сәтті өңделіп, индекстелді.`);
    }
    console.log(`[ТАМАША] "${bookName}" кітабы толығымен жүйеге енгізілді.`);
  } catch (error) {
    console.error("Қате орын алды (ingestBook):", error);
  }
}

// Скриптті тікелей іске қосу үшін (мысалы: npx tsx src/backend/ingest.ts ./dummy.pdf "Сапар фикхы")
const isMainModule = typeof process !== 'undefined' && process.argv && process.argv[1] && path.basename(process.argv[1]) === 'ingest.ts';
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
