import { Telegraf, Markup } from 'telegraf';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import { Storage } from '@google-cloud/storage';
import { storage as customStorage } from '../storage';
import { searchAnswers } from '../rag/searchService';
import { generateAgentAnswerStream } from '../rag/aiService';
import { ai } from '../rag/aiClient';
import { db } from '../db/firestore';
import { getCoordinatesFromGCS, highlightImage } from '../rag/visionHighlight';

const storage = customStorage || new Storage();
// Fallback for dev: if you don't set it, it'll try this name
const PROCESSED_BUCKET = process.env.PROCESSED_IMAGES_BUCKET || 'daraq-497018-daraq-processed-images';

interface SourceInfo {
  book: string;
  page: number;
  pages?: number[];
  imageUrl: string;
  targetText?: string;
}

// ... original cache map
const sourceCache = new Map<string, SourceInfo>();
const groupCache = new Map<string, SourceInfo[]>();

/**
 * Firestore-бағытталған кэшті қолдау үшін көмекші функциялар (Stateless контейнерде жоғалмауы үшін)
 */
export async function getSourceInfo(id: string): Promise<SourceInfo | undefined> {
  const mem = sourceCache.get(id);
  if (mem) return mem;

  if (db) {
    try {
      const doc = await db.collection('sourceCache').doc(id).get();
      if (doc.exists) {
        const data = doc.data() as SourceInfo;
        sourceCache.set(id, data);
        return data;
      }
    } catch (e) {
      console.error('[⚠️] Error retrieving from Firestore sourceCache:', e);
    }
  }
  return undefined;
}

export function setSourceInfo(id: string, info: SourceInfo): void {
  sourceCache.set(id, info);
  if (db) {
    db.collection('sourceCache').doc(id).set(info).catch(e => {
      console.error('[⚠️] Error saving to Firestore sourceCache:', e);
    });
  }
}

export async function getGroupInfo(id: string): Promise<SourceInfo[] | undefined> {
  const mem = groupCache.get(id);
  if (mem) return mem;

  if (db) {
    try {
      const doc = await db.collection('groupCache').doc(id).get();
      if (doc.exists) {
        const data = (doc.data() as { sources: SourceInfo[] }).sources;
        groupCache.set(id, data);
        return data;
      }
    } catch (e) {
      console.error('[⚠️] Error retrieving from Firestore groupCache:', e);
    }
  }
  return undefined;
}

export function setGroupInfo(id: string, sources: SourceInfo[]): void {
  groupCache.set(id, sources);
  if (db) {
    db.collection('groupCache').doc(id).set({ sources }).catch(e => {
      console.error('[⚠️] Error saving to Firestore groupCache:', e);
    });
  }
}

interface PaginationState {
  quranSources: any[];
  bookSources: any[];
  quranPageIndex: number;
}

const paginationCache = new Map<string, PaginationState>();
const renamedTopicsCache = new Set<string>();

export function processAndDeduplicateSources(rawSources: any[]): { quranSources: any[]; bookSources: any[] } {
  if (!rawSources || rawSources.length === 0) {
    return { quranSources: [], bookSources: [] };
  }

  const quranSources: any[] = [];
  const bookSources: any[] = [];

  const seenQuran = new Set<string>();
  const seenBook = new Set<string>();

  for (const src of rawSources) {
    if (!src) continue;

    const isQuran = src.isQuran || 
                    (src.book && src.book.endsWith('сүресі')) || 
                    (src.url && src.url.toLowerCase().includes('quran.com'));

    if (isQuran) {
      const key = src.url || `${src.book}_${src.page}`;
      if (!seenQuran.has(key)) {
        seenQuran.add(key);
        quranSources.push({
          book: src.book,
          page: src.page || 1,
          url: src.url || 'https://quran.com',
          isQuran: true,
          text: src.text || ""
        });
      }
    } else {
      const chunkPages = src.pages && Array.isArray(src.pages) ? src.pages.map(Number) : [src.page || 1];
      const key = `${src.book}_${chunkPages.join('_')}`;
      if (!seenBook.has(key)) {
        seenBook.add(key);
        bookSources.push({
          book: src.book,
          page: chunkPages[0] || 1,
          pages: chunkPages,
          imageUrl: src.imageUrl || "",
          text: src.text || ""
        });
      }
    }
  }

  return { quranSources, bookSources };
}

