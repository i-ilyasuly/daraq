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
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error("Суретті жүктеу мүмкін болмады");
    const arrayBuffer = await response.arrayBuffer();
    baseImageBuffer = Buffer.from(arrayBuffer);
    
    // Бұл код dummy-image-content сынды жарамсыз суретті анықтап, қате лақтырады
    await sharp(baseImageBuffer).metadata();
  } catch (err) {
    // Егер GCS-тен алынған сурет жарамсыз болса (MVP-дегі mock content), бос орынға сурет сызамыз
    baseImageBuffer = await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 4,
        background: { r: 240, g: 240, b: 240, alpha: 1 }
      }
    })
    .png()
    .toBuffer();
  }

  // Суреттің төменгі жағына су белгісін салу
  return await sharp(baseImageBuffer)
    .composite([
      {
        input: Buffer.from(svgText),
        gravity: 'south'
      }
    ])
    .jpeg()
    .toBuffer();
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
    return ctx.reply(
      `Ассалаумағалейкум, ${userName}! \n\nМен Daraq — Ханафи мазһабы бойынша сенімді діни көмекшіңізбін. Қандай сұрағыңыз бар?`
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
      finalMessage += '\n\nСұрағыңызды нақтылап қоюыңызға болады.'; // Follow-up мәтін

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
      
      if (inlineKeyboard) {
        await ctx.reply(finalMessage, inlineKeyboard);
      } else {
        await ctx.reply(finalMessage);
      }

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
  if (appUrl) {
    const webhookPath = `/api/bot-webhook`;
    bot.telegram.setWebhook(`${appUrl}${webhookPath}`).then(() => {
      console.log(`Webhook set at ${appUrl}${webhookPath}`);
    });
  } else {
    console.log('APP_URL not defined, attempting to start bot in pulling mode.');
    bot.launch();
  }

  return bot;
}
