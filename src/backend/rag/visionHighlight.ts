import { ImageAnnotatorClient } from '@google-cloud/vision';
import { storage, getGcpCredentials } from '../storage';
import sharp from 'sharp';

const BUCKET_NAME = process.env.GCS_BUCKET_NAME || 'daraq-processed-images';

let visionClient: ImageAnnotatorClient;
const gcpCreds = getGcpCredentials();
if (gcpCreds) {
  visionClient = new ImageAnnotatorClient({
    projectId: gcpCreds.projectId,
    credentials: gcpCreds.credentials
  });
} else {
  visionClient = new ImageAnnotatorClient();
}

export interface WordPolygon {
  text: string;
  vertices: { x: number; y: number }[];
}

export interface PageCoordinates {
  pageNumber: number;
  words: WordPolygon[];
}

/**
 * 1. Google Cloud Vision API арқылы суреттегі мәтін координаттарын алу
 */
export async function extractCoordinatesFromImage(imageBuffer: Buffer): Promise<WordPolygon[]> {
  const [result] = await visionClient.documentTextDetection({
     image: { content: imageBuffer }
  });
  const fullTextAnnotation = result.fullTextAnnotation;
  const words: WordPolygon[] = [];

  if (fullTextAnnotation && fullTextAnnotation.pages) {
    for (const page of fullTextAnnotation.pages) {
      if (!page.blocks) continue;
      for (const block of page.blocks) {
        if (!block.paragraphs) continue;
        for (const paragraph of block.paragraphs) {
          if (!paragraph.words) continue;
          for (const word of paragraph.words) {
            if (!word.symbols) continue;
            const wordText = word.symbols.map(s => s.text).join('');
            const vertices = word.boundingBox?.vertices?.map(v => ({
              x: v.x || 0,
              y: v.y || 0
            })) || [];
            words.push({ text: wordText, vertices });
          }
        }
      }
    }
  }

  return words;
}

/**
 * 2. Координаттарды GCS-ке жеке JSON етіп сақтау
 */
export async function saveCoordinatesToGCS(bookName: string, pageNumber: number, words: WordPolygon[]): Promise<string> {
  if (!storage) throw new Error("GCS қосылмаған.");
  const bucket = storage.bucket(BUCKET_NAME);
  const safeBookName = bookName.replace(/[^a-zA-Zа-яА-Я0-9-_]/g, '_');
  const fileName = `${safeBookName}/page_${pageNumber}.json`;
  
  const gcsFile = bucket.file(fileName);
  await gcsFile.save(JSON.stringify({ pageNumber, words }, null, 2), {
    resumable: false,
    metadata: { contentType: "application/json" }
  });
  
  return `gs://${BUCKET_NAME}/${fileName}`;
}

/**
 * 3. GCS-тен координаттар JSON файлын оқу
 */
export async function getCoordinatesFromGCS(bookName: string, pageNumber: number): Promise<WordPolygon[] | null> {
  if (!storage) return null;
  const bucket = storage.bucket(BUCKET_NAME);
  const safeBookName = bookName.replace(/[^a-zA-Zа-яА-Я0-9-_]/g, '_');
  const fileName = `${safeBookName}/page_${pageNumber}.json`;
  
  try {
    const [content] = await bucket.file(fileName).download();
    const data = JSON.parse(content.toString('utf-8')) as PageCoordinates;
    return data.words;
  } catch (err) {
    console.warn(`[⚠️] Жоқ JSON: ${fileName}`);
    return null;
  }
}

/**
 * 4. Дереккөз мәтінімен сәйкестендіріп, `sharp` арқылы суретке сары маркер қосу
 */
