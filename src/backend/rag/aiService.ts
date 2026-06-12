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


async function classifyIntent(query: string, history: {role: string, parts: any[]}[]): Promise<'CHITCHAT' | 'KNOWLEDGE_SEARCH'> {
  const clean = query.trim().toLowerCase();
  
  // 1. Ұзын мәтіндер әметте діни немесе талдауды қажет ететін үлкен сұрақтар
  if (clean.length > 100) {
    return 'KNOWLEDGE_SEARCH';
  }

  // 2. Діни негізгі кілт сөздер (мұндайда міндетті түрде кітаптарды іздеу керек)
  const religiousKeywords = [
    'намаз', 'ораза', 'дәрет', 'дарет', 'аят', 'сүре', 'суре', 'хадис', 'үндеу', 'үкім', 'укім', 'парыз', 'сүннет', 'суннет', 
    'уәжіп', 'уажип', 'халал', 'харам', 'мәкруһ', 'макрух', 'мустахаб', 'неке', 'талақ', 'талак', 'зекет', 'ажырасу', 'қаза', 'каза',
    'сапар', 'мүсәпір', 'мусапир', 'құран', 'куран', 'аллаһ', 'аллах', 'құдай', 'кудай', 'пайғамбар', 'пайгамбар',
    'күнә', 'куна', 'жәннат', 'жаннат', 'тозақ', 'тозак', 'ислам', 'дін', 'дин', 'иман', 'періште', 'периште', 'жұма', 'жума',
    'ақша', 'акша', 'несие', 'банк', 'пайыз', 'өсім', 'осим', 'сауда', 'тамақ', 'тамак', 'ет', 'шошқа', 'шошка', 'арақ', 'арак'
  ];

  for (const kw of religiousKeywords) {
    if (clean.includes(kw)) {
      return 'KNOWLEDGE_SEARCH';
    }
  }

  // Егер сұрақ белгісі болса немесе сұрау есімдіктері болса, бірақ 'сен кімсің' деген сияқты болмаса
  const questionWords = ['қалай', 'не', 'кім', 'қашан', 'қайда', 'қандай', 'неше', 'неге', '?'];
  const hasQuestion = questionWords.some(qw => clean.includes(qw));
  
  // 3. Сәлемдесу, алғыс, қоштасу және жалпы қарапайым кілт сөздері (CHITCHAT)
  const chitchatKeywords = [
    'сәлем', 'салем', 'ассалау', 'ассаламу', 'алейкум', 'әлейкум', 'қалайсың', 'қалайсыз', 'қалайсын', 'амансыз',
    'рахмет', 'рақмет', 'ризамын', 'алғыс', 'алгыс', 'сүйем', 'суйем',
    'спасибо', 'благодарю', 'привет', 'здравствуйте', 'салам',
    'сен кімсің', 'сен кімсін', 'атың кім', 'не істей аласың', 'не істей аласын', 'сен не істейсің', 'сен не істейсин',
    'кто ты', 'как зовут', 'что умеешь',
    'сау бол', 'сау болыңыз', 'сау болыныз', 'көріскенше', 'корискенше', 'пока', 'до свидания',
    'керемет', 'тамаша', 'күшті', 'кушти', 'окей', 'ok', 'жарайды'
  ];

  // Толық сөзбен сәйкестік (exact match) немесе қысқа сөз тіркестері ғана CHITCHAT деп танылуы керек
  if (clean.length < 30 && !hasQuestion) {
     for (const kw of chitchatKeywords) {
      if (clean.includes(kw)) {
        return 'CHITCHAT';
      }
    }
  }

  // 4. Тек өте қысқа сөздер немесе фразалар болса (мысалы, "қалай", "иә", "жоқ", "нәтиже")
  if (clean.length < 20) {
    return 'CHITCHAT';
  }

  // Әйтпесе, толыққанды діни Іздеуді немесе нақты сұрақ ретінде қабылдаймыз
  return 'KNOWLEDGE_SEARCH';
}

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