export function buildKeyboard(quranSources: any[], bookSources: any[], quranPageIndex: number, pagId: string): any {
  const buttons: any[][] = [];

  // 1. Дәлел суреттері (діни кітап беттері) – әрқашан міндетті түрде жоғарыда
  if (bookSources && bookSources.length > 0) {
    if (bookSources.length === 1) {
      const src = bookSources[0];
      const pages = src.pages && Array.isArray(src.pages) ? src.pages : [src.page || 1];
      
      if (src.imageUrl || src.book) {
        if (pages.length <= 1) {
          const btnLabel = `🖼 Дәлел суретті көру (${src.page}-бет)`;
          
          // Find existing or create unique sourceId
          let sourceId = '';
          for (const [key, val] of sourceCache.entries()) {
            if (val.book === src.book && val.page === src.page) {
              sourceId = key;
              break;
            }
          }
          if (!sourceId) {
            sourceId = uuidv4().substring(0, 8);
            setSourceInfo(sourceId, {
              book: src.book,
              page: src.page,
              pages: pages,
              imageUrl: src.imageUrl || "",
              targetText: src.text || ""
            });
          }
          
          buttons.push([Markup.button.callback(btnLabel, `view_source_${sourceId}`)]);
        } else {
          // If 2 or more pages, it becomes a group button!
          const groupId = uuidv4().substring(0, 8);
          // Wait! Let's build GCS and image naming helper for GCS paths dynamically
          const sourcesList = pages.map((p: number) => ({
            book: src.book,
            page: p,
            imageUrl: src.imageUrl || "",
            targetText: src.text || ""
          }));
          setGroupInfo(groupId, sourcesList);

          const btnLabel = `🖼 Барлық дәлел суреттерін көру (${pages.length} сурет)`;
          buttons.push([Markup.button.callback(btnLabel, `view_srcgrp_${groupId}`)]);
        }
      }
    } else {
      // Multiple chunks! Let's collect all unique book/page combinations across all chunks
      const allPages: { book: string; page: number; imageUrl: string; targetText?: string }[] = [];
      const seen = new Set<string>();
      
      for (const src of bookSources) {
        const pages = src.pages && Array.isArray(src.pages) ? src.pages : [src.page || 1];
        for (const p of pages) {
          const key = `${src.book}_${p}`;
          if (!seen.has(key)) {
            seen.add(key);
            allPages.push({
              book: src.book,
              page: p,
              imageUrl: src.imageUrl || "",
              targetText: src.text || ""
            });
          }
        }
      }

      if (allPages.length === 1) {
        const item = allPages[0];
        const btnLabel = `🖼 Дәлел суретті көру (${item.page}-бет)`;
        
        let sourceId = '';
        for (const [key, val] of sourceCache.entries()) {
          if (val.book === item.book && val.page === item.page) {
            sourceId = key;
            break;
          }
        }
        if (!sourceId) {
          sourceId = uuidv4().substring(0, 8);
          setSourceInfo(sourceId, {
            book: item.book,
            page: item.page,
            pages: [item.page],
            imageUrl: item.imageUrl || "",
            targetText: item.targetText || ""
          });
        }
        buttons.push([Markup.button.callback(btnLabel, `view_source_${sourceId}`)]);
      } else {
        const groupId = uuidv4().substring(0, 8);
        setGroupInfo(groupId, allPages);

        const btnLabel = `🖼 Барлық дәлел суреттерін көру (${allPages.length} сурет)`;
        buttons.push([Markup.button.callback(btnLabel, `view_srcgrp_${groupId}`)]);
      }
    }
  }

  if (buttons.length === 0) return null;
  return Markup.inlineKeyboard(buttons);
}

/**
 * Қазақша кириллицаны латыншаға транслитерациялау функциясы
 */
export function transliterateToLatin(text: string): string {
  const map: { [key: string]: string } = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo', 'ж': 'zh', 'з': 'z',
    'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r',
    'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'kh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch',
    'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
    'ә': 'ae', 'ғ': 'g', 'қ': 'q', 'ң': 'n', 'ө': 'o', 'ұ': 'u', 'ү': 'u', 'һ': 'h', 'і': 'i',
    'А': 'A', 'Б': 'B', 'В': 'V', 'Г': 'G', 'Д': 'D', 'Е': 'E', 'Ё': 'Yo', 'Ж': 'Zh', 'З': 'Z',
    'И': 'I', 'Й': 'Y', 'К': 'K', 'Л': 'L', 'M': 'M', 'Н': 'N', 'О': 'O', 'П': 'P', 'Р': 'R',
    'С': 'S', 'Т': 'T', 'У': 'U', 'Ф': 'F', 'Х': 'Kh', 'Ц': 'Ts', 'Ч': 'Ch', 'Ш': 'Sh', 'Щ': 'Shch',
    'Ы': 'Y', 'Э': 'E', 'Ю': 'Yu', 'Я': 'Ya',
    'Ә': 'Ae', 'Ғ': 'G', 'Қ': 'Q', 'Ң': 'N', 'Ө': 'O', 'Ұ': 'U', 'Ү': 'U', 'Һ': 'H', 'І': 'I'
  };
  return text.split('').map(char => map[char] || char).join('');
}

/**
 * Сурет үстіне су белгісін (Watermark) салатын функция
 */
