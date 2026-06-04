import { GoogleGenAI } from "@google/genai";
import { storage } from "../storage";
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";
import textToSpeech from "@google-cloud/text-to-speech";
import path from "path";

dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const PROCESSED_BUCKET = process.env.PROCESSED_IMAGES_BUCKET || 'daraq-497018-daraq-processed-images';
const bucket = storage ? storage.bucket(PROCESSED_BUCKET) : null;

// Initialize Standard Cloud TTS
const ttsClient = new textToSpeech.TextToSpeechClient(
  process.env.GOOGLE_APPLICATION_CREDENTIALS ? 
  { keyFilename: path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS) } : 
  {}
);

/**
 * AI Voice Director: Rewrites the text into an emotional script and chooses the voice.
 */
async function generateVoiceScript(text: string): Promise<{ transcript: string }> {
  const prompt = `Сіз аудиожазба (TTS) үшін режиссерсіз. Мына мәтінді дыбыстауға арналған табиғи транскрипт етіп қайта жазып беріңіз.

Талаптар:
1. Барлық Telegram HTML тегтерін (<b>, <i>, <blockquote>) толық алып тастаңыз.
2. Дыбыстың эмоциясын беру үшін интонациялық белгілер қосыңыз (мысалы, [warmly] - жылы, [serious] - байыппен, [reverent] ауыр/құрметпен, [slowly] - баяу, [sighs] - күрсініп).
3. Дайын мәтіннің басында тұрақты түрде мынадай форматты (Сцена мен Контекстті) міндетті түрде сақтап жазыңыз:

Scene: Тыныш, кәсіби, сенімді әрі нұрлы діни кітапхана.
Sample Context: Сабырлы, байсалды, түсінікті әрі жанашыр. Дауыс ырғағы сенім артарлық және жылы.
Speaker 1 - Aoede

4. ЕГЕР МӘТІН ӨТЕ ҰЗАҚ БОЛСА, ең басты мағынасын сақтап, қысқа әрі нұсқа (максимум 5-6 сөйлем) етіп тұжырымдап беріңіз. 

(Осыдан кейін өзіңіз дайындаған транскрипт жазылуы керек).

Бастапқы мәтін:
${text}`;

  const interaction = await ai.interactions.create({
    model: "gemini-3.5-flash",
    input: prompt,
    generation_config: {
      temperature: 0.7,
    }
  });

  let transcript = "";
  for (const step of interaction.steps) {
    if (step.type === 'model_output') {
      const textContent = step.content?.find((c: any) => c.type === 'text');
      if (textContent && textContent.text) {
        transcript += textContent.text;
      }
    }
  }

  return { transcript: transcript.trim() };
}

/**
 * Handles the Voice Agent pipeline: Cache -> Transcript -> TTS -> Cache
 */
export async function getVoiceResponse(messageId: number, originalText: string): Promise<{ audioBuffer: Buffer, isCached: boolean }> {
  if (!bucket) {
    throw new Error("GCS Bucket is not initialized.");
  }
  const fileName = `voice_cache/${messageId}.ogg`;
  const file = bucket.file(fileName);

  // 1. Бұлттық дыбыс кэші (GCS Cache Check)
  try {
    const [exists] = await file.exists();
    if (exists) {
      const [buffer] = await file.download();
      // Validate that it's actually an OGG file (legacy cache was raw PCM)
      if (buffer.length > 4 && buffer.slice(0, 4).toString('ascii') === 'OggS') {
        return { audioBuffer: buffer, isCached: true };
      } else {
        console.warn(`[VoiceAgent] Found legacy PCM cache for ${fileName}, converting to OGG locally.`);
        try {
          const { execSync } = require('child_process');
          const finalAudioBuffer = execSync('ffmpeg -f s16le -ar 24000 -ac 1 -i pipe:0 -c:a libopus -b:a 64k -f ogg pipe:1', { 
            input: buffer,
            encoding: 'buffer'
          });
          file.save(finalAudioBuffer, { contentType: 'audio/ogg' }).catch(() => {});
          return { audioBuffer: finalAudioBuffer, isCached: true };
        } catch (convErr) {
          console.warn("[VoiceAgent] Legacy PCM conversion failed, falling through to re-generate.", convErr);
        }
      }
    }
  } catch (error) {
    console.error("[VoiceAgent] Cache check error:", error);
  }

  const maxTextLength = 800;
  let textToProcess = originalText;
  if (textToProcess.length > maxTextLength) {
    textToProcess = textToProcess.substring(0, maxTextLength) + "... (жалғасы бар)";
  }

  // 2. ЖИ Режиссер (The AI Director - Script Writing)
  const { transcript } = await generateVoiceScript(textToProcess);

  // 3. Premium gemini-3.1-flash-tts-preview Generation
  let audioBuffer: Buffer | null = null;
  try {
    const ttsInteraction = await ai.interactions.create({
      model: 'gemini-3.1-flash-tts-preview',
      input: transcript,
      response_modalities: ['audio'],
      generation_config: {
        speech_config: [{
          voice: 'aoede'
        }]
      }
    });

    for (const step of ttsInteraction.steps) {
      if (step.type === 'model_output') {
        const audioContent = step.content?.find((c: any) => c.type === 'audio');
        if (audioContent && audioContent.data) {
          audioBuffer = Buffer.from(audioContent.data, 'base64');
        }
      }
    }
  } catch (ttsError: any) {
    console.error("[VoiceAgent] TTS generation error:", ttsError, ttsError?.response?.data);
    throw new Error("TTS generation failed: " + (ttsError.message || String(ttsError)));
  }

  if (!audioBuffer) {
    throw new Error("TTS failed to generate audio buffer.");
  }

  let finalAudioBuffer = audioBuffer;
  try {
    const { execSync } = require('child_process');
    finalAudioBuffer = execSync('ffmpeg -f s16le -ar 24000 -ac 1 -i pipe:0 -c:a libopus -b:a 64k -f ogg pipe:1', { 
      input: audioBuffer,
      encoding: 'buffer'
    });
  } catch (convErr) {
    console.warn("[VoiceAgent] Warning: ffmpeg conversion failed, trying raw buffer natively.", convErr);
  }

  // 4. Сақтау
  try {
    await file.save(finalAudioBuffer, {
      contentType: 'audio/ogg',
    });
  } catch (error) {
    console.error("[VoiceAgent] Saving to cache error:", error);
  }

  return { audioBuffer: finalAudioBuffer, isCached: false };
}
