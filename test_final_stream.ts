import { generateAgentAnswerStream } from './src/backend/rag/aiService';

async function run() {
  const result = await generateAgentAnswerStream(
    `test_chat_id_${Date.now()}`,
    "Белгісіз адам еңбегі жайлы айт",
    (chunk) => { console.log(`[CHUNK] ${chunk}`); },
    (action) => { console.log(`[ACTION] ${action}`); }
  );
  console.log("\n\nFINAL ANSWER:\n", result.answer);
}

run();
