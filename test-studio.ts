import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: { 'User-Agent': 'aistudio-build' }
  }
});

async function testStudio() {
  try {
    console.log("Testing text generation via gemini-3.5-flash...");
    const gen = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: 'Tell me a joke.'
    });
    console.log("Joke success! Text:", gen.text);
  } catch (err: any) {
    console.error("Joke failed:", err.message || err);
  }

  try {
    console.log("\nTesting embedding via gemini-embedding-2-preview...");
    const emb = await ai.models.embedContent({
      model: 'gemini-embedding-2-preview',
      contents: 'Сәлем!'
    });
    console.log("Embedding success! Dimension:", emb.embeddings?.[0]?.values?.length);
  } catch (err: any) {
    console.error("Embedding failed:", err.message || err);
  }
}

testStudio();
