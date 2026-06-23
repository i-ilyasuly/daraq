import { db } from '../db/firestore';
import { SearchResult, searchAnswers } from './searchService';
import { ai, generateContentFixed, generateContentStreamFixed, GEMINI_GENERATION_MODEL, GEMINI_INTENT_MODEL } from './aiClient';
import { fetchSingleVerse, searchQuran } from './quranService';
import { checkCache, writeCache } from './cacheService';
import { getVerifiedFatwasContext } from './webSearchService';
import { Type, ThinkingLevel } from '@google/genai';
import 'dotenv/config';

import { SYSTEM_PROMPT, TRANSCRIPTION_CORRECTION_PROMPT } from './prompts';

function tryGetDomain(urlStr: string): string {
  try {
    const url = new URL(urlStr);
    return url.hostname.replace('www.', '');
  } catch (e) {
    if (urlStr.includes('fatua.kz')) return 'fatua.kz';
    if (urlStr.includes('muftyat.kz')) return 'muftyat.kz';
    return 'Дереккөз сілтемесі';
  }
}


import { classifyIntent, RouterResult } from './routerService';

export interface AnswerResult {
  answer: string;
  sources: SearchResult[];
  intent?: string;
}

/**
 * Firestore-дан осы пайдаланушының соңғы 20 хабарламасын оқу
 */
async function getChatHistory(chatId: string, threadId?: string | number) {
  if (!db) {
    console.warn("[⚠️] Firestore қосылмаған. Чат тарихы оқылмады.");
    return [];
  }
  try {
    const threadStr = (threadId !== undefined && threadId !== null) ? String(threadId) : 'general';
    const snapshot = await db.collection('users').doc(chatId).collection('topics').doc(threadStr).collection('messages')
      .orderBy('timestamp', 'desc')
      .limit(20)
      .get();
    
    if (snapshot.empty) return [];

    const messages = snapshot.docs.map(doc => doc.data());
    const formattedHistory = messages.reverse().map(msg => ({
      role: msg.role === 'bot' ? 'model' : 'user',
      parts: [{ text: msg.text }]
    }));

    return formattedHistory;
  } catch (error) {
    console.error("[❌] Чат тарихын оқу кезінде қате орын алды (Firestore Error):", error);
    return [];
  }
}

import { rewindHistory, saveToChatHistory } from './historyService';
export { rewindHistory, saveToChatHistory };

function isAskingForProof(q: string): boolean {
  const clean = q.toLowerCase();
  const keywords = [
    'дәлел', 'далел', 'сурет', 'көрсет', 'көрсете', 'кітап', 'аят', 
    'көрмей', 'көрмедім', 'көрінбейді', 'көрінбей', 'таппадым', 'қайда', 
    'сілтеме', 'көз', 'дерек', 'кітаптан', 'фото', 'скриншот'
  ];
  return keywords.some(kw => clean.includes(kw));
}

/**
 * Сауалдың Құран аяттарына сілтемесі бар-жоғын анықтаушы көмекші функция
 */
