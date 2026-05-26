import { checkCache } from './src/backend/rag/cacheService';

async function run() {
  const cached = await checkCache("Малта деген не?");
  console.log("CACHED:", JSON.stringify(cached?.sources, null, 2));
}

run();
