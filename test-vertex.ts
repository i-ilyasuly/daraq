import { vertexAiClient, ai } from "./src/backend/rag/aiClient";

async function run() {
  try {
    const activeClient = vertexAiClient || ai;
    console.log("Using Vertex AI client?", !!vertexAiClient);
    const text = "Ораза - мұсылманның парызы.";
    const ttsInteraction = await activeClient.interactions.create({
      model: 'gemini-3.1-flash-tts-preview',
      input: text,
      response_modalities: ['audio'],
      generation_config: {
        speech_config: [{ voice: 'aoede' }]
      }
    });

    let audioBuffer: Buffer | null = null;
    for (const step of ttsInteraction.steps) {
      if (step.type === 'model_output') {
        const audioContent = step.content?.find((c: any) => c.type === 'audio');
        if (audioContent && audioContent.data) {
            audioBuffer = Buffer.from(audioContent.data, 'base64');
        }
      }
    }
    console.log("Size:", audioBuffer?.length);
  } catch (e: any) {
    console.error("Error:", e?.message);
    if (e?.response?.data) console.error(e.response.data);
  }
}
run();
