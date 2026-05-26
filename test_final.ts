import { generateAgentAnswerStream } from './src/backend/rag/aiService';

async function run() {
  const result = await generateAgentAnswerStream(
    "test_chat_id_final",
    "Белгісіз адам еңбегі жайлы айт",
    (chunk) => { process.stdout.write(chunk); },
    (action) => {}
  );
  console.log("\n\nFINAL SOURCES LENGHT: ", result.sources.length);
}

run();
