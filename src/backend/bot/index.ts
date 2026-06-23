import { formatTelegramMessage, transliterateToLatin, filterSourcesByResponse, isAskingForProof } from './formatters';
import { Telegraf, Markup } from 'telegraf';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import { Storage } from '@google-cloud/storage';
import { storage as customStorage } from '../storage';
import { searchAnswers } from '../rag/searchService';
import { generateAgentAnswerStream, saveToChatHistory, rewindHistory, correctTranscribedText } from '../rag/aiService';
import { ai } from '../rag/aiClient';
import { db } from '../db/firestore';
import { transcribeKazakhVoice } from '../rag/scribeService';

function createThrottledUpdater(callback: (text: string) => Promise<void> | void, waitMs: number) {
  let lastRan = 0;
  let timeout: NodeJS.Timeout | null = null;
  let lastText = '';

  const execute = async () => {
    lastRan = Date.now();
    timeout = null;
    try {
      await callback(lastText);
    } catch (e) {}
  };

  return {
    update: (text: string) => {
      lastText = text;
      const now = Date.now();
      const remaining = waitMs - (now - lastRan);

      if (remaining <= 0) {
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
        execute();
      } else if (!timeout) {
        timeout = setTimeout(execute, remaining);
      }
    },
    flush: async () => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      try {
        await callback(lastText);
      } catch (e) {}
    }
  };
}

const storage = customStorage || new Storage();
// Fallback for dev: if you don't set it, it'll try this name
const PROCESSED_BUCKET = process.env.PROCESSED_IMAGES_BUCKET || 'daraq-497018-daraq-processed-images';

import {
  SourceInfo, ongoingStreams, userToBotMsgMap, sourceUploadCache,
  getSourceInfo, setSourceInfo, getGroupInfo, setGroupInfo,
  PaginationState, paginationCache, renamedTopicsCache, pendingSourcesCache,
  sourceCache, groupCache
} from './botCache';

import {
  getCustomEmojiMap, EMOJI_FALLBACKS, extractEmojiAndText
} from './emojiService';

export { getSourceInfo, setSourceInfo, getGroupInfo, setGroupInfo, renamedTopicsCache } from './botCache';

import { formatStatusMessage, splitTextIntoSafeChunks, processAndDeduplicateSources, buildKeyboard } from './messageBuilder';
import { addWatermark } from './watermark';
import { setupActionHandlers } from './actions';

export async function sendRawTelegramApi(method: string, payload: any) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    if (process.env.NODE_ENV === 'test') return;
    throw new Error('TELEGRAM_BOT_TOKEN is not set');
  }
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!data.ok) {
    console.error(`[Telegram API Error] ${method}:`, data);
    throw new Error(`Telegram API Error: ${data.description}`);
  }
  return data.result;
}

