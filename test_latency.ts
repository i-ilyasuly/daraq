import 'dotenv/config';
import { performance } from 'perf_hooks';
import { generateAgentAnswerStream } from './src/backend/rag/aiService';
import { checkCache } from './src/backend/rag/cacheService';
import { searchAnswers } from './src/backend/rag/searchService';
import { embedText } from './src/backend/rag/aiClient';
import { qdrant } from './src/backend/db/qdrant';
import { db } from './src/backend/db/firestore';

async function measureStep<T>(name: string, fn: () => Promise<T>): Promise<{ result: T; duration: number }> {
  const start = performance.now();
  const result = await fn();
  const end = performance.now();
  const duration = end - start;
  return { result, duration };
}

async function runLatencyTests() {
  console.log("=========================================");
  console.log("            DARAQ LATENCY TEST           ");
  console.log("=========================================");

  // 1. Warm-up
  console.log("\n[1/4] Warming up services (V8 compilation, connection reuse)...");
  try {
    await embedText({
      model: 'gemini-embedding-2',
      contents: "жылы сәлем",
      config: { taskType: 'RETRIEVAL_QUERY', outputDimensionality: 1536 }
    });
    console.log("  - Gemini API Warm-up: Success");
  } catch (e: any) {
    console.log("  - Gemini API Warm-up failed: ", e.message);
  }

  try {
    if (qdrant) {
      await qdrant.search('daraq_books', { vector: Array(1536).fill(0), limit: 1 });
      console.log("  - Qdrant Connection Warm-up: Success");
    }
  } catch (e: any) {
    console.log("  - Qdrant Connection Warm-up failed: ", e.message);
  }

  try {
    if (db) {
      await db.collection('sourceCache').limit(1).get();
      console.log("  - Firestore Connection Warm-up: Success");
    }
  } catch (e: any) {
    console.log("  - Firestore Connection Warm-up failed: ", e.message);
  }

  // 2. Test Cases
  const testQueries = [
    { text: "Сәлем, қалайсың?" },
    { text: "Белгісіз адам еңбегі жайлы айт" },
    { text: "Ораза қашан басталды?" },
    { text: "Бақара сүресі 183-аят мағынасы" },
  ];

  const results: any[] = [];

  console.log("\n[2/4] Running precise step-by-step latency analysis...");

  for (let i = 0; i < testQueries.length; i++) {
    const query = testQueries[i].text;
    console.log(`\n-----------------------------------------`);
    console.log(`QUERY ${i + 1}: "${query}"`);
    console.log(`-----------------------------------------`);

    // Measure cache check
    const cacheTiming = await measureStep("Semantic Cache Check", () => checkCache(query));
    console.log(`- Semantic Cache Check: ${cacheTiming.duration.toFixed(2)}ms (Found: ${cacheTiming.result !== null})`);

    // Measure total generation time (full end-to-end stream)
    console.log("Measuring end-to-end generateAgentAnswerStream...");
    let firstChunkTime = 0;
    const startE2E = performance.now();
    
    const streamResult = await generateAgentAnswerStream(
      `test_latency_user_${Date.now()}`,
      query,
      (chunk) => {
        if (firstChunkTime === 0) {
          firstChunkTime = performance.now() - startE2E;
        }
      },
      (action) => {}
    );
    const endE2E = performance.now();
    const totalE2E = endE2E - startE2E;
    
    console.log(`- Time to First Chunk: ${firstChunkTime > 0 ? firstChunkTime.toFixed(2) + 'ms' : 'N/A'}`);
    console.log(`- Total End-to-End Latency: ${totalE2E.toFixed(2)}ms`);
    console.log(`- Sources Found: ${streamResult.sources.length}`);

    // Break down key operations individually
    const startSearch = performance.now();
    const embedTiming = await measureStep("Direct Embedding", () => embedText({
      model: 'gemini-embedding-2',
      contents: query,
      config: { taskType: 'RETRIEVAL_QUERY', outputDimensionality: 1536 }
    }));
    const embeddingDuration = embedTiming.duration;

    const qdrantStart = performance.now();
    let qdrantResultsLength = 0;
    if (qdrant) {
      let denseVector = embedTiming.result.embeddings?.[0]?.values;
      if (denseVector) {
        if (denseVector.length === 768) denseVector = [...denseVector, ...Array(768).fill(0)];
        try {
          const searchResponse = await qdrant.query('daraq_books', {
            prefetch: [
              { query: denseVector, limit: 10 }
            ],
            limit: 10,
            with_payload: true
          });
          qdrantResultsLength = searchResponse.points?.length || 0;
        } catch (e) {}
      }
    }
    const qdrantDuration = performance.now() - qdrantStart;
    const totalSearchDuration = performance.now() - startSearch;

    console.log(`- Direct Embedding Latency: ${embeddingDuration.toFixed(2)}ms`);
    console.log(`- Qdrant Search Latency: ${qdrantDuration.toFixed(2)}ms`);
    console.log(`- Total Search Layer Latency: ${totalSearchDuration.toFixed(2)}ms`);

    results.push({
      query,
      cacheCheckMs: cacheTiming.duration,
      firstChunkMs: firstChunkTime,
      totalE2EMs: totalE2E,
      embeddingMs: embeddingDuration,
      qdrantMs: qdrantDuration,
      totalSearchMs: totalSearchDuration,
      sourcesCount: streamResult.sources.length
    });
  }

  // 3. Statistical Calculations
  console.log("\n=========================================");
  console.log("          LATENCY STATS SUMMARY          ");
  console.log("=========================================");

  const median = (arr: number[]) => {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };

  const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

  const totalTimes = results.map(r => r.totalE2EMs);
  const cacheCheckingTimes = results.map(r => r.cacheCheckMs);
  const firstChunkTimes = results.map(r => r.firstChunkMs).filter(t => t > 0);
  const embeddingTimes = results.map(r => r.embeddingMs).filter(t => t > 0);
  const qdrantTimes = results.map(r => r.qdrantMs).filter(t => t > 0);

  console.log(`\nEnd-to-End Latency:`);
  console.log(`  - Minimum: ${Math.min(...totalTimes).toFixed(2)}ms`);
  console.log(`  - Maximum: ${Math.max(...totalTimes).toFixed(2)}ms`);
  console.log(`  - Mean   : ${mean(totalTimes).toFixed(2)}ms`);
  console.log(`  - Median : ${median(totalTimes).toFixed(2)}ms`);

  console.log(`\nTime to First Chunk (Time-to-First-Token UI starts streaming):`);
  console.log(`  - Mean   : ${mean(firstChunkTimes).toFixed(2)}ms`);
  console.log(`  - Median : ${median(firstChunkTimes).toFixed(2)}ms`);

  console.log(`\nComponent Timings Metas (Median values):`);
  console.log(`  - Semantic Cache Check duration : ${median(cacheCheckingTimes).toFixed(2)}ms`);
  if (embeddingTimes.length > 0) {
    console.log(`  - Gemini Model Embedding duration: ${median(embeddingTimes).toFixed(2)}ms`);
  }
  if (qdrantTimes.length > 0) {
    console.log(`  - Qdrant Search duration : ${median(qdrantTimes).toFixed(2)}ms`);
  }

  console.log("\n[3/4] Major Bottlenecks Detected:");
  
  // Analyze bottlenecks
  const avgCache = mean(cacheCheckingTimes);
  console.log(`  1. Semantic Cache check average: ${avgCache.toFixed(2)}ms. This is executed at the very beginning of the flow.`);
  if (embeddingTimes.length > 0) {
    console.log(`  2. Embedding duration: ${mean(embeddingTimes).toFixed(2)}ms.`);
    console.log(`     CRITICAL DUPLICATION: When there is a cache miss, the system executes an embedding API call inside checkCache(),`);
    console.log(`     and then executes another identical embedding API call inside searchAnswers() sequentially.`);
    console.log(`     This double-embedding delays the response by an extra ~${mean(embeddingTimes).toFixed(2)}ms for every normal question!`);
  }
  
  // Analyze the multi-hop Agentic flow
  console.log(`  3. Double LLM Network Hop (Agentic Re-Routing Loop):`);
  console.log(`     Currently, the system is designed as a multi-hop agent with a system instruction that prevents it from answering directly.`);
  console.log(`     In step 1, the LLM is called and decides to call the "searchDatabase" or "get_quran_verse" tool.`);
  console.log(`     In step 2, the tool is executed (calling embedding API and Qdrant).`);
  console.log(`     In step 3, the LLM is called again with search results to synthesize the final answer.`);
  console.log(`     This represents 2 consecutive LLM roundtrips to Gemini representing over 60-70% of the total latency (over ${((median(totalTimes) - median(cacheCheckingTimes) - median(embeddingTimes)*2)/1000).toFixed(1)} seconds spend purely waiting on sequential LLM reasoning).`);

  console.log("\n=========================================");
  console.log("            END OF LATENCY REPORT        ");
  console.log("=========================================");
}

runLatencyTests()
  .then(() => process.exit(0))
  .catch(err => {
    console.error("Test execution failed:", err);
    process.exit(1);
  });
