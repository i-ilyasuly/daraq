import 'dotenv/config';

const SURAH_NAMES_KK: Record<number, string> = {
  1: "Фатиха", 2: "Бақара", 3: "Әли Имран", 4: "Ниса", 5: "Мәида", 6: "Әнғам", 7: "Ағраф", 8: "Әнфәл", 9: "Тәубе", 10: "Юнус",
  11: "Һұд", 12: "Юсуф", 13: "Рағд", 14: "Ибраһим", 15: "Хижр", 16: "Нахл", 17: "Исра", 18: "Кәһф", 19: "Мәриям", 20: "Таһа",
  21: "Әнбия", 22: "Хаж", 23: "Муминун", 24: "Нұр", 25: "Фурқан", 26: "Шуғара", 27: "Нәмл", 28: "Қасас", 29: "Анкабут", 30: "Рум",
  31: "Лұқман", 32: "Сәжде", 33: "Ахзаб", 34: "Сәбә", 35: "Фатыр", 36: "Ясин", 37: "Саффат", 38: "Сад", 39: "Зүмәр", 40: "Ғафир",
  41: "Фуссилат", 42: "Шура", 43: "Зұхруф", 44: "Духан", 45: "Жәсия", 46: "Ахқаф", 47: "Мұхаммед", 48: "Фатх", 49: "Хұжурат", 50: "Қаф",
  51: "Зарият", 52: "Тур", 53: "Нәжм", 54: "Қамар", 55: "Рахман", 56: "Уақиға", 57: "Хадид", 58: "Мужәдилә", 59: "Хашр", 60: "Мумтәхинә",
  61: "Сафф", 62: "Жұма", 63: "Мунафиқун", 64: "Тағабун", 65: "Талақ", 66: "Тахрим", 67: "Мүлк", 68: "Қалам", 69: "Хаққа", 70: "Мағариж",
  71: "Нұх", 72: "Жын", 73: "Музәммил", 74: "Мудәссир", 75: "Қиямет", 76: "Инсан", 77: "Мүрселәт", 78: "Нәбә", 79: "Назиғат", 80: "Абаса",
  81: "Тәкуир", 82: "Инфитар", 83: "Мутаффифин", 84: "Иншиқақ", 85: "Буруж", 86: "Тариқ", 87: "Ағлә", 88: "Ғашия", 89: "Фәжр", 90: "Бәләд",
  91: "Шәмс", 92: "Ләйл", 93: "Духа", 94: "Шарх", 95: "Тин", 96: "Аләқ", 97: "Қадр", 98: "Бәйнә", 99: "Зілзәлә", 100: "Адият",
  101: "Қариға", 102: "Тәкәсүр", 103: "Аср", 104: "Һумәзә", 105: "Фил", 106: "Құрайыш", 107: "Мәғун", 108: "Кәусар", 109: "Кәфирун", 110: "Наср",
  111: "Мәсәд", 112: "Ықылас", 113: "Фәләқ", 114: "Нас"
};

const SURAH_VERSE_COUNTS: Record<number, number> = {
  1: 7, 2: 286, 3: 200, 4: 176, 5: 120, 6: 165, 7: 206, 8: 75, 9: 129, 10: 109,
  11: 123, 12: 111, 13: 43, 14: 52, 15: 99, 16: 128, 17: 111, 18: 110, 19: 98, 20: 135,
  21: 112, 22: 78, 23: 118, 24: 64, 25: 77, 26: 227, 27: 93, 28: 88, 29: 69, 30: 60,
  31: 34, 32: 30, 33: 73, 34: 54, 35: 45, 36: 83, 37: 182, 38: 88, 39: 75, 40: 85,
  41: 54, 42: 53, 43: 89, 44: 59, 45: 37, 46: 35, 47: 38, 48: 29, 49: 18, 50: 45,
  51: 60, 52: 49, 53: 62, 54: 55, 55: 78, 56: 96, 57: 29, 58: 22, 59: 24, 60: 13,
  61: 14, 62: 11, 63: 11, 64: 18, 65: 12, 66: 12, 67: 30, 68: 52, 69: 52, 70: 44,
  71: 28, 72: 28, 73: 20, 74: 56, 75: 40, 76: 31, 77: 50, 78: 40, 79: 46, 80: 42,
  81: 29, 82: 19, 83: 36, 84: 25, 85: 22, 86: 17, 87: 19, 88: 26, 89: 30, 90: 20,
  91: 15, 92: 21, 93: 11, 94: 8, 95: 8, 96: 19, 97: 5, 98: 8, 99: 8, 100: 11,
  101: 11, 102: 8, 103: 3, 104: 9, 105: 5, 106: 4, 107: 7, 108: 3, 109: 6, 110: 3,
  111: 5, 112: 4, 113: 5, 114: 6
};

