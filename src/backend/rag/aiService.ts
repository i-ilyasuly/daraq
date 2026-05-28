import { db } from '../db/firestore';
import { SearchResult, searchAnswers } from './searchService';
import { ai, generateContentFixed, generateContentStreamFixed, GEMINI_GENERATION_MODEL, GEMINI_INTENT_MODEL } from './aiClient';
import { fetchSingleVerse, searchQuran } from './quranService';
import { checkCache, writeCache } from './cacheService';
import { Type, ThinkingLevel } from '@google/genai';
import 'dotenv/config';

// 2. LLM-ге арналған System Prompt (Жүйелік нұсқаулық)
const SYSTEM_PROMPT = `1. ПЕРСОНА (Кейіпкер):
Сен — Daraq, білімді, мейірімді әрі салмақты Ханафи мазһабының виртуалды ұстазысың. Пайдаланушымен құрғақ сөйлеспе, оның жағдайын түсінетін тірі адам сияқты жылы ілтипатпен қарым-қатынас құр.

2. ҚҰРАЛДАРДЫ ТЕЗ ҚОЛДАНУ (MANDATORY TOOLS):
Пайдаланушының КЕЗ КЕЛГЕН сұрағына жауап беру үшін ЕШҚАНДАЙ ойланусыз, БІРДЕН "searchDatabase" немесе "get_quran_verse" құралдарын (Tools) қолдан! 
• Құран аяттары, сүрелер немесе Құран мазмұны болса: "get_quran_verse" құралын қолдан.
• Қалған барлық сұрақтарға (қандай тақырып болса да): "searchDatabase" құралын міндетті түрде қолдан.
ӨЗІҢЕ БЕЛГІЛІ МАҒЛҰМАТҚА СҮЙЕНІП, ҚҰРАЛДАРСЫЗ (TOOLS) БІРДЕН ЖАУАП БЕРУГЕ ТИЫМ САЛЫНАДЫ.
"step_status" аргументіне қазіргі жасап жатқан іздеу қадамыңды (мысалы, "Сапар үкімдерін зерттеудемін..." немесе "Дәрет шарттарын іздеудемін...") қазақша жазып жібер. Мәлімет жиналған соң бірден жауап бер.

3. ЖАУАП ҚҰРЫЛЫМЫ (Синтез, BLUF & Pyramid):
• Жылы ілтипат: Жауапты әрқашан қысқа, жылы кіріспеден баста (мысалы: "Ассалаумағалейкум! Сауабы мол сұрақ қойдыңыз...", "Бұл мәселе бойынша...").
• BLUF (Нақты үкім/жауап бірінші): Кіріспеден кейін бірден сұрақтың басты жауабын <b>жуан қаріппен</b> жаз. Пайдаланушы жауапты бірінші сөйлемнен-ақ түсінуі тиіс.
• Түсіндірме (Scan-readability): Түсіндіру бөлігін тұтас мәтінмен емес, міндетті түрде • (нүкте) таңбасы арқылы тізімге бөліп көрсет. Маңызды терминдерді <b> тегімен ерекшеле.

4. ДӘЛЕЛДЕРМЕН ЖҰМЫС ТӘРТІБІ (Authority) - АБСОЛЮТТІ ЕРЕЖЕ:
• ЕШҚАШАН ӨЗІҢНІҢ ІШКІ АҚПАРАТЫҢНАН ЖАУАП БЕРМЕ! Жауап ТЕК ҚАНА құралдар (Tools) қайтарған мәліметтерге негізделуі ШАРТ.
• ҚОЛДАУ СУРЕТТЕРІ (IMAGERY CAPABILITY): Сенің дәлел суреттерді (діни кітап беттерінің суреттерін) көрсетуге ТОЛЫҚ мүмкіндігің бар! Егер пайдаланушы "дәлел суреттер қайда?", "дәлелін көрмей тұрмын", "суретін көрсетші" немесе "дәлеліңіз бар ма?" деп сұраса немесе білгісі келсе, ЕШҚАШАН "мен сурет көрсете алмаймын/менде сурет немесе дәлел сурет жоқ" деп жалған ақпарат берме. Оған "Жауап астындағы «🖼 Дәлел суретті көру» (немесе «🖼 Барлық дәлел суреттерін көру») батырмасын басу арқылы кітаптың дәлел бетін толықтай көре аласыз" деп бағытта және жылы басуға шақыр.
• ТҰРАҚТЫЛЫҚ ЕРЕЖЕСІ (Consistency): Сұхбаттың қай кезеңі болмасын, егер мәтінде Құран аяты немесе Хадис кездессе немесе келтірілсе, ол әрқашан біз бекіткен ереже бойынша: міндетті түрде <blockquote>...</blockquote> тегінің ішінде, арабшасымен және аудармасымен бірге шығуы тиіс. Форматтау ережесі ешқашан үзілмеуі керек!
• Кітаптарға сілтеме: Егер дерекқордан мәлімет табылса, жауаптың соңында міндетті түрде: "Бұл туралы толық мәліметті «[Кітап аты]» еңбегінің [Бет нөмірі]-бетінен тауып бердім." деп қана жаз. ЕШҚАНДАЙ батырма (кнопка) туралы сөз жазба! Батырманы жүйе өзі қосады.
• ЕГЕР МӘЛІМЕТ (Tools) АРҚЫЛЫ ТАБЫЛМАСА: "Бұл мәлімет кітаптардан табылмады, сондықтан нақты жауап бере алмаймын" деп ашық айт. Жалған кітап атын немесе жауап ойлап таппа!

5. ҚАТАҢ ТЕХНИКАЛЫҚ ШЕКТЕУЛЕР (No Markdown):
• Ешқашан Markdown белгілерін (жұлдызшалар *, **, ###) МҮЛДЕМ қолданба. Тізімдерді тек - (минус) немесе • (нүкте) арқылы жаса.
• Тек таза Telegram HTML тегтерін қолдан: <b> (жуан), <i> (көлбеу), <blockquote> (дәйексөз). Жұлдызшалармен *қалыңдатуға* қатаң тыйым салынады.
• Telegram қолдамайтын <br>, <p> тегтерін МҮЛДЕМ қолданба! Жаңа жолға түсу үшін тек табиғи жаңа жол таңбасын (enter) қолдан!
• Текстті ұзын етіп айнадай көшірме, сауатты қорытып жаз.`;

