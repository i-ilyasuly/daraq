// Қазақша сүрелер картасы (Quran.com ID-леріне сәйкес)
export const KAZ_SURAHS: { [key: string]: number } = {
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

  // Telegram API 7.0+ Expandable Blockquotes (Жиналатын дәйексөздер)
  const quoteBlocks = formatted.match(/^(?:>[ \t]*.*(?:\n|$))+/gm);
  if (quoteBlocks) {
    for (const block of quoteBlocks) {
      const lines = block.split('\n')
        .filter(l => l.trim().startsWith('>'))
        .map(l => l.replace(/^>[ \t]*/, ''))
        .join('\n')
        .trim();
      if (lines) {
        // Егер өте ұзын болса, expandable қыламыз
        const isLong = lines.length > 200 || lines.split('\n').length > 3;
        const tag = isLong ? '<blockquote expandable>' : '<blockquote>';
        formatted = formatted.replace(block, `${tag}\n${lines}\n</blockquote>\n`);
      }
    }
  }

  formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>'); // **bold** -> <b>bold</b> (Fallback)
  formatted = formatted.replace(/(?<!<)\*(?!>)(.*?)\*(?![^<]*>)/g, '<i>$1</i>'); // *italic*
  formatted = formatted.replace(/\|\|(.*?)\|\|/gs, '<tg-spoiler>$1</tg-spoiler>'); // ||spoiler|| -> <tg-spoiler>spoiler</tg-spoiler>

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
      
      formatted = formatted.replace(pattern, (match: string, p1: string, offset: number, fullStr: string) => {
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

  formatted = formatted.replace(autoPattern, (match: string, surahName: string, verseStr: string, offset: number, fullStr: string) => {
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
export function chooseBestSource(answer: string, sources: any[]): any {
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

export function isAskingForProof(query: string): boolean {
  const clean = query.toLowerCase();
  const keywords = [
    'дәлел', 'далел', 'сурет', 'көрсет', 'көрсете', 'кітап', 'аят', 
    'көрмей', 'көрмедім', 'көрінбейді', 'көрінбей', 'таппадым', 'қайда', 
    'сілтеме', 'көз', 'дерек', 'кітаптан', 'фото', 'скриншот'
  ];
  return keywords.some(kw => clean.includes(kw));
}