export interface QuranVerseData {
  verseKey: string;
  arabicText: string;
  translationText: string;
  surahNameKk: string;
  quranComUrl: string;
  audioUrl?: string;
  audio_url?: string;
}

/**
 * Single verse detail lookup by key (e.g., "2:183") using Quran.com API
 */
export async function fetchSingleVerse(verseKey: string): Promise<QuranVerseData | null> {
  const [surahStr, verseStr] = verseKey.split(':');
  const surahId = parseInt(surahStr, 10);
  const verseId = parseInt(verseStr, 10);
  if (isNaN(surahId) || surahId < 1 || surahId > 114 || isNaN(verseId)) {
    return null;
  }

  // Local validation of verse boundaries to prevent Quran.com 404 Not Found exceptions
  const maxVerses = SURAH_VERSE_COUNTS[surahId];
  if (maxVerses === undefined || verseId < 1 || verseId > maxVerses) {
    console.log(`[⚠️] Skipping invalid Quran reference: surah ${surahId} only has ${maxVerses} verses (requested verse ${verseId})`);
    return null;
  }

  // Normalize verseKey to remove any leading zeros (e.g. "08:26" -> "8:26")
  const normalizedVerseKey = `${surahId}:${verseId}`;

  try {
    const url = `https://api.quran.com/api/v4/verses/by_key/${normalizedVerseKey}?translations=113,222&fields=text_uthmani`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Quran.com API error: ${res.statusText}`);
    }

    const data = await res.json();
    const v = data.verse;
    if (!v) return null;

    let translation = "";
    if (v.translations && v.translations.length > 0) {
      // Find preference for 113, then fallback
      const pref = v.translations.find((t: any) => t.resource_id === 113) || v.translations[0];
      translation = pref.text;
    }

    // Clean up HTML tags inside translation just in case
    translation = translation.replace(/<[^>]*>/g, '').trim();
    // Replace slash annotations with parentheses e.g. " / text / " to " (text) "
    translation = translation.replace(/\s*\/\s*([^/]+?)\s*\/\s*/g, ' ($1) ');
    // Clean up spaces before punctuation that might result from slash replacements
    translation = translation.replace(/\)\s+\./g, ').').replace(/\)\s+,/g, '),');

    const surahNameKk = SURAH_NAMES_KK[surahId] || `Сүре ${surahId}`;
    const quranComUrl = `https://quran.com/${surahId}/${v.verse_number}`;

    let audioUrl = "";
    try {
      const audioRes = await fetch(`https://api.quran.com/api/v4/recitations/4/by_ayah/${normalizedVerseKey}`);
      if (audioRes.ok) {
        const audioData = await audioRes.json();
        const firstFile = audioData.audio_files?.[0];
        if (firstFile && firstFile.url) {
          audioUrl = firstFile.url.startsWith('http') 
            ? firstFile.url 
            : `https://audio.qurancdn.com/${firstFile.url}`;
        }
      }
    } catch (e) {
      console.error(`[⚠️] Error fetching audio recitation for ${normalizedVerseKey}:`, e);
    }

    const pad3 = (num: number) => String(num).padStart(3, '0');
    if (!audioUrl) {
      const parsedVerseId = parseInt(verseStr, 10) || 1;
      audioUrl = `https://audio.qurancdn.com/Shatri/mp3/${pad3(surahId)}${pad3(v.verse_number || parsedVerseId)}.mp3`;
    }

    return {
      verseKey: normalizedVerseKey,
      arabicText: v.text_uthmani || "",
      translationText: translation,
      surahNameKk,
      quranComUrl,
      audioUrl: audioUrl,
      audio_url: audioUrl
    };
  } catch (error) {
    console.error(`[❌] Error fetching Quran.com verse ${verseKey}:`, error);
    return null;
  }
}