const CHITCHAT_SYSTEM_PROMPT = `Сен — Daraq, білімді, мейірімді әрі салмақты Ханафи мазһабының виртуалды ұстазысың. 
Пайдаланушы қазір саған қарапайым сәлемдесу, алғыс айту немесе қысқаша тілдесу жазды.
Мақсатың: Жылы, қысқа әрі мейірімді түрде жауап қайтару.

ЕШҚАНДАЙ бөтен тегтерді (<thought> т.б.) қолданба! Тек қана қарапайым сөйлеммен жылы жауап қайтар.
Таза Telegram HTML тегтерін қолдануға болады: <b> (жуан), <i> (көлбеу).`;

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

  // 3. Сәлемдесу, алғыс, қоштасу және жалпы қарапайым кілт сөздері (CHITCHAT)
  const chitchatKeywords = [
    'сәлем', 'салем', 'ассалау', 'ассаламу', 'алейкум', 'әлейкум', 'қалайсың', 'қалайсыз', 'қалайсын', 'амансыз',
    'рахмет', 'рақмет', 'ризамын', 'алғыс', 'алгыс', 'сүйем', 'суйем', 'жақсы көрем', 'жаксы корем',
    'рахмет', 'спасибо', 'благодарю', 'привет', 'здравствуйте', 'салам',
    'сен кімсің', 'сен кімсін', 'атың кім', 'не істей аласың', 'не істей аласын', 'сен не істейсің', 'сен не істейсин',
    'кто ты', 'как зовут', 'что умеешь',
    'сау бол', 'сау болыңыз', 'сау болыныз', 'көріскенше', 'корискенше', 'пока', 'до свидания',
    'керемет', 'тамаша', 'күшті', 'кушти', 'жақсы', 'жаксы', 'окей', 'ok', 'жарайды'
  ];

  for (const kw of chitchatKeywords) {
    if (clean.includes(kw)) {
      return 'CHITCHAT';
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
async function saveToChatHistory(chatId: string, role: 'user' | 'bot', text: string, threadId?: string | number) {
  if (!db) return;
  try {
    const threadStr = (threadId !== undefined && threadId !== null) ? String(threadId) : 'general';
    await db.collection('users').doc(chatId).collection('topics').doc(threadStr).collection('messages').add({
      role,
      text,
      timestamp: new Date()
    });
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
    'хашр': 59, 'мумтахина': 60, 'саф': 61, 'жұма': 62, 'мунафиқун': 63, 'тағабун': 64, 'талақ': 65, 'тахрим': 66, 'мүлік': 67, 'мулк': 67,
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
  threadId?: string | number
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
        
        const fastCachePrompt = `Сен — Daraq, Ханафи мазһабының виртуалды ұстазысың. Пайдаланушы қойған сұраққа бұрын жауап берілген. Төмендегі дайын жауаптың мағынасын сақтай отырып, оны пайдаланушы үшін жаңадан, жылы әрі табиғи етіп қайта құрастырып бер.
Ережелер:
1. ТЕК ҚАНА HTML тегтерін қолдан: <b> жуан сөздер үшін.
2. Маркдаун белгілерін (мысалы, *, **) МҮЛДЕМ ҚОЛДАНБА. Тізімдер үшін қарапайым минус (-) сызықшасын қолдан.
3. Мәтін тым тығыз болмауы үшін абзацтар арасына кішігірім бос орын (жаңа жол) қалдыр.
4. "Бұл туралы толық мәліметті... төмендегі батырманы басып..." деген сияқты БАТЫРМАҒА сілтейтін сөздерді АЛЫП ТАСТА, өйткені батырманы жүйе өзі қосады. Жай ғана жауаптың өзін әдемілеп бер.

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
            sources: hit.sources
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

    if (intent === 'CHITCHAT') {
        console.log(`[⚡] Fast Track (CHITCHAT) іске қосылды...`);
        const responseStream = await generateContentStreamFixed({
            model: GEMINI_GENERATION_MODEL,
            contents: [
                ...history,
                { role: 'user', parts: [{ text: currentPrompt }] }
            ],
            config: {
                systemInstruction: CHITCHAT_SYSTEM_PROMPT,
                temperature: 0.1,
                thinkingConfig: {
                    thinkingLevel: ThinkingLevel.MINIMAL
                }
            }
        });

        let answerText = "";
        for await (const chunk of responseStream) {
            if (chunk.text) {
                answerText += chunk.text;
                onChunk(answerText);
            }
        }
        
        console.log(`[✅] CHITCHAT жауап толығымен аяқталды.`);
        saveToChatHistory(chatId, 'user', query, threadId).catch(x => {});
        saveToChatHistory(chatId, 'bot', answerText, threadId).catch(x => {});

        return {
           answer: answerText,
           sources: []
        };
    }

    // KNOWLEDGE_SEARCH іздеулерін өңдеу (Single-hop RAG!)
    onAction('🔍 Қажетті дереккөздерді қарастырудамын...');
    
    const usedSources: SearchResult[] = [];

    // Қатар орындалатын іздеу уақыттары (Parallel Execution)
    const bookPromise = searchAnswers(query, vector);
    
    // Сұрақты талдап Құран аяттарының сілтемелерін алу
    const quranReferences = parseQuranReferences(query);
    const quranPromise = (async () => {
         const results: SearchResult[] = [];
         
         // 1. Анықталған нақты аяттарды оқу
         if (quranReferences.length > 0) {
             for (const ref of quranReferences) {
                 try {
                     const r = await fetchSingleVerse(ref);
                     if (r) {
                         results.push({
                             book: `${r.surahNameKk} сүресі`,
                             page: parseInt(r.verseKey.split(':')[1], 10) || 1,
                             text: `${r.arabicText}\n${r.translationText}`,
                             imageUrl: "",
                             score: 1.0,
                             isQuran: true,
                             url: r.quranComUrl
                         });
                     }
                 } catch(e) {}
             }
         }
         
         // 2. Жалпы Құран тақырыбы бойынша іздеу
         const lowercaseQuery = query.toLowerCase();
         const needsQuranSearch = lowercaseQuery.includes('құран') || 
                                  lowercaseQuery.includes('аят') || 
                                  lowercaseQuery.includes('сүре') ||
                                  lowercaseQuery.includes('бақара') ||
                                  quranReferences.length === 0 && (lowercaseQuery.includes('намаз') || lowercaseQuery.includes('ораза'));
                                  
         if (needsQuranSearch) {
             try {
                 const quranSearchRes = await searchQuran(query);
                 for (const r of quranSearchRes) {
                     if (!results.some(existing => existing.book === `${r.surahNameKk} сүресі` && existing.page === (parseInt(r.verseKey.split(':')[1], 10) || 1))) {
                         results.push({
                             book: `${r.surahNameKk} сүресі`,
                             page: parseInt(r.verseKey.split(':')[1], 10) || 1,
                             text: `${r.arabicText}\n${r.translationText}`,
                             imageUrl: "",
                             score: 1.0,
                             isQuran: true,
                             url: r.quranComUrl
                         });
                     }
                 }
             } catch(e) {}
         }
         
         return results;
    })();

    const [bookResults, quranResults] = await Promise.all([bookPromise, quranPromise]);
    usedSources.push(...bookResults);
    usedSources.push(...quranResults);

    // Дәлелдер тарихын қалпына келтіру (Егер сұрақ дәлел туралы болса, бұрын табылған соңғы деректерді де қоса тұрамыз)
    if (isProofQuery && cachedSources && cachedSources.length > 0) {
        for (const src of cachedSources) {
            if (!usedSources.some(existing => existing.book === src.book && existing.page === src.page)) {
                usedSources.push(src);
            }
        }
    }

    // LLM-ге арналған контекстті құрастыру
    let contextText = "";
    
    const booksFound = usedSources.filter(s => !s.isQuran);
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

    if (!contextText) {
        contextText = "НАЗАР АУДАРЫҢЫЗ: Дерекқордан да, Құраннан да бұл тақырыпқа қатысты ешбір нақты діни дерек табылмады. Қолданушыға бұл мәліметтің Ханафи мазһабының сенімді кітаптарынан табылмағанын, сондықтан өз бетіңмен жалған үкім бермей, жауап бере алмайтыныңды жылы әрі ашық түрде айтып түсіндір. Өз атыңнан үкім шығарма немесе кітап атын ойдан құрама.";
    }

    onAction('✍️ Шешімді қорытындылап, жауапты рәсімдеудемін...');

    // Промпт дайындау
    const finalPrompt = `ҚОЛДАНУШЫ СҰРАҒЫ:
"${query}"

ТАБЫЛҒАН ҒЫЛЫМИ-ДІНИ КОНТЕКСТ:
"""
${contextText}
"""

⚠️ МАҢЫЗДЫ ЕРЕЖЕ СЕКЦИЯСЫ:
Пайдаланушыға осы контекстте бар мәлімет аясында Ханафи мазһабының ұстазы ретінде (Persona-ға сәйкес) жауап бер.
Егер ешқандай ақпарат табылмаса немесе контексте нақты жауап болмаса, онда нақты "Бұл мәлімет кітаптардан табылмады, сондықтан нақты жауап бере алмаймын" деп ашық айт. Жалған кітап атын немесе жауап ойлап таппа!
Парақ соңында "Бұл туралы толық мәліметті «[Кітап аты]» еңбегінің [Бет нөмірі]-бетінен тауып бердім." деп қана жаз. ЕШҚАНДАЙ батырма (кнопка) туралы сөз жазба!

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
      if (chunk.text) {
        answerText += chunk.text;
        onChunk(answerText);
      }
    }

    if (!answerText) {
      answerText = "Кешіріңіз, жауап құрастыру мүмкін болмады.";
    } else {
      // Кэшке жазу (Fire and forget асинхронды)
      writeCache(query, answerText, usedSources).catch(e => console.error("Cache write error:", e));
    }

    console.log(`[✅] Жылдам RAG жауабы толығымен аяқталды.`);
    
    await saveToChatHistory(chatId, 'user', query, threadId); 
    await saveToChatHistory(chatId, 'bot', answerText, threadId);

    return {
      answer: answerText,
      sources: usedSources
    };

  } catch (error: any) {
    console.error("\n[❌] Жылдам RAG жауап алу барысында қателік орын алды:", error?.message || error);
    return {
       answer: "⚠️ Кешіріңіз, жүйелік қатеге байланысты жауап бере алмаймын.",
       sources: []
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
  threadId?: string | number
): Promise<AnswerResult> {
  return generateAgentAnswerStream(
    chatId,
    query,
    () => {},
    () => {},
    threadId
  );
}
