/**
 * Қарапайым хэштеу алгоритмі
 */
function stringHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * Text-ten Sparse вектор жасауға арналған токенизация функциясы
 */
export function tokenizeAndHash(text: string) {
  const words = text.toLowerCase().match(/[\wа-яА-ЯөӨқҚүҮғҒіІңҢұҰһҺ]+/g) || [];
  const termFreq: Record<number, number> = {};
  for (const word of words) {
     const hash = stringHash(word);
     termFreq[hash] = (termFreq[hash] || 0) + 1;
  }
  return {
    indices: Object.keys(termFreq).map(Number),
    values: Object.values(termFreq)
  };
}
