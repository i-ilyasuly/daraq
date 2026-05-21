import { GoogleGenAI } from '@google/genai';
import { db } from '../db/firestore';
import { SearchResult } from './searchService';
import 'dotenv/config';

// 1. Gemini Client қосылымы
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// 2. LLM-ге арналған System Prompt (Жүйелік нұсқаулық)
const SYSTEM_PROMPT = `Сен Ханафи мазһабы бойынша діни көмекшісің (Daraq). 
Жауапты тек төменде берілген контекстке (кітап мәтіндеріне) сүйеніп қана, қазақ тілінде бер. 
Жауап құрылымды, қысқа әрі нақты болуы тиіс. 
Егер берілген контекстте сұраққа жауап болмаса, "Білмеймін" немесе "Бұл мәлімет кітаптарда табылмады" деп ашық айт, өз жаныңнан ештеңе қоспа.

МАҢЫЗДЫ НҰСҚАУ (FORMATTING):
Жауапты құрастырғанда ешқандай Markdown (жұлдызшалар *, **) қолданба. Тек таза HTML тегтерін қолдан. 
Мысалы, тақырыптарды немесе маңызды сөздерді жуандату үшін <b>мәтін</b> қолдан, тізімдер үшін қарапайым нүкте • белгісін қолдан.
ЕСКЕРТУ: Telegram қолдамайтын <br>, <p> сияқты тегтерді МҮЛДЕМ қолданба! Жаңа жолға түсу үшін тек табиғи жаңа жол таңбасын (enter) қолдан!`;

export interface AnswerResult {
  answer: string;
  sources: SearchResult[];
}

/**
 * Firestore-дан осы пайдаланушының соңғы 20 хабарламасын оқу
 */
async function getChatHistory(chatId: string) {
  if (!db) {
    console.warn("[⚠️] Firestore қосылмаған. Чат тарихы оқылмады.");
    return [];
  }
  try {
    const snapshot = await db.collection('chats').doc(chatId).collection('messages')
      .orderBy('timestamp', 'desc')
      .limit(20)
      .get();
    
    if (snapshot.empty) return [];

    const messages = snapshot.docs.map(doc => doc.data());
    const formattedHistory = messages.reverse().map(msg => ({
      role: msg.role === 'bot' ? 'model' : 'user',
      parts: [{ text: msg.text }]
    }));

    // Gemini requires alternating history. To be safe, we will just filter or ensure.
    // However, for safety without complex merging, let's just log it if we hit a problem later.
    return formattedHistory;
  } catch (error) {
    console.error("[❌] Чат тарихын оқу кезінде қате орын алды (Firestore Error):", error);
    return [];
  }
}

/**
 * Хабарламаларды Firestore-ға сақтау
 */
async function saveToChatHistory(chatId: string, role: 'user' | 'bot', text: string) {
  if (!db) return;
  try {
    await db.collection('chats').doc(chatId).collection('messages').add({
      role,
      text,
      timestamp: new Date()
    });
  } catch (error) {
    console.error("[❌] Хабарламаны сақтау кезінде қате орын алды (Firestore Error):", error);
  }
}

/**
 * 3. Басты функция: Ізделген контексттерді және тарихты қолданып жауап генерациялау
 */
export async function generateAnswer(chatId: string, query: string, context: SearchResult[]): Promise<AnswerResult> {
  console.log(`\n[🤖] Жауап генерациялау басталды (ChatID: ${chatId})`);
  
  try {
    // Дәлелдердің (контексттің) мәтінін дайындау
    const contextText = context.map((c, i) => 
      `[Дерек ${i + 1}] Кітап: "${c.book}", Бет: ${c.page}\nМәтін: ${c.text}`
    ).join('\n\n');
    
    // LLM-ге жіберілетін жүктеме: Контекст + Пайдаланушы сұрағы
    let currentPrompt = `Контекст (кітап мәтіндері):\n${contextText}\n\nПайдаланушы сұрағы: ${query}`;

    // 1. Тарихты алу
    const rawHistory = await getChatHistory(chatId);
    
    // Gemini SDK STRICTLY ALTERNATING ROLES талабын қамтамасыз ету (user -> model -> user -> model...)
    // Егер екі 'user' немесе екі 'model' қатарынан келсе, алдыңғысын алып тастаймыз немесе біріктіреміз.
    const history: {role: string, parts: {text: string}[]}[] = [];
    let expectedRole = 'user'; // Тарихты басынан бастап (first message) user-дан күтеміз
    
    for (const msg of rawHistory) {
        if (history.length === 0) {
            history.push(msg); // First message
        } else {
            const lastMsg = history[history.length - 1];
            if (lastMsg.role === msg.role) {
                // Бірдей рөлдер қатарынан келсе, мәтіндерін біріктіреміз
                lastMsg.parts[0].text += `\n\n${msg.parts[0].text}`;
            } else {
                history.push(msg);
            }
        }
    }
    
    // Барлық хабарламаларды форматтау (Тарих + Ағымдағы сұрақ)
    // currentPrompt 'user' болғандықтан, ең соңғы тарих 'model' болуына көз жеткіземіз:
    if (history.length > 0 && history[history.length - 1].role === 'user') {
       // Егер тарихтың соңы 'user' болса, біз тағы 'user' қосамыз, сондықтан алдыңғы 'user'-ді біріктіреміз:
       const lastUser = history.pop();
       if (lastUser) {
           currentPrompt = `[Алдыңғы хабарлама]: ${lastUser.parts[0].text}\n\n[Жаңа сұрақ]: ${currentPrompt}`;
       }
    }
    
    const contents = [
      ...history,
      { role: 'user', parts: [{ text: currentPrompt }] }
    ];

    console.log(`[⏳] LLM-ге сұраныс жіберілуде (gemini-3.1-pro-preview)...`);
    let response;
    try {
      response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: contents,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          temperature: 0.1, // Кесінді мәліметтерден ауытқымауы үшін төмен температура
        }
      });
    } catch (genAiError: any) {
      console.error("\n[❌] Gemini API Error:", genAiError?.response?.data || genAiError?.message || genAiError);
      throw genAiError; // Try-catch сыртына шығарамыз
    }

    const answerText = response.text || "Кешіріңіз, жауап құрастыру мүмкін болмады.";
    console.log(`[✅] Жауап сәтті генерацияланды.`);

    // 4. Сұрақ пен жауапты дерекқорға сақтау
    console.log(`[⏳] Чат тарихы Firestore-ға сақталуда...`);
    // Мұнда тарихқа LLM-ге жіберілген толық prompt емес, тек пайдаланушының таза сұрағын ғана сақтаймыз
    await saveToChatHistory(chatId, 'user', query); 
    await saveToChatHistory(chatId, 'bot', answerText);

    // 5. Нәтиже мен дәлелдерді бірге қайтару
    return {
      answer: answerText,
      sources: context // Толықтай дәлел тізімі
    };

  } catch (error: any) {
    console.error("\n[❌] Жауап генерациялау барысында қателік орын алды (RAG/System Error):", error?.message || error);
    return {
      answer: "Кешіріңіз, жүйелік қателікке байланысты жауап бере алмаймын.",
      sources: context
    };
  }
}