export function parseQuranReferences(query: string): string[] {
  const references: string[] = [];
  
  // 1. Формат "2:183" немесе "2:183-185"
  const colonPattern = /\b(\d+):(\d+)(-\d+)?\b/g;
  let match;
  while ((match = colonPattern.exec(query)) !== null) {
    references.push(match[0]);
  }

  // Helper to normalize text (makes Kazakh & Russian keyboard letters equivalent)
  const normalizeForMatching = (text: string): string => {
    return text.toLowerCase()
      .replace(/ұ/g, 'у')
      .replace(/ү/g, 'у')
      .replace(/қ/g, 'к')
      .replace(/ғ/g, 'г')
      .replace(/ө/g, 'о')
      .replace(/ә/g, 'а')
      .replace(/һ/g, 'х')
      .replace(/і/g, 'и');
  };

  const SURAH_KEYS_MAP: Record<string, number> = {
    'фатиха': 1, 'бақара': 2, 'әли имран': 3, 'әли-имран': 3, 'ниса': 4, 'мәида': 5, 'анғам': 6, 'әнғам': 6, 'ағраф': 7, 'әнфал': 8, 'әнфәл': 8, 'тәубе': 9, 'юнус': 10,
    'һұд': 11, 'юсуф': 12, 'рағд': 13, 'рағыд': 13, 'ибраһим': 14, 'хижр': 15, 'нахл': 16, 'исра': 17, 'кәһф': 18, 'мәриям': 19, 'таһа': 20,
    'әнбия': 21, 'хаж': 22, 'муминун': 23, 'нұр': 24, 'фурқан': 25, 'фұрқан': 25, 'шуара': 26, 'нәмл': 27, 'қасас': 28, 'анкабут': 29, 'әнкабут': 29,
    'рум': 30, 'лұқман': 31, 'сәжде': 32, 'ахзаб': 33, 'сәбә': 34, 'фатыр': 35, 'ясин': 36, 'саффат': 37, 'саад': 38, 'зумар': 39, 'зүмәр': 39,
    'ғафир': 40, 'фуссилат': 41, 'шура': 42, 'зухруф': 43, 'духан': 44, 'жәсия': 45, 'ахқаф': 46, 'мұхаммед': 47, 'фатх': 48,
    'хужурат': 49, 'қаф': 50, 'зәрият': 51, 'тур': 52, 'нәжм': 53, 'қамар': 54, 'рахман': 55, 'уақиға': 56, 'хадид': 57, 'мужәдәлә': 58, 'мүжәдилә': 58,
    'хашр': 59, 'мумtaхина': 60, 'саф': 61, 'жұма': 62, 'мунафиқун': 63, 'тағабун': 64, 'талақ': 65, 'тахрим': 66, 'мүлік': 67, 'мулк': 67,
    'қалам': 68, 'хаққа': 69, 'мағариж': 70, 'нұх': 71, 'жын': 72, 'муззаммил': 73, 'муддәссир': 74, 'қиямет': 75, 'инсан': 76, 'мүрсәләт': 77, 'нәбә': 78,
    'назиғат': 79, 'ғабит': 80, 'тәкуир': 81, 'инфитар': 82, 'мутаффифин': 83, 'иншиқақ': 84, 'буруж': 85, 'тариқ': 86, 'ала': 87,
    'ғашия': 88, 'фәжр': 89, 'бәләд': 90, 'шәмс': 91, 'ләйл': 92, 'духа': 93, 'инширах': 94, 'шарх': 94, 'тин': 95,
    'алақ': 96, 'қадр': 97, 'бәййінә': 98, 'зілзәлә': 99, 'адият': 100, 'қариға': 101, 'тәкәсүр': 102, 'аср': 103, 'һумаза': 104, 'һумәзә': 104,
    'фил': 105, 'құрайыш': 106, 'мағун': 107, 'кәусар': 108, 'кәфирун': 109, 'наср': 110, 'мәсәд': 111, 'ықылас': 112, 'фәләқ': 113, 'нас': 114
  };

  const clean = query.toLowerCase();
  const normalizedClean = normalizeForMatching(clean);

  // 1b. Support slash formatting in the text (e.g. "13/38")
  // Only register as Quran verse if the numbers fit surah (1-114) and verse (1-286) ranges
  const slashPattern = /\b(\d+)\/(\d+)\b/g;
  let slashMatch;
  while ((slashMatch = slashPattern.exec(clean)) !== null) {
    const sId = parseInt(slashMatch[1], 10);
    const vId = parseInt(slashMatch[2], 10);
    if (sId >= 1 && sId <= 114 && vId >= 1 && vId <= 286) {
      references.push(`${sId}:${vId}`);
    }
  }

  // 2. Қазақша сүре аттары бойынша іздеу
  for (const [surahName, id] of Object.entries(SURAH_KEYS_MAP)) {
    const normSurah = normalizeForMatching(surahName);
    if (normalizedClean.includes(normSurah)) {
      // Robust regex that permits optional surah modifiers and non-word separators
      const reg = new RegExp(`${normSurah}[\\s,.;()"'“-]*(?:суреси(?:нин|нде|деги)?)?[\\s,.;()"'“-]*(\\d+)`, 'gi');
      const matches = [...normalizedClean.matchAll(reg)];
      for (const m of matches) {
        if (m && m[1]) {
          const verseNum = parseInt(m[1], 10);
          if (verseNum >= 1 && verseNum <= 286) {
            references.push(`${id}:${verseNum}`);
          }
        }
      }
    }
  }

  return Array.from(new Set(references));
}

function detectLanguage(query: string, userLanguage?: string): 'kk' | 'ru' | 'en' {
  const clean = query.trim().toLowerCase();

  const hasLatin = /[a-zA-Z]/i.test(clean);
  const hasCyrillic = /[а-яА-ЯёЁәӘіІңҢғҒүҮұҰқҚөӨһҺ]/i.test(clean);

  const englishWords = /\b(what|is|how|can|do|does|fast|prayer|islam|muslim|halal|haram|why|when|who|where|the|and|hijab|quran|ramadan|hadith)\b/i;
  const englishCheck = englishWords.test(clean);

  if (hasLatin && !hasCyrillic && (englishCheck || userLanguage?.startsWith('en'))) {
    return 'en';
  }

  if (hasCyrillic) {
    const containsKazakhSpecials = /[әіңғүұқөһ]/i.test(clean);
    if (containsKazakhSpecials) {
      return 'kk';
    }

    const russianWords = /\b(можно|ли|как|почему|когда|что|это|для|если|или|где|кто|намаза|поста|закон|грех|вера|бог|аллах|намаз|ораза|халал|харам|грешно|почему)\b/i;
    if (russianWords.test(clean) || userLanguage?.startsWith('ru')) {
      const kazakhWords = /\b(болады|ма|ме|ба|бе|па|пе|неге|қалай|калай|қашан|кашан|неше|намаз|ораза|дәрет|дарет|үкімі|укімі|неке)\b/i;
      if (kazakhWords.test(clean) && !userLanguage?.startsWith('ru')) {
        return 'kk';
      }
      return 'ru';
    }
  }

  if (userLanguage?.startsWith('ru')) return 'ru';
  if (userLanguage?.startsWith('en')) return 'en';

  return 'kk';
}

