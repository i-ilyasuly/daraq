import { generateAgentAnswerStream } from './src/backend/rag/aiService';
import { db } from './src/backend/db/firestore';
import { filterSourcesByResponse } from './src/backend/bot/index';

async function run() {
  const chatId = "123456789";
  const query = "Ораза кімге парыз";
  console.log("Query 1:", query);
  
  const res1 = await generateAgentAnswerStream(chatId, query, () => {}, () => {}, 'general');
  console.log("Res 1 answer:", res1.answer.substring(0, 50));
  console.log("Res 1 sources count:", res1.sources.length);
  
  if (db) {
      await db.collection('users').doc(chatId).collection('topics').doc('general').collection('latestSources').doc('current').set({
        sources: res1.sources,
        answer: res1.answer,
        updatedAt: new Date()
      });
  }

  const query2 = "Дәлелі суреті көрсетші";
  console.log("\nQuery 2:", query2);
  const res2 = await generateAgentAnswerStream(chatId, query2, () => {}, () => {}, 'general');
  console.log("Res 2 answer:", res2.answer.substring(0, 50));
  console.log("Res 2 sources count:", res2.sources?.length || 0);

  let relevantSources: any[] = [];
  if (res2.sources && res2.sources.length > 0) {
    relevantSources = filterSourcesByResponse(res2.sources, res2.answer);
  } else {
    // Simulate what happens in index.ts if relevantSources is initially empty
    relevantSources = [];
  }

  let cachedData;
  if (!relevantSources || relevantSources.length === 0) {
      if (db) {
        const doc = await db.collection('users').doc(chatId).collection('topics').doc('general').collection('latestSources').doc('current').get();
        if (doc.exists) {
          cachedData = doc.data();
          relevantSources = cachedData?.sources;
          console.log("Restored sources count:", relevantSources?.length);
        }
      }
  }

  console.log("Final relevant sources book:", relevantSources?.[0]?.book, relevantSources?.[0]?.page);
  process.exit(0);
}
run();
