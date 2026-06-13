import { Markup } from 'telegraf';
import { v4 as uuidv4 } from 'uuid';
import { setSourceInfo, setGroupInfo, sourceCache } from './botCache';

export function formatStatusMessage(text: string): string {
  // 1. Remove HTML tags if any (like <i>, </i>, <code>, </code>)
  let clean = text.replace(/<[^>]*>?/gm, '');

  // 2. Remove emojis and symbols: target common categories & specific emojis
  clean = clean.replace(/[\u{1F300}-\u{1F9FF}]/gu, ''); // Miscellaneous Symbols and Pictographs, Supplemental Symbols and Pictographs
  clean = clean.replace(/[\u{2700}-\u{27BF}]/gu, '');   // Dingbats
  clean = clean.replace(/[\u{1F600}-\u{1F64F}]/gu, ''); // Emoticons
  clean = clean.replace(/[\u{1F680}-\u{1F6FF}]/gu, ''); // Transport and Map Symbols
  clean = clean.replace(/[\u{2600}-\u{26FF}]/gu, '');   // Miscellaneous Symbols
  
  // Specific emoji characters
  clean = clean.replace(/[⏳⌛🔍👉✍️📖⚠️⚡️]/g, '');

  // Strip variation selectors (\ufe0f)
  clean = clean.replace(/\ufe0f/g, '');

  // 3. Clean up leading/trailing whitespace
  clean = clean.trim();

  // Strip trailing ellipsis (...) if present
  clean = clean.replace(/\.{3,}\s*$/, '');
  clean = clean.trim();

  // 4. Wrap with code tags for monospace style
  return `<code>${clean}</code>`;
}

export function splitTextIntoSafeChunks(text: string, maxLength: number = 3800): string[] {
    const chunks: string[] = [];
    let current = '';
    const paragraphs = text.split('\n\n');
    for (const p of paragraphs) {
        if (current.length + p.length + 2 > maxLength && current.length > 0) {
            let chunkToPush = current;
            const openB = (chunkToPush.match(/<b>/g) || []).length > (chunkToPush.match(/<\/b>/g) || []).length;
            const openI = (chunkToPush.match(/<i>/g) || []).length > (chunkToPush.match(/<\/i>/g) || []).length;
            const openQuote = (chunkToPush.match(/<blockquote(?: [^>]*)?>/g) || []).length > (chunkToPush.match(/<\/blockquote>/g) || []).length;
            
            if (openI) chunkToPush += '</i>';
            if (openB) chunkToPush += '</b>';
            if (openQuote) chunkToPush += '</blockquote>';
            
            chunks.push(chunkToPush);
            
            let prefix = '';
            if (openQuote) prefix += '<blockquote>';
            if (openB) prefix += '<b>';
            if (openI) prefix += '<i>';
            
            let r = p;
            while(r.length > maxLength) {
                let slice = prefix + r.substring(0, maxLength - prefix.length);
                // Also close tags for purely emergency hard slices
                if (openI) slice += '</i>';
                if (openB) slice += '</b>';
                if (openQuote) slice += '</blockquote>';
                chunks.push(slice);
                r = r.substring(maxLength - prefix.length);
            }
            current = prefix + r;
        } else {
            current += (current ? '\n\n' : '') + p;
        }
    }
    if (current) chunks.push(current);
    return chunks;
}

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
          text: src.text || "",
          audio_url: src.audio_url
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

  if (buttons.length === 0) return null;
  return Markup.inlineKeyboard(buttons);
}
