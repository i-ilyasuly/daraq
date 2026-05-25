import { Telegraf, Markup } from 'telegraf';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import { Storage } from '@google-cloud/storage';
import { storage as customStorage } from '../storage';
import { searchAnswers } from '../rag/searchService';
import { generateAgentAnswerStream } from '../rag/aiService';
import { ai } from '../rag/aiClient';
import { db } from '../db/firestore';

const storage = customStorage || new Storage();
// Fallback for dev: if you don't set it, it'll try this name
const PROCESSED_BUCKET = process.env.PROCESSED_IMAGES_BUCKET || 'daraq-497018-daraq-processed-images';

interface SourceInfo {
  book: string;
  page: number;
  imageUrl: string;
}

// ... original cache map
const sourceCache = new Map<string, SourceInfo>();

/**
 * Қазақша кириллицаны латыншаға транслитерациялау функциясы
 */
function transliterateToLatin(text: string): string {
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
async function addWatermark(imageUrl: string, bookName: string, pageNumber: number): Promise<Buffer> {
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

/**
 * Telegram қабылдамайтын <br> және <p> сияқты тегтерді кәдімгі жол ауыстыруға алмастыру,
 * және қажет болған жағдайда жұлдызшалы Markdown-ды HTML форматына келтіру.
 */
export function formatTelegramMessage(text: string): string {
  let formatted = text;
  formatted = formatted.replace(/<br\s*\/?>/gi, '\n');
  formatted = formatted.replace(/<\/p>/gi, '\n\n').replace(/<p>/gi, '');
  formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>'); // **bold** -> <b>bold</b> (Fallback)
  formatted = formatted.replace(/\*(.*?)\*/g, '<i>$1</i>'); // *italic* -> <i>italic</i> (Fallback)
  return formatted;
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

  // Адамның өзі сол топик атауын қолмен өзгерткен кезде оны тіркеп, сақтау
  bot.on('forum_topic_edited', async (ctx) => {
    try {
      const chatId = String(ctx.chat.id);
      const targetThreadId = ctx.message?.message_thread_id;
      const senderId = ctx.message?.from?.id;
      const botId = ctx.botInfo?.id;

      // Егер топикті боттың өзі өзгертсе, оны елемейміз (бұл біздің автоматты өзгертуіміз)
      if (senderId && botId && senderId === botId) {
        console.log(`[Bot] Ignoring forum_topic_edited service message since it was edited by the bot itself.`);
        return;
      }

      if (chatId && targetThreadId && db) {
        const threadStr = String(targetThreadId);
        await db.collection('users').doc(chatId).collection('topics').doc(threadStr).set({
          customTitle: true,
          updatedAt: new Date()
        }, { merge: true });
        console.log(`[Bot] User manually edited topic ${targetThreadId}. Marked customTitle: true.`);
      }
    } catch (e) {
      console.error('[Bot] Error handling forum_topic_edited:', e);
    }
  });

const renamedTopicsCache = new Set<string>();

  // 2. Сұрақты өңдеу
  bot.on('text', async (ctx) => {
    const chatId = String(ctx.chat.id);
    const query = ctx.message.text;
    const chatType = ctx.chat.type;
    const targetThreadId = ctx.message.message_thread_id;
    let statusMessageId: number | undefined;

    try {
      // Күту мәртебесі: Ойлануда хабарламасын ЕШҚАНДАЙ кідіріссіз/күтусіз бірден жібереміз (Барынша жылдамдық үшін)
      let statusMsg = await ctx.telegram.sendMessage(chatId, '⏳ Ойлануда...', {
        message_thread_id: targetThreadId
      } as any);
      statusMessageId = statusMsg.message_id;

      // Typing анимациясын әр 4 секунд сайын жіберіп тұрамыз
      let isAgentThinking = true;
      const typingInterval = setInterval(() => {
          if (isAgentThinking && statusMessageId) {
             ctx.telegram.sendChatAction(chatId, 'typing', { message_thread_id: targetThreadId }).catch(() => {});
          }
      }, 4000);

      // Бірінші хабарлама екенін және топик атауын дайындауды фонда/параллель орындаймыз
      let isFirstTopicMessage = false;
      let topicNamePromise: Promise<string | undefined> | null = null;

      if (targetThreadId) {
        const cacheKey = `${chatId}_${targetThreadId}`;
        if (!renamedTopicsCache.has(cacheKey)) {
          let hasPriorMessages = false;
          try {
            if (db) {
              const threadStr = String(targetThreadId);
              const topicDoc = await db.collection('users').doc(chatId).collection('topics').doc(threadStr).get();
              const messagesSnapshot = await db.collection('users').doc(chatId).collection('topics').doc(threadStr).collection('messages').limit(1).get();
              
              if (topicDoc.exists && (topicDoc.data()?.renamed || topicDoc.data()?.customTitle)) {
                hasPriorMessages = true;
              } else if (!messagesSnapshot.empty) {
                hasPriorMessages = true;
              }
            }
          } catch (e) {
            console.error('[⚠️] Error checking topic metadata in Firestore:', e);
          }

          if (hasPriorMessages) {
            renamedTopicsCache.add(cacheKey);
          } else {
            renamedTopicsCache.add(cacheKey);
            isFirstTopicMessage = true;

            // Жауап генерациясымен параллельді түрде тақырып атауын дайындаймыз
            const prompt = `Сен Telegram тобындағы тақырыпқа (forum topic) өте қысқа, 2-3 сөзден тұратын атау және сәйкес эмодзи ойлап табуың керек. \n\nАлғашқы сұрақ: "${query}"\n\nТалаптар:\n1. 1 эмодзи + 2 немесе 3 сөз. Кез келген сәйкес келетін смайликті (эмодзи) еркін таңда, ешқандай шектеу жоқ.\n2. Атау қазақ тілінде болуы міндетті.\n3. Ешқандай қосымша мәтінсіз, тек атауды қайтар.\nМысал: 🌙 Ораза пайдалары`;
            
            const aiPromise = ai.models.generateContent({
              model: 'gemini-3-flash-preview', // User requested this model
              contents: prompt
            });
            
            const timeoutPromise = new Promise<any>((_, reject) => 
              setTimeout(() => reject(new Error("Timeout generation: Model is hanging")), 3000)
            );

            topicNamePromise = Promise.race([aiPromise, timeoutPromise]).then(res => {
              let newName = res.text?.trim().replace(/\n/g, ' ');
              if (newName && newName.length > 2) {
                return newName.substring(0, 128);
              }
              throw new Error("Empty or invalid name");
            }).catch(async (err) => {
              console.warn('[AI] gemini-3-flash-preview қатесі немесе күту уақыты аяқталды (Timeout), gemini-2.5-flash моделіне ауысамыз:', err.message || err);
              try {
                const fallbackAiPromise = ai.models.generateContent({
                  model: 'gemini-2.5-flash',
                  contents: prompt
                });
                const fallbackTimeoutPromise = new Promise<any>((_, reject) => 
                  setTimeout(() => reject(new Error("Timeout fallback")), 1500)
                );
                
                const fallbackRes = await Promise.race([fallbackAiPromise, fallbackTimeoutPromise]);
                let fallbackName = fallbackRes.text?.trim().replace(/\n/g, ' ');
                if (fallbackName && fallbackName.length > 2) {
                  return fallbackName.substring(0, 128);
                }
              } catch(fallbackErr: any) {
                console.error('[AI] Fallback Топик атын генерациялау кезінде қателік:', fallbackErr.message || fallbackErr);
              }
              
              // Егер екі модель де сәтсіз болса, пайдаланушы сұрағының алғашқы 3 сөзін тақырып аты етеміз
              const cleanQuery = query.replace(/[?.,!;:#@*()_+=-\[\]{}]/g, '').trim();
              const words = cleanQuery.split(/\s+/).filter(w => w.length > 1).slice(0, 3).join(' ');
              if (words.length > 2) {
                return `❓ ${words}`;
              }
              return '❓ Сұрақ-жауап';
            });
          }
        }
      }

      // 2. LLM арқылы ағынды (streaming) жауап генерациялау
      let lastSentText = "";
      let lastSentTime = 0;
      let throttleTimeout: NodeJS.Timeout | null = null;
      let isUpdating = false;
      const draftId = Math.floor(Math.random() * 1000000000) + 1; // Уникалды draft_id қажет (нөлдік емес)

      const triggerDraftUpdate = async (textToUpdate: string) => {
        if (!textToUpdate.trim() || textToUpdate === lastSentText) return;
        isUpdating = true;
        const payload: any = {
          chat_id: chatId,
          text: textToUpdate + ' ✍️...',
          parse_mode: 'HTML',
          draft_id: draftId
        };
        if (targetThreadId) {
          payload.message_thread_id = targetThreadId;
        }
        try {
          await ctx.telegram.callApi('sendMessageDraft' as any, payload);
          lastSentText = textToUpdate;
          lastSentTime = Date.now();
        } catch (e) {
          // Қателерді елемейміз (мысалы, жабылмаған HTML тегтері)
        } finally {
          isUpdating = false;
        }
      };

      const handleChunk = (currentFullText: string) => {
        if (!currentFullText.trim() || currentFullText === lastSentText) return;

        const now = Date.now();
        const timeSinceLast = now - lastSentTime;

        if (throttleTimeout) {
          clearTimeout(throttleTimeout);
          throttleTimeout = null;
        }

        if (timeSinceLast >= 1000 && !isUpdating) {
          triggerDraftUpdate(currentFullText);
        } else {
          // Мәтін мүлде жоғалмауы үшін келесі секунд басында орындауды жүйелейміз
          const delay = Math.max(0, 1000 - timeSinceLast);
          throttleTimeout = setTimeout(() => {
            if (!isUpdating) {
              triggerDraftUpdate(currentFullText);
            }
          }, delay);
        }
      };

      const answerData = await generateAgentAnswerStream(chatId, query, async (currentFullText) => {
        isAgentThinking = false;

        // Бірінші рет ағын басталғанда уақытша хабарламаны өшіреміз (асинхронды, кідіртпестен)
        if (statusMessageId) {
          const tempId = statusMessageId;
          statusMessageId = undefined;
          ctx.telegram.deleteMessage(chatId, tempId).catch(() => {});
        }

        handleChunk(currentFullText);
      }, async (statusActionStr) => {
          // Агент құрал шақырғанда статусты жаңарту
          if (statusMessageId && isAgentThinking) {
             try {
                 await ctx.telegram.editMessageText(chatId, statusMessageId, undefined, statusActionStr);
             } catch(e) {}
          }
      }, targetThreadId);

      clearInterval(typingInterval);
      if (throttleTimeout) {
        clearTimeout(throttleTimeout);
      }

      // Егер соңғы ағын аяқталғанда жіберілмеген мәтін қалып қойса, оны жібереміз
      if (answerData.answer && answerData.answer !== lastSentText) {
        await triggerDraftUpdate(answerData.answer);
      }

      let finalMessage = formatTelegramMessage(answerData.answer);

      // 3. Батырмаларды құрастыру (Егер дәлелдер табылса)
      let inlineKeyboard: any = null;
      if (answerData.sources && answerData.sources.length > 0) {
        // Ең сенімді әрі жауапқа ең сәйкес келетін дәлелді батырмаға ілеміз
        const bestSource = chooseBestSource(answerData.answer, answerData.sources) || answerData.sources[0];

        if (bestSource.isQuran && bestSource.url) {
          inlineKeyboard = Markup.inlineKeyboard([
            Markup.button.url('📖 Quran.com-нан оқу', bestSource.url)
          ]);
        } else if (bestSource.imageUrl) {
          const sourceId = uuidv4().substring(0, 8); // Қысқа ID (Telegram Callback Data Limit 64 bytes)
          
          sourceCache.set(sourceId, {
            book: bestSource.book,
            page: bestSource.page,
            imageUrl: bestSource.imageUrl
          });

          inlineKeyboard = Markup.inlineKeyboard([
            Markup.button.callback('🖼 Дәлел суретті көру', `view_source_${sourceId}`)
          ]);
        }
      }

      const quoteMatch = query.match(/[^.?!]+[.?!]/);
      let quoteText = quoteMatch ? quoteMatch[0].trim() : query.trim();
      if (quoteText.length > 200) {
        quoteText = quoteText.substring(0, 200);
      }
      const exactQuoteText = query.includes(quoteText) ? quoteText : query.substring(0, Math.min(200, query.length));

      const extraOptions: any = { parse_mode: 'HTML' };
      
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

      // Біз әрқашан уақытша күту немесе ескі хабарламаны өшіреміз
      if (statusMessageId) {
        try {
          await ctx.telegram.deleteMessage(chatId, statusMessageId);
        } catch (e) {
          // Елемейміз
        }
      }

      // Финалдық хабарламаны жібереміз
      try {
        await ctx.telegram.sendMessage(chatId, finalMessage, extraOptions);
      } catch (replyError) {
        console.error("[⚠️] HTML форматымен жіберу қатесі, таза мәтін жіберілуде:", replyError);
        const plainText = finalMessage.replace(/<[^>]*>?/gm, '');
        const plainOptions: any = { ...extraOptions };
        delete plainOptions.parse_mode;
        // Re-assign inline keyboard explicitly in case it was lost
        if (inlineKeyboard) Object.assign(plainOptions, inlineKeyboard);
        await ctx.telegram.sendMessage(chatId, plainText, plainOptions);
      }

      // Стриминг толық аяқталған соң ғана тақырып атын өзгерту (алдын ала дайындалған уәдені (promise) күту):
      if (isFirstTopicMessage && targetThreadId && topicNamePromise) {
        try {
          const newName = await topicNamePromise;
          if (newName) {
            await ctx.telegram.editForumTopic(chatId, targetThreadId, { name: newName });
            console.log(`[AI] Жеке чаттағы Топик аты өзгертілді: ${newName}`);
            
            // Сақталған статус ретінде Firestore-ға жазу
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

      if (statusMessageId) {
        try {
          await ctx.telegram.editMessageText(chatId, statusMessageId, undefined, errorMessage, { parse_mode: 'HTML' });
        } catch (e) {
          await ctx.telegram.sendMessage(chatId, errorMessage, { parse_mode: 'HTML', message_thread_id: targetThreadId } as any);
        }
      } else {
        await ctx.telegram.sendMessage(chatId, errorMessage, { parse_mode: 'HTML', message_thread_id: targetThreadId } as any);
      }
    }
  });

  // 4. "🖼 Дәлел суретті көру" батырмасын ұстап алу
  bot.action(/view_source_(.+)/, async (ctx) => {
    try {
      const sourceId = ctx.match[1];
      const sourceInfo = sourceCache.get(sourceId);

      if (!sourceInfo) {
        await ctx.answerCbQuery('Кешіріңіз, дәлел суреті табылмады немесе ескірген.', { show_alert: true });
        return;
      }

      await ctx.answerCbQuery('Сурет жүктелуде...');

      // Су белгісін қою (Watermark)
      const imageBuffer = await addWatermark(sourceInfo.imageUrl, sourceInfo.book, sourceInfo.page);

      // Пайдаланушыға суретті жіберу
      await ctx.replyWithPhoto({ source: imageBuffer }, { caption: `📖 ${sourceInfo.book}, ${sourceInfo.page}-бет` });

    } catch (error) {
      console.error("[❌] Суретті жүктеу кезінде қате:", error);
      await ctx.answerCbQuery('Суретті ашу кезінде қателік кетті.', { show_alert: true });
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
