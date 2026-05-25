import { db } from '../db/firestore';
import { SearchResult, searchAnswers } from './searchService';
import { ai } from './aiClient';
import { fetchSingleVerse, searchQuran } from './quranService';
import { Type } from '@google/genai';
import 'dotenv/config';

// 2. LLM-ге арналған System Prompt (Жүйелік нұсқаулық)
const SYSTEM_PROMPT = `Сен Ханафи мазһабы бойынша діни көмекшісің (Daraq). 
Пайдаланушы сұрағына жауап беру үшін МІНДЕТТІ ТҮРДЕ "searchDatabase" немесе "get_quran_verse" сияқты құралдарды (Tools) қолданып іздеу жаса! 
• Егер пайдаланушы Құран аяттары, сүрелер немесе Құран мазмұны туралы сұраса (мысалы 'аят', 'сүре', немесе белгілі бір Құран тақырыбы) "get_quran_verse" құралын МІНДЕТТІ ТҮРДЕ қолдан.
• Ал басқа жалпы діни сұрақтарға, фиқһқа, фатуаларға, діни үкімдерге "searchDatabase" құралын қолдан.
• Егер сұрақ қарапайым сәлемдесу немесе алғыс болса, құралсыз қысқаша жауап бере бер.

Жауапты тек табылған мәліметтерге сүйеніп қана, қазақ тілінде бер. 
Жауап құрылымды, қысқа әрі нақты болуы тиіс. 
Егер берілген контекстте сұраққа жауап болмаса, "Білмеймін" немесе "Бұл мәлімет кітаптарда немесе Құранда табылмады" деп ашық айт, өз жаныңнан ештеңе қоспа.

МАҢЫЗДЫ НҰСҚАУ (FORMATTING):
Жауапты құрастырғанда ешқандай Markdown (жұлдызшалар *, **) қолданба. Тек таза HTML тегтерін қолдан. 
Мысалы, тақырыптарды немесе маңызды сөздерді жуандату үшін <b>мәтін</b> қолдан, тізімдер үшін қарапайым нүкте • белгісін қолдан.
Құран аяттарын форматтау ережесі:
Егер сен пайдаланушыға Құран аятын (арабша мәтінін немесе қазақша аудармасын) Quran MCP құралынан немесе Qdrant базасынан алып көрсететін болсаң, оны міндетті түрде Telegram HTML форматындағы <blockquote>...</blockquote> (дәйексөз) тегінің ішіне алып жаз. Құран аяты сенің өз сөздеріңнен визуалды түрде осылайша бөлектеліп тұруы шарт.
ЕСКЕРТУ: Telegram қолдамайтын <br>, <p> сияқты тегтерді МҮЛДЕМ қолданба! Жаңа жолға түсу үшін тек табиғи жаңа жол таңбасын (enter) қолдан!
Дәйексөзді (кітап аты, беті, немесе сілтемені) жауаптың ішіне немесе соңына жазып қоюдың ҚАЖЕТІ ЖОҚ. Ол батырма арқылы автоматты түрде беріледі. Тек жауапты бер.`;

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

/**
 * 3. Басты функция: Агенттік RAG - Автоматты түрде іздеп, ағынды жауап береді
 */
