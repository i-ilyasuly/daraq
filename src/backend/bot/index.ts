import { Telegraf, Markup } from 'telegraf';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import { Storage } from '@google-cloud/storage';
import { storage as customStorage } from '../storage';
import { searchAnswers } from '../rag/searchService';
import { generateAnswer, generateAnswerStream } from '../rag/aiService';
import { ai } from '../rag/aiClient';

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

/**
 * Telegram Bot API sendMessageDraft әдісіне сұраныс жіберу
 */
async function sendDraftMessage(ctx: any, chatId: string, text: string, messageThreadId?: number, draftId?: string): Promise<any> {
  try {
    const payload: any = {
      chat_id: chatId,
      text: text,
    };
    if (messageThreadId) {
      payload.message_thread_id = messageThreadId;
    }
    if (draftId) {
      payload.draft_id = draftId;
    }
    const res = await ctx.telegram.callApi('sendMessageDraft', payload);
    return res;
  } catch (err: any) {
    console.warn("[⚠️] Telegram Bot API 'sendMessageDraft' қолдамады немесе қате шықты:", err.message);
    return null;
  }
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

const renamedTopicsCache = new Set<string>();

  // 2. Сұрақты өңдеу
  bot.on('text', async (ctx) => {
    const chatId = String(ctx.chat.id);
    const query = ctx.message.text;
    const chatType = ctx.chat.type;
    const targetThreadId = ctx.message.message_thread_id;
    let statusMessageId: number | undefined;

    // Пайдаланушы жеке чатта жаңа топик ашып, ішіне алғашқы сұрағын жазғанда (бот осы thread-ты бірінші рет көріп тұрса), AI арқылы атауын жаңартамыз
    if (chatType === 'private' && targetThreadId) {
      const cacheKey = `${chatId}_${targetThreadId}`;
      if (!renamedTopicsCache.has(cacheKey)) {
        renamedTopicsCache.add(cacheKey);

        // Фондық режимде (async) Vertex AI арқылы сұрақты талдап, топик атын өзгертеміз
        (async () => {
          try {
            const prompt = `Сен Telegram тобындағы тақырыпқа (forum topic) өте қысқа, 2-3 сөзден тұратын атау және сәйкес эмодзи ойлап табуың керек. \n\nАлғашқы сұрақ: "${query}"\n\nТалаптар:\n1. 1 эмодзи + 2 немесе 3 сөз.\n2. Атау қазақ тілінде болуы міндетті.\n3. Ешқандай қосымша мәтінсіз, тек атауды қайтар.\nМысал: 🌙 Ораза пайдалары`;
            const res = await ai.models.generateContent({
              model: 'gemini-3-flash-preview',
              contents: prompt
            });
            let newName = res.text?.trim().replace(/\n/g, ' ');
            if (newName) {
              // Telegram шектеуі: тақырып аты 128 таңбадан аспауы тиіс
              newName = newName.substring(0, 128);
              await ctx.telegram.editForumTopic(chatId, targetThreadId, { name: newName });
              console.log(`[AI] Жеке чаттағы Топик аты өзгертілді: ${newName}`);
            }
          } catch(e) {
            console.error('[AI] Топик атын генерациялау кезінде қателік:', e);
          }
        })();
      }
    }

    try {
      // Күту мәртебесі: Ізделуде
      const statusMsg = await ctx.telegram.sendMessage(chatId, '⏳ Ізделуде...', {
        message_thread_id: targetThreadId
      } as any);
      statusMessageId = statusMsg.message_id;

      // 1. Дәлелдер іздеу
      const searchResults = await searchAnswers(query);

      // Күту мәртебесі: Тексерілуде
      await ctx.telegram.editMessageText(chatId, statusMessageId, undefined, '📖 Дәлелдер тексерілуде...');

      // 2. LLM арқылы ағынды (streaming) жауап генерациялау
      let currentDraftId: string | undefined;
      let lastEditTime = Date.now();
      let lastSentText = "";
      let usedDraftApi = false;

      const answerData = await generateAnswerStream(chatId, query, searchResults, async (currentFullText) => {
        const plainText = currentFullText.replace(/<[^>]*>?/gm, ''); // HTML тегтерін тазалаймыз
        if (!plainText.trim() || plainText === lastSentText) return;

        // 1. Алдымен жаңа sendMessageDraft-ты байқап көреміз (жылдам, ешқандай 1500мс шектеусіз)
        const draftRes = await sendDraftMessage(ctx, chatId, plainText + ' ✍️...', targetThreadId, currentDraftId);
        if (draftRes && draftRes.draft_id) {
          if (statusMessageId) {
            try {
              await ctx.telegram.deleteMessage(chatId, statusMessageId);
              statusMessageId = undefined;
            } catch (e) {
              // Елемейміз
            }
          }
          currentDraftId = draftRes.draft_id;
          lastSentText = plainText;
          usedDraftApi = true;
          return;
        }

        // 2. Fallback: Егер sendMessageDraft жұмыс істемесе, бұрынғыша editMessageText қабылдаймыз (әр 800мс сайын)
        const now = Date.now();
        if (now - lastEditTime >= 800) {
          try {
            await ctx.telegram.editMessageText(chatId, statusMessageId, undefined, plainText + ' ✍️...');
            lastEditTime = now;
            lastSentText = plainText;
          } catch (e) {
            // Қателерді елемейміз
          }
        }
      });

      let finalMessage = formatTelegramMessage(answerData.answer);

      if (!answerData.answer.startsWith('⚠️')) {
        finalMessage += '\n\n<i>Сұрағыңызды нақтылап қоюыңызға болады.</i>'; // Follow-up мәтін
      }

      // 3. Батырмаларды құрастыру (Егер дәлелдер табылса)
      let inlineKeyboard: any = null;
      if (answerData.sources && answerData.sources.length > 0) {
        // Ең сенімді әрі жауапқа ең сәйкес келетін дәлелді батырмаға ілеміз
        const bestSource = chooseBestSource(answerData.answer, answerData.sources) || answerData.sources[0];
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

      const extraOptions = inlineKeyboard 
        ? Object.assign({ parse_mode: 'HTML' }, inlineKeyboard, targetThreadId ? { message_thread_id: targetThreadId } : {}) 
        : (targetThreadId ? { parse_mode: 'HTML', message_thread_id: targetThreadId } : { parse_mode: 'HTML' });

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
        const plainOptions = inlineKeyboard 
          ? Object.assign({}, inlineKeyboard, targetThreadId ? { message_thread_id: targetThreadId } : {})
          : (targetThreadId ? { message_thread_id: targetThreadId } : undefined);
        await ctx.telegram.sendMessage(chatId, plainText, plainOptions);
      }

    } catch (error: any) {
      console.error("[❌] Telegram ботта қателік орын алды:", error);
      const errorStr = String(error?.response?.data || error?.message || error || "");
      console.error("Толық қате сипаттамасы:", errorStr);
      
      const isCreditsError = errorStr.includes("depleted") || errorStr.includes("429") || errorStr.includes("RESOURCE_EXHAUSTED");
      
      // Қателерді өңдеу
      let errorMessage = 'Кешіріңіз, жүйелік қателікке байланысты жауап бере алмаймын. Сұрағыңызды нақтылап қоюыңызға болады.';
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
