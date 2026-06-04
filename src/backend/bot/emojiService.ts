export let cachedCustomEmojiMap: Map<string, string> | null = null;

export async function getCustomEmojiMap(telegram: any): Promise<Map<string, string>> {
  if (cachedCustomEmojiMap) {
    return cachedCustomEmojiMap;
  }
  const map = new Map<string, string>();
  try {
    let stickers: any[] = [];
    if (typeof telegram.getForumTopicIconStickers === 'function') {
      stickers = await telegram.getForumTopicIconStickers();
    } else {
      stickers = await telegram.callApi('getForumTopicIconStickers', {});
    }
    
    if (Array.isArray(stickers)) {
      for (const sticker of stickers) {
        if (sticker && sticker.emoji && sticker.custom_emoji_id) {
          map.set(sticker.emoji, sticker.custom_emoji_id);
        }
      }
    }
    console.log(`[Stickers] Succesfully loaded ${map.size} custom emoji sticker mapping IDs.`);
  } catch (e) {
    console.error("[⚠️] Error fetching getForumTopicIconStickers:", e);
  }
  
  cachedCustomEmojiMap = map;
  return map;
}

export const EMOJI_FALLBACKS: Record<string, string> = {
  '🪥': '📝',
  '🚭': '⚡️',
  '🚗': '🚗',
  '💼': '💼',
  '🕌': '🏠', // Fallback to house icon for religious building
  '🌙': '⭐️', // Fallback to star for moon
  '📖': '📚',
  '📑': '📝',
};

/**
 * Тақырыптан эмодзи мен таза мәтінді бөлек-бөлек айыратын функция.
 * Мысалы: "🌙 Ораза үкімдері" -> { emoji: "🌙", text: "Ораза үкімдері" }
 */
export function extractEmojiAndText(rawText: string): { emoji: string; text: string } {
  const textMatches = rawText.trim();
  // Match standard emojis at the very beginning
  const emojiStartRegex = /^(\p{Extended_Pictographic}|\p{Emoji_Presentation})[\uFE00-\uFE0F\u200D\p{Emoji_Modifier}]*/u;
  const match = textMatches.match(emojiStartRegex);
  if (match) {
    const emoji = match[0];
    const text = textMatches.slice(emoji.length).trim();
    return { emoji, text };
  }
  
  // Try finding any pictographic/emoji near the start (index <= 2) as fallback
  const generalMatch = textMatches.match(/(\p{Extended_Pictographic}|\p{Emoji_Presentation})/u);
  if (generalMatch && textMatches.indexOf(generalMatch[0]) <= 2) {
    const emoji = generalMatch[0];
    const text = textMatches.replace(emoji, '').replace(/\s+/g, ' ').trim();
    return { emoji, text };
  }
  
  return { emoji: '', text: textMatches };
}
