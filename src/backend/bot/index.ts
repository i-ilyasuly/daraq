import { formatTelegramMessage, transliterateToLatin, filterSourcesByResponse, isAskingForProof } from './formatters';
import { Telegraf, Markup } from 'telegraf';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import { Storage } from '@google-cloud/storage';
import { storage as customStorage } from '../storage';
import { searchAnswers } from '../rag/searchService';
import { generateAgentAnswerStream, saveToChatHistory, rewindHistory } from '../rag/aiService';
import { ai } from '../rag/aiClient';
import { db } from '../db/firestore';
import { getVoiceResponse } from '../rag/voiceAgent';

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

export function processAndDeduplicateSources(rawSources: any[], answerText?: string): { quranSources: any[]; bookSources: any[] } {
  if (!rawSources || rawSources.length === 0) {
    return { quranSources: [], bookSources: [] };
  }

  const quranSources: any[] = [];
  const bookSources: any[] = [];

  const seenQuran = new Set<string>();
  const seenBook = new Set<string>();

  for (const src of rawSources) {
    if (!src) continue;

    const isQuran = src.isQuran || 
                    (src.book && src.book.endsWith('сүресі')) || 
                    (src.url && src.url.toLowerCase().includes('quran.com'));

    if (isQuran) {
      const key = src.url || `${src.book}_${src.page}`;
      if (!seenQuran.has(key)) {
        seenQuran.add(key);
        quranSources.push({
          book: src.book,
          page: src.page || 1,
          url: src.url || 'https://quran.com',
          isQuran: true,
          text: src.text || ""
        });
      }
    } else {
      const chunkPages = src.pages && Array.isArray(src.pages) ? src.pages.map(Number) : [src.page || 1];
      const key = `${src.book}_${chunkPages.join('_')}`;
      if (!seenBook.has(key)) {
        seenBook.add(key);
        
        bookSources.push({
          book: src.book,
          page: chunkPages[0] || 1,
          pages: chunkPages,
          imageUrl: src.imageUrl || "",
          text: src.text || "",
          score: src.score || 0
        });
      }
    }
  }

  // Sort book sources by score descending to keep top scores first
  bookSources.sort((a, b) => (b.score || 0) - (a.score || 0));

  return { quranSources, bookSources };
}