async function addWatermark(imageUrl: string, bookName: string, pageNumber: number, targetText?: string): Promise<Buffer> {
  const watermarkText = `Daraq: ${bookName}, ${pageNumber} бет`;
  const svgText = `
    <svg width="800" height="80">
      <rect width="100%" height="100%" fill="rgba(0,0,0,0.6)" />
      <text x="50%" y="50%" text-anchor="middle" dy=".3em" font-family="sans-serif" font-size="28" fill="white">
        ${watermarkText}
      </text>
    </svg>
  `;

  let baseImageBuffer: Buffer;
  let useFallbackWatermark = false;

  try {
    const bucket = storage.bucket(PROCESSED_BUCKET);
    
    // Мүмкін болатын барлық атау форматтары мен транслитерацияларды тізімдейміз
    const safeBookName = bookName.replace(/[^a-zA-Zа-яА-Я0-9-_]/g, '_');
    const latinBookRaw = transliterateToLatin(bookName);
    const latinBookWithUnderscore = latinBookRaw.replace(/[^a-zA-Z0-9-_]/g, '_');
    const latinBookNoSpacesOrPunctuation = latinBookRaw.replace(/[^a-zA-Z0-9]/g, '');

    const possibleNames = [
      // 1. Транслитерация бойынша (мысалы Oraza_qulshylygy)
      `${latinBookWithUnderscore}/page_${pageNumber}.png`,
      `${latinBookWithUnderscore}/page_${pageNumber}.jpg`,
      `${latinBookWithUnderscore}/page_${pageNumber}.jpeg`,
      // 2. Барлық бос орындар мүлдем жоқ транслитерация бойынша (мысалы Orazaqulshylygy немеse Zhumanamazy)
      `${latinBookNoSpacesOrPunctuation}/page_${pageNumber}.png`,
      `${latinBookNoSpacesOrPunctuation}/page_${pageNumber}.jpg`,
      `${latinBookNoSpacesOrPunctuation}/page_${pageNumber}.jpeg`,
      // 3. Кириллица бойынша тазаланған (мысалы Ораза_құлшылығы)
      `${safeBookName}/page_${pageNumber}.png`,
      `${safeBookName}/page_${pageNumber}.jpg`,
      `${safeBookName}/page_${pageNumber}.jpeg`,
      // 4. Тікелей берілген кітап атауы бойынша
      `${bookName}/page_${pageNumber}.png`,
      `${bookName}/page_${pageNumber}.jpg`,
      `${bookName}/page_${pageNumber}.jpeg`,
    ];

    let fileToDownload: any = null;
    let foundName = '';

    for (const name of possibleNames) {
      const f = bucket.file(name);
      const [exists] = await f.exists();
      if (exists) {
        fileToDownload = f;
        foundName = name;
        break;
      }
    }

    if (!fileToDownload) {
      throw new Error(`Шынайы сурет GCS ішіндегі ізделген нұсқалардың ешбірінен табылмады. Қаралған жолдар: ${possibleNames.join(', ')}`);
    }

    console.log(`[🎯] Шынайы сурет табылды: ${foundName}`);
    
    // Суретті жүктеп алу
    const [imageContent] = await fileToDownload.download();
    baseImageBuffer = imageContent;
    
    // Сурет жарамдылығын sharp арқылы тексеру
    await sharp(baseImageBuffer).metadata();
  } catch (err) {
    console.warn(`[⚠️] Жаппай суретті алу қатесі, fallback қосылады:`, err);
    useFallbackWatermark = true;
    
    // Егер GCS-тен алынған сурет жарамсыз болса (немесе табылмаса), әдемі визуалды шаблон (placeholder) жасаймыз
    const placeholderSvg = `
      <svg width="800" height="600" xmlns="http://www.w3.org/2000/svg">
        <!-- Background -->
        <rect width="100%" height="100%" fill="#f4f1ea" />
        
        <!-- Outer Border -->
        <rect x="20" y="20" width="760" height="560" fill="none" stroke="#8b7355" stroke-width="3" rx="15" />
        
        <!-- Inner Border -->
        <rect x="35" y="35" width="730" height="530" fill="none" stroke="#d4c5b0" stroke-width="1.5" rx="8" />
        
        <!-- Corner Ornaments (Simplified) -->
        <circle cx="35" cy="35" r="5" fill="#8b7355" />
        <circle cx="765" cy="35" r="5" fill="#8b7355" />
        <circle cx="35" cy="565" r="5" fill="#8b7355" />
        <circle cx="765" cy="565" r="5" fill="#8b7355" />
        
        <!-- Center Book / Watermark placeholder -->
        <text x="50%" y="40%" text-anchor="middle" font-family="serif" font-size="52" font-weight="bold" fill="#3e3222" letter-spacing="4">
          DARAQ
        </text>
        <text x="50%" y="50%" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#5c4d3c">
          Бұл мәлімет кітапта бар, бірақ
        </text>
        <text x="50%" y="56%" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#5c4d3c">
          сандық нұсқасы (скан) жүктелмеген.
        </text>
        
        <!-- Footer Info -->
        <rect x="150" y="500" width="500" height="40" fill="#ede8df" rx="20" />
        <text x="50%" y="527" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#8b7355" font-weight="bold">
          📖 ${bookName} | ${pageNumber}-бет
        </text>
      </svg>
    `;
    
    baseImageBuffer = await sharp(Buffer.from(placeholderSvg))
      .png()
      .toBuffer();
  }

  // Егер жарамды сурет болса, оның төменгі жағына су белгісін саламыз
  if (!useFallbackWatermark) {
    if (targetText) {
      try {
        const words = await getCoordinatesFromGCS(bookName, pageNumber);
        if (words && words.length > 0) {
           baseImageBuffer = await highlightImage(baseImageBuffer, words, targetText);
        }
      } catch (e) {
        console.warn("[⚠️] Highlighting failed, skipping:", e);
      }
    }

    return await sharp(baseImageBuffer)
      .composite([
        {
          input: Buffer.from(svgText),
          gravity: 'south'
        }
      ])
      .jpeg()
      .toBuffer();
  } else {
    return baseImageBuffer;
  }
}

// Қазақша сүрелер картасы (Quran.com ID-леріне сәйкес)
const KAZ_SURAHS: { [key: string]: number } = {
  'бақара': 2, 'әли имран': 3, 'әли-имран': 3, 'ниса': 4, 'мәида': 5, 'анғам': 6, 'әнғам': 6, 'ағраф': 7, 'әнфал': 8, 'тәубе': 9, 'юнус': 10,
  'һұд': 11, 'юсуф': 12, 'рағд': 13, 'ибраһим': 14, 'хижр': 15, 'нахл': 16, 'исра': 17, 'кәһф': 18, 'мәриям': 19, 'таһа': 20,
  'әнбия': 21, 'хаж': 22, 'муминун': 23, 'нұр': 24, 'фурқан': 25, 'шуара': 26, 'нәмл': 27, 'қасас': 28, 'анкабут': 29, 'әнкабут': 29,
  'рум': 30, 'лұқман': 31, 'сәжде': 32, 'ахзаб': 33, 'сәбә': 34, 'фатыр': 35, 'ясин': 36, 'саффат': 37, 'саад': 38, 'зумар': 39,
  'ғафир': 40, 'фуссилат': 41, 'шура': 42, 'зухруф': 43, 'духан': 44, 'жәсия': 45, 'ахқаф': 46, 'мұхаммед': 47, 'фатх': 48,
  'хужурат': 49, 'қаф': 50, 'зәрият': 51, 'тур': 52, 'нәжм': 53, 'қамар': 54, 'рахман': 55, 'уақиға': 56, 'хадид': 57, 'мужәдәлә': 58,
  'хашр': 59, 'мумтахина': 60, 'саф': 61, 'жұма': 62, 'мунафиқун': 63, 'тағабун': 64, 'талақ': 65, 'тахрим': 66, 'мүлік': 67, 'мулк': 67,
  'қалам': 68, 'хаққа': 69, 'мағариж': 70, 'нұх': 71, 'жын': 72, 'муззаммил': 73, 'муддәссир': 74, 'қиямет': 75, 'инсан': 76, 'мүрсәләт': 77, 'нәбә': 78,
  'назиғат': 79, 'ғабит': 80, 'тәкуир': 81, 'инфитар': 82, 'мутаффифин': 83, 'иншиқақ': 84, 'буруж': 85, 'тариқ': 86, 'ала': 87,
  'ғашия': 88, 'фәжр': 89, 'бәләд': 90, 'шәмс': 91, 'ләйл': 92, 'духа': 93, 'инширах': 94, 'шарх': 94, 'тин': 95,
  'алақ': 96, 'қадр': 97, 'бәййінә': 98, 'зілзәлә': 99, 'адият': 100, 'қариға': 101, 'тәкәсүр': 102, 'аср': 103, 'һумаза': 104,
  'фил': 105, 'құрайыш': 106, 'мағун': 107, 'кәусар': 108, 'кәфирун': 109, 'наср': 110, 'мәсәд': 111, 'ықылас': 112, 'фәләқ': 113, 'нас': 114
};

