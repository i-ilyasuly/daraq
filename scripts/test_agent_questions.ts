import '../src/backend/crypto-patch';
import { generateAgentAnswerStream } from '../src/backend/rag/aiService';

const queries = [
  "адамдар ауыз бекіткенде алдымен аштық пен әлсіздікті сезінеді ме? Неліктен"
];

async function runTests() {
  for (const query of queries) {
    console.log(`\n===========================================`);
    console.log(`[❓] Сұрақ: "${query}"`);
    console.log(`===========================================`);
    try {
      let isFirst = true;
      let finalAnswer = '';
      
      const onChunk = (text: string) => {
        if (isFirst) {
          console.log(`[🤖] Маманның жауабы:`);
          isFirst = false;
        }
        process.stdout.write(text.substring(finalAnswer.length));
        finalAnswer = text;
      };

      const onAction = Object; // no-op

      const response = await generateAgentAnswerStream('test_chat_1', query, onChunk, onAction, 'test_thread_1', 'kk');
      
      if (response && response.answer && isFirst) {
         console.log(`[🤖] Маманның жауабы:`);
         console.log(response.answer);
      }
      console.log(`\n\n[✅] Сұрақ сәтті аяқталды. Алынған көздер: ${response?.sources?.length || 0}`);
    } catch (e: any) {
      console.error(`\n[❌] Қате: ${e.message}`);
    }
  }
}

runTests();
