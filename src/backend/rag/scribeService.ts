import { Blob } from 'buffer';
import { ai } from './aiClient';

/**
 * Gemini арқылы дауыстық хабарламаны қосалқы мәтінге айналдыру (Fallback Transcription)
 */
async function transcribeUsingGeminiFallback(
  audioBuffer: Buffer,
  fileName: string
): Promise<string> {
  console.log('[🎙 GEMINI STT] ElevenLabs failed or not configured. Using Gemini-3.5-flash as fallback...');
  try {
    const base64Audio = audioBuffer.toString('base64');
    let mimeType = 'audio/ogg';
    if (fileName.endsWith('.mp3')) {
      mimeType = 'audio/mp3';
    } else if (fileName.endsWith('.wav')) {
      mimeType = 'audio/wav';
    } else if (fileName.endsWith('.m4a')) {
      mimeType = 'audio/m4a';
    }

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: [
        {
          inlineData: {
            mimeType: mimeType,
            data: base64Audio,
          },
        },
        {
          text: `Сен - қазақ және көптілді аудио транскрипциялау бойынша озық ассистентсің.
Мына жүктелген дауыстық/аудио хабарламаны тыңдап, оның қазақ тіліндегі (немесе аудиода айтылған тілдегі) мәтінін дәлдікпен толық жазып бер.
Маңызды ережелер:
1. Тек аудиода айтылған сөздерді ғана жазыңыз.
2. Ешқандай өз тусініктеріңді, кіріспе сөздерді, қауіпсіздік ескертулерін немесе "Төменде аудио транскрипциясы:" деген сияқты қосымша мәтіндерді МҮЛДЕМ қоспаңыз.
3. Тек дыбысталған таза сөздерді ғана қайтарыңыз.`,
        },
      ],
    });

    const textResult = (response.text || '').trim();
    if (!textResult) {
      throw new Error('Gemini API returned an empty transcription.');
    }
    console.log('[🎙 GEMINI STT] Successfully transcribed text:', textResult);
    return textResult;
  } catch (error: any) {
    console.error('[❌ GEMINI STT FALLBACK ERROR]:', error.message || error);
    throw new Error(`Аудио хабарламаны Gemini арқылы транскрипциялау да сәтсіз аяқталды: ${error.message || error}`);
  }
}

/**
 * Дауыстық хабарламаны қазақ тілінде мәтінге айналдыру функциясы (ElevenLabs Scribe v2 немесе Gemini fallback)
 * @param audioBuffer Telegram-нан алынған аудио буфері
 * @param fileName Файл атауы (мысалы, voice.ogg)
 */
export async function transcribeKazakhVoice(
  audioBuffer: Buffer,
  fileName: string = 'voice.ogg'
): Promise<string> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.warn('[⚠️ STT WARNING] ELEVENLABS_API_KEY is not configured! Routing directly to Gemini fallback...');
    return await transcribeUsingGeminiFallback(audioBuffer, fileName);
  }

  // Node Fetch-де Multipart Form Data құру
  const formData = new globalThis.FormData();
  
  // Buffer-ді Blob-қа айналдыру
  const blob = new Blob([audioBuffer], { type: 'audio/ogg' });
  formData.append('file', blob, fileName);
  formData.append('model_id', 'scribe_v1');
  formData.append('language_code', 'kk'); // Қазақ тілін міндетті түрде бекіту

  try {
    console.log('[🎙 ELEVENLABS] Transcribing voice file via Scribe v2...');
    const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ElevenLabs API Error: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as { text: string };
    const textResult = (data.text || '').trim();
    console.log('[🎙 ELEVENLABS] Transcribed text:', textResult);
    return textResult;
  } catch (error: any) {
    console.error('[❌ ELEVENLABS SCRIBE ERROR]:', error.message || error);
    console.log('[🔄 FALLBACK] ElevenLabs failed (quota/key/network). Attempting Gemini API fallback...');
    
    try {
      return await transcribeUsingGeminiFallback(audioBuffer, fileName);
    } catch (fallbackError: any) {
      // If even the fallback fails, throw a clear error with context of both failures
      throw new Error(`Дауыстық хабарламаны мәтінге айналдыру сәтсіз аяқталды. ElevenLabs: ${error.message}. Gemini Fallback: ${fallbackError.message}`);
    }
  }
}