export function buildKeyboard(quranSources: any[], bookSources: any[], quranPageIndex: number, pagId: string, query?: string): any {
  const buttons: any[][] = [];

  // Sort and identify the Top-2 highest scoring book chunks
  const sortedBookSources = [...(bookSources || [])].sort((a, b) => (b.score || 0) - (a.score || 0));

  // 1. Дәлел суреттері (діни кітап беттері) – әрқашан міндетті түрде жоғарыда
  if (bookSources && bookSources.length > 0) {
    if (bookSources.length === 1) {
      const src = bookSources[0];
      const pages = src.pages && Array.isArray(src.pages) ? src.pages : [src.page || 1];
      
      if (src.imageUrl || src.book) {
        if (pages.length <= 1) {
          const btnLabel = `🖼 Дәлел суретті көру (${src.page}-бет)`;
          
          // Find existing or create unique sourceId
          let sourceId = '';
          for (const [key, val] of sourceCache.entries()) {
            if (val.book === src.book && val.page === src.page) {
              sourceId = key;
              break;
            }
          }
          if (!sourceId) {
            sourceId = uuidv4().substring(0, 8);
            setSourceInfo(sourceId, {
              book: src.book,
              page: src.page,
              pages: pages,
              imageUrl: src.imageUrl || "",
              query: query
            });
          }
          
          buttons.push([Markup.button.callback(btnLabel, `view_source_${sourceId}`)]);
        } else {
          // If 2 or more pages, it becomes a group button!
          const groupId = uuidv4().substring(0, 8);
          // Wait! Let's build GCS and image naming helper for GCS paths dynamically
          const sourcesList = pages.map((p: number) => ({
            book: src.book,
            page: p,
            imageUrl: src.imageUrl || "",
            query: query
          }));
          setGroupInfo(groupId, sourcesList);

          const btnLabel = `🖼 Барлық дәлел суреттерін көру (${pages.length} сурет)`;
          buttons.push([Markup.button.callback(btnLabel, `view_srcgrp_${groupId}`)]);
        }
      }
    } else {
      // Multiple chunks! Let's collect all unique book/page combinations across all chunks
      const allPages: { book: string; page: number; imageUrl: string; query?: string }[] = [];
      const seen = new Set<string>();
      
      for (const src of sortedBookSources) {
        const pages = src.pages && Array.isArray(src.pages) ? src.pages : [src.page || 1];
        for (const p of pages) {
          const key = `${src.book}_${p}`;
          if (!seen.has(key)) {
            seen.add(key);
            allPages.push({
              book: src.book,
              page: p,
              imageUrl: src.imageUrl || "",
              query: query
            });
          }
        }
      }

      if (allPages.length === 1) {
        const item = allPages[0];
        const btnLabel = `🖼 Дәлел суретті көру (${item.page}-бет)`;
        
        let sourceId = '';
        for (const [key, val] of sourceCache.entries()) {
          if (val.book === item.book && val.page === item.page) {
            sourceId = key;
            break;
          }
        }
        if (!sourceId) {
          sourceId = uuidv4().substring(0, 8);
          setSourceInfo(sourceId, {
            book: item.book,
            page: item.page,
            pages: [item.page],
            imageUrl: item.imageUrl || "",
            query: query
          });
        }
        buttons.push([Markup.button.callback(btnLabel, `view_source_${sourceId}`)]);
      } else {
        const groupId = uuidv4().substring(0, 8);
        setGroupInfo(groupId, allPages);

        const btnLabel = `🖼 Барлық дәлел суреттерін көру (${allPages.length} сурет)`;
        buttons.push([Markup.button.callback(btnLabel, `view_srcgrp_${groupId}`)]);
      }
    }
  }

  // Дауыстық жауап батырмасын қосу
  buttons.push([Markup.button.callback('🎤 Дыбыстық жауап', 'voice_resp')]);

  if (buttons.length === 0) return null;
  return Markup.inlineKeyboard(buttons);
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
      await ctx.reply('⏳ "Ораза" және "Намаз" темаларын құру басталуда...');
      
      const emojiMap = await getCustomEmojiMap(ctx.telegram);
      
      // Намаз (Mosque icon fallback to house if not exists)
      let namazEmojiId = emojiMap.get('🕌');
      if (!namazEmojiId) namazEmojiId = emojiMap.get('🏠');
      
      // Ораза (Moon fallback to star if not exists)
      let orazaEmojiId = emojiMap.get('🌙');
      if (!orazaEmojiId) orazaEmojiId = emojiMap.get('⭐️');

      // Намаз тақырыбы
      const namazTopic = await ctx.telegram.createForumTopic(
        chatId, 
        namazEmojiId ? 'Намаз' : '🕌 Намаз', 
        namazEmojiId ? { icon_custom_emoji_id: namazEmojiId } : undefined
      );

      // Ораза тақырыбы
      const orazaTopic = await ctx.telegram.createForumTopic(
        chatId, 
        orazaEmojiId ? 'Ораза' : '🌙 Ораза', 
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
      const brainId = emojiMap.get('🧠');
      const topic = await ctx.telegram.createForumTopic(
        chatId, 
        brainId ? 'Жаңа тақырып' : '🧠 Жаңа тақырып',
        brainId ? { icon_custom_emoji_id: brainId } : undefined
      );
      await ctx.reply(`✅ Жаңа топик құрылды! Thread ID: ${topic.message_thread_id}. Енді сол жерге жазыңыз.`);
    } catch (e: any) {
      await ctx.reply(`❌ Жаңа топик құру мүмкін болмады: ${e.message}`);
    }
  });

  const handleIncomingMessage = async (ctx: any, customQuery?: string) => {
    const chatId = String(ctx.chat.id);
    const targetThreadId = ctx.message?.message_thread_id;
    const query = customQuery || (ctx.message && ('text' in ctx.message) ? ctx.message.text : '');

    if (!query) return;

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
        await ctx.telegram.callApi('sendMessageDraft', {
          chat_id: chatId,
          draft_id: draftId,
          message_thread_id: targetThreadId,
          text: '⏳ <i>Ойланып жатырмын...</i>',
          parse_mode: 'HTML'
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

      const answerData = await generateAgentAnswerStream(
        chatId,
        query,
        async (currentFullText) => {
          if (abortController.signal.aborted) return;
          const formatted = formatTelegramMessage(currentFullText);
          try {
            await ctx.telegram.callApi('sendMessageDraft', {
              chat_id: chatId,
              draft_id: draftId,
              message_thread_id: targetThreadId,
              text: formatted,
              parse_mode: 'HTML'
            });
          } catch(e) {}
        },
        async (statusText) => {
          if (abortController.signal.aborted) return;
          if (statusText.includes('іздеу') || statusText.includes('қарастырудамын')) {
             currentActionStatus = 'choose_sticker';
          } else {
             currentActionStatus = 'typing';
          }
          try {
            await ctx.telegram.callApi('sendMessageDraft', {
              chat_id: chatId,
              draft_id: draftId,
              message_thread_id: targetThreadId,
              text: `⏳ ${statusText}`,
              parse_mode: 'HTML'
            });
          } catch (e) {}
        },
        targetThreadId,
        lang,
        abortController.signal,
        true // skip internal history saving, we do it here!
      );

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
            cachedAnswerToUse = cachedData.answer; // Prioritize original factual answer for perfect highlight overlap
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

      let finalMessage = formatTelegramMessage(answerData.answer, quranSources);

      const extraOptions: any = { 
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        link_preview_options: { is_disabled: true }
      };

      // Нақты сөйлемнен дәйексөз келтіру (Quote in Reply Parameters) алынып тасталды (UX Visual Bug fix)
      if (ctx.message && ctx.message.message_id) {
        extraOptions.reply_parameters = {
          message_id: ctx.message.message_id
        };
      }

      if (targetThreadId) {
        extraOptions.message_thread_id = targetThreadId;
      }

      if (inlineKeyboard) {
        Object.assign(extraOptions, inlineKeyboard);
      }

      // 7. Message Effects (Мерекелік Хабарлама Эффектілері — API 7.3+)
      const lf = finalMessage.toLowerCase();
      if (
         lf.includes('мүбәрак') || 
         lf.includes('мубарак') || 
         lf.includes('айт қабыл болсын') || 
         lf.includes('айт кабыл болсын') ||
         lf.includes('благословенн') ||
         lf.includes('қабыл етсін')
      ) {
         extraOptions.message_effect_id = "5046509860389126442"; // 🎉 Конфетти (Confetti effect)
      }

      // Финалдық хабарламаны жібереміз
      let botSentMsg: any = null;
      try {
        botSentMsg = await ctx.telegram.sendMessage(chatId, finalMessage, extraOptions);
      } catch (replyError) {
        console.error("[⚠️] HTML форматымен жіберу қатесі, таза мәтін жіберілуде:", replyError);
        const plainText = finalMessage.replace(/<[^>]*>?/gm, '');
        const plainOptions: any = { ...extraOptions };
        delete plainOptions.parse_mode;
        if (inlineKeyboard) Object.assign(plainOptions, inlineKeyboard);
        botSentMsg = await ctx.telegram.sendMessage(chatId, plainText, plainOptions);
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
            }

            console.log(`[Rename Check] Proceeding to generate premium Big Tech name for thread/topic ${targetThreadId}...`);

            const prompt = `Сен — Telegram тақырыптарының атауын жасайтын кәсіби редакторсың. 
Мына сұрақ пен жауапты талдап, олардың негізгі тақырыбын Big Tech (ChatGPT, Claude) стандарттарына 100% сай келетіндей етіп жаса.

ҚАТАҢ ЕРЕЖЕЛЕР:
1. ҰЗЫНДЫҒЫ: Атау қатаң түрде тек 2-3 сөзден ғана тұруы керек.
2. ФОРМАТЫ: Сұраулы сөйлем немесе етістік қолданба. Тек зат есіммен немесе атау тұлғасында жаз (мысалы: "Ораза ұстау тәртібі" немесе "Сапардағы намаз").
3. ТАЗАЛЫҚ: Ешқандай тырнақша, нүкте, үтір, сұрақ белгісін қолданба.
4. ДИЗАЙН: Тақырып атауының ең басына тақырыпқа сәйкес келетін ТЕК 1 эмодзи қос (мысалы: 📚, 🚗, 💡, 📝). Егер тақырыпқа сай PREMIUM иконка таппасаң, жай ғана тақырыпқа сай эмодзи қой, жүйе өзі реттейді.
5. ТІЛ: Тек қазақ тілінде жаз.

ҮЛГІ (Few-Shot Examples):
- Пайдаланушы: "Жолаушымын, намаз не болады?" -> 🚗 Сапардағы намаз
- Пайдаланушы: "Вейп шегу харам ба?" -> 🚭 Вейп үкімі
- Пайдаланушы: "Ораза ұстағанда тіс тазалауға бола ма?" -> 🪥 Ораза және мисуак
- Пайдаланушы: "Саудада ақшаны қалай өсімсіз аламыз?" -> 💼 Халал сауда ережесі

Сұрақ: "${query}"
Жауап: "${finalMessage}"`;
            
            const aiPromise = ai.models.generateContent({
              model: 'gemini-3.1-flash-lite',
              contents: prompt
            });
            
            const timeoutPromise = new Promise<any>((_, reject) => 
               setTimeout(() => reject(new Error("Timeout generation: Model is hanging")), 3000)
            );

            let newName = await Promise.race([aiPromise, timeoutPromise]).then(res => {
              let parsedName = res.text?.trim().replace(/\n/g, ' ');
              return parsedName ? parsedName.substring(0, 128) : undefined;
            }).catch(async (err) => {
              console.warn('[AI] gemini-3.1-flash-lite қатесі немесе күту уақыты аяқталды (Timeout), балама модельге ауысамыз:', err.message || err);
              try {
                const fallbackRes = await ai.models.generateContent({
                  model: 'gemini-3.1-flash-lite',
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
              if (parsed.emoji) {
                const emojiMap = await getCustomEmojiMap(ctx.telegram);
                let matchedId = emojiMap.get(parsed.emoji);
                
                // Try fallback first if no direct match
                if (!matchedId) {
                  const fallbackEmoji = EMOJI_FALLBACKS[parsed.emoji];
                  if (fallbackEmoji) {
                    matchedId = emojiMap.get(fallbackEmoji);
                  }
                }

                if (matchedId) {
                  // Option 3 Path A: Valid Icon found
                  // Use the ID for the icon and CLEAN text for the name
                  customEmojiId = matchedId;
                  cleanName = parsed.text || "Тақырып"; // Ensure text is not empty
                  console.log(`[Stickers] Found match for ${parsed.emoji} -> ID ${matchedId}. Using clean title: "${cleanName}"`);
                } else {
                  // Option 3 Path B: No valid icon for this emoji
                  // Keep the emoji in the text title, icon will remain default
                  cleanName = newName;
                  customEmojiId = undefined;
                  console.log(`[Stickers] No match for ${parsed.emoji}. Keeping emoji in text: "${cleanName}"`);
                }
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
      if (error?.message === 'AbortError') {
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
      }

      const theDraftId = ctx.message ? ctx.message.message_id : Date.now();
      try {
        await ctx.telegram.sendMessage(chatId, errorMessage, { parse_mode: 'HTML', message_thread_id: targetThreadId } as any);
      } catch (e) {
        console.error("Error sending failure message:", e);
      }
    }
  };

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

    // 3. Ескі бот жауабын тауып, стримингті бастау
    let currentBotMsgId = botMsgId;

    if (currentBotMsgId) {
       try {
           await ctx.telegram.editMessageText(chatId, currentBotMsgId, undefined, '⏳ <i>Сұрақ өзгертілді, жаңа жауап дайындалуда...</i>', { parse_mode: 'HTML' });
       } catch(e) {
           console.warn("[⚠️] Could not edit previous bot message:", e);
           currentBotMsgId = undefined; // Fallback to new message
       }
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

      const answerData = await generateAgentAnswerStream(
        chatId,
        query,
        async (currentFullText) => {
          if (abortController.signal.aborted) return;
          const formatted = formatTelegramMessage(currentFullText);
          try {
            if (currentBotMsgId) {
               await ctx.telegram.editMessageText(chatId, currentBotMsgId, undefined, formatted, { parse_mode: 'HTML' });
            } else {
               await ctx.telegram.callApi('sendMessageDraft', { chat_id: chatId, draft_id: draftId, message_thread_id: targetThreadId, text: formatted, parse_mode: 'HTML' });
            }
          } catch(e) {}
        },
        async (statusText) => {
          if (abortController.signal.aborted) return;
          if (statusText.includes('іздеу') || statusText.includes('қарастырудамын')) {
             currentActionStatus = 'choose_sticker';
          } else {
             currentActionStatus = 'typing';
          }
          try {
            const txt = `⏳ ${statusText}`;
            if (currentBotMsgId) {
               await ctx.telegram.editMessageText(chatId, currentBotMsgId, undefined, txt, { parse_mode: 'HTML' });
            } else {
               await ctx.telegram.callApi('sendMessageDraft', { chat_id: chatId, draft_id: draftId, message_thread_id: targetThreadId, text: txt, parse_mode: 'HTML' });
            }
          } catch (e) {}
        },
        targetThreadId,
        lang,
        abortController.signal,
        true
      );

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

      let finalMessage = formatTelegramMessage(answerData.answer, quranSources);

      const extraOptions: any = { parse_mode: 'HTML', disable_web_page_preview: true, link_preview_options: { is_disabled: true } };
      if (inlineKeyboard) Object.assign(extraOptions, inlineKeyboard);
      
      const lf = finalMessage.toLowerCase();
      if (lf.includes('мүбәрак') || lf.includes('мубарак') || lf.includes('айт қабыл болсын') || lf.includes('айт кабыл болсын') || lf.includes('қабыл етсін')) {
         extraOptions.message_effect_id = "5046509860389126442";
      }

      let botSentMsg: any = null;
      try {
        if (currentBotMsgId) {
           botSentMsg = await ctx.telegram.editMessageText(chatId, currentBotMsgId, undefined, finalMessage, extraOptions);
        } else {
           extraOptions.reply_parameters = { message_id: draftId };
           if (targetThreadId) extraOptions.message_thread_id = targetThreadId;
           botSentMsg = await ctx.telegram.sendMessage(chatId, finalMessage, extraOptions);
        }
      } catch (replyError: any) {
        try {
            const plainText = finalMessage.replace(/<[^>]*>?/gm, '');
            const plainOptions: any = { ...extraOptions };
            delete plainOptions.parse_mode;
            if (inlineKeyboard) Object.assign(plainOptions, inlineKeyboard);
            if (currentBotMsgId) {
                botSentMsg = await ctx.telegram.editMessageText(chatId, currentBotMsgId, undefined, plainText, plainOptions);
            } else {
                botSentMsg = await ctx.telegram.sendMessage(chatId, plainText, plainOptions);
            }
        } catch(e) {}
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
        if (err?.message === 'AbortError') {
           console.log(`[🛑] Edited message stream aborted for chat ${chatId}`);
           return;
        }
        console.error("[❌] Error processing edited message:", err);
    }
  });

  bot.action('voice_resp', async (ctx) => {
    try {
      try {
        await ctx.answerCbQuery("⏳ Дыбыс жасалуда...", { show_alert: false });
      } catch (e) {
        console.warn("[VoiceAgent] Ignore answerCbQuery error:", e);
      }

      if (!ctx.callbackQuery.message) {
        throw new Error("No message attached to callback query.");
      }

      const msg = ctx.callbackQuery.message as any;
      const messageId = msg.message_id;
      const originalText = msg.text || msg.caption || "";

      if (!originalText) {
        return ctx.reply("❌ Кешіріңіз, дыбыстауға арналған мәтін табылмады.");
      }

      await ctx.telegram.sendChatAction(ctx.chat!.id, 'record_voice', { message_thread_id: ctx.callbackQuery.message.message_thread_id });

      const { audioBuffer } = await getVoiceResponse(messageId, originalText);

      await ctx.telegram.sendVoice(ctx.chat!.id, { source: audioBuffer, filename: 'voice.ogg' }, { 
        reply_parameters: { message_id: messageId },
        message_thread_id: ctx.callbackQuery.message.message_thread_id
      });

    } catch (error: any) {
      console.error("[VoiceAgent] Error generating voice response:", error, error.response?.data || "");
      let errorMessage = "❌ Дыбыс қызметі уақытша қолжетімді емес.";
      if (error?.status === 429 || error?.message?.includes("429") || error?.message?.includes("quota")) {
        errorMessage = "❌ Дыбыстау қызметінің лимиті таусылды. Біраз уақыттан соң қайталап көріңіз.";
      } else {
        errorMessage += ` (Қате: ${error.message})`;
      }
      
      await ctx.reply(errorMessage, { 
        reply_parameters: { message_id: ctx.callbackQuery?.message?.message_id } 
      }).catch(e => console.error("Error sending failure reply:", e));
    }
  });

  // 4. "noop" батырмасын ұстап алу (бос батырма, ештеңе істемейді, тек күтуді өшіреді)
  bot.action('noop', async (ctx) => {
    try {
      await ctx.answerCbQuery();
    } catch (e) {}
  });

  // 5. Құран пагинациясын басқару
  bot.action(/pag_quran_(.+)_(.+)/, async (ctx) => {
    try {
      const pagId = ctx.match[1];
      const newPageIdx = parseInt(ctx.match[2], 10);

      const state = paginationCache.get(pagId);
      if (!state) {
        await ctx.answerCbQuery('Кешіріңіз, бұл батырманың мерзімі өтіп кеткен.', { show_alert: true });
        return;
      }

      state.quranPageIndex = newPageIdx;
      paginationCache.set(pagId, state);

      const inlineKeyboard = buildKeyboard(state.quranSources, state.bookSources, newPageIdx, pagId);

      await ctx.answerCbQuery();
      if (inlineKeyboard) {
        await ctx.editMessageReplyMarkup(inlineKeyboard.reply_markup);
      }
    } catch (error) {
      console.error("[❌] Құран пагинациясы кезінде қате орын алды:", error);
    }
  });

  // 6. "🖼 Дәлел суретті көру" батырмасын ұстап алу
  bot.action(/view_source_(.+)/, async (ctx) => {
    try {
      const sourceId = ctx.match[1];
      const sourceInfo = await getSourceInfo(sourceId);

      if (!sourceInfo) {
        await ctx.answerCbQuery('Кешіріңіз, дәлел суреті табылмады немесе ескірген.', { show_alert: true });
        return;
      }

      await ctx.answerCbQuery('Суреттер дайындалуда...');
      
      const chatId = String(ctx.chat?.id || '');
      const targetThreadId = (ctx.callbackQuery?.message as any)?.message_thread_id;
      
      let isWorking = true;
      const sendPhotoStatus = async () => {
        try {
          if (isWorking) {
            await ctx.telegram.sendChatAction(chatId, 'upload_photo', targetThreadId ? { message_thread_id: targetThreadId } : undefined);
          }
        } catch (e) {}
      };
      
      const statusInterval = setInterval(sendPhotoStatus, 4000);
      sendPhotoStatus();

      try {
        // Кросс-бет (Cross-Page) мәселесін анықтау
        const pageList = sourceInfo.pages && sourceInfo.pages.length > 0 
          ? sourceInfo.pages 
          : [sourceInfo.page];

        const cacheKey = `${sourceInfo.book}_${pageList.join(',')}`;
        if (sourceUploadCache.has(cacheKey)) {
           const cached = sourceUploadCache.get(cacheKey)!;
           try {
             if (cached.messageIds.length === 1) {
               await ctx.telegram.callApi('copyMessage', {
                 chat_id: chatId,
                 from_chat_id: cached.chatId,
                 message_id: cached.messageIds[0],
                 message_thread_id: targetThreadId
               });
             } else {
               await ctx.telegram.callApi('copyMessages', {
                 chat_id: chatId,
                 from_chat_id: cached.chatId,
                 message_ids: cached.messageIds,
                 message_thread_id: targetThreadId
               });
             }
             isWorking = false;
             clearInterval(statusInterval);
             return;
           } catch (e) {
             console.log("[⚠️] Failed to copy cached target, falling back to re-upload", e);
             sourceUploadCache.delete(cacheKey);
           }
        }

      if (pageList.length <= 1) {
        // Бір ғана бет болса, әдеттегідей жалғыз сурет ретінде жібереміз
        const imageBuffer = await addWatermark(sourceInfo.imageUrl, sourceInfo.book, pageList[0]);
        const sentMsg = await ctx.replyWithPhoto({ source: imageBuffer }, { caption: `📖 ${sourceInfo.book}, ${pageList[0]}-бет` });
        sourceUploadCache.set(cacheKey, { chatId, messageIds: [sentMsg.message_id] });
      } else {
        // Екі немесе одан да көп бет болса (Cross-Page), оларды альбом (MediaGroup) ретінде жібереміз
        console.log(`[📚 CROSS-PAGE] Processing ${pageList.length} pages for ${sourceInfo.book}: [${pageList.join(', ')}]`);
        const results = await Promise.all(
          pageList.map(async (pNum) => {
            try {
              // Сурет сілтемесіндегі "page_X.png"-ді тиісті бетке өзгертеміз
              let pageUrl = sourceInfo.imageUrl || "";
              if (pageUrl) {
                pageUrl = pageUrl.replace(/page_\d+\.png/g, `page_${pNum}.png`);
              }
              const buffer = await addWatermark(pageUrl, sourceInfo.book, pNum);
              return { buffer, pageNum: pNum };
            } catch (err) {
              console.error(`[❌] Бетті өңдеу қатесі (${sourceInfo.book}, бет ${pNum}):`, err);
              return null;
            }
          })
        );

        const validResults = results.filter((r): r is { buffer: Buffer; pageNum: number } => r !== null);

        if (validResults.length === 0) {
          await ctx.reply('Кешіріңіз, ешқандай дәлел суретін дайындау мүмкін болмады.');
          return;
        }

        const media = validResults.map(res => ({
          type: 'photo' as const,
          media: { source: res.buffer },
          caption: `📖 ${sourceInfo.book}, ${res.pageNum}-бет`
        }));

        const sentMsgs = await ctx.replyWithMediaGroup(media);
        if (Array.isArray(sentMsgs)) {
          sourceUploadCache.set(cacheKey, { chatId, messageIds: sentMsgs.map(m => m.message_id) });
        }
      }

      } catch (error) {
        console.error("[❌] Суретті жүктеу немесе альбом жасау кезінде қате:", error);
        await ctx.answerCbQuery('Суретті ашу кезінде қателік кетті.', { show_alert: true });
      } finally {
        isWorking = false;
        clearInterval(statusInterval);
      }
    } catch (error) {
      console.error("[❌] Әрекетті өңдеу қатесі:", error);
    }
  });

  // 7. Бірнеше дәлел суретін бірге (Media Group) жіберетін батырманы ұстап алу
  bot.action(/view_srcgrp_(.+)/, async (ctx) => {
    try {
      const groupId = ctx.match[1];
      const sources = await getGroupInfo(groupId);

      if (!sources || sources.length === 0) {
        await ctx.answerCbQuery('Кешіріңіз, дәлел суреттері табылмады немесе ескірген.', { show_alert: true });
        return;
      }

      await ctx.answerCbQuery('Дәлел суреттері дайындалуда...');

      const chatId = String(ctx.chat?.id || '');
      const targetThreadId = (ctx.callbackQuery?.message as any)?.message_thread_id;
      
      let isWorking = true;
      const sendPhotoStatus = async () => {
        try {
          if (isWorking) {
            await ctx.telegram.sendChatAction(chatId, 'upload_photo', targetThreadId ? { message_thread_id: targetThreadId } : undefined);
          }
        } catch (e) {}
      };
      
      const statusInterval = setInterval(sendPhotoStatus, 4000);
      sendPhotoStatus();

      try {
        const cacheKey = `grp_${groupId}`;
        if (sourceUploadCache.has(cacheKey)) {
           const cached = sourceUploadCache.get(cacheKey)!;
           try {
             if (cached.messageIds.length === 1) {
               await ctx.telegram.callApi('copyMessage', {
                 chat_id: chatId,
                 from_chat_id: cached.chatId,
                 message_id: cached.messageIds[0],
                 message_thread_id: targetThreadId
               });
             } else {
               await ctx.telegram.callApi('copyMessages', {
                 chat_id: chatId,
                 from_chat_id: cached.chatId,
                 message_ids: cached.messageIds,
                 message_thread_id: targetThreadId
               });
             }
             isWorking = false;
             clearInterval(statusInterval);
             return;
           } catch (e) {
             console.log("[⚠️] Failed to copy cached target, falling back to re-upload", e);
             sourceUploadCache.delete(cacheKey);
           }
        }

        // Суреттерге су белгісін параллельді Promise.all арқылы қосу
        const results = await Promise.all(
          sources.map(async (src) => {
            try {
              let customUrl = src.imageUrl || "";
              if (customUrl) {
                customUrl = customUrl.replace(/page_\d+\.png/g, `page_${src.page}.png`);
              }
  
              const buffer = await addWatermark(customUrl, src.book, src.page);
              return {
                buffer,
                book: src.book,
                page: src.page
              };
            } catch (err) {
              console.error(`[❌] Суретке су белгісін қосу кезіндегі қате (${src.book}, бет ${src.page}):`, err);
              return null;
            }
          })
        );
  
        const imageBuffers = results.filter((res): res is { buffer: Buffer; book: string; page: number } => res !== null);
  
        if (imageBuffers.length === 0) {
          await ctx.answerCbQuery('Кешіріңіз, ешқандай суретті жүктеу мүмкін болмады.', { show_alert: true });
          return;
        }
  
        // Media Group түрінде біріктіріп жібереміз
        try {
          const media = imageBuffers.map(img => ({
            type: 'photo' as const,
            media: { source: img.buffer },
            caption: `📖 ${img.book}, ${img.page}-бет`
          }));
          const sentMsgs = await ctx.replyWithMediaGroup(media);
          if (Array.isArray(sentMsgs)) {
             sourceUploadCache.set(cacheKey, { chatId, messageIds: sentMsgs.map(m => m.message_id) });
          }
        } catch (mediaGroupError) {
          console.warn("[⚠️] Media Group жіберу қатесі, суреттерді жеке-жеке жібереміз:", mediaGroupError);
          // Fallback: send sequentially if Media Group fails
          const messageIds: number[] = [];
          for (const img of imageBuffers) {
            const sentMsg = await ctx.replyWithPhoto({ source: img.buffer }, { caption: `📖 ${img.book}, ${img.page}-бет` });
            messageIds.push(sentMsg.message_id);
          }
          sourceUploadCache.set(cacheKey, { chatId, messageIds });
        }
      } catch (error) {
        console.error("[❌] Топтық суретті жүктеу немесе қате:", error);
        await ctx.answerCbQuery('Суреттер топтамасын ашу кезінде қателік кетті.', { show_alert: true });
      } finally {
        isWorking = false;
        clearInterval(statusInterval);
      }
    } catch (error) {
      console.error("[❌] Дәлелдер тобын жүктеу кезінде қате:", error);
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