/**
 * Searches Quran.com and resolves the top match verses
 */
export async function searchQuran(query: string): Promise<QuranVerseData[]> {
  console.log(`[🔎] Құраннан іздеу басталды: "${query}"`);
  try {
    // 1. Search with Kazakh filters first
    let url = `https://api.quran.com/api/v4/search?q=${encodeURIComponent(query)}&language=kk`;
    let res = await fetch(url);
    let data = await res.json();

    let results = data.search?.results || [];

    // 2. Fallback to English search if Kazakh yields 0 hits
    if (results.length === 0) {
      console.log(`[⏳] Қазақша нәтиже табылмады. Жалпы іздеуді қолданамыз...`);
      url = `https://api.quran.com/api/v4/search?q=${encodeURIComponent(query)}`;
      res = await fetch(url);
      data = await res.json();
      results = data.search?.results || [];
    }

    if (results.length === 0) {
      return [];
    }

    // Get top 2 matching verses to provide concise evidence/context
    const topResults = results.slice(0, 2);
    const verses: QuranVerseData[] = [];

    for (const r of topResults) {
      if (r.verse_key) {
        const detail = await fetchSingleVerse(r.verse_key);
        if (detail) {
          verses.push(detail);
        }
      }
    }

    return verses;
  } catch (error) {
    console.error("[❌] Error searchQuran:", error);
    return [];
  }
}

/**
 * Main Quran Tool entry point that formats output as context
 */
export async function getQuranVerseTool(verseKeyOrQuery: string): Promise<string> {
  const cleanInput = verseKeyOrQuery.trim();
  const verseKeyPattern = /^(\d+):(\d+)(-\d+)?$/;

  let results: QuranVerseData[] = [];

  if (verseKeyPattern.test(cleanInput)) {
    // Range or Single verse key
    const match = cleanInput.match(verseKeyPattern);
    if (match) {
      const surahId = match[1];
      const startVerse = parseInt(match[2], 10);
      const endVerseStr = match[3];

      if (endVerseStr) {
        // Range
        const endVerse = parseInt(endVerseStr.replace('-', ''), 10);
        const count = Math.min(endVerse - startVerse + 1, 3); // Max 3 verses to keep it clean

        const promises: Promise<QuranVerseData | null>[] = [];
        for (let i = 0; i < count; i++) {
          promises.push(fetchSingleVerse(`${surahId}:${startVerse + i}`));
        }

        const details = await Promise.all(promises);
        results = details.filter((d): d is QuranVerseData => d !== null);
      } else {
        // Single verse
        const detail = await fetchSingleVerse(cleanInput);
        if (detail) {
          results.push(detail);
        }
      }
    }
  } else {
    // Normal query search
    results = await searchQuran(cleanInput);
  }

  if (results.length === 0) {
    return "Құраннан бұл сұранысқа сәйкес келетін аяттар табылмады.";
  }

  // Format into context string
  return results.map(r => {
    return `[ҚҰРАН АЯТЫ] ${r.surahNameKk} сүресі, ${r.verseKey.split(':')[1]}-аят
Сілтеме: ${r.quranComUrl}
Арабша: ${r.arabicText}
Қазақша аудармасы: ${r.translationText}${r.audio_url ? `\nАудио сілтемесі: ${r.audio_url}` : ''}`;
  }).join('\n\n');
}