export async function generateAgentAnswerStream(
  chatId: string,
  query: string,
  onChunk: (currentFullText: string) => void,
  onAction: (statusText: string) => void,
  threadId?: string | number
): Promise<AnswerResult> {
  console.log(`\n[🤖] Агенттік жауап беру басталды (ChatID: ${chatId})`);
  
  try {
    const rawHistory = await getChatHistory(chatId, threadId);
    
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
    
    let currentPrompt = query;
    if (history.length > 0 && history[history.length - 1].role === 'user') {
        const lastUser = history.pop();
        if (lastUser) {
            currentPrompt = `[Алдыңғы хабарлама]: ${lastUser.parts[0].text}\n\n[Жаңа сұрақ]: ${currentPrompt}`;
        }
    }
    
    let contents: any[] = [
      ...history,
      { role: 'user', parts: [{ text: currentPrompt }] }
    ];

    const searchDecl = {
        name: "searchDatabase",
        description: "Діни сұрақтар бойынша жауапты, фатуаларды, үкімдерді табу үшін кітаптардан (дерекқордан) іздеу жасайды. Ең маңызды құрал.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            searchQuery: {
              type: Type.STRING,
              description: "Іздеуге арналған нақты сөйлем немесе кілт сөздер"
            }
          },
          required: ["searchQuery"]
        }
    };

    const quranDecl = {
        name: "get_quran_verse",
        description: "Құран аяттарын алу немесе Құраннан іздеу жасау. Пайдаланушы Құран туралы сұрағанда (мысалы 'аят', 'сүре', немесе белгілі бір Құран тақырыбы) осы құралды МІНДЕТТІ ТҮРДЕ қолдан.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            verseKeyOrQuery: {
              type: Type.STRING,
              description: "Нақты аят сілтемесі (мысалы '2:183') немесе Құран мазмұны бойынша іздеуге арналған сұрақ/кілт сөз (мысалы 'ораза')."
            }
          },
          required: ["verseKeyOrQuery"]
        }
    };

    let usedSources: SearchResult[] = [];
    let answerText = "";
    let isFinished = false;
    let iterations = 0;
    const MAX_ITERATIONS = 4;

    while (!isFinished && iterations < MAX_ITERATIONS) {
        iterations++;
        console.log(`[⏳] LLM-ге сұраныс жіберілуде (Iteration ${iterations})...`);
        const responseStream = await ai.models.generateContentStream({
          model: 'gemini-3.1-flash-lite',
          contents: contents,
          config: {
            systemInstruction: SYSTEM_PROMPT,
            temperature: 0.1,
            tools: [{ functionDeclarations: [searchDecl, quranDecl] }]
          }
        });

        let isFunctionCall = false;
        let functionCalls: any[] = [];

        for await (const chunk of responseStream) {
          if (chunk.functionCalls && chunk.functionCalls.length > 0) {
            isFunctionCall = true;
            functionCalls.push(...chunk.functionCalls);
          }
          if (chunk.text && !isFunctionCall) {
            answerText += chunk.text;
            onChunk(answerText);
          }
        }

        if (!isFunctionCall) {
          isFinished = true;
          break; // Агент жауап беріп болды
        }

        // Агент құралды шақырды
        const toolCall = functionCalls[0]; // тек біріншісін аламыз
        if (toolCall) {
            // push model's tool call into history
            contents.push({
                role: 'model',
                parts: [{ functionCall: toolCall }]
            });

            if (toolCall.name === 'searchDatabase') {
                onAction('📖 Дерекқордан ізделуде...');
                const sq = toolCall.args.searchQuery || query;
                console.log(`[🤖] Агент "searchDatabase" шақырды: "${sq}"`);
                
                // Дерекқордан іздеу
                const searchResults = await searchAnswers(sq);
                
                let contextText = "Бұл тақырып бойынша ештеңе табылмады.";
                if (searchResults && searchResults.length > 0) {
                    usedSources.push(...searchResults); // дәлелдерді сақтаймыз
                    contextText = searchResults.map((c, i) => 
                      `[Дерек ${i + 1}] Кітап: "${c.book}", Бет: ${c.page}\nМәтін: ${c.text}`
                    ).join('\n\n');
                }

                // Табылған мәліметті (немесе табылмағанын) қайтарамыз
                contents.push({
                    role: 'user',
                    parts: [{
                        functionResponse: {
                            name: 'searchDatabase',
                            response: { result: contextText }
                        }
                    }]
                });
                onAction('📖 Дәлелдер тексерілуде...');
            } else if (toolCall.name === 'get_quran_verse') {
                onAction('📖 Құран аяттары ізделуде...');
                const vq = toolCall.args.verseKeyOrQuery || query;
                console.log(`[🤖] Агент "get_quran_verse" шақырды: "${vq}"`);
                
                // Resolve using quranService
                const verseKeyPattern = /^(\d+):(\d+)(-\d+)?$/;
                let quranResults: any[] = [];
                const cleanInput = vq.trim();

                if (verseKeyPattern.test(cleanInput)) {
                  const match = cleanInput.match(verseKeyPattern);
                  if (match) {
                    const surahId = match[1];
                    const startVerse = parseInt(match[2], 10);
                    const endVerseStr = match[3];

                    if (endVerseStr) {
                      const endVerse = parseInt(endVerseStr.replace('-', ''), 10);
                      const count = Math.min(endVerse - startVerse + 1, 3);
                      for (let i = 0; i < count; i++) {
                        const d = await fetchSingleVerse(`${surahId}:${startVerse + i}`);
                        if (d) quranResults.push(d);
                      }
                    } else {
                      const d = await fetchSingleVerse(cleanInput);
                      if (d) quranResults.push(d);
                    }
                  }
                } else {
                  quranResults = await searchQuran(cleanInput);
                }

                let contextText = "Құраннан бұл сұранысқа сәйкес келетін аяттар табылмады.";
                if (quranResults.length > 0) {
                    contextText = quranResults.map(r => {
                      return `[ҚҰРАН АЯТЫ] ${r.surahNameKk} сүресі, ${r.verseKey.split(':')[1]}-аят
Сілтеме: ${r.quranComUrl}
Арабша: ${r.arabicText}
Қазақша аудармасы: ${r.translationText}`;
                    }).join('\n\n');

                    // Push to usedSources for button rendering
                    for (const r of quranResults) {
                        usedSources.push({
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

                // Табылған мәліметті қайтарамыз
                contents.push({
                    role: 'user',
                    parts: [{
                        functionResponse: {
                            name: 'get_quran_verse',
                            response: { result: contextText }
                        }
                    }]
                });
                onAction('📖 Дәлелдер тексерілуде...');
            }
        }
    }

    if (!answerText) {
      answerText = "Кешіріңіз, жауап құрастыру мүмкін болмады.";
    }

    console.log(`[✅] Агенттік жауап толығымен аяқталды.`);
    
    await saveToChatHistory(chatId, 'user', query, threadId); 
    await saveToChatHistory(chatId, 'bot', answerText, threadId);

    return {
      answer: answerText,
      sources: usedSources
    };
  } catch (error: any) {
    console.error("\n[❌] Агенттік жауап алу барысында қателік орын алды:", error?.message || error);
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
