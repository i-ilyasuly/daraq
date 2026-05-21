import { Telegraf, Markup } from 'telegraf';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import { searchAnswers } from '../rag/searchService';
import { generateAnswer } from '../rag/aiService';

interface SourceInfo {
  book: string;
  page: number;
  imageUrl: string;
}

// Уақытша жад (пайдаланушы 🖼 Дәлел суретті көру басып қалса, осы жерден сурет метадатасы алынады)
const sourceCache = new Map<string, SourceInfo>();

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
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error("Суретті жүктеу мүмкін болмады");
    const arrayBuffer = await response.arrayBuffer();
    baseImageBuffer = Buffer.from(arrayBuffer);
    
    // Бұл код dummy-image-content сынды жарамсыз суретті анықтап, қате лақтырады
    await sharp(baseImageBuffer).metadata();
  } catch (err) {
    useFallbackWatermark = true;
    
    // Егер GCS-тен алынған сурет жарамсыз болса (MVP-дегі mock content), әдемі визуалды шаблон (placeholder) жасаймыз
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

  // 2. Сұрақты өңдеу
  bot.on('text', async (ctx) => {
    const chatId = String(ctx.chat.id);
    const query = ctx.message.text;
    let statusMessageId: number | undefined;

    try {
      // Күту мәртебесі: Ізделуде
      const statusMsg = await ctx.reply('⏳ Ізделуде...');
      statusMessageId = statusMsg.message_id;

      // 1. Дәлелдер іздеу
      const searchResults = await searchAnswers(query);

      // Күту мәртебесі: Тексерілуде
      await ctx.telegram.editMessageText(chatId, statusMessageId, undefined, '📖 Дәлелдер тексерілуде...');

      // 2. LLM арқылы жауап генерациялау
      const answerData = await generateAnswer(chatId, query, searchResults);

      let finalMessage = answerData.answer;
      // Telegram қабылдамайтын <br> және <p> сияқты тегтерді кәдімгі жол ауыстыруға алмастыру
      finalMessage = finalMessage.replace(/<br\s*\/?>/gi, '\n');
      finalMessage = finalMessage.replace(/<\/p>/gi, '\n\n').replace(/<p>/gi, '');
      finalMessage = finalMessage.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>'); // **bold** -> <b>bold</b> (Fallback)
      finalMessage = finalMessage.replace(/\*(.*?)\*/g, '<i>$1</i>'); // *italic* -> <i>italic</i> (Fallback)

      finalMessage += '\n\n<i>Сұрағыңызды нақтылап қоюыңызға болады.</i>'; // Follow-up мәтін

      // 3. Батырмаларды құрастыру (Егер дәлелдер табылса)
      let inlineKeyboard: any = null;
      if (answerData.sources && answerData.sources.length > 0) {
        // Ең сенімді 1-ші дәлелді батырмаға ілеміз
        const bestSource = answerData.sources[0];
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

      // Жауапты жіберу және ескі хабарламаны өшіру
      await ctx.telegram.deleteMessage(chatId, statusMessageId);
      
      const extraOptions = inlineKeyboard ? Object.assign({ parse_mode: 'HTML' }, inlineKeyboard) : { parse_mode: 'HTML' };
      
      await ctx.reply(finalMessage, extraOptions);

    } catch (error) {
      console.error("[❌] Telegram ботта қателік орын алды:", error);
      // Қателерді өңдеу
      if (statusMessageId) {
        try {
          await ctx.telegram.editMessageText(chatId, statusMessageId, undefined, 'Кешіріңіз, сұрақты өңдеу кезінде қателік кетті.');
        } catch (e) {
          await ctx.reply('Кешіріңіз, сұрақты өңдеу кезінде қателік кетті.');
        }
      } else {
        await ctx.reply('Кешіріңіз, сұрақты өңдеу кезінде қателік кетті.');
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
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction && appUrl) {
    const webhookPath = `/api/bot-webhook`;
    bot.telegram.setWebhook(`${appUrl}${webhookPath}`).then(() => {
      console.log(`Webhook set at ${appUrl}${webhookPath}`);
    });
  } else {
    console.log('Development mode detected or APP_URL missing. Starting bot in polling mode...');
    bot.telegram.deleteWebhook({ drop_pending_updates: true }).then(() => {
      bot.launch({ dropPendingUpdates: true });
      console.log('Bot started in polling mode.');
    }).catch((error: unknown) => {
      console.error('Error starting polling mode:', error);
    });
  }

  return bot;
}
