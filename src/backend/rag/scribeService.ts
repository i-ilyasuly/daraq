import { Blob } from 'buffer';

/**
 * Дауыстық хабарламаны қазақ тілінде мәтінге айналдыру функциясы (ElevenLabs Scribe v2)
 * @param audioBuffer Telegram-нан алынған аудио буфері
 * @param fileName Файл атауы (мысалы, voice.ogg)
 */
export async function transcribeKazakhVoice(
  audioBuffer: Buffer,
  fileName: string = 'voice.ogg'
): Promise<string> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error('ELEVENLABS_API_KEY орта айнымалысы бапталмаған!');
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
    throw new Error(`Дауыстық хабарламаны мәтінге айналдыру сәтсіз аяқталды: ${error.message || error}`);
  }
}
