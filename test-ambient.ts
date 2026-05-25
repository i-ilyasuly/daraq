import { GoogleGenAI } from '@google/genai';

// Delete GOOGLE_APPLICATION_CREDENTIALS to let the Google Auth Library load Ambient Credentials!
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
delete process.env.GEMINI_API_KEY;

const ai = new GoogleGenAI({
  vertexai: true,
  // Let the SDK auto-discover project and location from ambient Cloud Run metadata!
  httpOptions: {
    headers: { 'User-Agent': 'aistudio-build' }
  }
});

async function run() {
  try {
    console.log("Calling embedding via text-multilingual-embedding-002 using ambient credentials...");
    const res = await ai.models.embedContent({
      model: 'text-multilingual-embedding-002',
      contents: 'Сәлем!',
    });
    console.log(`[🎯 SUCCESS] Ambient credentials work! Dimension:`, res.embeddings?.[0]?.values?.length);
  } catch (err: any) {
    console.log(`[❌ FAILED]: ${err.status || err.code} - ${err.message || JSON.stringify(err)}`);
  }
}

run();