export async function highlightImage(imageBuffer: Buffer, words: WordPolygon[], targetText: string): Promise<Buffer> {
  // Normalize target text to array of words using Unicode letters/numbers
  const targetWords = targetText
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .split(/\s+/)
    .filter(Boolean);

  if (targetWords.length === 0 || words.length === 0) {
    return imageBuffer;
  }

  // Normalize polygon words
  const pageWords = words.map(w => ({
    ...w,
    cleanText: w.text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
  }));

  // Stop words to minimize false matching of common background words stretching the highlight
  const stopWords = new Set([
    'және', 'мен', 'де', 'да', 'та', 'те', 'бір', 'бұл', 'сол', 'ол', 'олар', 'оның', 
    'оған', 'оны', 'олардан', 'ішінде', 'үшін', 'бойынша', 'туралы', 'дейін', 'дейді', 
    'деп', 'болса', 'болады', 'болған', 'егер', 'кім', 'кімде', 'кісі', 'адам', 
    'ораза', 'құлшылық', 'құлшылығы', 'кітап', 'с.ғ.с', 'пайғамбар', 'алла', 'алланың',
    'ең', 'ал', 'күн', 'күні', 'ай', 'айы', 'жыл', 'жылы', 'басқа', 'бірнеше', 'болып',
    'сияқты', 'бұлардың', 'жеке', 'өтейік', 'ма', 'ме', 'ба', 'бе', 'па', 'пе',
    'сөзі', 'сөзінің', 'араб', 'тіліндегі', 'сөздікте', 'мағынасы', 'білдіреді'
  ]);

  // Build a set of significant target words (length >= 2)
  const targetSet = new Set(targetWords.filter(w => w.length >= 2));
  
  // Use Kadane's algorithm to find the optimal contiguous range (subarray) on the page 
  // that aligns with the targetText. This prevents solitary matches of common words
  // from stretching the highlight across the entire page.
  let maxSoFar = -Infinity;
  let maxEndingHere = 0;
  let startIndex = 0;
  let endIndex = 0;
  let tempStart = 0;
  let hasValidMatch = false;

  const wordScores = pageWords.map(word => {
    let score = -0.35; // Penalty for non-matching words
    if (word.cleanText && word.cleanText.length >= 2 && targetSet.has(word.cleanText)) {
      hasValidMatch = true;
      if (stopWords.has(word.cleanText) || word.cleanText.length < 3) {
        score = 0.15; // Low reward for common background/stop words
      } else {
        score = 1.2;  // High reward for unique content words
      }
    }
    return score;
  });

  if (hasValidMatch) {
    for (let i = 0; i < pageWords.length; i++) {
      maxEndingHere += wordScores[i];
      
      if (maxEndingHere > maxSoFar) {
        maxSoFar = maxEndingHere;
        startIndex = tempStart;
        endIndex = i;
      }
      
      if (maxEndingHere < 0) {
        maxEndingHere = 0;
        tempStart = i + 1;
      }
    }
  }

  // Kazakh-friendly stemming prefix/suffix match
  const isKazakhMatch = (pageWord: string, targets: string[]): boolean => {
    if (!pageWord || pageWord.length < 2) return false;
    for (const tw of targets) {
      if (tw.length < 2) continue;
      // Exact match
      if (pageWord === tw) return true;
      // Stem matching: restrict to >= 3 characters to avoid false matches (such as "де" with "денедегі")
      if (tw.length >= 3 && pageWord.startsWith(tw)) return true;
      if (pageWord.length >= 3 && tw.startsWith(pageWord)) return true;
    }
    return false;
  };

  // Find exact boundaries within the optimal matching window
  let trimmedStart = startIndex;
  let trimmedEnd = endIndex;

  if (hasValidMatch && maxSoFar > 3.0) {
    while (trimmedStart <= trimmedEnd) {
      const word = pageWords[trimmedStart];
      if (word.cleanText && isKazakhMatch(word.cleanText, targetWords)) {
        break;
      }
      trimmedStart++;
    }
    while (trimmedEnd >= trimmedStart) {
      const word = pageWords[trimmedEnd];
      if (word.cleanText && isKazakhMatch(word.cleanText, targetWords)) {
        break;
      }
      trimmedEnd--;
    }
  }

  const polygonsToDraw: WordPolygon[] = [];
  // Solid match check: only highlight if evidence is strong enough (density maxSoFar > 3.0)
  if (hasValidMatch && maxSoFar > 3.0 && trimmedStart <= trimmedEnd) {
    // Highlight all words in the trimmed window continuously to prevent gaps/breaks
    for (let i = trimmedStart; i <= trimmedEnd; i++) {
      polygonsToDraw.push(pageWords[i]);
    }
  }

  if (polygonsToDraw.length === 0) {
    return imageBuffer; 
  }

  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width || 800;
  const height = metadata.height || 1200;

  /**
   * Mathematically expand word polygon vertices along text alignment direction.
   * This provides perfect alignment and continuous look without any vertical drifts.
   */
  function expandPolygon(vertices: { x: number; y: number }[], padX: number, padY: number): { x: number; y: number }[] {
    if (vertices.length !== 4) return vertices;
    
    const v0 = vertices[0]; // Top-Left
    const v1 = vertices[1]; // Top-Right
    const v2 = vertices[2]; // Bottom-Right
    const v3 = vertices[3]; // Bottom-Left

    // Top horizontal unit vector
    const dxTop = v1.x - v0.x;
    const dyTop = v1.y - v0.y;
    const lenTop = Math.hypot(dxTop, dyTop) || 1;
    const uxTop = dxTop / lenTop;
    const uyTop = dyTop / lenTop;

    // Bottom horizontal unit vector
    const dxBot = v2.x - v3.x;
    const dyBot = v2.y - v3.y;
    const lenBot = Math.hypot(dxBot, dyBot) || 1;
    const uxBot = dxBot / lenBot;
    const uyBot = dyBot / lenBot;

    // Left vertical unit vector
    const dxLeft = v3.x - v0.x;
    const dyLeft = v3.y - v0.y;
    const lenLeft = Math.hypot(dxLeft, dyLeft) || 1;
    const uxLeft = dxLeft / lenLeft;
    const uyLeft = dyLeft / lenLeft;

    // Right vertical unit vector
    const dxRight = v2.x - v1.x;
    const dyRight = v2.y - v1.y;
    const lenRight = Math.hypot(dxRight, dyRight) || 1;
    const uxRight = dxRight / lenRight;
    const uyRight = dyRight / lenRight;

    return [
      {
        x: v0.x - uxTop * padX - uxLeft * padY,
        y: v0.y - uyTop * padX - uyLeft * padY
      },
      {
        x: v1.x + uxTop * padX - uxRight * padY,
        y: v1.y + uyTop * padX - uyRight * padY
      },
      {
        x: v2.x + uxBot * padX + uxRight * padY,
        y: v2.y + uyBot * padX + uyRight * padY
      },
      {
        x: v3.x - uxBot * padX + uxLeft * padY,
        y: v3.y - uyBot * padX + uyLeft * padY
      }
    ];
  }

  let svgPolygons = '';
  // Render word polygons as beautifully contoured, continuous and slightly overlapping highlights
  for (const poly of polygonsToDraw) {
    if (poly.vertices && poly.vertices.length === 4) {
      // Horizontal expand is 4.5px, vertical expand is 1.5px to achieve seamless continuous highlight line matching actual lines perfectly
      const expanded = expandPolygon(poly.vertices, 4.5, 1.5);
      const points = expanded.map(v => `${v.x.toFixed(1)},${v.y.toFixed(1)}`).join(' ');
      svgPolygons += `<polygon points="${points}" fill="rgba(255, 235, 59, 0.45)" stroke="none" />\n`;
    }
  }

  const svgOverlay = `
    <svg width="${width}" height="${height}">
      ${svgPolygons}
    </svg>
  `;

  const blendedBuffer = await sharp(imageBuffer)
    .composite([
      { input: Buffer.from(svgOverlay), blend: 'over' }
    ])
    .png()
    .toBuffer();

  return blendedBuffer;
}