/**
 * Telegram қабылдамайтын <br> және <p> сияқты тегтерді кәдімгі жол ауыстыруға алмастыру,
 * және қажет болған жағдайда жұлдызшалы Markdown-ды HTML форматына келтіру.
 */
export function formatTelegramMessage(text: string, quranSources: any[] = []): string {
  let formatted = text;
  formatted = formatted.replace(/<br\s*\/?>/gi, '\n');
  formatted = formatted.replace(/<\/p>/gi, '\n\n').replace(/<p>/gi, '');
  
  // Тізімдердегі * белгілерін • белгісіне ауыстыру (Жаңа жолдан басталған немесе бос орын алдындағы)
  formatted = formatted.replace(/^(\s*)\*\s/gm, '$1• ');

  formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>'); // **bold** -> <b>bold</b> (Fallback)
  formatted = formatted.replace(/(?<!<)\*(?!>)(.*?)\*(?![^<]*>)/g, '<i>$1</i>'); // *italic*

  // Үлкен бос орындарды болдырмау үшін 3 немесе одан көп қатар келген бос жолдарды бір бос жолға азайтамыз (ең көп дегенде 2 жаңа жол)
  formatted = formatted.replace(/(?:\r?\n\s*){3,}/g, '\n\n');

  // 1. Құран аяттарының нақты сілтемелерін (quranSources берілген болса) мәтін ішінде көк сілтемемен алмастыру
  if (quranSources && quranSources.length > 0) {
    for (const src of quranSources) {
      if (!src.book) continue;
      const surahKk = src.book.replace(" сүресі", "").trim();
      const verseNum = src.page || 1;
      const url = src.url || 'https://quran.com';
      
      const escapedSurah = surahKk.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      // Match: "Бақара сүресінің 184-аятында", "Бақара сүресі, 184-аят", "Бақара 184-аят", etc.
      const pattern = new RegExp(`(${escapedSurah}\\s+(?:сүресі(?:нің|нде|дегі)?,?\\s+)?${verseNum}(?:\\s*-\\s*аят(?:ында|ы|қа|пен)?)?)`, 'gi');
      
      formatted = formatted.replace(pattern, (match, p1, offset, fullStr) => {
        // HTML сілтемесінің ішінде өзін тағы ауыстыруды болдырмау үшін:
        const before = fullStr.substring(0, offset);
        const openCount = (before.match(/<a\s/g) || []).length;
        const closeCount = (before.match(/<\/a>/g) || []).length;
        if (openCount > closeCount) {
          return match;
        }
        return `<a href="${url}">${match}</a>`;
      });
    }
  }

  // 2. Мәтін ішіндегі кез келген Құран аяттарына сілтемелерді автоматты түрде тауып, Quran.com сілтемесіне айналдыру
  const surahKeys = Object.keys(KAZ_SURAHS).sort((a, b) => b.length - a.length);
  const escapedSurahs = surahKeys.map(k => k.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|');
  const autoPattern = new RegExp(`(${escapedSurahs})\\s+(?:сүресі(?:нің|нде|дегі)?,?\\s+)?(\\d+)(?:\\s*-\\s*аят(?:ында|ы|қа|пен|қарлық|тар|қа)?\\b)?`, 'gi');

  formatted = formatted.replace(autoPattern, (match, surahName, verseStr, offset, fullStr) => {
    // Егер бұл сөз тіркесі бұрыннан <a> сілтемесінің ішінде немесе оған таяу тұрса, өзгертпейміз:
    const before = fullStr.substring(0, offset);
    const openCount = (before.match(/<a\s/g) || []).length;
    const closeCount = (before.match(/<\/a>/g) || []).length;
    if (openCount > closeCount) {
      return match;
    }

    const surahId = KAZ_SURAHS[surahName.toLowerCase().trim()];
    if (surahId) {
      const url = `https://quran.com/${surahId}/${verseStr}`;
      return `<a href="${url}">${match}</a>`;
    }
    return match;
  });

  return formatted.trim();
}

/**
 * Біз жауаптағы сөздер мен әрбір дереккөздегі мәтін сәйкестігін бағалаймыз.
 * Бұл арқылы ең сәйкес келетін нақты парақты/дәлелді анықтаймыз.
 */
function chooseBestSource(answer: string, sources: any[]): any {
  if (!sources || sources.length === 0) return null;
  if (sources.length === 1) return sources[0];

  const cleanText = (t: string) => t.toLowerCase().replace(/[^a-zA-Zа-яА-Яәғқңөұүһі]/g, ' ');
  const answerWords = cleanText(answer)
    .split(/\s+/)
    .filter(w => w.length > 3);

  if (answerWords.length === 0) {
    return sources[0];
  }

  let bestSource = sources[0];
  let maxScore = -1;

  for (const src of sources) {
    const srcText = cleanText(src.text);
    let intersectionCount = 0;
    
    const uniqueAnswerWords = Array.from(new Set(answerWords));
    for (const word of uniqueAnswerWords) {
      if (srcText.includes(word)) {
        intersectionCount++;
      }
    }

    const ratio = intersectionCount / uniqueAnswerWords.length;
    const combinedScore = ratio * 0.7 + (src.score || 0) * 0.3;
    
    if (combinedScore > maxScore) {
      maxScore = combinedScore;
      bestSource = src;
    }
  }

  return bestSource;
}

/**
 * Жауап мәтінінен модель тікелей сілтеме жасаған кітаптар мен беттерді іздейді.
 * Тек сол нақты беттерді ғана сүзгілеп алып қалады.
 * Егер сәйкестік табылмаса, ең жақсы сәйкестікті (chooseBestSource) балама ретінде қайтарады.
 */
export function filterSourcesByResponse(sources: any[], answer: string): any[] {
  if (!sources || sources.length === 0) return [];

  const filtered: any[] = [];
  const lowercaseAnswer = answer.toLowerCase();
  
  // 1. Құран дереккөздері үшін сүзгілеу:
  const quranSources = sources.filter(src => src.isQuran || (src.book && src.book.endsWith('сүресі')));
  const bookSources = sources.filter(src => !src.isQuran && !(src.book && src.book.endsWith('сүресі')));
  
  for (const src of quranSources) {
    const surahName = src.book.replace(" сүресі", "").trim().toLowerCase();
    const verseNum = src.page || 1;
    if (lowercaseAnswer.includes(surahName) && answer.includes(String(verseNum))) {
      filtered.push(src);
    }
  }

  // 2. Кітаптар үшін сүзгілеу:
  const references: { book: string; page: number }[] = [];
  const regex = /«([^»]+)»[^\d]*(\d+)/g;
  let match;
  while ((match = regex.exec(answer)) !== null) {
    const bookName = match[1].trim().toLowerCase();
    const pageNum = parseInt(match[2], 10);
    references.push({ book: bookName, page: pageNum });
  }

  const matchedBooks: any[] = [];
  if (references.length > 0) {
    for (const src of bookSources) {
      const srcBook = (src.book || '').toLowerCase().trim();
      const srcPages = src.pages && Array.isArray(src.pages) ? src.pages.map(Number) : [src.page || 1];
      
      const matched = references.some(ref => {
        const bookMatches = srcBook.includes(ref.book) || ref.book.includes(srcBook);
        const pageMatches = srcPages.includes(ref.page);
        return bookMatches && pageMatches;
      });
      
      if (matched) {
        matchedBooks.push(src);
      }
    }
  }

  if (matchedBooks.length > 0) {
    filtered.push(...matchedBooks);
  } else if (bookSources.length > 0) {
    // Егер нақты сілтеме табылмаса, ең үздік жалғыз кітап дереккөзін ғана таңдаймыз
    const bestBook = chooseBestSource(answer, bookSources);
    if (bestBook) {
      filtered.push(bestBook);
    }
  }

  // Егер жалпы ештеңе өтпесе, fallback ретінде ең жақсы жалғыз деректі аламыз
  if (filtered.length === 0 && sources.length > 0) {
    const bestGlobal = chooseBestSource(answer, sources);
    if (bestGlobal) {
      filtered.push(bestGlobal);
    }
  }

  return filtered;
}


export function isAskingForProof(query: string): boolean {
  const clean = query.toLowerCase();
  const keywords = [
    'дәлел', 'далел', 'сурет', 'көрсет', 'көрсете', 'кітап', 'аят', 
    'көрмей', 'көрмедім', 'көрінбейді', 'көрінбей', 'таппадым', 'қайда', 
    'сілтеме', 'көз', 'дерек', 'кітаптан', 'фото', 'скриншот'
  ];
  return keywords.some(kw => clean.includes(kw));
}


export function setupBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const appUrl = process.env.APP_URL;

  if (!token) {
    console.warn('TELEGRAM_BOT_TOKEN is missing. Bot cannot be started.');
    return null;
  }

  const bot = new Telegraf(token);

  // 1. Автоматты сәлемдесу
  bot.start((ctx) => {
    const userName = ctx.from?.first_name || 'Қолданушы';
    return ctx.replyWithHTML(
      `Ассалаумағалейкум, <b>${userName}</b>!\n\nМен <b>Daraq</b> — Ханафи мазһабы бойынша сенімді діни көмекшіңізбін. Қандай сұрағыңыз бар?`
    );
  });

  // Темаларды (ораза, намаз) құру пәрмені
  bot.command('create_topics', async (ctx) => {
    const chatId = ctx.chat.id;

    try {
      await ctx.reply('⏳ "Ораза" және "Намаз" темаларын құру басталуда...');
      
      // Намаз тақырыбы (жеке чатқа бағыттауымыз мүмкін)
      const namazTopic = await ctx.telegram.createForumTopic(chatId, 'Намаз');
      // Ораза тақырыбы (жеке чатқа бағыттауымыз мүмкін)
      const orazaTopic = await ctx.telegram.createForumTopic(chatId, 'Ораза');

      return ctx.replyWithHTML(
        `✅ Темалар сәтті құрылды!\n\n` +
        `🕌 <b>Намаз</b> (Thread ID: <code>${namazTopic.message_thread_id}</code>)\n` +
        `🌙 <b>Ораза</b> (Thread ID: <code>${orazaTopic.message_thread_id}</code>)\n\n` +
        `Енді осы тақырыптар ішінде сұрақ қойып, жаңа жылдам ағынды (streaming) жауаптарды тексере аласыз!`
      );
    } catch (error: any) {
      console.error('Темаларды құру кезінде қателік:', error);
      return ctx.reply(`❌ Темаларды құру мүмкін болмады.\nҚате: ${error.message}`);
    }
  });

  bot.command('newtopic', async (ctx) => {
    const chatId = ctx.from.id;
    try {
      const topic = await ctx.telegram.createForumTopic(chatId, 'Жаңа тақырып');
      await ctx.reply(`✅ Жаңа топик құрылды! Thread ID: ${topic.message_thread_id}. Енді сол жерге жазыңыз.`);
    } catch (e: any) {
      await ctx.reply(`❌ Жаңа топик құру мүмкін болмады: ${e.message}`);
    }
  });

  bot.on('message', async (ctx: any) => {
    const chatId = String(ctx.chat.id);
    const targetThreadId = ctx.message?.message_thread_id;
    const query = ctx.message && ('text' in ctx.message) ? ctx.message.text : '';

    if (!query) return;

    let isFirstTopicMessage = false;
    const cacheKey = `${chatId}_${targetThreadId || 'general'}`;
    const draftId = ctx.message.message_id; // Using user message_id as draft identifier!

    try {
      // Typing status indicating bot is thinking
      let isAgentThinking = true;
      const sendTypingStatus = async () => {
        try {
          if (isAgentThinking) {
            await ctx.telegram.sendChatAction(chatId, 'typing', targetThreadId ? { message_thread_id: targetThreadId } : undefined);
          }
        } catch (e) {}
      };
      
      const typingInterval = setInterval(sendTypingStatus, 4000);
      sendTypingStatus();

      try {
        await ctx.telegram.callApi('sendMessageDraft', {
          chat_id: chatId,
          draft_id: draftId,
          message_thread_id: targetThreadId,
          text: '⏳ <i>Ойланып жатырмын...</i>',
          parse_mode: 'HTML'
        });
      } catch (e) {
        // Ignore API failures for draft
      }

      if (targetThreadId && db) {
        if (!renamedTopicsCache.has(cacheKey)) {
          const topicDoc = await db.collection('users').doc(chatId).collection('topics').doc(String(targetThreadId)).get();
          if (topicDoc.exists && topicDoc.data()?.renamed) {
            renamedTopicsCache.add(cacheKey);
          } else {
            const topicMessages = await db.collection('users').doc(chatId).collection('topics').doc(String(targetThreadId)).collection('messages').limit(1).get();
            const hasPriorMessages = !topicMessages.empty;
            if (hasPriorMessages) {
              renamedTopicsCache.add(cacheKey);
            } else {
              isFirstTopicMessage = true;
              renamedTopicsCache.add(cacheKey);
            }
          }
        }
      }

      const threadStr = (targetThreadId !== undefined && targetThreadId !== null) ? String(targetThreadId) : 'general';

      let quranSources: any[] = [];
      let bookSources: any[] = [];
      let inlineKeyboard: any = null;

      const answerData = await generateAgentAnswerStream(
        chatId,
        query,
        async (currentFullText) => {
          const formatted = formatTelegramMessage(currentFullText);
          try {
            await ctx.telegram.callApi('sendMessageDraft', {
              chat_id: chatId,
              draft_id: draftId,
              message_thread_id: targetThreadId,
              text: formatted,
              parse_mode: 'HTML'
            });
          } catch(e) {}
        },
        async (statusText) => {
          try {
            await ctx.telegram.callApi('sendMessageDraft', {
              chat_id: chatId,
              draft_id: draftId,
              message_thread_id: targetThreadId,
              text: `⏳ ${statusText}`,
              parse_mode: 'HTML'
            });
          } catch (e) {}
        },
        targetThreadId
      );

      isAgentThinking = false;
      clearInterval(typingInterval);

      let relevantSources: any[] = [];
      if (answerData.sources && answerData.sources.length > 0) {
        relevantSources = filterSourcesByResponse(answerData.sources, answerData.answer);
      }

      // Егер осы сұраныста дәлелдер табылса, оларды Firestore-ға кэштейміз
      if (relevantSources && relevantSources.length > 0) {
        if (db) {
          db.collection('users').doc(chatId).collection('topics').doc(threadStr).collection('latestSources').doc('current').set({
            sources: relevantSources,
            updatedAt: new Date()
          }).catch(e => console.error('[⚠️] Error caching latest sources:', e));
        }
      } else if (isAskingForProof(query)) {
        // Егер дәлел табылмаса, бірақ пайдаланушы сұраса немесе көрмей тұрса, бұрын табылған соңғы дәлелдерді кэштен жүктейміз
        if (db) {
          try {
            const cachedDoc = await db.collection('users').doc(chatId).collection('topics').doc(threadStr).collection('latestSources').doc('current').get();
            if (cachedDoc.exists) {
              const cachedData = cachedDoc.data();
              if (cachedData && cachedData.sources && cachedData.sources.length > 0) {
                relevantSources = cachedData.sources;
                console.log(`[Cache] Restored ${cachedData.sources.length} sources from Firestore for query: "${query}"`);
              }
            }
          } catch (e) {
            console.error('[⚠️] Error fetching cached latest sources:', e);
          }
        }
      }

      if (relevantSources && relevantSources.length > 0) {
        const processed = processAndDeduplicateSources(relevantSources);
        quranSources = processed.quranSources;
        bookSources = processed.bookSources;
        if (quranSources.length > 0 || bookSources.length > 0) {
          const pagId = uuidv4().substring(0, 8);
          paginationCache.set(pagId, {
            quranSources,
            bookSources,
            quranPageIndex: 0
          });
          inlineKeyboard = buildKeyboard(quranSources, bookSources, 0, pagId);
        }
      }

      let finalMessage = formatTelegramMessage(answerData.answer, quranSources);

      const quoteMatch = query.match(/[^.?!]+[.?!]/);
      let quoteText = quoteMatch ? quoteMatch[0].trim() : query.trim();
      if (quoteText.length > 200) {
        quoteText = quoteText.substring(0, 200);
      }
      const exactQuoteText = query.includes(quoteText) ? quoteText : query.substring(0, Math.min(200, query.length));

      const extraOptions: any = { 
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        link_preview_options: { is_disabled: true }
      };

      // Нақты сөйлемнен дәйексөз келтіру (Quote in Reply Parameters)
      extraOptions.reply_parameters = {
        message_id: ctx.message.message_id,
        quote: exactQuoteText
      };

      if (targetThreadId) {
        extraOptions.message_thread_id = targetThreadId;
      }

      if (inlineKeyboard) {
        Object.assign(extraOptions, inlineKeyboard);
      }

      // Финалдық хабарламаны жібереміз
      try {
        await ctx.telegram.sendMessage(chatId, finalMessage, extraOptions);
      } catch (replyError) {
        console.error("[⚠️] HTML форматымен жіберу қатесі, таза мәтін жіберілуде:", replyError);
        const plainText = finalMessage.replace(/<[^>]*>?/gm, '');
        const plainOptions: any = { ...extraOptions };
        delete plainOptions.parse_mode;
        if (inlineKeyboard) Object.assign(plainOptions, inlineKeyboard);
        await ctx.telegram.sendMessage(chatId, plainText, plainOptions);
      }

      // Стриминг толық аяқталған соң ғана тақырып атын өзгерту
      if (isFirstTopicMessage && targetThreadId) {
        (async () => {
          try {
            const prompt = `Мына Сұрақ пен Жауапты талдап, олардың негізгі тақырыбын 2-3 сөзден тұратын қысқа, нұсқа әрі тартымды атауға айналдыр. Басына міндетті түрде тақырыпқа сай 1 эмодзи қос. Тек қазақ тілінде жаз.\n\nСұрақ: "${query}"\nЖауап: "${finalMessage}"`;
            
            const aiPromise = ai.models.generateContent({
              model: 'gemini-3.1-flash-lite',
              contents: prompt
            });
            
            const timeoutPromise = new Promise<any>((_, reject) => 
               setTimeout(() => reject(new Error("Timeout generation: Model is hanging")), 3000)
            );

            let newName = await Promise.race([aiPromise, timeoutPromise]).then(res => {
              let parsedName = res.text?.trim().replace(/\n/g, ' ');
              return parsedName ? parsedName.substring(0, 128) : undefined;
            }).catch(async (err) => {
              console.warn('[AI] gemini-3.1-flash-lite қатесі немесе күту уақыты аяқталды (Timeout), балама модельге ауысамыз:', err.message || err);
              try {
                const fallbackRes = await ai.models.generateContent({
                  model: 'gemini-3.1-flash-lite',
                  contents: prompt
                });
                let fallbackName = fallbackRes.text?.trim().replace(/\n/g, ' ');
                return fallbackName ? fallbackName.substring(0, 128) : undefined;
              } catch(fallbackErr) {
                console.error('[AI] Fallback Топик атын генерациялау кезінде қателік:', fallbackErr);
                return undefined;
              }
            });

            if (newName) {
              newName = newName.replace(/[\*_`~#|\[\]()\\-]/g, '').replace(/\s+/g, ' ').trim();
            }

            if (newName) {
              await ctx.telegram.editForumTopic(chatId, targetThreadId, { name: newName });
              console.log(`[AI] Жеке чаттағы Топик аты өзгертілді: ${newName}`);
              
              if (db) {
                const threadStr = String(targetThreadId);
                await db.collection('users').doc(chatId).collection('topics').doc(threadStr).set({
                  renamed: true,
                  title: newName,
                  updatedAt: new Date()
                }, { merge: true });
              }
            }
          } catch(e) {
            console.error('[AI] Топик атын өзгерту кезінде қателік:', e);
          }
        })();
      }

    } catch (error: any) {
      console.error("[❌] Telegram ботта қателік орын алды:", error);
      const errorStr = String(error?.response?.data || error?.message || error || "");
      console.error("Толық қате сипаттамасы:", errorStr);
      
      const isCreditsError = errorStr.includes("depleted") || errorStr.includes("429") || errorStr.includes("RESOURCE_EXHAUSTED");
      
      // Қателерді өңдеу
      let errorMessage = 'Кешіріңіз, жүйелік қателікке байланысты жауап бере алмаймын.';
      if (isCreditsError) {
        errorMessage = '⚠️ <b>Жүйелік қате (429 Resource Exhausted / Quota):</b>\n\nGoogle Cloud Vertex AI жүйесіндегі сұраныс квотасы таусылды немесе шегіне жетті. Біраз уақыттан соң қайталап көріңіз немесе Google Cloud Console арқылы квотаңызды көбейтіңіз.';
      }

      const theDraftId = ctx.message ? ctx.message.message_id : Date.now();
      try {
        await ctx.telegram.sendMessage(chatId, errorMessage, { parse_mode: 'HTML', message_thread_id: targetThreadId } as any);
      } catch (e) {
        console.error("Error sending failure message:", e);
      }
    }
  });

  // 4. "noop" батырмасын ұстап алу (бос батырма, ештеңе істемейді, тек күтуді өшіреді)
  bot.action('noop', async (ctx) => {
    try {
      await ctx.answerCbQuery();
    } catch (e) {}
  });

  // 5. Құран пагинациясын басқару
  bot.action(/pag_quran_(.+)_(.+)/, async (ctx) => {
    try {
      const pagId = ctx.match[1];
      const newPageIdx = parseInt(ctx.match[2], 10);

      const state = paginationCache.get(pagId);
      if (!state) {
        await ctx.answerCbQuery('Кешіріңіз, бұл батырманың мерзімі өтіп кеткен.', { show_alert: true });
        return;
      }

      state.quranPageIndex = newPageIdx;
      paginationCache.set(pagId, state);

      const inlineKeyboard = buildKeyboard(state.quranSources, state.bookSources, newPageIdx, pagId);

      await ctx.answerCbQuery();
      if (inlineKeyboard) {
        await ctx.editMessageReplyMarkup(inlineKeyboard.reply_markup);
      }
    } catch (error) {
      console.error("[❌] Құран пагинациясы кезінде қате орын алды:", error);
    }
  });

  // 6. "🖼 Дәлел суретті көру" батырмасын ұстап алу
  bot.action(/view_source_(.+)/, async (ctx) => {
    try {
      const sourceId = ctx.match[1];
      const sourceInfo = await getSourceInfo(sourceId);

      if (!sourceInfo) {
        await ctx.answerCbQuery('Кешіріңіз, дәлел суреті табылмады немесе ескірген.', { show_alert: true });
        return;
      }

      await ctx.answerCbQuery('Сурет жүктелуде...');

      // Су белгісін қою (Watermark)
      const imageBuffer = await addWatermark(sourceInfo.imageUrl, sourceInfo.book, sourceInfo.page, sourceInfo.targetText);

      // Пайдаланушыға суретті жіберу
      await ctx.replyWithPhoto({ source: imageBuffer }, { caption: `📖 ${sourceInfo.book}, ${sourceInfo.page}-бет` });

    } catch (error) {
      console.error("[❌] Суретті жүктеу кезінде қате:", error);
      await ctx.answerCbQuery('Суретті ашу кезінде қателік кетті.', { show_alert: true });
    }
  });

  // 7. Бірнеше дәлел суретін бірге (Media Group) жіберетін батырманы ұстап алу
  bot.action(/view_srcgrp_(.+)/, async (ctx) => {
    try {
      const groupId = ctx.match[1];
      const sources = await getGroupInfo(groupId);

      if (!sources || sources.length === 0) {
        await ctx.answerCbQuery('Кешіріңіз, дәлел суреттері табылмады немесе ескірген.', { show_alert: true });
        return;
      }

      await ctx.answerCbQuery('Дәлел суреттері дайындалуда...');

      // Суреттерге су белгісін параллельді Promise.all арқылы қосу
      const results = await Promise.all(
        sources.map(async (src) => {
          try {
            let customUrl = src.imageUrl || "";
            if (customUrl) {
              customUrl = customUrl.replace(/page_\d+\.png/g, `page_${src.page}.png`);
            }
            const buffer = await addWatermark(customUrl, src.book, src.page, src.targetText);
            return {
              buffer,
              book: src.book,
              page: src.page
            };
          } catch (err) {
            console.error(`[❌] Суретке су белгісін қосу кезіндегі қате (${src.book}, бет ${src.page}):`, err);
            return null;
          }
        })
      );

      const imageBuffers = results.filter((res): res is { buffer: Buffer; book: string; page: number } => res !== null);

      if (imageBuffers.length === 0) {
        await ctx.answerCbQuery('Кешіріңіз, ешқандай суретті жүктеу мүмкін болмады.', { show_alert: true });
        return;
      }

      // Media Group түрінде біріктіріп жібереміз
      try {
        const media = imageBuffers.map(img => ({
          type: 'photo' as const,
          media: { source: img.buffer },
          caption: `📖 ${img.book}, ${img.page}-бет`
        }));
        await ctx.replyWithMediaGroup(media);
      } catch (mediaGroupError) {
        console.warn("[⚠️] Media Group жіберу қатесі, суреттерді жеке-жеке жібереміз:", mediaGroupError);
        // Fallback: send sequentially if Media Group fails
        for (const img of imageBuffers) {
          await ctx.replyWithPhoto({ source: img.buffer }, { caption: `📖 ${img.book}, ${img.page}-бет` });
        }
      }

    } catch (error) {
      console.error("[❌] Дәлелдер тобын жүктеу кезінде қате:", error);
      await ctx.answerCbQuery('Суреттер топтамасын ашу кезінде қателік кетті.', { show_alert: true });
    }
  });

  // Вэбхук арқылы немесе ұзақ сұрау арқылы қосу
  const isCloudRun = process.env.K_SERVICE !== undefined;
  const appUrlLower = appUrl ? appUrl.toLowerCase() : '';
  const isDevelopment = process.env.NODE_ENV === 'development' || 
                        appUrlLower.includes('ais-dev-') || 
                        appUrlLower.includes('ais-pre-') || 
                        !appUrl;
  const isProduction = !isDevelopment;
  const hasAppUrl = appUrl && appUrl !== "MY_APP_URL" && !appUrl.includes("your_") && !appUrl.includes("localhost");

  if (isProduction) {
    if (hasAppUrl) {
      const webhookPath = `/api/bot-webhook`;
      bot.telegram.setWebhook(`${appUrl}${webhookPath}`).then(() => {
        console.log(`[🌐] Webhook successfully set at ${appUrl}${webhookPath}`);
      }).catch((err) => {
        console.error(`[❌] Failed to set webhook at ${appUrl}${webhookPath}:`, err);
      });
    } else {
      console.error(`[❌] ӨНДІРІСТІК РЕЖИМ (Cloud Run) анықталды, бірақ 'APP_URL' айнымалысы дұрыс орнатылмаған немесе "MY_APP_URL" болып тұр.`);
      console.error(`[❌] Cloud Run-да 409 Conflict қателерінің алдын алу үшін Polling-пен қосу тоқтатылды (қауіпсіздік үшін бұғатталды).`);
      console.error(`[💡] ШЕШІМІ: Google Cloud Console-де Daraq Cloud Run қызметінің баптауларына (Variables / Secret) барып, APP_URL айнымалысына Cloud Run сілтемеңізді енгізіңіз (мысалы: APP_URL=https://daraq-xxxxxx.run.app).`);
    }
  } else {
    console.log('Development mode detected or APP_URL missing. Starting bot in polling mode...');
    bot.telegram.deleteWebhook({ drop_pending_updates: true }).then(() => {
      bot.launch({ dropPendingUpdates: true }).catch((error: any) => {
        if (error?.response?.error_code === 409) {
          console.warn('Bot is already running or conflicting with another instance (409 Conflict). Skipping polling startup.');
        } else {
          console.error('Error starting polling mode:', error);
        }
      });
      console.log('Bot started in polling mode.');
    }).catch((error: unknown) => {
      console.error('Error starting polling mode:', error);
    });
  }

  return bot;
}
