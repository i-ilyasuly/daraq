import { GoogleGenAI } from "@google/genai";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function run() {
  const text = "Ораза - мұсылманның парызы.";
  const ttsInteraction = await ai.interactions.create({
    model: 'gemini-3.1-flash-tts-preview',
    input: text,
    response_modalities: ['audio'],
    generation_config: {
      speech_config: [{ voice: 'aoede' }]
    }
  });

  for (const step of ttsInteraction.steps) {
    if (step.type === 'model_output') {
      const audioContent = step.content?.find((c: any) => c.type === 'audio');
      if (audioContent && audioContent.data) {
        console.log("MimeType:", audioContent.mimeType);
        const buffer = Buffer.from(audioContent.data, 'base64');
        fs.writeFileSync("output.raw", buffer);
        console.log("Saved output.raw size", buffer.length);
      }
    }
  }
}
run();