/**
 * Хабарламаларды Firestore-ға сақтау
 */
export async function rewindHistory(chatId: string, threadId: string | number | undefined, targetMsgId: number, newText: string): Promise<{deletedMsgIds: number[], updatedUserQuery: boolean}> {
  const result = { deletedMsgIds: [] as number[], updatedUserQuery: false };
  if (!db) return result;
  try {
    const threadStr = (threadId !== undefined && threadId !== null) ? String(threadId) : 'general';
    const msgRef = db.collection('users').doc(chatId).collection('topics').doc(threadStr).collection('messages');
    
    // First, try to find the message by msgId
    let snapshot = await msgRef.where('msgId', '==', targetMsgId).get();
    
    if (snapshot.empty) {
      console.log(`[⚠️] Cannot rewind history, message ID ${targetMsgId} not found in Firestore. Older message format?`);
      return result;
    }
    
    const targetDoc = snapshot.docs[0];
    const targetTimestamp = targetDoc.data().timestamp;

    // We want to delete everything strictly AFTER this user message
    const toDelete = await msgRef.where('timestamp', '>', targetTimestamp).get();
    
    const batch = db.batch();
    toDelete.forEach((doc) => {
      batch.delete(doc.ref);
      const mId = doc.data().msgId;
      if (mId && typeof mId === 'number') {
         result.deletedMsgIds.push(mId);
      }
    });

    // OVERWRITE the user message query per user's explicit request
    batch.update(targetDoc.ref, { text: newText });

    await batch.commit();
    result.updatedUserQuery = true;
    console.log(`[✅] Rewound history: Updated target message ${targetMsgId} and deleted ${toDelete.size} subsequent messages`);
  } catch(e) {
    console.error("[❌] Error rewinding history:", e);
  }
  return result;
}

