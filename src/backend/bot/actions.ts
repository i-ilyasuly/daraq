import { Telegraf, Markup } from 'telegraf';
import { getSourceInfo, getGroupInfo, paginationCache, setSourceInfo, sourceCache, sourceUploadCache, PaginationState } from './botCache';
import { addWatermark } from './watermark';
import { buildKeyboard } from './messageBuilder';

export function setupActionHandlers(bot: Telegraf<any>) {
  // 3. "Дыбысты өңдеу" батырмасын басу
  bot.action('voice_resp', async (ctx) => {
    try {
      await ctx.answerCbQuery("❌ Кешіріңіз, дыбыстау қызметі уақытша өшірілген.", { show_alert: true });
    } catch (e) {
      console.warn("[VoiceAgent] Ignore answerCbQuery error:", e);
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
}