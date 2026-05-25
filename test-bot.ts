import 'dotenv/config';
import { ai } from './src/backend/rag/aiClient';

async function run() {
  console.log("Starting Vertex test directly with object contents...");
  const prompt = `Сен Telegram тобындағы тақырыпқа... \n\nАлғашқы сұрақ: "Ораза туралы"`

  console.log("Calling ai.models.generateContent...");
  
  const promise = ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{ role: 'user', parts: [{ text: prompt }] }]
  });
  
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout after 10 seconds")), 10000));
  
  try {
     const res: any = await Promise.race([promise, timeout]);
     console.log("Result:", res?.text);
  } catch(e: any) {
     console.log("Error:", e.message);
  }
  
  console.log("Finished test!");
  process.exit(0);
}

run();