async function setupBotProfile(telegram: any) {
  try {
    // 1. Қазақ тіліндегі сипаттамалар (kk)
    await telegram.callApi('setMyDescription', {
      description: 'Daraq — Ханафи мазһабы бойынша сенімді діни жасанды интеллект көмекшісі. Сенімді классикалық кітаптардан дәлелдер тауып, жауап береді.',
      language_code: 'kk'
    });
    await telegram.callApi('setMyShortDescription', {
      short_description: 'Ханафи мазһабы бойынша сенімді діни AI көмекшісі.',
      language_code: 'kk'
    });

    // 2. Орыс тіліндегі сипаттамалар (ru)
    await telegram.callApi('setMyDescription', {
      description: 'Daraq — надежный религиозный ИИ-помощник по мазхабу Ханафи. Находит ответы со ссылками на классические исламские книги.',
      language_code: 'ru'
    });
    await telegram.callApi('setMyShortDescription', {
      short_description: 'Надежный ИИ-помощник по мазхабу Ханафи.',
      language_code: 'ru'
    });

    // 3. Ағылшын тіліндегі сипаттамалар (en)
    await telegram.callApi('setMyDescription', {
      description: 'Daraq — a reliable religious AI assistant following the Hanafi school of thought. It provides answers with proofs from classical Islamic books.',
      language_code: 'en'
    });
    await telegram.callApi('setMyShortDescription', {
      short_description: 'Reliable Hanafi Islamic AI assistant.',
      language_code: 'en'
    });

    // 4. Жалпылама (Default) сипаттамалар
    await telegram.callApi('setMyDescription', {
      description: 'Daraq — Ханафи мазһабы бойынша сенімді діни жасанды интеллект көмекшісі. Сенімді классикалық кітаптардан дәлелдер тауып, жауап береді.'
    });
    await telegram.callApi('setMyShortDescription', {
      short_description: 'Ханафи мазһабы бойынша сенімді діни AI көмекшісі.'
    });

    console.log('[✅] Telegram bot profiles (description, short_description) updated successfully.');
  } catch (err) {
    console.error('[⚠️] Failed to update Telegram bot profiles:', err);
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
  setupBotProfile(bot.telegram);

  // 1. Автоматты сәлемдесу және Терең сілтемелер (Deep Linking)
  bot.start(async (ctx: any) => {
    const startPayload = ctx.startPayload;
    if (startPayload) {
      let query = startPayload.replace(/_/g, ' ');
      if (startPayload.toLowerCase() === 'namaz_fatwa') {
         query = 'Намаз пәтуасы';
      } else if (startPayload.toLowerCase() === 'oraza_fatwa') {
         query = 'Ораза пәтуасы';
      } else if (startPayload.toLowerCase() === 'sapar_fiqhy') {
         query = 'Сапар фиқһы және сапар намазы сұрақтары';
      }
      return handleIncomingMessage(ctx, query);
    }

    const userName = ctx.from?.first_name || 'Қолданушы';
    return ctx.replyWithHTML(
      `Ассалаумағалейкум, <b>${userName}</b>!\n\nМен <b>Daraq</b> — Ханафи мазһабы бойынша сенімді діни көмекшіңізбін. Қандай сұрағыңыз бар?`
    );
  });

  // Темаларды (ораза, намаз) құру пәрмені
  bot.command('create_topics', async (ctx) => {
    const chatId = ctx.chat.id;

    try {
      await ctx.replyWithHTML(formatStatusMessage('"Ораза" және "Намаз" темаларын құру басталуда...'));
      
      const emojiMap = await getCustomEmojiMap(ctx.telegram);
      
      // Намаз (Mosque icon fallback to house if not exists)
      let namazEmojiId = emojiMap.get('🕌');
      if (!namazEmojiId) namazEmojiId = emojiMap.get('🏠') || emojiMap.get('🧠') || Array.from(emojiMap.values())[0];
      
      // Ораза (Moon fallback to star if not exists)
      let orazaEmojiId = emojiMap.get('🌙');
      if (!orazaEmojiId) orazaEmojiId = emojiMap.get('⭐️') || emojiMap.get('🧠') || Array.from(emojiMap.values())[0];

      // Намаз тақырыбы
      const namazTopic = await ctx.telegram.createForumTopic(
        chatId, 
        'Намаз', 
        namazEmojiId ? { icon_custom_emoji_id: namazEmojiId } : undefined
      );

      // Ораза тақырыбы
      const orazaTopic = await ctx.telegram.createForumTopic(
        chatId, 
        'Ораза', 
        orazaEmojiId ? { icon_custom_emoji_id: orazaEmojiId } : undefined
      );

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
      const emojiMap = await getCustomEmojiMap(ctx.telegram);
      let brainId = emojiMap.get('🧠');
      if (!brainId) {
        brainId = emojiMap.get('📝') || emojiMap.get('❓') || Array.from(emojiMap.values())[0];
      }
      const topic = await ctx.telegram.createForumTopic(
        chatId, 
        'Жаңа тақырып',
        brainId ? { icon_custom_emoji_id: brainId } : undefined
      );
      await ctx.reply(`✅ Жаңа топик құрылды! Thread ID: ${topic.message_thread_id}. Енді сол жерге жазыңыз.`);
    } catch (e: any) {
      await ctx.reply(`❌ Жаңа топик құру мүмкін болмады: ${e.message}`);
    }
  });

  const handleIncomingMessage = async (ctx: any, customQuery?: string, isVoice: boolean = false) => {
    const chatId = String(ctx.chat.id);
    const targetThreadId = ctx.message?.message_thread_id;
    const query = customQuery || (ctx.message && ('text' in ctx.message) ? ctx.message.text : '');

    if (!query) return;

    const quotePrefix = (isVoice && customQuery) ? `<aside><i>"${customQuery}"</i></aside>\n\n` : '';

    const topicCacheKey = `${chatId}_${targetThreadId || 'general'}`;
    const draftId = ctx.message ? ctx.message.message_id : Math.floor(Math.random() * 100000); // Using user message_id or custom fake ID

    // Map new stream logic
    const abortController = new AbortController();
    const streamKey = `${chatId}_${targetThreadId || 'general'}`;
    // If a stream is already running for this user in this thread, we could abort it, 
    // but the requirement mostly implies aborting on *edit*. We will store it here anyway.
    ongoingStreams.set(streamKey, abortController);

    try {
      // Typing status indicating bot is thinking
      let isAgentThinking = true;
      let currentActionStatus = 'typing';
      const sendTypingStatus = async () => {
        try {
          if (isAgentThinking && !abortController.signal.aborted) {
            await ctx.telegram.sendChatAction(chatId, currentActionStatus as 'typing' | 'choose_sticker', targetThreadId ? { message_thread_id: targetThreadId } : undefined);
          }
        } catch (e) {}
      };
      
      const typingInterval = setInterval(sendTypingStatus, 4000);
      sendTypingStatus();

      try {
        await sendRawTelegramApi('sendRichMessageDraft', {
          chat_id: chatId,
          draft_id: draftId,
          message_thread_id: targetThreadId,
          rich_message: { html: `<tg-thinking>${formatStatusMessage('Ойлану')}</tg-thinking>` }
        });
      } catch (e) {
        // Ignore API failures for draft
      }

      // No blocking Firestore logic here to maximize response speed!

      const threadStr = (targetThreadId !== undefined && targetThreadId !== null) ? String(targetThreadId) : 'general';

      let quranSources: any[] = [];
      let bookSources: any[] = [];
      let inlineKeyboard: any = null;

      const lang = ctx.from?.language_code;

      const draftUpdater = createThrottledUpdater(async (currentFullText) => {
        if (abortController.signal.aborted) return;
        const formatted = quotePrefix + formatTelegramMessage(currentFullText);
        try {
          await sendRawTelegramApi('sendRichMessageDraft', {
            chat_id: chatId,
            draft_id: draftId,
            message_thread_id: targetThreadId,
            rich_message: { html: formatted }
          });
        } catch(e) {}
      }, 1200);

      const answerData = await generateAgentAnswerStream(
        chatId,
        query,
        (currentFullText) => {
          draftUpdater.update(currentFullText);
        },
        async (statusText) => {
          if (abortController.signal.aborted) return;
          if (statusText.includes('іздеу') || statusText.includes('қарастырудамын')) {
             currentActionStatus = 'choose_sticker';
          } else {
             currentActionStatus = 'typing';
          }
          try {
            await sendRawTelegramApi('sendRichMessageDraft', {
              chat_id: chatId,
              draft_id: draftId,
              message_thread_id: targetThreadId,
              rich_message: { html: `<tg-thinking>${formatStatusMessage(statusText)}</tg-thinking>` }
            });
          } catch (e) {}
        },
        targetThreadId,
        lang,
        abortController.signal,
        true // skip internal history saving, we do it here!
      );

      await draftUpdater.flush();

      isAgentThinking = false;
      clearInterval(typingInterval);
      ongoingStreams.delete(streamKey);

      let relevantSources: any[] = [];
      if (answerData.sources && answerData.sources.length > 0) {
        relevantSources = filterSourcesByResponse(answerData.sources, answerData.answer);
      }

      let cachedAnswerToUse = answerData.answer;
      let originalQuery = query;
      const cacheKey = `${chatId}_${threadStr}`;
      
      // Егер пайдаланушы дәлел сұраса, бұрын табылған соңғы жауапты (мәтінді) оқу
      if (isAskingForProof(query)) {
        const cachedData = pendingSourcesCache.get(cacheKey);
        if (cachedData) {
          if (cachedData.answer) {
            cachedAnswerToUse = cachedData.answer; // Prioritize original factual answer for consistent source reference
          }
          if (cachedData.query) {
            originalQuery = cachedData.query;
          }
          if (!relevantSources || relevantSources.length === 0) {
            if (cachedData.sources && cachedData.sources.length > 0) {
              relevantSources = cachedData.sources;
              console.log(`[Cache] Restored ${cachedData.sources.length} sources from memory for query: "${query}"`);
            }
          }
        }
      } else {
        // Жаңадан табылған дәлелдерді кэштейміз (егер бұл дәлел сұрау болмаса ғана)
        // ТІПТІ relevantSources бос болса да (LLM кітап атын атамаса да), RAG берген барлық source-тарды сақтап қоямыз
        const sourcesToCache = (relevantSources && relevantSources.length > 0) ? relevantSources : (answerData.sources || []);
        pendingSourcesCache.set(cacheKey, {
          sources: sourcesToCache,
          answer: answerData.answer,
          query: query
        });
      }

      if (relevantSources && relevantSources.length > 0) {
        const processed = processAndDeduplicateSources(relevantSources, cachedAnswerToUse);
        quranSources = processed.quranSources;
        bookSources = processed.bookSources;
        if (quranSources.length > 0 || bookSources.length > 0) {
          const pagId = uuidv4().substring(0, 8);
          paginationCache.set(pagId, {
            quranSources,
            bookSources,
            quranPageIndex: 0,
            query: originalQuery
          });
          inlineKeyboard = buildKeyboard(quranSources, bookSources, 0, pagId, originalQuery);
        }
      }

      let botSentMsg: any = null;

      const extraOptions: any = { 
        disable_web_page_preview: true,
        link_preview_options: { is_disabled: true }
      };

      if (ctx.message && ctx.message.message_id) {
        extraOptions.reply_parameters = { message_id: ctx.message.message_id };
      }

      if (targetThreadId) {
        extraOptions.message_thread_id = targetThreadId;
      }

      const lf = answerData.answer.toLowerCase();
      if (lf.includes('мүбәрак') || lf.includes('мубарак') || lf.includes('айт қабыл болсын') || lf.includes('айт кабыл болсын') || lf.includes('благословенн') || lf.includes('қабыл етсін')) {
         extraOptions.message_effect_id = "5046509860389126442";
      }

      const txt = quotePrefix + formatTelegramMessage(answerData.answer, quranSources);
      if (inlineKeyboard) Object.assign(extraOptions, inlineKeyboard);
      
      try {
          botSentMsg = await sendRawTelegramApi('sendRichMessage', {
              chat_id: chatId,
              rich_message: { html: txt },
              ...extraOptions
          });
      } catch(e) {
          console.error(`[⚠️] sendRichMessage error:`, e);
          const pOpts = { ...extraOptions };
          delete pOpts.reply_parameters;
          // Fallback if rich message fails
          const plainText = txt.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>?/gm, '');
          botSentMsg = await ctx.telegram.sendMessage(chatId, plainText, pOpts);
      }

      // Жадқа және дерекқорға сақтау
      if (botSentMsg) {
         userToBotMsgMap.set(draftId.toString(), botSentMsg.message_id);
         saveToChatHistory(chatId, 'user', query, targetThreadId, draftId).catch(()=>{});
         saveToChatHistory(chatId, 'bot', answerData.answer, targetThreadId, botSentMsg.message_id, draftId).catch(()=>{});
      }

      // Стриминг толық аяқталған соң ғана тақырып атын өзгерту
      console.log(`[Rename Check] chatId: ${chatId}, targetThreadId: ${targetThreadId}, intent: ${answerData?.intent}, cacheKey: ${chatId}_${targetThreadId || 'general'}`);
      if (targetThreadId && answerData?.intent === 'KNOWLEDGE_SEARCH') {
        const tCacheKey = `${chatId}_${targetThreadId}`;
        (async () => {
          try {
            let recentlyUsedEmojis: string[] = [];
            let recentlyUsedEmojiIds: string[] = [];

            if (db) {
              // 1. Жергілікті кэште бар ма, тексереміз
              if (renamedTopicsCache.has(tCacheKey)) {
                console.log(`[Rename Check] Skipping rename, already in local memory cache: ${tCacheKey}`);
                return;
              }
              // 2. Firestore-дан бұрын өзгерген-өзгөрмегенін тексереміз
              const topicDoc = await db.collection('users').doc(chatId).collection('topics').doc(String(targetThreadId)).get();
              if (topicDoc.exists && topicDoc.data()?.renamed) {
                console.log(`[Rename Check] Skipping rename, Firestore indicates already marked 'renamed' for thread: ${targetThreadId}`);
                renamedTopicsCache.add(tCacheKey);
                return;
              }

              // 3. Соңғы 30 тақырыптың эмодзилерін жүктейміз (қайталамау үшін)
              try {
                const topicsSnap = await db.collection('users').doc(chatId).collection('topics')
                  .orderBy('updatedAt', 'desc')
                  .limit(30)
                  .get();
                topicsSnap.forEach(doc => {
                  const data = doc.data();
                  if (data.emoji) recentlyUsedEmojis.push(data.emoji);
                  if (data.customEmojiId) recentlyUsedEmojiIds.push(data.customEmojiId);
                });
              } catch (err) {
                console.error('[AI] Бұрынғы тақырыптарды/эмодзилерді Firestore-дан жүктеу кезінде қате:', err);
              }
            }

            console.log(`[Rename Check] Proceeding to generate premium Big Tech name for thread/topic ${targetThreadId}...`);
            console.log(`[Stickers] Recently used emojis: ${JSON.stringify(recentlyUsedEmojis)}, IDs: ${JSON.stringify(recentlyUsedEmojiIds)}`);

            const avoidInstruction = recentlyUsedEmojis.length > 0
              ? `\n\n5. ҚАТАҢ ШЕКТЕУ: Қайталамау үшін мына эмодзилерді МҮЛДЕМ қолданба немесе басқасын таңда: ${Array.from(new Set(recentlyUsedEmojis)).join(', ')}`
              : '';

            const prompt = `Сен — Telegram тақырыптарының атауын жасайтын кәсіби редакторсың. 
Мына сұрақ пен жауапты талдап, олардың негізгі тақырыбын Big Tech (ChatGPT, Claude) стандарттарына 100% сай келетіндей етіп жаса.

ҚАТАҢ ЕРЕЖЕЛЕР:
1. ҰЗЫНДЫҒЫ: Атау қатаң түрде тек 2-3 сөзден ғана тұруы керек.
2. ФОРМАТЫ: Сұраулы сөйлем немесе етістік қолданба. Тек зат есіммен немесе атау тұлғасында жаз (мысалы: "Ораза ұстау тәртібі" немесе "Сапардағы намаз").
3. ТАЗАЛЫҚ: Ешқандай тырнақша, нүкте, үтір, сұрақ белгісін қолданба.
4. ДИЗАЙН: Тақырып атауының ең басына тақырыпқа сәйкес келетін ТЕК 1 эмодзи қос (мысалы: 📚, 🚗, 💡, 📝). Егер тақырыпқа сай PREMIUM иконка таппасаң, жай ғана тақырыпқа сай эмодзи қой, жүйе өзі реттейді.${avoidInstruction}
5. ТІЛ: Тек қазақ тілінде жаз.

ҮЛГІ (Few-Shot Examples):
- Пайдаланушы: "Жолаушымын, намаз не болады?" -> 🚗 Сапардағы намаз
- Пайдаланушы: "Вейп шегу харам ба?" -> 🚭 Вейп үкімі
- Пайдаланушы: "Ораза ұстағанда тіс тазалауға бола ма?" -> 🪥 Ораза және мисуак
- Пайдаланушы: "Саудада ақшаны қалай өсімсіз аламыз?" -> 💼 Халал сауда ережесі

Сұрақ: "${query}"
Жауап: "${answerData?.answer || ''}"`;
            
            const aiPromise = ai.models.generateContent({
              model: 'gemini-flash-lite-latest',
              contents: prompt
            });
            
            const timeoutPromise = new Promise<any>((_, reject) => 
               setTimeout(() => reject(new Error("Timeout generation: Model is hanging")), 3000)
            );

            let newName = await Promise.race([aiPromise, timeoutPromise]).then(res => {
              let parsedName = res.text?.trim().replace(/\n/g, ' ');
              return parsedName ? parsedName.substring(0, 128) : undefined;
            }).catch(async (err) => {
              console.warn('[AI] gemini-flash-lite-latest қатесі немесе күту уақыты аяқталды (Timeout), балама модельге ауысамыз:', err.message || err);
              try {
                const fallbackRes = await ai.models.generateContent({
                  model: 'gemini-flash-lite-latest',
                  contents: prompt
                });
                let fallbackName = fallbackRes.text?.trim().replace(/\n/g, ' ');
                return fallbackName ? fallbackName.substring(0, 128) : undefined;
              } catch(fallbackErr) {
                console.error('[AI] Fallback Топик атын генерациялау кезінде қателік:', fallbackErr);
                return undefined;
              }
            });

            if (newName) {
              newName = newName.replace(/[\*_`~#|\[\]()\\-]/g, '').replace(/\s+/g, ' ').trim();
            }

            if (newName) {
              let cleanName = newName;
              let customEmojiId: string | undefined = undefined;

              const parsed = extractEmojiAndText(newName);
              const emojiMap = await getCustomEmojiMap(ctx.telegram);
              const availableEntries = Array.from(emojiMap.entries());

              if (parsed.emoji) {
                let matchedId = emojiMap.get(parsed.emoji);
                
                // Try fallback first if no direct match
                if (!matchedId) {
                  const fallbackEmoji = EMOJI_FALLBACKS[parsed.emoji];
                  if (fallbackEmoji) {
                    matchedId = emojiMap.get(fallbackEmoji);
                  }
                }

                // Егер табылған смайлик бұрыннан соңғы 30 рет қолданылса, әрі басқа қолданылмаған анимациялық смайликтер бар болса:
                // Оны жаңа, еш қайталанбаған біреуіне алмастырамыз.
                if (matchedId && (recentlyUsedEmojiIds.includes(matchedId) || recentlyUsedEmojis.includes(parsed.emoji))) {
                  const unusedAlternative = availableEntries.find(([emojiChar, id]) => {
                    return !recentlyUsedEmojiIds.includes(id) && !recentlyUsedEmojis.includes(emojiChar);
                  });
                  if (unusedAlternative) {
                    console.log(`[Stickers] Emoji ${parsed.emoji} was recently used. Overriding with unused animated emoji character: ${unusedAlternative[0]}`);
                    matchedId = unusedAlternative[1];
                    parsed.emoji = unusedAlternative[0];
                  }
                }

                // Егер әлі де табылмаса, дефолтты анимациялық смайликтің бірін таңдауға мәжбүрлейміз.
                if (!matchedId) {
                  const unusedAlternative = availableEntries.find(([emojiChar, id]) => {
                    return !recentlyUsedEmojiIds.includes(id) && !recentlyUsedEmojis.includes(emojiChar);
                  });
                  if (unusedAlternative) {
                    matchedId = unusedAlternative[1];
                    parsed.emoji = unusedAlternative[0];
                  } else {
                    matchedId = emojiMap.get('📝') || emojiMap.get('❓') || emojiMap.get('🧠') || Array.from(emojiMap.values())[0];
                  }
                }

                customEmojiId = matchedId;
                cleanName = parsed.text || "Тақырып"; // Таза мәтін, смайликсіз
                console.log(`[Stickers] Found match for ${parsed.emoji} -> ID ${matchedId}. Using clean title: "${cleanName}"`);
              } else {
                // Егер тақырыпта мүлдем смайлик табылмаса, бәрібір соңғы қолданылмаған анимациялық смайликтердің бірін таңдауға мәжбүрлейміз
                const unusedAlternative = availableEntries.find(([emojiChar, id]) => {
                  return !recentlyUsedEmojiIds.includes(id) && !recentlyUsedEmojis.includes(emojiChar);
                });
                
                let fallbackId = '';
                let fallbackChar = '';
                if (unusedAlternative) {
                  fallbackId = unusedAlternative[1];
                  fallbackChar = unusedAlternative[0];
                } else {
                  fallbackId = emojiMap.get('🧠') || emojiMap.get('📝') || emojiMap.get('❓') || Array.from(emojiMap.values())[0];
                  fallbackChar = '🧠';
                }
                
                customEmojiId = fallbackId;
                parsed.emoji = fallbackChar;
                cleanName = newName; // Смайликсіз таза атау
                console.log(`[Stickers] No emoji in raw title. Forcing custom emoji ID: ${fallbackId} (${fallbackChar}). Title: "${cleanName}"`);
              }

              const editOptions: any = { name: cleanName };
              if (customEmojiId) {
                editOptions.icon_custom_emoji_id = customEmojiId;
              }

              await ctx.telegram.editForumTopic(chatId, targetThreadId, editOptions);
              console.log(`[AI] Жеке чаттағы Топик аты өзгертілді: "${cleanName}", эмодзи ID: ${customEmojiId || 'none'}`);
              
              if (db) {
                const threadStr = String(targetThreadId);
                await db.collection('users').doc(chatId).collection('topics').doc(threadStr).set({
                  renamed: true,
                  title: cleanName,
                  emoji: parsed.emoji || null,
                  customEmojiId: customEmojiId || null,
                  updatedAt: new Date()
                }, { merge: true });
              }
              renamedTopicsCache.add(tCacheKey);
            }
          } catch(e) {
            console.error('[AI] Топик атын өзгерту кезінде қателік:', e);
          }
        })();
      }

    } catch (error: any) {
      if (error?.message === 'AbortError' || error?.name === 'AbortError') {
         console.log(`[🛑] Message stream aborted for chat ${chatId}`);
         return; // Do nothing, another branch is handling it.
      }
      console.error("[❌] Telegram ботта қателік орын алды:", error);
      const errorStr = String(error?.response?.data || error?.message || error || "");
      console.error("Толық қате сипаттамасы:", errorStr);
      
      const isCreditsError = errorStr.includes("depleted") || errorStr.includes("429") || errorStr.includes("RESOURCE_EXHAUSTED");
      
      // Қателерді өңдеу
      let errorMessage = 'Кешіріңіз, жүйелік қателікке байланысты жауап бере алмаймын.';
      if (isCreditsError) {
        errorMessage = '⚠️ <b>Жүйелік қате (429 Resource Exhausted / Quota):</b>\n\nGoogle Cloud Vertex AI жүйесіндегі сұраныс квотасы таусылды немесе шегіне жетті. Біраз уақыттан соң қайталап көріңіз немесе Google Cloud Console арқылы квотаңызды көбейтіңіз.';
      } else if (errorStr.includes("SAFETY")) {
        errorMessage = 'Кешіріңіз, қауіпсіздік саясатына байланысты бұл сұраққа жауап бере алмаймын. (Safety block)';
      } else if (errorStr.includes("denied access") || errorStr.includes("PERMISSION_DENIED") || errorStr.includes("403")) {
        errorMessage = '⚠️ <b>API Қате (403 Forbidden):</b> Жүйенің API кілтіне (AI Studio немесе Vertex AI) рұқсат берілмей тұр.';
      } else if (errorStr.includes("404") || errorStr.includes("not found")) {
        errorMessage = '⚠️ <b>API Қате (404 Not Found):</b> Қолданыстағы AI моделі табылмады немесе бұл жобаға рұқсат етілмеген.';
      }

      const theDraftId = ctx.message ? ctx.message.message_id : Date.now();
      try {
        await ctx.telegram.sendMessage(chatId, errorMessage, { parse_mode: 'HTML', message_thread_id: targetThreadId } as any);
      } catch (e) {
        console.error("Error sending failure message:", e);
      }
    }
  };

  bot.on('voice', async (ctx: any) => {
    const chatId = String(ctx.chat.id);
    const targetThreadId = ctx.message?.message_thread_id;
    const draftId = ctx.message ? ctx.message.message_id : Math.floor(Math.random() * 100000);

    try {
      // 1. Пайдаланушыға жазу/жүктеу статус жібереміз
      await ctx.telegram.sendChatAction(chatId, 'upload_voice', targetThreadId ? { message_thread_id: targetThreadId } : undefined);
      
      // Бот әрекеті: жағдай статустарының тізіміне дауысты өңдеуді қосу (осылайша жеке жаңа хабарлама ретінде шықпайды)
      await sendRawTelegramApi('sendRichMessageDraft', {
          chat_id: chatId,
          draft_id: draftId,
          message_thread_id: targetThreadId,
          rich_message: { html: `<tg-thinking>${formatStatusMessage('Дыбысты талдау')}</tg-thinking>` }
        });

      // 2. Файл сілтемесін алу
      const fileId = ctx.message.voice.file_id;
      const fileLink = await ctx.telegram.getFileLink(fileId);

      // 3. Файлды жүктеп алу (Buffer ретінде)
      const downloadResponse = await fetch(fileLink.href);
      if (!downloadResponse.ok) {
        throw new Error(`Failed to download audio file from Telegram: ${downloadResponse.statusText}`);
      }
      const arrayBuffer = await downloadResponse.arrayBuffer();
      const audioBuffer = Buffer.from(arrayBuffer);

      // 4. ElevenLabs Scribe v2 арқылы транскрипция жасау
      const transcribedText = await transcribeKazakhVoice(audioBuffer);

      if (!transcribedText || transcribedText.trim().length === 0) {
        await sendRawTelegramApi('sendRichMessageDraft', {
          chat_id: chatId,
          draft_id: draftId,
          message_thread_id: targetThreadId,
          rich_message: { html: '❌ Дауыстан ештеңе түсіне алмадым. Баяу әрі нақтырақ сөйлеп көріңізші.' }
        });
        return;
      }

      // Түзету статусын көрсету
      await sendRawTelegramApi('sendRichMessageDraft', {
          chat_id: chatId,
          draft_id: draftId,
          message_thread_id: targetThreadId,
          rich_message: { html: `<tg-thinking>${formatStatusMessage('Мәтінді түзету')}</tg-thinking>` }
        });

      // 4.5. Gemini арқылы мәтінді түзетіп алу
      const correctedText = await correctTranscribedText(transcribedText);

      // Егер модель түсініксіз текстке нақтылау сұраса (промпт талабына сай), оны бірден пайдаланушыға жібереміз
      if (correctedText.includes('Кешіріңіз') && correctedText.includes('түсіне алмадым') || correctedText.includes('нақтылап')) {
        await sendRawTelegramApi('sendRichMessageDraft', {
            chat_id: chatId,
            draft_id: draftId,
            message_thread_id: targetThreadId,
            rich_message: { html: correctedText }
        });
        return; // RAG-қа жібермейміз
      }

      // 5. RAG ядромызға танылған әрі түзетілген мәтінді бағыттау
      await handleIncomingMessage(ctx, correctedText, true);

    } catch (error: any) {
      console.error('[❌ VOICE TRANSCRIPTION ERROR]:', error);
      await sendRawTelegramApi('sendRichMessageDraft', {
          chat_id: chatId,
          draft_id: draftId,
          message_thread_id: targetThreadId,
          rich_message: { html: '❌ Дауысты өңдеу кезінде қателік кетті. Мәтін түрінде жауып көріңізші.' }
        });
    }
  });

  bot.on('message', async (ctx: any) => {
    await handleIncomingMessage(ctx);
  });

  // Handle edited messages for specific Rewind & Streaming UX
  bot.on('edited_message', async (ctx: any) => {
    const chatId = String(ctx.chat.id);
    const targetThreadId = ctx.editedMessage?.message_thread_id;
    const query = ctx.editedMessage && ('text' in ctx.editedMessage) ? ctx.editedMessage.text : '';

    if (!query) return;
    const draftId = ctx.editedMessage.message_id;

    const streamKey = `${chatId}_${targetThreadId || 'general'}`;
    
    // 1. Ағынды тоқтату (егер осы чатта жауап жазылып жатса)
    const existingStream = ongoingStreams.get(streamKey);
    if (existingStream) {
      console.log(`[🛑] Aborting ongoing stream for edited message in chat ${chatId}`);
      existingStream.abort();
      ongoingStreams.delete(streamKey);
    }

    // 2. Бұған дейінгі контекстті дерекқордан тазарту (Rewind History)
    const rewindResult = await rewindHistory(chatId, targetThreadId, draftId, query);
    const deletedMsgIds = rewindResult.deletedMsgIds;
    const skipUserSave = rewindResult.updatedUserQuery;
    let botMsgId = userToBotMsgMap.get(draftId.toString());
    if (!botMsgId && db) {
       try {
          const threadStr = (targetThreadId !== undefined && targetThreadId !== null) ? String(targetThreadId) : 'general';
          const snap = await db.collection('users').doc(chatId).collection('topics').doc(threadStr).collection('messages')
              .where('replyToMsgId', '==', draftId).where('role', '==', 'bot').limit(1).get();
          if (!snap.empty) {
             botMsgId = snap.docs[0].data().msgId;
             if (botMsgId) userToBotMsgMap.set(draftId.toString(), botMsgId);
          }
       } catch(e) {}
    }

    // Телеграмнан артық хаттарды өшіру (Mass Delete)
    const validIdsToDelete = deletedMsgIds.filter(mId => mId !== draftId && mId !== botMsgId);
    if (validIdsToDelete.length > 0) {
       for (let i = 0; i < validIdsToDelete.length; i += 100) {
          const chunk = validIdsToDelete.slice(i, i + 100);
          try {
             await ctx.telegram.callApi('deleteMessages', { chat_id: chatId, message_ids: chunk });
             console.log(`[✅] Deleted ${chunk.length} messages in bulk`);
          } catch(e) {
             console.log(`[⚠️] Could not bulk delete messages from Telegram:`, e);
          }
       }
    }

    // 3. Ескі бот жауабын тауып, оны өшіру және жаңа хабарлама ретінде стримингті бастау
    let currentBotMsgId = botMsgId;

    if (currentBotMsgId) {
       try {
           await ctx.telegram.deleteMessage(chatId, currentBotMsgId);
           console.log(`[🗑️] Deleted previous bot response message ${currentBotMsgId} to send a fresh one`);
       } catch(e) {
           console.warn("[⚠️] Could not delete previous bot message:", e);
       }
       currentBotMsgId = undefined; // Force sending a new message with three dots animation and no reply, as per User's request
    }

    const abortController = new AbortController();
    ongoingStreams.set(streamKey, abortController);

    try {
      let isAgentThinking = true;
      let currentActionStatus = 'typing';
      const sendTypingStatus = async () => {
        try {
          if (isAgentThinking && !abortController.signal.aborted) {
            await ctx.telegram.sendChatAction(chatId, currentActionStatus as 'typing' | 'choose_sticker', targetThreadId ? { message_thread_id: targetThreadId } : undefined);
          }
        } catch (e) {}
      };
      
      const typingInterval = setInterval(sendTypingStatus, 4000);
      sendTypingStatus();

      const lang = ctx.from?.language_code;
      const threadStr = (targetThreadId !== undefined && targetThreadId !== null) ? String(targetThreadId) : 'general';

      const draftUpdater = createThrottledUpdater(async (currentFullText) => {
        if (abortController.signal.aborted) return;
        const formatted = formatTelegramMessage(currentFullText);
        try {
          if (formatted.length > 4000) return;
          if (currentBotMsgId) {
             await sendRawTelegramApi('editMessageText', { chat_id: chatId, message_id: currentBotMsgId, rich_message: { html: formatted }, disable_web_page_preview: true, link_preview_options: { is_disabled: true } });
          } else {
             await sendRawTelegramApi('sendRichMessageDraft', { chat_id: chatId, draft_id: draftId, message_thread_id: targetThreadId, rich_message: { html: formatted } });
          }
        } catch(e) {}
      }, 1200);

      const answerData = await generateAgentAnswerStream(
        chatId,
        query,
        (currentFullText) => {
          draftUpdater.update(currentFullText);
        },
        async (statusText) => {
          if (abortController.signal.aborted) return;
          if (statusText.includes('іздеу') || statusText.includes('қарастырудамын')) {
             currentActionStatus = 'choose_sticker';
          } else {
             currentActionStatus = 'typing';
          }
          try {
            const txt = formatStatusMessage(statusText);
            if (currentBotMsgId) {
               await ctx.telegram.editMessageText(chatId, currentBotMsgId, undefined, `<tg-thinking>${txt}</tg-thinking>`, { parse_mode: 'HTML', disable_web_page_preview: true, link_preview_options: { is_disabled: true } });
            } else {
               await sendRawTelegramApi('sendRichMessageDraft', {
                 chat_id: chatId,
                 draft_id: draftId,
                 message_thread_id: targetThreadId,
                 rich_message: { html: `<tg-thinking>${txt}</tg-thinking>` }
               });
            }
          } catch (e) {}
        },
        targetThreadId,
        lang,
        abortController.signal,
        true
      );

      await draftUpdater.flush();

      isAgentThinking = false;
      clearInterval(typingInterval);
      ongoingStreams.delete(streamKey);

      let relevantSources: any[] = [];
      if (answerData.sources && answerData.sources.length > 0) {
        relevantSources = filterSourcesByResponse(answerData.sources, answerData.answer);
      }
      
      let cachedAnswerToUse = answerData.answer;
      let originalQuery = query;
      const cacheKey = `${chatId}_${threadStr}`;
      
      if (isAskingForProof(query)) {
        const cachedData = pendingSourcesCache.get(cacheKey);
        if (cachedData) {
          if (cachedData.answer) cachedAnswerToUse = cachedData.answer;
          if (cachedData.query) originalQuery = cachedData.query;
          if (!relevantSources || relevantSources.length === 0) {
            if (cachedData.sources && cachedData.sources.length > 0) {
              relevantSources = cachedData.sources;
            }
          }
        }
      } else {
        const sourcesToCache = (relevantSources && relevantSources.length > 0) ? relevantSources : (answerData.sources || []);
        pendingSourcesCache.set(cacheKey, { sources: sourcesToCache, answer: answerData.answer, query: query });
      }

      let quranSources: any[] = [];
      let bookSources: any[] = [];
      let inlineKeyboard: any = null;
      if (relevantSources && relevantSources.length > 0) {
        const processed = processAndDeduplicateSources(relevantSources, cachedAnswerToUse);
        quranSources = processed.quranSources;
        bookSources = processed.bookSources;
        if (quranSources.length > 0 || bookSources.length > 0) {
          const pagId = uuidv4().substring(0, 8);
          paginationCache.set(pagId, { quranSources, bookSources, quranPageIndex: 0, query: originalQuery });
          inlineKeyboard = buildKeyboard(quranSources, bookSources, 0, pagId, originalQuery);
        }
      }

      const extraOptions: any = { disable_web_page_preview: true, link_preview_options: { is_disabled: true } };
      
      const lf = answerData.answer.toLowerCase();
      if (lf.includes('мүбәрак') || lf.includes('мубарак') || lf.includes('айт қабыл болсын') || lf.includes('айт кабыл болсын') || lf.includes('қабыл етсін')) {
         extraOptions.message_effect_id = "5046509860389126442";
      }

      if (inlineKeyboard) Object.assign(extraOptions, inlineKeyboard);

      const txt = formatTelegramMessage(answerData.answer, quranSources);

      let botSentMsg: any = null;
      try {
         if (currentBotMsgId) {
             botSentMsg = await sendRawTelegramApi('editMessageText', {
                 chat_id: chatId,
                 message_id: currentBotMsgId,
                 rich_message: { html: txt },
                 ...extraOptions
             });
         } else {
             if (draftId && !currentBotMsgId) extraOptions.reply_parameters = { message_id: draftId };
             if (targetThreadId) extraOptions.message_thread_id = targetThreadId;
             botSentMsg = await sendRawTelegramApi('sendRichMessage', {
                 chat_id: chatId,
                 rich_message: { html: txt },
                 ...extraOptions
             });
         }
      } catch(e) {
         console.error(`[⚠️] submit rich message error:`, e);
         const pOpts = { ...extraOptions };
         delete pOpts.reply_parameters;
         const pText = txt.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>?/gm, '');
         if (currentBotMsgId) {
             botSentMsg = await ctx.telegram.editMessageText(chatId, currentBotMsgId, undefined, pText, pOpts);
         } else {
             botSentMsg = await ctx.telegram.sendMessage(chatId, pText, pOpts);
         }
      }

      if (botSentMsg && botSentMsg !== true) {
          userToBotMsgMap.set(draftId.toString(), botSentMsg.message_id);
          if (!skipUserSave) saveToChatHistory(chatId, 'user', query, targetThreadId, draftId).catch(()=>{});
          saveToChatHistory(chatId, 'bot', answerData.answer, targetThreadId, botSentMsg.message_id, draftId).catch(()=>{});
      } else if (currentBotMsgId) {
          if (!skipUserSave) saveToChatHistory(chatId, 'user', query, targetThreadId, draftId).catch(()=>{});
          saveToChatHistory(chatId, 'bot', answerData.answer, targetThreadId, currentBotMsgId, draftId).catch(()=>{});
      }

    } catch (err: any) {
        if (err?.message === 'AbortError' || err?.name === 'AbortError') {
           console.log(`[🛑] Edited message stream aborted for chat ${chatId}`);
           return;
        }
        console.error("[❌] Error processing edited message:", err);
    }
  });

  setupActionHandlers(bot);

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
