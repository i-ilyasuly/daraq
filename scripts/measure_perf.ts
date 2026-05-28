// Disable Firestore to prevent potential connection hangs during command-line tests
process.env.FIREBASE_PROJECT_ID = "";
process.env.FIREBASE_CLIENT_EMAIL = "";
process.env.FIREBASE_PRIVATE_KEY = "";

import { generateAgentAnswerStream } from '../src/backend/rag/aiService';
import { searchAnswers } from '../src/backend/rag/searchService';
import { embedText, GEMINI_EMBEDDING_MODEL } from '../src/backend/rag/aiClient';
import { checkCache } from '../src/backend/rag/cacheService';
import 'dotenv/config';

async function measureChitchat() {
  console.log("\n--- CHITCHAT ТЕСТІ (2 РЕТ ЖҮРГІЗУ) ---");
  const testQueries = ["Ассалаумағалейкум", "Сәлем, қалайсың?"];
  
  for (let idx = 0; idx < testQueries.length; idx++) {
    const query = testQueries[idx];
    console.log(`\nІске қосу #${idx + 1}: "${query}"`);
    
    // 1-қадам: Кэш тексеру
    const startCache = performance.now();
    await checkCache(query);
    const endCache = performance.now();
    const cacheTime = endCache - startCache;
    
    // 2-қадам: LLM Жауап беру уақыты (Stream)
    let firstTokenTime = 0;
    const startLLM = performance.now();
    let completedText = "";
    
    await generateAgentAnswerStream(
      "perf_test_chat_chitchat_" + idx,
      query,
      (chunk) => {
        if (!firstTokenTime) {
          firstTokenTime = performance.now();
        }
        completedText = chunk;
      },
      (action) => {}
    );
    
    const endLLM = performance.now();
    const firstTokenLatency = firstTokenTime ? (firstTokenTime - startLLM) : 0;
    const completeLLMTime = endLLM - startLLM;
    
    console.log(`  - Кэш тексеру уақыты: ${cacheTime.toFixed(2)} мс`);
    console.log(`  - Алғашқы токенге дейінгі кешігу (TTFT): ${firstTokenLatency.toFixed(2)} мс`);
    console.log(`  - LLM толық жауап генерациясы: ${completeLLMTime.toFixed(2)} мс`);
    console.log(`  - Қорытынды жалпы уақыт: ${(cacheTime + completeLLMTime).toFixed(2)} мс`);
  }
}

async function measureKnowledgeSearch() {
  console.log("\n--- KNOWLEDGE_SEARCH ТЕСТІ (3 РЕТ ЖҮРГІЗУ) ---");
  const testQueries = [
    "Оразаның денсаулыққа пайдасы қандай?",
    "Оразаның ақиреттік пайдалары қандай?",
    "Ерғали Алпысбаев дайындаған ораза дәрісіндегі кәффарат оразалардың түрлері қандай?"
  ];
  
  for (let idx = 0; idx < testQueries.length; idx++) {
    const query = testQueries[idx];
    console.log(`\nІске қосу #${idx + 1}: "${query}"`);
    
    // 1-қадам: Кэш тексеру
    const startCache = performance.now();
    await checkCache(query);
    const endCache = performance.now();
    const cacheTime = endCache - startCache;
    
    // 2-қадам: Векторизация уақыты (Gemini Embedding)
    const startEmbed = performance.now();
    const embedRes = await embedText({
      model: GEMINI_EMBEDDING_MODEL,
      contents: query,
      config: {
        taskType: 'RETRIEVAL_QUERY',
        outputDimensionality: 1536
      }
    });
    const denseVector = embedRes.embeddings?.[0]?.values;
    const endEmbed = performance.now();
    const embedTime = endEmbed - startEmbed;
    
    // 3-қадам: Сақтау орнынан іздеу (BM25 + Dense Qdrant Search)
    const startSearch = performance.now();
    const searchRes = await searchAnswers(query, denseVector);
    const endSearch = performance.now();
    const searchTime = endSearch - startSearch;
    
    // 4-қадам: LLM Генерирация уақыты (Streaming)
    let firstTokenTime = 0;
    const startLLM = performance.now();
    let completedText = "";
    
    await generateAgentAnswerStream(
      "perf_test_chat_search_" + idx,
      query,
      (chunk) => {
        if (!firstTokenTime) {
          firstTokenTime = performance.now();
        }
        completedText = chunk;
      },
      (action) => {}
    );
    
    const endLLM = performance.now();
    const firstTokenLatency = firstTokenTime ? (firstTokenTime - startLLM) : 0;
    const completeLLMTime = endLLM - startLLM;
    
    console.log(`  - Табылған дереккөздер саны: ${searchRes.length}`);
    console.log(`  - Кэш тексеру уақыты: ${cacheTime.toFixed(2)} мс`);
    console.log(`  - Gemini Векторлау уақыты: ${embedTime.toFixed(2)} мс`);
    console.log(`  - Qdrant Іздеу уақыты: ${searchTime.toFixed(2)} мс`);
    console.log(`  - Алғашқы токенге дейінгі кешігу (TTFT): ${firstTokenLatency.toFixed(2)} мс`);
    console.log(`  - LLM толық RAG жауап генерациясы: ${completeLLMTime.toFixed(2)} мс`);
    console.log(`  - Қорытынды жалпы уақыт: ${(cacheTime + embedTime + searchTime + completeLLMTime).toFixed(2)} мс`);
  }
}

async function runAllMeasurements() {
  console.log("=====================================================");
  console.log("       DARAQ RAG СЕРВЕР PERFORMANCE ТЕСТІ            ");
  console.log("=====================================================");
  
  try {
    await measureChitchat();
    await measureKnowledgeSearch();
  } catch (error) {
    console.error("Тест барысында қате орын алды:", error);
  }
  
  console.log("\n=====================================================");
  console.log("               ТЕСТ АЯҚТАЛДЫ                         ");
  console.log("=====================================================");
  process.exit(0);
}

runAllMeasurements();
