import { qdrant } from '../db/qdrant';
import 'dotenv/config';

const QDRANT_COLLECTION = 'daraq_books';

export async function deleteBook(bookName: string) {
  if (!qdrant) {
    console.error("Qdrant қосылмаған.");
    return;
  }
  
  try {
    console.log(`[⏳] "${bookName}" кітабын дерекқордан жою басталды...`);
    
    // Qdrant-тан кітапқа тиесілі барлық векторларды жою
    const response = await qdrant.delete(QDRANT_COLLECTION, {
      filter: {
        must: [
          {
            key: "book",
            match: {
              value: bookName
            }
          }
        ]
      }
    });

    console.log(`[✅] "${bookName}" кітабы Qdrant дерекқорынан толықтай жойылды!`);
    console.log(response);

  } catch (error) {
    console.error("Кітапты жою кезінде қате орын алды:", error);
  }
}

import { fileURLToPath } from 'url';

// Скриптті тікелей іске қосу
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  const args = process.argv.slice(2);
  const bookName = args[0];

  if (!bookName) {
    console.log("Пайдалану: npx tsx src/backend/rag/deleteBook.ts <кітап_аты>");
    process.exit(1);
  }

  deleteBook(bookName).then(() => process.exit(0));
}
