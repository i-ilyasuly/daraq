import 'dotenv/config';
import { ai } from './src/backend/rag/aiClient';

async function test() {
  const queries = [
    "Сәлем",
    "Не істеп жатырсың?",
    "Қазір бұрынғыша жазған сұрауымның алғашқы сөздерінен топик жасап жатыр",
    "Тема қалай ашылады?",
  ];
  
  for (const query of queries) {
    const prompt = `Сен Telegram тобындағы тақырыпқа (forum topic) өте қысқа, 2-3 сөзден тұратын атау және сәйкес эмодзи ойлап табуың керек. \n\nАлғашқы сұрақ: "${query}"\n\nТалаптар:\n1. 1 эмодзи + 2 немесе 3 сөз.\n2. Атау қазақ тілінде болуы міндетті.\n3. Ешқандай қосымша мәтінсіз, тек атауды қайтар.\nМысал: 🌙 Ораза пайдалары`;
    try {
      const res = await ai.models.generateContent({
        model: 'gemini-3.1-flash-lite',
        contents: prompt
      });
      console.log(`Query: ${query} => Response: ${res.text}`);
    } catch (e) {
      console.error(e);
    }
  }
}
test();