/**
 * 3. Басты функция: Бір кезеңді RAG (Single-hop RAG) - Агенттік екі кезеңді LLM шешімін (Double LLM Network Hop)
 * толықтай алып тастап, деректерді параллельді іздеп, бір-ақ LLM-мен ағынды жауап береді.
 */
export async function generateAgentAnswerStream(
  chatId: string,
  query: string,
  onChunk: (currentFullText: string) => void,
  onAction: (statusText: string) => void,
  threadId?: string | number,
  userLanguage?: string,
  abortSignal?: AbortSignal,
  skipHistorySave?: boolean
): Promise<AnswerResult> {
  console.log(`\n[🤖] Бір кезеңді RAG жауап беру басталды (ChatID: ${chatId})`);
  const effectiveLang = detectLanguage(query, userLanguage);
  console.log(`[🌐] Анықталған тіл (Effective Language): ${effectiveLang}`);
  
  try {
    const isProofQuery = isAskingForProof(query);

    // 1. Чат тарихы мен Семантикалық кэшті қатар оқу
    const historyPromise = getChatHistory(chatId, threadId);
    const cachePromise = isProofQuery ? Promise.resolve({ hit: null, vector: undefined }) : checkCache(query);
    
    const proofSourcesPromise = (isProofQuery && db) ? (async () => {
        try {
            const threadStr = (threadId !== undefined && threadId !== null) ? String(threadId) : 'general';
            const cachedDoc = await db.collection('users').doc(chatId).collection('topics').doc(threadStr).collection('latestSources').doc('current').get();
            if (cachedDoc.exists) {
                const cachedData = cachedDoc.data();
                if (cachedData && cachedData.sources && cachedData.sources.length > 0) {
                    console.log(`[aiService] Restored ${cachedData.sources.length} cached sources for proof inquiry.`);
                    return cachedData.sources as SearchResult[];
                }
            }
        } catch (e) {
            console.error('[⚠️] Error fetching cached latest sources inside aiService:', e);
        }
        return [] as SearchResult[];
    })() : Promise.resolve([] as SearchResult[]);

    // Күту
    const [rawHistory, { hit, vector }, cachedSources] = await Promise.all([
        historyPromise,
        cachePromise,
        proofSourcesPromise
    ]);

    // Тарихты форматтау
    if (rawHistory.length > 0) {
        const lastMsg = rawHistory[rawHistory.length - 1];
        if (lastMsg.role === 'user' && lastMsg.parts[0].text === query) {
             rawHistory.pop();
        }
    }

    const history: {role: string, parts: any[]}[] = [];
    for (const msg of rawHistory) {
        if (history.length === 0) {
            history.push(msg);
        } else {
            const lastMsg = history[history.length - 1];
            if (lastMsg.role === msg.role) {
                lastMsg.parts[0].text += `\n\n${msg.parts[0].text}`;
            } else {
                history.push(msg);
            }
        }
    }

    // Егер кэштен табылса (Hit)
    if (hit) {
        console.log(`[⚡] Semantic Cache (Семантикалық кэш) іске қосылды...`);
        onAction('Контексті біріктіру');
        
        const dayOfWeekC = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Almaty" })).getDay();
        const fastCachePrompt = `Сен — Daraq, Ханафи мазһабының виртуалды ұстазысың. Пайдаланушы қойған сұраққа бұрын жауап берілген. Төмендегі дайын жауаптың мағынасын сақтай отырып, оны пайдаланушы үшін жаңадан, жылы әрі табиғи етіп қайта құрастырып бер.
Ережелер:
1. HTML ТЕГТЕРІН ҚОЛДАН: <b> (жуан мәтін), <i> (көлбеу мәтін), <aside> (дәйексөздер). Ескі жауаптағы Құран аяттарының аудармаларын, Хадистерді немесе ғалымдардың/кітаптардың тікелей үзінділерін («кітапта жазылған үзінділер») тауып, оларды міндетті түрде <aside>...</aside> тегтерінің ішіне ал! Ескі жауапта бұрыннан бар <aside>...</aside> немесе <blockquote>...</blockquote> дәйексөз форматтауларын мүлтіксіз сақтап, қайта құрастырғанда да <aside>...</aside> дәйексөз ретінде қалдыр.
2. Маркдаун белгілерін (мысалы, *, **) МҮЛДЕМ ҚОЛДАНБА. Тізімдер үшін қарапайым минус (-) сызықшасын немесе • (нүкте) таңбасын қолдан.
3. Мәтін тым тығыз болмауы үшін абзацтар арасына кішігірім бос орын (жаңа жол) қалдыр.
4. "Бұл туралы толық мәліметті... төмендегі батырманы басып..." деген сияқты БАТЫРМАҒА сілтейтін сөздерді АЛЫП ТАСТА, өйткені батырманы жүйе өзі қосады. Жай ғана жауапвтың өзін әдемілеп бер.
5. КӨПТІЛДІ ДІНИ ӘДЕП (Multilingual Islamic Adab): ЕШҚАШАН (с.а.с), (r.а), (а.с), pbuh, ﷺ сияқты қысқартуларды/символдарды қолданбау. Толыққанды мадақ-дұғаларды ЖАҚШАҒА АЛЫП (мысалы: "<i>(Алланың оған игілігі мен сәлемі болсын)</i>" немесе "<i>(мир ему и благословение Аллаха)</i>") тілге бейімдеп, міндетті түрде <i>(...)</i> (көлбеу және жақша ішінде) тегінің ішіне толық жаз.
6. БАСЫНДАҒЫ СӘЛЕМДЕСУ ЖӘНЕ ДҰҒА СТИЛІ: Мәтіннің ең басындағы сәлемдесу, жылы бата-тілек және басты жауап (үкім) мүлдем бір параграфта бірігіп біртұтас қабырға болып тұрмауы тиіс:
   - Бірінші сәтте тек қана жылы сәлемдесуді жеке өз дара жолы ретінде беріп, одан кейін екі бос жол таста (мысалы: "Ассалаумағалейкум уа рахматуллаһи уа бәрәкәтүһ! 🌸" немесе "Ассаламу алейкум ва рахматуллахи ва баракатух! 🌸").
   - Сәлемдесуден соң, жауап таңдалған жағдайға сай жылы бата-тілегіңді кәдімгі қарапайым қаріптермен бөлек, дербес параграф ретінде жаз және астынан тағы екі бос жол таста. Оны жиналатын блокқа (<blockquote expandable>) салудың мүлдем қажеті ЖОҚ.
   - Одан кейін бірден басқа мәтін мен <h2>Басты үкім</h2> тақырыпшасын бастап, нақты үкімін ерекшелеп бер.
${effectiveLang === 'ru' ? '7. ⚠️ ПЕРЕВОД: Обязательно переведи и дай ответ на РУССКОМ языке.' : ''}
${effectiveLang === 'en' ? '7. ⚠️ TRANSLATION: Must translate and reply in ENGLISH.' : ''}
${dayOfWeekC === 5 ? '8. ⚠️ БҮГІН ЖҰМА: Бұл қасиетті Жұма күні. Жауабыңа «Жұма мүбәрак болсын! 🎊» мағынасындағы құттықтауды қос.' : ''}

Ескі жауап:
"""
${hit.answer}
"""`;
        
        let fastAnswerText = "";
        const fastStream = await generateContentStreamFixed({
            model: GEMINI_GENERATION_MODEL,
            contents: [{ role: 'user', parts: [{ text: fastCachePrompt }] }],
            config: {
                temperature: 0.1,
                thinkingConfig: {
                    thinkingLevel: ThinkingLevel.MINIMAL
                }
            }
        });

        for await (const chunk of fastStream) {
            if (chunk.text) {
                fastAnswerText += chunk.text;
                onChunk(fastAnswerText);
            }
        }

        console.log(`[✅] Кэш негізінде жауап толығымен генерацияланды.`);
        saveToChatHistory(chatId, 'user', query, threadId).catch(x => {});
        saveToChatHistory(chatId, 'bot', fastAnswerText, threadId).catch(x => {});

        return {
            answer: fastAnswerText,
            sources: hit.sources,
            intent: 'KNOWLEDGE_SEARCH'
        };
    }

    // Intent пен толықтықты анықтау (Smart Router)
    let routerResult: RouterResult;
    if (isProofQuery) {
      routerResult = {
        intent: 'KNOWLEDGE_SEARCH',
        is_complete: true,
        clarification_prompt: '',
        chitchat_response: '',
        refined_query: query
      };
    } else {
      routerResult = await classifyIntent(query, history);
    }
    const intent = routerResult.intent;
    console.log(`[🤖] Сұрақ санаты анықталды: ${intent}, толықтығы (is_complete): ${routerResult.is_complete}`);

    let searchInput = routerResult.refined_query || query;
    let currentPrompt = searchInput;

    if (history.length > 0 && history[history.length - 1].role === 'user') {
        const lastUser = history.pop();
        if (lastUser) {
            currentPrompt = `[Алдыңғы хабарлама]: ${lastUser.parts[0].text}\n\n[Жаңа сұрақ]: ${currentPrompt}`;
        }
    }

    if (effectiveLang === 'ru') {
        currentPrompt = `[⚠️ ПЕРЕВОД: Отвечай только на РУССКОМ языке]\n` + currentPrompt;
    } else if (effectiveLang === 'en') {
        currentPrompt = `[⚠️ TRANSLATION: Reply strictly in ENGLISH]\n` + currentPrompt;
    }
    
    const dayOfWeekCC = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Almaty" })).getDay();
    if (dayOfWeekCC === 5) {
        currentPrompt = `[⚠️ БҮГІН ЖҰМА: Бұл қасиетті Жұма күні. Жауабыңа «Жұма мүбәрак болсын! 🎊» мағынасындағы құттықтауды қос]\n` + currentPrompt;
    }

    const usedSources: SearchResult[] = [];
    let webSourcesJoined = "";
    let webSourcesList: { title: string; url: string; snippet: string }[] = [];

    // Chitchat flows: skip DB search completely
    if (intent === 'CHITCHAT') {
      console.log(`[🤖] Chitchat flow triggered.`);
      
      const answerText = routerResult.chitchat_response || "Уағалейкумассалам! <b>Daraq</b> көмекшісіне қош келдіңіз. Діни мәселелер бойынша сұрағыңыз болса, қоя беріңіз. 😊";
      
      onChunk(answerText);

      if (!skipHistorySave) {
        await saveToChatHistory(chatId, 'user', query, threadId);
        await saveToChatHistory(chatId, 'bot', answerText, threadId);
      }

      return {
        answer: answerText,
        sources: [],
        intent: 'CHITCHAT'
      };
    }

    // Incomplete Knowledge Search Flow
    if (intent === 'KNOWLEDGE_SEARCH' && !routerResult.is_complete) {
      console.log(`[🤖] Incomplete knowledge search flow triggered. Requesting clarification.`);
      const clarificationText = routerResult.clarification_prompt || "Кешіріңіз, сұрағыңызды түсіну үшін жағдайды толығырақ жаза аласыз ба?";
      onChunk(clarificationText);

      if (!skipHistorySave) {
        await saveToChatHistory(chatId, 'user', query, threadId);
        await saveToChatHistory(chatId, 'bot', clarificationText, threadId);
      }

      return {
        answer: clarificationText,
        sources: [],
        intent: 'KNOWLEDGE_SEARCH'
      };
    }

    // Knowledge Search Flow
    onAction('Дереккөздерден іздеу');

    const hasBeenRefined = searchInput !== query;

    // Parallel execution of Book Search and Web Search to minimize response latency
    const bookSearchPromise = searchAnswers(searchInput, hasBeenRefined ? undefined : vector);
    const webSearchPromise = (async () => {
      try {
        return await getVerifiedFatwasContext(searchInput, onAction);
      } catch (err: any) {
        console.error(`[🚨 Orchestration] Parallel search_official_kazakh_fatwas failed or timed out:`, err.message || err);
        return { text: '', sources: [] };
      }
    })();

    const [bookResults, webResult] = await Promise.all([
      bookSearchPromise,
      webSearchPromise
    ]);

    webSourcesJoined = webResult.text;
    webSourcesList = webResult.sources;

    // Append web sources to usedSources list so they are saved / cached
    webSourcesList.forEach(src => {
      usedSources.push({
        text: src.snippet,
        book: "ҚМДБ Пәтуасы",
        page: 1,
        imageUrl: "",
        score: 1.0,
        url: src.url
      });
    });

    // Now extract Quran references from everything we have gathered: searchInput, book chunks, and scraped web fatwas!
    const combinedTextsToParse = [
      searchInput, 
      ...bookResults.map(r => r.text),
      webSourcesJoined || ''
    ].join("\n");
    const quranRefs = parseQuranReferences(combinedTextsToParse);

    let quranResults = [];
    if (quranRefs.length > 0) {
      console.log(`[🔎] Extracted Quran references to fetch: ${JSON.stringify(quranRefs)}`);
      const fetchPromises = quranRefs.map(async (ref) => {
        try {
          const verse = await fetchSingleVerse(ref);
          if (verse) {
            return {
              book: `${verse.surahNameKk} сүресі`,
              page: parseInt(ref.split(':')[1], 10) || 1,
              text: `${verse.arabicText}\n${verse.translationText}`,
              imageUrl: '',
              score: 1.0,
              isQuran: true,
              url: verse.quranComUrl,
              audio_url: verse.audio_url
            };
          }
        } catch (e) {
          console.error(`[⚠️ Quran fetch error for ${ref}]:`, e);
        }
        return null;
      });
      const resolved = await Promise.all(fetchPromises);
      quranResults = resolved.filter(r => r !== null);
      console.log(`[✅] Fetched ${quranResults.length} Quran verses.`);
    }

    usedSources.push(...bookResults);
    usedSources.push(...quranResults);

    // Дәлелдер тарихын қалпына келтіру (Егер сұрақ дәлел тураса, бұрын табылған соңғы деректерді де қоса тұрамыз)
    if (isProofQuery && cachedSources && cachedSources.length > 0) {
        for (const src of cachedSources) {
            if (!usedSources.some(existing => existing.book === src.book && existing.page === src.page)) {
                usedSources.push(src);
            }
        }
    }

    let contextText = "";

    // 1. Quran Verses first
    const quranVerses = usedSources.filter(s => s.isQuran);
    if (quranVerses.length > 0) {
        contextText += "=== [ҚАСИЕТТІ ҚҰРАН АЯТТАРЫ] ===\n";
        quranVerses.forEach(q => {
            contextText += `[Құран: ${q.book}, ойнату сілтемесі ${q.url || ''}]\nМәтіні (Арабша): ${q.text}\n\n`;
        });
    }

    // 2. Books
    const books = usedSources.filter(s => !s.isQuran && s.book !== "ҚМДБ Пәтуасы");
    if (books.length > 0) {
        contextText += "=== [ДІНИ-ҒЫЛЫМИ КІТАПТАРДАН ДЕРЕККӨЗДЕР] ===\n";
        books.forEach((b, idx) => {
            contextText += `Дереккөз #${idx + 1} (&quot;${b.book}&quot;, бет ${b.page || 'беймәлім'}):\n${b.text}\n\n`;
        });
    }

    // 3. Web fatwas
    if (webSourcesJoined) {
        contextText += "=== [ҚМДБ РЕСМИ САЙТЫНАН ЗАМАНАУИ ПӘТУАЛАР] ===\n";
        contextText += webSourcesJoined + "\n\n";
    }

    if (!contextText) {
        contextText = `НАЗАР АУДАРЫҢЫЗ (ҚАТАҢ ЕРЕЖЕ): Дерекқордан да, Құраннан да бұл тақырыпқа қатысты ешбір нақты діни дерек табылдады немесе сәйкестік деңгейі тым төмен болды (Score Threshold).
Қолданушыға қате мәлімет (галлюцинация) бермеуі үшін, сен міндетті түрде дәл осылай немесе осыған өте жақын мағынада жұмсақ түрде жауап бер:
"Кешіріңіз, маған жүктелген Ханафи мазһабының сенімді кітаптарынан бұл мәселенің нақты үкімін таба алмадым. Сондықтан сізге қате мәлімет бермеу үшін бұл сұраққа жауап бере алмаймын."
Өз атыңнан ешқандай үкім, факт немесе жалған кітап атын ойдан құрастырмауға қатаң бұйырамын!`;
    }

    onAction('Жауапты қалыптастыру');

    // Промпт дайындау
    let langInstruction = "";
    if (effectiveLang === 'ru') {
        langInstruction = "\n⚠️ ТІЛДІК ЕРЕЖЕ (Language Mirroring): Пайдаланушының тілі немесе сұрақ қойған тілі — орыс тілі (ru). Сондықтан жауапты МІНДЕТТІ ТҮРДЕ ОРЫС ТІЛІНДЕ (strictly and only on Russian language) беріңіз. Барлық түсіндірулер мен қорытынбылар орысша болуы шарт. Егер Qdrant базасынан немесе ҚМДБ пәтуаларынан келген сенімді мәліметтер (context) КҮШТІ және Қазақ тілінде болса, сол қазақша мәліметтерді еш бұрмаламай, мағынасын 100% сақтай отырып, орыс тіліне өзіңіз ақылды түрде аударып жауап беріңіз. Діни әдеп дұғалары мен бата-тілектер де орыс тілінде толыққанды, табиғи түрде жазылсын (мысалы: «да будет доволен им Аллах», «мир ему», «да помилует его Аллах», «пусть Аллах дарует вам полезные знания» және т.б. қолданылсын).\n";
    } else if (effectiveLang === 'en') {
        langInstruction = "\n⚠️ ТІЛДІК ЕРЕЖЕ (Language Mirroring): Пайдаланушының тілі немесе сұрақ қойған тілі — ағылшын тілі (en). Жауапты МІНДЕТТІ ТҮРДЕ АҒЫЛШЫН ТІЛІНДЕ (strictly in English) беріңіз. Егер Qdrant базасынан келген сенімді мәліметтер (context) КҮШТІ және Қазақ тілінде болса, сол қазақша мәліметтерді еш бұрмаламай, мағынасын 100% сақтай отырып, ағылшын тіліне өзіңіз ақылды түрде аударып жауап беріңіз. Діни әдеп дұғалары мен бата-тілектер де ағылшын тілінде толыққанды, табиғи түрде жазылсын (мысалы: «peace and blessings of Allah be upon him», «peace be upon him», «may Allah be pleased with him», «may Allah bless you with useful knowledge» және т.б. қолданылсын).\n";
    }

    const dayOfWeekK = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Almaty" })).getDay();
    if (dayOfWeekK === 5) {
        langInstruction += "\n⚠️ БҮГІН ЖҰМА: Бұл қасиетті Жұма күні! Жауабыңның басында немесе соңында табиғи түрде «Жұма мүбәрак болсын! 🎊» мағынасындағы жылы құттықтауды қос (Орысша болса: «Джума мубарак! 🎊» немесе «Благословенной пятницы!»).\n";
    }

    const finalPrompt = `ҚОЛДАНУШЫ СҰРАҒЫ:
"${query}"
${hasBeenRefined ? `(ЖҮЙЕ ҚАЛПЫНА КЕЛТІРГЕН ТОЛЫҚ СҰРАҚ СИПАТЫ: "${searchInput}")` : ''}
${langInstruction}
ТАБЫЛҒАН ҒЫЛЫМИ-ДІНИ КОНТЕКСТ:
"""
${contextText}
"""

⚠️ МАҢЫЗДЫ ЕРЕЖЕ СЕКЦИЯСЫ:
Пайдаланушыға осы контекстте бар мәлімет аясында Ханафи мазһабының ұстазы ретінде (Persona-ға сәйкес) жауап бер.
Егер жауапта Құрантан аяттар немесе дәлелдер келтірілетін болса (мейлі олар басқа кітаптардан немесе сайт мәтіндерінен табылса да), сен оларды міндетті түрде нақты Құран аяттарының дерегінен (Құран құралдары айқындап берген АРАБША және АУДАРМАСЫ бөлімдерінен) сәйкестендіріп тауып ал. Ешқашан аятты тек қазақша аударма күйінде жаза салма! Әрқашан алдымен арабшасын жазып, одан кейін ғана аудармасын және соңына тиісті форматтағы сілтемесін қос.
Қосылатын аяттарды міндетті түрде бір тұтас <aside>...</aside> блогының ішінде, арабшасы мен қазақша аудармасының арасына нақты бос жолдар (абзацтар) тастау арқылы жаз. Telegram-да қателік тудыратын ішкі немесе қабатталған (nested) <aside> тегтерін қолданба! СТРИКТТІ түрде мына формат бойынша жаз (арабша мәтіні, қазақша аудармасы және сілтемесі бір ғана <aside> тегінің ішінде болады, бірақ олардың арасында міндетті түрде екі бос жол (\\n\\n) тасталып, ал сілтемесі <cite>...</cite> тегімен ерекшеленеді):
<aside>
[АРАБША МӘТІН харакаттарымен]

«[АУДАРМАСЫН жақшаға алмай, тырнақшаның ішінде осылай жаз]»

<cite>([СҮРЕ АТЫ] сүресі, [АЯТ НӨМІРІ]-аят (<a href="[АУДИО СІЛТЕМЕСІ]">тыңдау</a>) )</cite>
</aside> (Ескерту: Пайдаланушыға көрсететін әрбір Құран аяты үшін аудио сілтемесі контекстте міндетті түрде берілген. Сондықтан кез келген аят үшін тыңдау сілтемесі бар нұсқаны 100% міндетті түрде таңдап жаз!).
Егер табылған дереккөздерде ҚМДБ ресми сайтынан алынған қазіргі заманғы пәтуалар болса, соларға сүйеніп толық ресми және заманауи пәтуа үкімін түсіндіріп бер. Егер классикалық кітаптар да, заманауи пәтуалар да қатар табылса, екеуін біріктіріп ең жақсы жауап нұсқасын жаса.
Егер ешқандай ақпарат табылмаса немесе контексте нақты жауап болмаса, онда нақты "Бұл мәлімет кітаптардан табылмады, сондықтан нақты жауап бере алмаймын" деп ашық айт. Жалған кітап атын немесе жауап ойлап таппа!
ЖАУАПТЫҢ СОҢЫНДА ЕШҚАНДАЙ дереккөзді немесе кітап атын, бетін атап түсіндіретін үлкен сөйлемдер, сүйенген сайттарды немесе "Бұл мәліметтерді ҚМДБ-ның ресми... дайындадым" не "Бұл туралы толық мәліметті... бетінен тауып бердім" сияқты артық сөйлемдерді МҮЛДЕМ ЖАЗБА! Барлық дереккөздер мен қолданылған кітаптар соңында автоматты түрде дәйексөз ретінде қосылады. ЕШҚАНДАЙ батырма (кнопка) туралы сөз жазба!

Жауапты таза HTML элементтерімен (<b>, <aside>) жасап, бірден ағынмен жазуды баста:`;

    const contents = [
      ...history,
      { role: 'user', parts: [{ text: finalPrompt }] }
    ];

    const responseStream = await generateContentStreamFixed({
      model: GEMINI_GENERATION_MODEL,
      contents: contents,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.1,
        thinkingConfig: {
          thinkingLevel: ThinkingLevel.MINIMAL
        }
      }
    });

    let answerText = "";
    for await (const chunk of responseStream) {
      if (abortSignal?.aborted) {
         console.log(`[🛑] RAG Streaming interrupted by abort signal (User edited message)`);
         throw new Error("AbortError");
      }
      if (chunk.text) {
        answerText += chunk.text;
        onChunk(answerText);
      }
    }

    if (!answerText) {
      answerText = "Кешіріңіз, жауап құрастыру мүмкін болмады.";
    } else {
      const quranCitations: string[] = [];
      const siteCitations: string[] = [];
      const bookCitations: string[] = [];

      // 1. Web sites
      if (webSourcesList.length > 0) {
        webSourcesList.forEach(src => {
          const domain = tryGetDomain(src.url);
          siteCitations.push(`<a href="${src.url}">${domain}</a>`);
        });
      }

      // 1.5 Quran
      const quranFound = usedSources.filter(s => s.isQuran);
      const quranCitationsMap = new Map<string, Set<number>>();
      const quranUrls = new Map<string, string>(); // key to url mapping
      
      const lowercaseAnswer = answerText.toLowerCase();

      quranFound.forEach(q => {
        const surahName = q.book.replace(" сүресі", "").trim().toLowerCase();
        const verseNum = q.page || 1;
        
        // Check if the answer actually mentions the surah name and the verse number
        const hasSurah = lowercaseAnswer.includes(surahName) || 
                          lowercaseAnswer.includes(surahName.replace('ә', 'а')) ||
                          lowercaseAnswer.includes(surahName.replace('ә', 'е')) ||
                          lowercaseAnswer.includes(surahName.replace('ө', 'о')) ||
                          lowercaseAnswer.includes(surahName.replace('ұ', 'у')) ||
                          lowercaseAnswer.includes(surahName.replace('ү', 'у')) ||
                          lowercaseAnswer.includes(surahName.replace('і', 'и')) ||
                          lowercaseAnswer.includes(surahName.replace('ғ', 'г')) ||
                          lowercaseAnswer.includes(surahName.replace('қ', 'к')) ||
                          lowercaseAnswer.includes(surahName.replace('қ', 'г'));

        const hasVerse = lowercaseAnswer.includes(String(verseNum));

        if (hasSurah && hasVerse) {
          if (!quranCitationsMap.has(q.book)) {
            quranCitationsMap.set(q.book, new Set());
          }
          if (q.page !== undefined && q.page !== null && String(q.page) !== '') {
            quranCitationsMap.get(q.book)!.add(Number(q.page));
          }
          if (q.url) {
            quranUrls.set(`${q.book}_${q.page}`, q.url);
          }
        }
      });

      quranCitationsMap.forEach((versesSet, surahName) => {
        const versesArray = Array.from(versesSet).sort((a,b) => a - b);
        if (versesArray.length > 0) {
          const links = versesArray.map(v => {
            const urlKey = `${surahName}_${v}`;
            const url = quranUrls.get(urlKey);
            if (url) {
              return `<a href="${url}">${v}</a>`;
            } else {
              return `${v}`;
            }
          });
          const suffix = versesArray.length > 1 ? 'аяттар' : 'аят';
          quranCitations.push(`${surahName}, ${links.join(', ')}-${suffix}`);
        }
      });

      // 2. Books
      const booksFound = usedSources.filter(s => !s.isQuran && s.book && s.book !== "ҚМДБ Пәтуасы");
      const bookPagesMap = new Map<string, Set<number | string>>();
      booksFound.forEach(b => {
        if (!bookPagesMap.has(b.book)) {
          bookPagesMap.set(b.book, new Set());
        }
        if (b.page !== undefined && b.page !== null && String(b.page) !== '') {
          bookPagesMap.get(b.book)!.add(b.page);
        }
      });

      bookPagesMap.forEach((pagesSet, bookName) => {
        const pagesArray = Array.from(pagesSet);
        if (pagesArray.length > 0) {
          const sortedPages = pagesArray.map(p => {
            const num = Number(p);
            return isNaN(num) ? p : num;
          }).sort((a, b) => {
            if (typeof a === 'number' && typeof b === 'number') {
              return a - b;
            }
            return String(a).localeCompare(String(b), undefined, { numeric: true });
          });
          const pagesStr = sortedPages.join(',');
          const isPlural = sortedPages.length > 1 || sortedPages.some(p => String(p).includes('-') || String(p).includes(','));
          const suffix = isPlural ? 'беттер' : 'бет';
          bookCitations.push(`${bookName}, ${pagesStr}-${suffix}`);
        } else {
          bookCitations.push(`${bookName}`);
        }
      });

      if (quranCitations.length > 0 || siteCitations.length > 0 || bookCitations.length > 0) {
        const lines: string[] = [];
        if (quranCitations.length > 0) {
          lines.push(`<h6>Құран: ${quranCitations.join(', ')}</h6>`);
        }
        if (siteCitations.length > 0) {
          lines.push(`<h6>Сайттар: ${siteCitations.join(', ')}</h6>`);
        }
        if (bookCitations.length > 0) {
          lines.push(`<h6>Кітаптар: ${bookCitations.join(', ')}</h6>`);
        }
        
        // RichBlockDetails аккордеоны ретінде шығарамыз
        const citations = `\n\n<details>\n<summary><b>Дереккөздерді көру</b></summary>\n${lines.join('\n')}\n</details>\n`;
        answerText += citations;
        // Trigger onChunk one last time to push the citations
        onChunk(answerText);
      }
      // Кэшке жазу (Fire and forget асинхронды)
      writeCache(query, answerText, usedSources).catch(e => console.error("Cache write error:", e));
    }

    console.log(`[✅] Жылдам RAG жауабы толығымен аяқталды.`);
    
    if (!skipHistorySave) {
       await saveToChatHistory(chatId, 'user', query, threadId); 
       await saveToChatHistory(chatId, 'bot', answerText, threadId);
    }

    return {
      answer: answerText,
      sources: usedSources,
      intent: 'KNOWLEDGE_SEARCH'
    };

  } catch (error: any) {
    if (error?.message === 'AbortError' || error?.name === 'AbortError') {
       throw error;
    }
    console.error("\n[❌] Жылдам RAG жауап алу барысында қателік орын алды:", error?.message || error);
    throw error;
  }
}

/**
 * Compatibility wrapper function that returns agent answers non-streamed
 */
export async function generateAnswer(
  chatId: string, 
  query: string, 
  preFetchedSources?: SearchResult[],
  threadId?: string | number,
  userLanguage?: string
): Promise<AnswerResult> {
  return generateAgentAnswerStream(
    chatId,
    query,
    () => {},
    () => {},
    threadId,
    userLanguage
  );
}

/**
 * Сөйлеу транскрипциясын түзетуден кейінгі сыни тексеріс пен тазалау
 */
export { validateAndCleanCorrection, correctTranscribedText } from './transcriptionService';