export async function saveToChatHistory(chatId: string, role: 'user' | 'bot', text: string, threadId?: string | number, msgId?: number, replyToMsgId?: number) {
  if (!db) return;
  try {
    const threadStr = (threadId !== undefined && threadId !== null) ? String(threadId) : 'general';
    const payload: any = { role, text, timestamp: new Date() };
    if (msgId) payload.msgId = msgId;
    if (replyToMsgId) payload.replyToMsgId = replyToMsgId;
    await db.collection('users').doc(chatId).collection('topics').doc(threadStr).collection('messages').add(payload);
  } catch (error) {
    console.error("[❌] Хабарламаны сақтау кезінде қате орын алды (Firestore Error):", error);
  }
}


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
function parseQuranReferences(query: string): string[] {
  const references: string[] = [];
  
  // 1. Формат "2:183" немесе "2:183-185"
  const colonPattern = /\b(\d+):(\d+)(-\d+)?\b/g;
  let match;
  while ((match = colonPattern.exec(query)) !== null) {
    references.push(match[0]);
  }

  // 2. Қазақша "Бақара сүресі, 183-аят" немесе "Бақара 183" форматы
  const SURAH_KEYS_MAP: Record<string, number> = {
    'фатиха': 1, 'бақара': 2, 'әли имран': 3, 'әли-имран': 3, 'ниса': 4, 'мәида': 5, 'анғам': 6, 'әнғам': 6, 'ағраф': 7, 'әнфал': 8, 'тәубе': 9, 'юнус': 10,
    'һұд': 11, 'юсуф': 12, 'рағд': 13, 'ибраһим': 14, 'хижр': 15, 'нахл': 16, 'исра': 17, 'кәһф': 18, 'мәриям': 19, 'таһа': 20,
    'әнбия': 21, 'хаж': 22, 'муминун': 23, 'нұр': 24, 'фурқан': 25, 'шуара': 26, 'нәмл': 27, 'қасас': 28, 'анкабут': 29, 'әнкабут': 29,
    'рум': 30, 'лұқман': 31, 'сәжде': 32, 'ахзаб': 33, 'сәбә': 34, 'фатыр': 35, 'ясин': 36, 'саффат': 37, 'саад': 38, 'зумар': 39,
    'ғафир': 40, 'фуссилат': 41, 'шура': 42, 'зухруф': 43, 'духан': 44, 'жәсия': 45, 'ахқаф': 46, 'мұхаммед': 47, 'фатх': 48,
    'хужурат': 49, 'қаф': 50, 'зәрият': 51, 'тур': 52, 'нәжм': 53, 'қамар': 54, 'рахман': 55, 'уақиға': 56, 'хадид': 57, 'мужәдәлә': 58,
    'хашр': 59, 'мумtaхина': 60, 'саф': 61, 'жұма': 62, 'мунафиқун': 63, 'тағабун': 64, 'талақ': 65, 'тахрим': 66, 'мүлік': 67, 'мулк': 67,
    'қалам': 68, 'хаққа': 69, 'мағариж': 70, 'нұх': 71, 'жын': 72, 'муззаммил': 73, 'муддәссир': 74, 'қиямет': 75, 'инсан': 76, 'мүрсәләт': 77, 'нәбә': 78,
    'назиғат': 79, 'ғабит': 80, 'тәкуир': 81, 'инфитар': 82, 'мутаффифин': 83, 'иншиқақ': 84, 'буруж': 85, 'тариқ': 86, 'ала': 87,
    'ғашия': 88, 'фәжр': 89, 'бәләд': 90, 'шәмс': 91, 'ләйл': 92, 'духа': 93, 'инширах': 94, 'шарх': 94, 'тин': 95,
    'алақ': 96, 'қадр': 97, 'бәййінә': 98, 'зілзәлә': 99, 'адият': 100, 'қариға': 101, 'тәкәсүр': 102, 'аср': 103, 'һумаза': 104,
    'фил': 105, 'құрайыш': 106, 'мағун': 107, 'кәусар': 108, 'кәфирун': 109, 'наср': 110, 'мәсәд': 111, 'ықылас': 112, 'фәләқ': 113, 'нас': 114
  };

  const clean = query.toLowerCase();
  for (const [surahName, id] of Object.entries(SURAH_KEYS_MAP)) {
    if (clean.includes(surahName)) {
      const reg = new RegExp(`${surahName}\\s+(?:сүресі(?:нің|нде|дегі)?,?\\s+)?(\\d+)`, 'i');
      const m = query.match(reg);
      if (m && m[1]) {
        references.push(`${id}:${m[1]}`);
      }
    }
  }

  return Array.from(new Set(references));
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
        onAction('👉 Бұрынғы жауаптар негізінде жылдам қорытындылаудамын...');
        
        const dayOfWeekC = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Almaty" })).getDay();
        const fastCachePrompt = `Сен — Daraq, Ханафи мазһабының виртуалды ұстазысың. Пайдаланушы қойған сұраққа бұрын жауап берілген. Төмендегі дайын жауаптың мағынасын сақтай отырып, оны пайдаланушы үшін жаңадан, жылы әрі табиғи етіп қайта құрастырып бер.
Ережелер:
1. HTML ТЕГТЕРІН ҚОЛДАН: <b> (жуан мәтін), <i> (көлбеу мәтін), <blockquote> (дәйексөздер). Ескі жауаптағы Құран аяттарының аудармаларын, Хадистерді немесе ғалымдардың/кітаптардың тікелей үзінділерін («кітапта жазылған үзінділер») тауып, оларды міндетті түрде <blockquote>...</blockquote> тегтерінің ішіне ал! Ескі жауапта бұрыннан бар <blockquote>...</blockquote> дәйексөз форматтауларын мүлтіксіз сақтап, қайта құрастырғанда да дәйексөз ретінде қалдыр.
2. Маркдаун белгілерін (мысалы, *, **) МҮЛДЕМ ҚОЛДАНБА. Тізімдер үшін қарапайым минус (-) сызықшасын немесе • (нүкте) таңбасын қолдан.
3. Мәтін тым тығыз болмауы үшін абзацтар арасына кішігірім бос орын (жаңа жол) қалдыр.
4. "Бұл туралы толық мәліметті... төмендегі батырманы басып..." деген сияқты БАТЫРМАҒА сілтейтін сөздерді АЛЫП ТАСТА, өйткені батырманы жүйе өзі қосады. Жай ғана жауапвтың өзін әдемілеп бер.
5. КӨПТІЛДІ ДІНИ ӘДЕП (Multilingual Islamic Adab): ЕШҚАШАН (с.а.с), (r.а), (а.с), pbuh, ﷺ сияқты қысқартуларды/символдарды қолданбау. Толыққанды мадақ-дұғаларды ЖАҚШАҒА АЛЫП (мысалы: "<i>(Алланың оған игілігі мен сәлемі болсын)</i>" немесе "<i>(мир ему и благословение Аллаха)</i>") тілге бейімдеп, міндетті түрде <i>(...)</i> (көлбеу және жақша ішінде) тегінің ішіне толық жаз.
${userLanguage?.startsWith('ru') ? '6. ⚠️ ПЕРЕВОД: Обязательно переведи и дай ответ на РУССКОМ языке.' : ''}
${userLanguage?.startsWith('en') ? '6. ⚠️ TRANSLATION: Must translate and reply in ENGLISH.' : ''}
${dayOfWeekC === 5 ? '7. ⚠️ БҮГІН ЖҰМА: Бұл қасиетті Жұма күні. Жауабыңа «Жұма мүбәрак болсын! 🎊» мағынасындағы құттықтауды қос.' : ''}

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

    // Intent анықтау (Chitchat немесе нақты сұрақ)
    const intent = isProofQuery ? 'KNOWLEDGE_SEARCH' : await classifyIntent(query, history);
    console.log(`[🤖] Сұрақ санаты анықталды: ${intent}`);

    let currentPrompt = query;
    if (history.length > 0 && history[history.length - 1].role === 'user') {
        const lastUser = history.pop();
        if (lastUser) {
            currentPrompt = `[Алдыңғы хабарлама]: ${lastUser.parts[0].text}\n\n[Жаңа сұрақ]: ${currentPrompt}`;
        }
    }

    if (userLanguage && userLanguage.startsWith('ru')) {
        currentPrompt = `[⚠️ ПЕРЕВОД: Отвечай только на РУССКОМ языке]\n` + currentPrompt;
    } else if (userLanguage && userLanguage.startsWith('en')) {
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
      const responseStream = await generateContentStreamFixed({
        model: GEMINI_GENERATION_MODEL,
        contents: [
          ...history,
          { role: 'user', parts: [{ text: currentPrompt }] }
        ],
        config: {
          systemInstruction: SYSTEM_PROMPT,
          temperature: 0.5,
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.MINIMAL
          }
        }
      });

      let answerText = "";
      for await (const chunk of responseStream) {
        if (abortSignal?.aborted) {
           throw new Error("AbortError");
        }
        if (chunk.text) {
          answerText += chunk.text;
          onChunk(answerText);
        }
      }

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

    // Knowledge Search Flow
    onAction('🔍 Қажетті дереккөздерді қарастырудамын...');

    const bookPromise = searchAnswers(query, vector);
    const quranRefs = parseQuranReferences(query);
    const quranPromise = quranRefs.length > 0 ? (async () => {
      const results: SearchResult[] = [];
      for (const ref of quranRefs) {
        try {
          const verse = await fetchSingleVerse(ref);
          if (verse) {
            results.push({
              book: `${verse.surahNameKk} сүресі`,
              page: parseInt(ref.split(':')[1], 10) || 1,
              text: `${verse.arabicText}\n${verse.translationText}`,
              imageUrl: '',
              score: 1.0,
              isQuran: true,
              url: verse.quranComUrl
            });
          }
        } catch (e) {
          console.error(`[⚠️ Quran fetch error]:`, e);
        }
      }
      return results;
    })() : Promise.resolve([] as SearchResult[]);

    const MIN_RELEVANCE_SCORE = 0.50;
    const [bookResults, quranResults] = await Promise.all([bookPromise, quranPromise]);
    usedSources.push(...bookResults);
    usedSources.push(...quranResults);

    // Evaluate relevance score from book search
    const maxScore = bookResults.length > 0 ? Math.max(...bookResults.map(r => r.score || 0)) : 0;
    const isModernIssue = /крипто|биткоин|vape|вейп|электронды темекі|электронные сигареты|интернет|онлайн|акция|маркетплейс|сетевой маркетинг|вакцина|пластикалық|пластическая/i.test(query);

    if (maxScore < MIN_RELEVANCE_SCORE || isModernIssue) {
      console.log(`[🔍 Orchestration] Triggering search_official_kazakh_fatwas. Low relevance (${maxScore.toFixed(4)} < ${MIN_RELEVANCE_SCORE}) or modern issue.`);
      try {
        const webResult = await getVerifiedFatwasContext(query, onAction);
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
      } catch (err: any) {
        console.error(`[🚨 Orchestration] search_official_kazakh_fatwas failed or timed out:`, err.message || err);
      }
    }

    // Дәлелдер тарихын қалпына келтіру (Егер сұрақ дәлел тураса, бұрын табылған соңғы деректерді де қоса тұрамыз)
    if (isProofQuery && cachedSources && cachedSources.length > 0) {
        for (const src of cachedSources) {
            if (!usedSources.some(existing => existing.book === src.book && existing.page === src.page)) {
                usedSources.push(src);
            }
        }
    }

    // LLM-ге арналған контекстті құрастыру
    let contextText = "";
    
    const booksFound = usedSources.filter(s => !s.isQuran && s.book !== "ҚМДБ Пәтуасы");
    const quranFound = usedSources.filter(s => s.isQuran);
    
    if (booksFound.length > 0) {
        contextText += "=== [ХАНАФИ МАЗҺАБЫ БОЙЫНША ТАБЫЛҒАН ДЕРЕККӨЗДЕР] ===\n";
        contextText += booksFound.map((c, i) => 
            `[Дереккөз ${i + 1}] КІТАП АТЫ: "${c.book}", БЕТІ: ${c.page}\nҚҰРАМЫНДАҒЫ МӘТІН: ${c.text}`
        ).join('\n\n') + "\n\n";
    }
    
    if (quranFound.length > 0) {
        contextText += "=== [ҚҰРАН АЯТТАРЫНАН ТАБЫЛҒАН СЕНІМДІ ДЕРЕКТЕР] ===\n";
        contextText += quranFound.map((r, i) =>
            `[Құран аяты ${i + 1}] СҮРЕ: "${r.book}", АЯТ НӨМІРІ: ${r.page}\nАРАБША: ${r.text.split('\n')[0]}\nАУДАРМАСЫ: ${r.text.split('\n').slice(1).join('\n')}`
        ).join('\n\n') + "\n\n";
    }

    if (webSourcesJoined) {
        contextText += "=== [ҚМДБ РЕСМИ САЙТЫНАН (MUFTYAT.KZ/FATUA.KZ) ТАБЫЛҒАН ҚАЗІРГІ ЗАМАНҒЫ ПӘТУАЛАР] ===\n";
        contextText += webSourcesJoined + "\n\n";
    }

    if (!contextText) {
        contextText = `НАЗАР АУДАРЫҢЫЗ (ҚАТАҢ ЕРЕЖЕ): Дерекқордан да, Құраннан да бұл тақырыпқа қатысты ешбір нақты діни дерек табылмады немесе сәйкестік деңгейі тым төмен болды (Score Threshold).
Қолданушыға қате мәлімет (галлюцинация) бермеу үшін, сен міндетті түрде дәл осылай немесе осыған өте жақын мағынада жұмсақ түрде жауап бер:
"Кешіріңіз, маған жүктелген Ханафи мазһабының сенімді кітаптарынан бұл мәселенің нақты үкімін таба алмадым. Сондықтан сізге қате мәлімет бермеу үшін бұл сұраққа жауап бере алмаймын."
Өз атыңнан ешқандай үкім, факт немесе жалған кітап атын ойдан құрастырмауға қатаң бұйырамын!`;
    }

    onAction('✍️ Шешімді қорытындылап, жауапты рәсімдеудемін...');

    // Промпт дайындау
    let langInstruction = "";
    if (userLanguage && userLanguage.startsWith('ru')) {
        langInstruction = "\n⚠️ ТІЛДІК ЕРЕЖЕ: Пайдаланушының тілі орыс тілі (ru). Сондықтан жауапты МІНДЕТТІ ТҮРДЕ ОРЫС ТІЛІНДЕ (на русском языке) беріңіз. Барлық түсіндірмелер мен қорытындылар орысша болуы шарт.\n";
    } else if (userLanguage && userLanguage.startsWith('en')) {
        langInstruction = "\n⚠️ ТІЛДІК ЕРЕЖЕ: Пайдаланушының тілі ағылшын тілі (en). Жауапты МІНДЕТТІ ТҮРДЕ АҒЫЛШЫН ТІЛІНДЕ (in English) беріңіз.\n";
    }

    const dayOfWeekK = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Almaty" })).getDay();
    if (dayOfWeekK === 5) {
        langInstruction += "\n⚠️ БҮГІН ЖҰМА: Бұл қасиетті Жұма күні! Жауабыңның басында немесе соңында табиғи түрде «Жұма мүбәрак болсын! 🎊» мағынасындағы жылы құттықтауды қос (Орысша болса: «Джума мубарак! 🎊» немесе «Благословенной пятницы!»).\n";
    }

    const finalPrompt = `ҚОЛДАНУШЫ СҰРАҒЫ:
"${query}"
${langInstruction}
ТАБЫЛҒАН ҒЫЛЫМИ-ДІНИ КОНТЕКСТ:
"""
${contextText}
"""

⚠️ МАҢЫЗДЫ ЕРЕЖЕ СЕКЦИЯСЫ:
Пайдаланушыға осы контекстте бар мәлімет аясында Ханафи мазһабының ұстазы ретінде (Persona-ға сәйкес) жауап бер.
Егер табылған деректерде ҚМДБ ресми сайтынан алынған қазіргі заманғы пәтуалар болса, соларға сүйеніп толық ресми және заманауи пәтуа үкімін түсіндіріп бер. Егер классикалық кітаптар да, заманауи пәтуалар да қатар табылса, екеуін біріктіріп ең жақсы жауап нұсқасын жаса.
Егер ешқандай ақпарат табылмаса немесе контексте нақты жауап болмаса, онда нақты "Бұл мәлімет кітаптардан табылмады, сондықтан нақты жауап бере алмаймын" деп ашық айт. Жалған кітап атын немесе жауап ойлап таппа!
Парақ соңында ақпарат классикалық кітаптан болса "Бұл туралы толық мәліметті «[Кітап аты]» еңбегінің [Бет нөмірі]-бетінен тауып бердім." деп қана жаз. Егер тек қазіргі заман пәтуасынан табылған болса, ҚМДБ ресми пәтуаларын қолданғаныңды қысқаша атап өт. ЕШҚАНДАЙ батырма (кнопка) туралы сөз жазба!

Жауапты таза HTML элементтерімен (<b>, <blockquote>) жасап, бірден ағынмен жазуды баста:`;

    const contents: any[] = [
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
      // Append web search source citations if any exist
      if (webSourcesList.length > 0) {
        const citationLinks = webSourcesList.map(src => {
          const domain = tryGetDomain(src.url);
          return `<a href="${src.url}">${domain}</a>`;
        });
        const citations = `\n\n<blockquote>Дереккөз: ${citationLinks.join(', ')}</blockquote>`;
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
    if (error?.message === 'AbortError') {
       throw error;
    }
    console.error("\n[❌] Жылдам RAG жауап алу барысында қателік орын алды:", error?.message || error);
    return {
       answer: "⚠️ Кешіріңіз, жүйелік қатеге байланысты жауап бере алмаймын.",
       sources: [],
       intent: 'CHITCHAT'
    };
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
export function validateAndCleanCorrection(rawText: string, correctedText: string): string {
  let cleaned = correctedText.trim();
  
  // 1. "Шығыс:" немесе "Жауап:" сияқты префикстерді алып тастау
  cleaned = cleaned.replace(/^(шығыс|жауап|түзетілген|corrected|output|кіріс|input)\s*:\s*/i, '');
  cleaned = cleaned.trim();

  // Егер тырнақшалардың ішіне алып берсе, оларды да тазалау
  if (cleaned.startsWith('"') && cleaned.endsWith('"') && cleaned.length > 2) {
    cleaned = cleaned.substring(1, cleaned.length - 1).trim();
  }

  const normalized = cleaned.toLowerCase();

  // 2. Артық метамәлімет немесе модельдің өз диалогын анықтауға арналған қара тізім
  const blacklistedTokens = [
    'түсінікті',
    'түзетуді қажет',
    'мәтінді жіберсеңіз',
    'нұсқауларға сай',
    'сауатты түрде',
    'қалпына келтіріп',
    'сіздің сұрағыңыз',
    'түзетілген нұсқа',
    'сұраққа жауап',
    'шығыс:',
    'кіріс:',
    'қатаң тыйымдар',
    'нұсқаулық',
    'нұсқауларға сәйкес',
    'жасанды интеллект',
    'моделісің'
  ];

  for (const token of blacklistedTokens) {
    if (normalized.includes(token)) {
      console.warn(`[⚠️ CORRECTOR GUARD] Blacklist token "${token}" triggered in corrected text! Falling back to raw.`);
      return rawText;
    }
  }

  // 3. Ұзындықты бақылау: Егер шикі мәтін қысқа болса, бірақ түзетілген мәтін одан бірнеше есе ұзын болып, нұсқаулықтарды шығарып жіберсе
  if (rawText.length < 15 && cleaned.length > 80) {
    console.warn(`[⚠️ CORRECTOR GUARD] Suspicious length expansion! Raw: ${rawText.length}, Corrected: ${cleaned.length}. Falling back to raw.`);
    return rawText;
  }

  return cleaned;
}

/**
 * Дауыстық хабарлама транскрипциясын қазақша грамматикаға немесе діни терминдерге сай түзету
 */
export async function correctTranscribedText(rawText: string): Promise<string> {
  if (!rawText || rawText.trim().length === 0) return rawText;

  try {
    console.log(`[🎙 CORRECTOR] Correcting speech transcription with Gemini: "${rawText}"`);
    const response = await generateContentFixed({
      model: GEMINI_GENERATION_MODEL,
      contents: [{ role: 'user', parts: [{ text: rawText }] }],
      config: {
        systemInstruction: TRANSCRIPTION_CORRECTION_PROMPT,
        temperature: 0.1,
        thinkingConfig: {
          thinkingLevel: ThinkingLevel.MINIMAL
        }
      }
    });

    const result = (response.text || '').trim();
    if (result && result.length > 0) {
      const validated = validateAndCleanCorrection(rawText, result);
      console.log(`[🎙 CORRECTOR] Successfully corrected transcription: "${validated}" (original: "${rawText}")`);
      return validated;
    }
  } catch (error: any) {
    console.error('[❌ CORRECTOR ERROR]: Failed to correct voice transcription, falling back to raw:', error.message || error);
  }

  return rawText;
}
