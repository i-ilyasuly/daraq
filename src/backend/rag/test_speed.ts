import { GoogleGenAI } from '@google/genai';
import * as dotenv from 'dotenv';
dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const models = [
  { id: 'gemini-flash-lite-latest', name: 'gemini-flash-lite-latest (Барлық жерге қойылды)', config: undefined }
];

const prompts = [
  "Белгісіз адам еңбегі жайлы айт.",
  "Ораза ұстаудың пайдалары туралы айтшы.",
  "Ораза ұстау күнәлардың кешірілуіне себеп болады ма? Бұл жайлы абу Хурайра жеткізген хадисте не делінеді?"
];

async function runTest() {
  console.log("=== ТЕСТ БАСТАЛДЫ ===\n");
  
  const results: any[] = [];

  for (const model of models) {
    console.log(`===========================================`);
    console.log(`МОДЕЛЬ: ${model.name}`);
    console.log(`===========================================`);
    
    let totalTimeSum = 0;
    
    for (let i = 0; i < prompts.length; i++) {
      const prompt = prompts[i];
      console.log(`\nСұрау ${i + 1}: ${prompt}`);
      
      const startTime = performance.now();
      let firstTokenTime = 0;
      let text = "";
      
      try {
        const stream = await ai.models.generateContentStream({
          model: model.id,
          contents: prompt,
          config: model.config as any
        });
        
        for await (const chunk of stream) {
          if (firstTokenTime === 0) {
            firstTokenTime = performance.now();
          }
          text += chunk.text;
        }
        
        const endTime = performance.now();
        const ttft = (firstTokenTime - startTime).toFixed(0);
        const totalTime = (endTime - startTime).toFixed(0);
        
        console.log(`>> Жауапты бастады (TTFT): ${ttft} ms`);
        console.log(`>> Жауапты аяқтады (Total): ${totalTime} ms`);
        console.log(`>> Жауап ұзындығы: ${text.length} символ`);
        
        totalTimeSum += (endTime - startTime);
      } catch (e: any) {
        console.log(`>> ҚАТЕЛІК: ${e.message}`);
        totalTimeSum += 999999; // айыппұл
      }
    }
    results.push({ name: model.name, avgTime: (totalTimeSum / prompts.length).toFixed(0) });
    console.log("\n");
  }
  
  console.log("=== ҚОРЫТЫНДЫ ===");
  results.sort((a, b) => a.avgTime - b.avgTime);
  results.forEach((r, idx) => {
    console.log(`${idx + 1}-Орын: ${r.name} (Орташа уақыт: ${r.avgTime} ms)`);
  });
}

runTest();
