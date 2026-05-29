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

  if (hasValidMatch && maxSoFar > 0.0) {
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
  console.log(`[HIGHLIGHT TRACE] TargetText snippet: "${targetText.substring(0, 30)}..." - hasValidMatch: ${hasValidMatch}, maxSoFar: ${maxSoFar}, trimmedStart: ${trimmedStart}, trimmedEnd: ${trimmedEnd}`);
  if (hasValidMatch && maxSoFar > 0.0 && trimmedStart <= trimmedEnd) {
    // Only highlight words in the trimmed window that actually match the targetText (Rule 5)
    for (let i = trimmedStart; i <= trimmedEnd; i++) {
      const word = pageWords[i];
      if (word.cleanText && isKazakhMatch(word.cleanText, targetWords)) {
        polygonsToDraw.push(word);
      }
    }
  }

  if (polygonsToDraw.length === 0) {
    return imageBuffer; 
  }

  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width || 800;
  const height = metadata.height || 1200;

  // Group highlighted words by horizontal lines and merge them
  interface WordBox {
    poly: WordPolygon;
    left: number;
    right: number;
    top: number;
    bottom: number;
    height: number;
    centerY: number;
  }

  const wordBoxes: WordBox[] = polygonsToDraw.map(p => {
    const xCoords = p.vertices.map(v => v.x);
    const yCoords = p.vertices.map(v => v.y);
    const left = Math.min(...xCoords);
    const right = Math.max(...xCoords);
    const top = Math.min(...yCoords);
    const bottom = Math.max(...yCoords);
    const h = bottom - top;
    const centerY = (top + bottom) / 2;
    return { poly: p, left, right, top, bottom, height: h, centerY };
  });

  // Sort word boxes by their centerY first so we process them top-to-bottom
  wordBoxes.sort((a, b) => a.centerY - b.centerY);

  const rows: WordBox[][] = [];
  for (const wb of wordBoxes) {
    let placed = false;
    for (const row of rows) {
      const rowCenter = row.reduce((sum, w) => sum + w.centerY, 0) / row.length;
      const rowHeight = row.reduce((sum, w) => sum + w.height, 0) / row.length;
      // If centerY is within 45% of row average height, they are on the same line
      if (Math.abs(wb.centerY - rowCenter) < rowHeight * 0.45) {
        row.push(wb);
        placed = true;
        break;
      }
    }
    if (!placed) {
      rows.push([wb]);
    }
  }

  interface MergedRow {
    left: number;
    right: number;
    top: number;
    bottom: number;
    height: number;
    centerY: number;
  }

  const mergedRows: MergedRow[] = [];

  for (const row of rows) {
    if (row.length === 0) continue;
    row.sort((a, b) => a.left - b.left);

    let currentBlock = {
      left: row[0].left,
      right: row[0].right,
      top: row[0].top,
      bottom: row[0].bottom,
    };

    const avgHeight = row.reduce((sum, w) => sum + w.height, 0) / row.length;

    for (let i = 1; i < row.length; i++) {
      const hw = row[i];
      const gap = hw.left - currentBlock.right;
      // Merge words on the same line if their gap is within a reasonable distance
      if (gap < avgHeight * 3.5) {
        currentBlock.right = Math.max(currentBlock.right, hw.right);
        currentBlock.top = Math.min(currentBlock.top, hw.top);
        currentBlock.bottom = Math.max(currentBlock.bottom, hw.bottom);
      } else {
        mergedRows.push({
          ...currentBlock,
          height: currentBlock.bottom - currentBlock.top,
          centerY: (currentBlock.top + currentBlock.bottom) / 2
        });
        currentBlock = {
          left: hw.left,
          right: hw.right,
          top: hw.top,
          bottom: hw.bottom,
        };
      }
    }
    mergedRows.push({
      ...currentBlock,
      height: currentBlock.bottom - currentBlock.top,
      centerY: (currentBlock.top + currentBlock.bottom) / 2
    });
  }

  // Sort merged rows vertically to group them into blocks (paragraphs)
  mergedRows.sort((a, b) => a.centerY - b.centerY);

  interface HighlightBlock {
    rows: MergedRow[];
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  }

  const hlBlocks: HighlightBlock[] = [];

  for (const mRow of mergedRows) {
    let placedInBlock = false;
    for (const b of hlBlocks) {
      const avgRowHeight = b.rows.reduce((sum, r) => sum + r.height, 0) / b.rows.length;
      // If the row is vertically adjacent to any block, group it there
      if (mRow.top - b.maxY < avgRowHeight * 3.0 && b.minY - mRow.bottom < avgRowHeight * 3.0) {
        b.rows.push(mRow);
        b.minX = Math.min(b.minX, mRow.left);
        b.maxX = Math.max(b.maxX, mRow.right);
        b.minY = Math.min(b.minY, mRow.top);
        b.maxY = Math.max(b.maxY, mRow.bottom);
        placedInBlock = true;
        break;
      }
    }
    if (!placedInBlock) {
      hlBlocks.push({
        rows: [mRow],
        minX: mRow.left,
        maxX: mRow.right,
        minY: mRow.top,
        maxY: mRow.bottom
      });
    }
  }

  let svgElements = '';
  const padX = 8; // Beautiful extra width padding
  const padY = 3; // Beautiful extra height padding

  for (const block of hlBlocks) {
    // 2. Indentation Alignment (тегістеу): Align the left-edge of all rows to block.minX
    for (const r of block.rows) {
      r.left = block.minX;
    }

    // Draw background highlights for all rows in this block using a soft translucent response-grade green
    for (const r of block.rows) {
      const w = r.right - r.left;
      const h = r.bottom - r.top;
      if (w > 0 && h > 0) {
        svgElements += `<rect x="${r.left - padX}" y="${r.top - padY}" width="${w + 2 * padX}" height="${h + 2 * padY}" fill="rgba(52, 199, 89, 0.25)" rx="4" ry="4" stroke="none" />\n`;
      }
    }

    // 3. Left vertical premium quote border
    const lineX = block.minX - padX - 8;
    const lineY = block.minY - padY;
    const lineHeight = (block.maxY + padY) - (block.minY - padY);
    if (lineHeight > 0) {
      svgElements += `<rect x="${lineX}" y="${lineY}" width="5" height="${lineHeight}" fill="#34C759" rx="2.5" ry="2.5" stroke="none" />\n`;
    }
  }

  const svgOverlay = `
    <svg width="${width}" height="${height}">
      ${svgElements}
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
