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
Егер берілген контекстте сұраққа жауап болмаса, "Білмеймін" немесе "Бұл мәлімет кітаптарда табылмады" деп ашық айт, өз жаныңнан ештеңе қоспа.`;

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
    // Керісінше реттеу (ескі хабарламалардан жаңасына қарай)
    return messages.reverse().map(msg => ({
      role: msg.role === 'bot' ? 'model' : 'user', // genai SDK 'model' деп күтеді
      parts: [{ text: msg.text }]
    }));
  } catch (error) {
    console.error("[❌] Чат тарихын оқу кезінде қате орын алды:", error);
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
    console.error("[❌] Хабарламаны сақтау кезінде қате орын алды:", error);
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
    const currentPrompt = `Контекст (кітап мәтіндері):\n${contextText}\n\nПайдаланушы сұрағы: ${query}`;

    // 1. Тарихты алу
    const history = await getChatHistory(chatId);
    
    // Барлық хабарламаларды форматтау (Тарих + Ағымдағы сұрақ)
    const contents = [
      ...history,
      { role: 'user', parts: [{ text: currentPrompt }] }
    ];

    console.log(`[⏳] LLM-ге сұраныс жіберілуде (gemini-3.1-pro-preview)...`);
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-pro-preview',
      contents: contents,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.1, // Кесінді мәліметтерден ауытқымауы үшін төмен температура
      }
    });

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

  } catch (error) {
    console.error("\n[❌] Жауап генерациялау барысында қателік:", error);
    return {
      answer: "Кешіріңіз, жүйелік қателікке байланысты жауап бере алмаймын.",
      sources: context
    };
  }
}
