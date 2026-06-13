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


export interface RouterResult {
  intent: 'CHITCHAT' | 'KNOWLEDGE_SEARCH';
  is_complete: boolean;
  clarification_prompt: string;
  refined_query: string;
}

async function classifyIntent(query: string, history: {role: string, parts: any[]}[]): Promise<RouterResult> {
  const clean = query.trim().toLowerCase();

  // If the query is incredibly short and matches greetings/thanks directly to optimize latency:
  const shortChitchat = [
    'сәлем', 'салем', 'ассалау', 'ассаламу', 'алейкум', 'әлейкум', 'қалайсың', 'қалайсыз', 'қалайсын', 'амансыз',
    'рахмет', 'рақмет', 'ризамын', 'алғыс',
    'спасибо', 'благодарю', 'привет', 'здравствуйте', 'салам',
    'сен кімсің', 'сен кімсін', 'атың кім',
    'сау бол', 'сау болыңыз', 'сау болыныз', 'пока', 'до свидания',
    'окей', 'ok', 'жарайды'
  ];
  if (clean.length < 15 && shortChitchat.some(kw => clean.includes(kw))) {
    return {
      intent: 'CHITCHAT',
      is_complete: true,
      clarification_prompt: '',
      refined_query: query
    };
  }

  try {
    console.log(`\n[🔍 ROUTER] Analyzing query for intent & completeness using Gemini... Query: "${query}"`);

    const formattedHistoryText = history
      .slice(-10) // analyze the last 10 turns to avoid token inflation
      .map(h => `${h.role === 'model' ? 'Бот' : 'Пайдаланушы'}: "${h.parts[0].text}"`)
      .join('\n');

    const promptText = `Сен — Daraq діни ассистент жүйесінің ақылды роутері және талдаушысысың. Пайдаланушының жаңа сұрағын чат тарихымен бірге талдап, тиісті санатты, сұрақтың толықтығын, қажет болса нақтылау сұрағын және қайта құрылған сұранысты белгіле.

ЖҰМЫС ШЕҢБЕРІ мен ЕРЕЖЕЛЕРІ:
1. 'intent':
   - 'CHITCHAT': Пайдаланушы сәлемдесе, алғыс айтса, боттың атын/мүмкіндіктерін сұраса немесе эмоциялық қысқа пікір білдірсе.
   - 'KNOWLEDGE_SEARCH': діни білім, пәтуалар, шариғат ережелері бойынша сұрақтар.

2. 'is_complete' (тек KNOWLEDGE_SEARCH үшін маңызды):
   - Пайдаланушы тым жалпылама, нақты белгісіз мәселе қойса (мысалы: "Дәрет бұзыла ма?", "Ораза бұзыла ма?", "Намазым қабыл ма?"), оны 'is_complete: false' деп бағала. Бізге нақты жағдайды (мұрын қанау, ұйықтау, тіс жуу т.б.) білу шарт.
   - Егер пайдаланушы бұған дейінгі боттың нақтылауына жауап берсе (мысалы, бұрын "Ораза бұзыла ма?" деген, бот нақтылау сұраған, енді ол "Тіс жудым/дәрі іштім" немесе "Еріксіз тамақ жұтып қойдым" дейді), бұл сұрақ толықтырылды деп санап, 'is_complete: true' деп бер.
   - Егер сұрақтың өзінде бірден нақты оқиға/іс-әрекет сипатталса (мысалы: "Жыласа дәрет бұзыла ма?", "Көз жасы дәретке әсер ете ме?"), бұл толық сұрақ. 'is_complete: true' деп бер.
   - ТЕК CHITCHAT немесе Құран аяттарына тікелей сілтейтін сұрақтар үшін 'is_complete: true' болсын.

3. 'clarification_prompt':
   - Егер 'is_complete: false' болса, пайдаланушы сұраған тілде (Қазақша, Орысша немесе Ағылшынша) сыпайы, жұмсақ түрде дәлелдемелі бапты анықтау сұрағын жаз. Сұрақта оған балама мысалдарды көрсетіп бағытта (мысалы: "Дәретіңізді дәл қандай жағдай бұзды деп ойлайсыз? Жел шығуы, мұрын қанауы немесе ұйықтау сияқты нақты не болғанын сипаттап берсеңіз, сізге дұрыс пәтуа тауып беремін. 😊").
   - 'is_complete: true' болса, бұл өріс бос ("") болсын.

4. 'refined_query':
   - Егер 'is_complete: true' болса, чат тарихындағы бастапқы жалпы сұрақты және пайдаланушының жаңа жауаптарын біріктіріп, ең нақты, қысқа діни іздеу сұранысын (refined query) жаса.
   - Мысалы: Пайдаланушы "Ораза бұзыла ма?" деп бастап, кейін "Тіс жусам" десе, refined_query: "Тіс жуғанда ораза бұзыла ма" деп құрастырылсын.
   - Сұрақ тілі сұрақ қойылған тілмен (Қазақша/Орысша/Ағылшынша) дәл СӘЙКЕС БОЛСЫН.

===
ЖҰМЫС ҮЛГІЛЕРІ (Few-Shot Examples):

Сұрақ: "Дәрет бұзыла ма?"
Чат тарихы: (бос)
Нәтиже:
{
  "intent": "KNOWLEDGE_SEARCH",
  "is_complete": false,
  "clarification_prompt": "Дәретіңізді дәл қандай жағдай бұзды деп ойлайсыз? Қан ағуы, жел шығуы немесе ұйықтап қалу өкілі сияқты нақты бір оқиға болды ма? Сипаттап жазсаңыз, нақты жауап табамын. 😊",
  "refined_query": ""
}

Сұрақ: "мұрыннан қан шықса"
Чат тарихы:
Пайдаланушы: "Дәрет бұзыла ма?"
Бот: "Дәретіңізді дәл қандай жағдай бұзды деп ойлайсыз?"
Нәтиже:
{
  "intent": "KNOWLEDGE_SEARCH",
  "is_complete": true,
  "clarification_prompt": "",
  "refined_query": "мұрыннан қан аққанда дәрет бұзыла ма"
}

Сұрақ: "Нарушается ли омовение?"
Чат тарихы: (бос)
Нәтиже:
{
  "intent": "KNOWLEDGE_SEARCH",
  "is_complete": false,
  "clarification_prompt": "Опишите, пожалуйста, какая именно ситуация произошла? Например, выделилась ли кровь, был ли сон или произошло что-то другое? Это поможет мне найти точный ответ по мазхабу Ханафи. 😊",
  "refined_query": ""
}

Сұрақ: "текла кровь"
Чат тарихы:
Пайдаланушы: "Нарушается ли омовение?"
Бот: "Опишите, пожалуйста, какая именно ситуация произошла?"
Нәтиже:
{
  "intent": "KNOWLEDGE_SEARCH",
  "is_complete": true,
  "clarification_prompt": "",
  "refined_query": "Нарушается ли омовение при выделении крови"
}

===
Пайдаланушы хабарламасы: "${query}"
Чат тарихы:
${formattedHistoryText || '(бос)'}`;

    const response = await generateContentFixed({
      model: GEMINI_INTENT_MODEL,
      contents: [{ role: 'user', parts: [{ text: promptText }] }],
      config: {
        temperature: 0.1,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            intent: {
              type: Type.STRING
            },
            is_complete: {
              type: Type.BOOLEAN
            },
            clarification_prompt: {
              type: Type.STRING
            },
            refined_query: {
              type: Type.STRING
            }
          },
          required: ["intent", "is_complete", "clarification_prompt", "refined_query"]
        }
      }
    });

    const resultText = (response.text || '').trim();
    const parsedData = JSON.parse(resultText);

    console.log(`[🔍 ROUTER] Analysis Result:`, JSON.stringify(parsedData, null, 2));

    return {
      intent: (parsedData.intent === 'CHITCHAT') ? 'CHITCHAT' : 'KNOWLEDGE_SEARCH',
      is_complete: parsedData.is_complete === true,
      clarification_prompt: parsedData.clarification_prompt || '',
      refined_query: parsedData.refined_query || query
    };

  } catch (error: any) {
    console.error(`[❌ ROUTER ERROR] Failed to classify intent with GenAI, fallback to heuristics:`, error.message || error);
    
    // Fallback logic
    const religiousKeywords = [
      'намаз', 'ораза', 'дәрет', 'дарет', 'аят', 'сүре', 'суре', 'хадис', 'үндеу', 'үкім', 'укім', 'парыз', 'сүннет', 'суннет', 
      'уәжіп', 'уажип', 'халал', 'харам', 'мәкруһ', 'макрух', 'мустахаб', 'неке', 'талақ', 'талак', 'зекет', 'ажырасу', 'қаза', 'каза',
      'сапар', 'мүсәпір', 'мусапир', 'құран', 'куран', 'аллаһ', 'аллах', 'құдай', 'кудай', 'пайғамбар', 'пайгамбар',
      'күнә', 'куна', 'жәннат', 'жаннат', 'тозақ', 'тозак', 'ислам', 'дін', 'дин', 'иман', 'періште', 'периште', 'жұма', 'жума'
    ];
    let isReligious = false;
    for (const kw of religiousKeywords) {
      if (clean.includes(kw)) {
        isReligious = true;
        break;
      }
    }
    return {
      intent: isReligious ? 'KNOWLEDGE_SEARCH' : 'CHITCHAT',
      is_complete: true,
      clarification_prompt: '',
      refined_query: query
    };
  }
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
1. HTML ТЕГТЕРІН ҚОЛДАН: <b> (жуан мәтін), <i> (көлбеу мәтін), <blockquote> (дәйексөздер). Ескі жауаптағы Құран аяттарының аудармаларын, Хадистерді немесе ғалымдардың/кітаптардың тікелей үзінділерін («кітапта жазылған үзінділер») тауып, оларды міндетті түрде <blockquote>...</blockquote> тегтерінің ішіне ал! Ескі жауапта бұрыннан бар <blockquote>...</blockquote> дәйексөз форматтауларын мүлтіксіз сақтап, қайта құрастырғанда да дәйексөз ретінде қалдыр.
2. Маркдаун белгілерін (мысалы, *, **) МҮЛДЕМ ҚОЛДАНБА. Тізімдер үшін қарапайым минус (-) сызықшасын немесе • (нүкте) таңбасын қолдан.
3. Мәтін тым тығыз болмауы үшін абзацтар арасына кішігірім бос орын (жаңа жол) қалдыр.
4. "Бұл туралы толық мәліметті... төмендегі батырманы басып..." деген сияқты БАТЫРМАҒА сілтейтін сөздерді АЛЫП ТАСТА, өйткені батырманы жүйе өзі қосады. Жай ғана жауапвтың өзін әдемілеп бер.
5. КӨПТІЛДІ ДІНИ ӘДЕП (Multilingual Islamic Adab): ЕШҚАШАН (с.а.с), (r.а), (а.с), pbuh, ﷺ сияқты қысқартуларды/символдарды қолданбау. Толыққанды мадақ-дұғаларды ЖАҚШАҒА АЛЫП (мысалы: "<i>(Алланың оған игілігі мен сәлемі болсын)</i>" немесе "<i>(мир ему и благословение Аллаха)</i>") тілге бейімдеп, міндетті түрде <i>(...)</i> (көлбеу және жақша ішінде) тегінің ішіне толық жаз.
${effectiveLang === 'ru' ? '6. ⚠️ ПЕРЕВОД: Обязательно переведи и дай ответ на РУССКОМ языке.' : ''}
${effectiveLang === 'en' ? '6. ⚠️ TRANSLATION: Must translate and reply in ENGLISH.' : ''}
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

    // Intent пен толықтықты анықтау (Smart Router)
    let routerResult: RouterResult;
    if (isProofQuery) {
      routerResult = {
        intent: 'KNOWLEDGE_SEARCH',
        is_complete: true,
        clarification_prompt: '',
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
    const bookResults = await searchAnswers(searchInput, hasBeenRefined ? undefined : vector);

    const MIN_RELEVANCE_SCORE = 0.50;

    // Evaluate relevance score from book search
    const maxScore = bookResults.length > 0 ? Math.max(...bookResults.map(r => r.score || 0)) : 0;
    const isModernIssue = /крипто|биткоин|vape|вейп|электронды темекі|электронные сигареты|интернет|онлайн|акция|маркетплейс|сетевой маркетинг|вакцина|пластикалық|пластическая/i.test(searchInput);

    if (maxScore < MIN_RELEVANCE_SCORE || isModernIssue) {
      console.log(`[🔍 Orchestration] Triggering search_official_kazakh_fatwas. Low relevance (${maxScore.toFixed(4)} < ${MIN_RELEVANCE_SCORE}) or modern issue.`);
      try {
        const webResult = await getVerifiedFatwasContext(searchInput, onAction);
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

    // Now extract Quran references from everything we have gathered: searchInput, book chunks, and scraped web fatwas!
    const combinedTextsToParse = [
      searchInput, 
      ...bookResults.map(r => r.text),
      webSourcesJoined || ''
    ].join("\n");
    const quranRefs = parseQuranReferences(combinedTextsToParse);

    let quranResults: SearchResult[] = [];
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
            } as SearchResult;
          }
        } catch (e) {
          console.error(`[⚠️ Quran fetch error for ${ref}]:`, e);
        }
        return null;
      });
      const resolved = await Promise.all(fetchPromises);
      quranResults = resolved.filter((r): r is SearchResult => r !== null);
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
            `[Құран аяты ${i + 1}] СҮРЕ: "${r.book}", АЯТ НӨМІРІ: ${r.page}\nАРАБША: ${r.text.split('\n')[0]}\nАУДАРМАСЫ: ${r.text.split('\n').slice(1).join('\n')}${r.audio_url ? `\nАУДИО СІЛТЕМЕСІ: ${r.audio_url}` : ''}`
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

    onAction('Жауапты қалыптастыру');

    // Промпт дайындау
    let langInstruction = "";
    if (effectiveLang === 'ru') {
        langInstruction = "\n⚠️ ТІЛДІК ЕРЕЖЕ (Language Mirroring): Пайдаланушының тілі немесе сұрақ қойған тілі — орыс тілі (ru). Сондықтан жауапты МІНДЕТТІ ТҮРДЕ ОРЫС ТІЛІНДЕ (strictly and only on Russian language) беріңіз. Барлық түсіндірулер мен қорытындылар орысша болуы шарт. Егер Qdrant базасынан немесе ҚМДБ пәтуаларынан келген сенімді мәліметтер (context) тек Қазақ тілінде болса, сол қазақша мәліметтерді еш бұрмаламай, мағынасын 100% сақтай отырып, орыс тіліне өзіңіз ақылды түрде аударып жауап беріңіз. Діни әдеп дұғалары мен бата-тілектер де орыс тілінде толыққанды, табиғи түрде жазылсын (мысалы: «да будет доволен им Аллах», «мир ему», «да помилует его Аллах», «пусть Аллах дарует вам полезные знания» және т.б. қолданылсын).\n";
    } else if (effectiveLang === 'en') {
        langInstruction = "\n⚠️ ТІЛДІК ЕРЕЖЕ (Language Mirroring): Пайдаланушының тілі немесе сұрақ қойған тілі — ағылшын тілі (en). Жауапты МІНДЕТТІ ТҮРДЕ АҒЫЛШЫН ТІЛІНДЕ (strictly in English) беріңіз. Егер Qdrant базасынан келген сенімді мәліметтер (context) тек Қазақ тілінде болса, сол қазақша мәліметтерді еш бұрмаламай, мағынасын 100% сақтай отырып, ағылшын тіліне өзіңіз ақылды түрде аударып жауап беріңіз. Діни әдеп дұғалары мен бата-тілектер де ағылшын тілінде толыққанды, табиғи түрде жазылсын (мысалы: «peace and blessings of Allah be upon him», «peace be upon him», «may Allah be pleased with him», «may Allah bless you with useful knowledge» және т.б. қолданылсын).\n";
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
Егер жауапта Құраннан аяттар немесе дәлелдер келтірілетін болса (мейлі олар басқа кітаптардан немесе сайт мәтіндерінен табылса да), сен оларды міндетті түрде нақты Құран аяттарының дерегінен (Құран құралдары айқындап берген АРАБША және АУДАРМАСЫ бөлімдерінен) сәйкестендіріп тауып ал. Ешқашан аятты тек қазақша аударма күйінде жаза салма! Әрқашан алдымен арабшасын жазып, одан кейін ғана аудармасын және соңына тиісті форматтағы сілтемесін қос.
Қосылатын аяттарды міндетті түрде бір <blockquote>...</blockquote> тегінің ішінде ерекшелеп, СТРИКТТІ түрде мына формат бойынша жаз (арабша мәтін мен аударманың арасында бос жол болсын, аудармадан кейін де бос жол тасталып, дәйексөз сілтемесі жаңа азат жолға астына жеке жазылсын):
<blockquote>[АРАБША МӘТІН харакаттарымен]

«[АУДАРМАСЫН жақшаға алмай, тырнақшаның ішінде осылай жаз]»

([СҮРЕ АТЫ] сүресі, [АЯТ НӨМІРІ]-аят (<a href="[АУДИО СІЛТЕМЕСІ]">тыңдау</a>) )</blockquote> (Ескерту: Пайдаланушыға көрсететін әрбір Құран аяты үшін аудио сілтемесі контекстте міндетті түрде берілген. Сондықтан кез келген аят үшін тыңдау сілтемесі бар нұсқаны 100% міндетті түрде таңдап жаз!).
Егер табылған дереккөздерде ҚМДБ ресми сайтынан алынған қазіргі заманғы пәтуалар болса, соларға сүйеніп толық ресми және заманауи пәтуа үкімін түсіндіріп бер. Егер классикалық кітаптар да, заманауи пәтуалар да қатар табылса, екеуін біріктіріп ең жақсы жауап нұсқасын жаса.
Егер ешқандай ақпарат табылмаса немесе контексте нақты жауап болмаса, онда нақты "Бұл мәлімет кітаптардан табылмады, сондықтан нақты жауап бере алмаймын" деп ашық айт. Жалған кітап атын немесе жауап ойлап таппа!
ЖАУАПТЫҢ СОҢЫНДА ЕШҚАНДАЙ дереккөзді немесе кітап атын, бетін атап түсіндіретін үлкен сөйлемдер, сүйенген сайттарды немесе "Бұл мәліметтерді ҚМДБ-ның ресми... дайындадым" не "Бұл туралы толық мәліметті... бетінен тауып бердім" сияқты артық сөйлемдерді МҮЛДЕМ ЖАЗБА! Барлық дереккөздер мен қолданылған кітаптар соңында автоматты түрде дәйексөз ретінде қосылады. ЕШҚАНДАЙ батырма (кнопка) туралы сөз жазба!

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
        const lines: string[] = ["<b>Дереккөздер:</b>"];
        if (quranCitations.length > 0) {
          lines.push(`Құран: ${quranCitations.join(', ')}`);
        }
        if (siteCitations.length > 0) {
          lines.push(`Сайттар: ${siteCitations.join(', ')}`);
        }
        if (bookCitations.length > 0) {
          lines.push(`Кітаптар: ${bookCitations.join(', ')}`);
        }
        const citations = `\n\n<blockquote expandable>${lines.join('\n')}</blockquote>\n`;
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
