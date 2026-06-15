import { generateContentFixed, GEMINI_GENERATION_MODEL } from './aiClient';
import { ThinkingLevel } from '@google/genai';
import { TRANSCRIPTION_CORRECTION_PROMPT } from './prompts';

export function validateAndCleanCorrection(rawText: string, correctedText: string): string {
  let cleaned = correctedText.trim();
  
  // 1. "Шығыс:" немесе "Жауап:" сияқты префикстерді алып тастау
  cleaned = cleaned.replace(/^(шығыс|жауап|түзетілген|corrected|output|кіріс|input)\s*:\s*/i, '');
  cleaned = cleaned.trim();

  // Егер тырнақшалардың ішіне алып берсе, оларды да тазалау
  if (cleaned.startsWith('"') && cleaned.endsWith('"') && cleaned.length > 2) {
    cleaned = cleaned.substring(1, cleaned.length - 1).trim();
  }

  const normalized = cleaned.toLowerCase();

  // 2. Артық метамәлімет немесе модельдің өз диалогын анықтауға арналған қара тізім
  const blacklistedTokens = [
    'түсінікті',
    'түзетуді қажет',
    'мәтінді жіберсеңіз',
    'нұсқауларға сай',
    'сауатты түрде',
    'қалпына келтіріп',
    'сіздің сұрағыңыз',
    'түзетілген нұсқа',
    'сұраққа жауап',
    'шығыс:',
    'кіріс:',
    'қатаң тыйымдар',
    'нұсқаулық',
    'нұсқауларға сәйкес',
    'жасанды интеллект',
    'моделісің'
  ];

  for (const token of blacklistedTokens) {
    if (normalized.includes(token)) {
      console.warn(`[⚠️ CORRECTOR GUARD] Blacklist token "${token}" triggered in corrected text! Falling back to raw.`);
      return rawText;
    }
  }

  // Егер LLM нақтылау сұраса (Кешіріңіз, дауыстық...), оны өткізіп жібереміз
  const isClarification = normalized.includes('кешіріңіз') && (normalized.includes('түсіне алмадым') || normalized.includes('нақтылап'));

  // 3. Ұзындықты бақылау: Егер шикі мәтін қысқа болса, бірақ түзетілген мәтін одан бірнеше есе ұзын болып, нұсқаулықтарды шығарып жіберсе
  if (!isClarification && rawText.length < 15 && cleaned.length > 80) {
    console.warn(`[⚠️ CORRECTOR GUARD] Suspicious length expansion! Raw: ${rawText.length}, Corrected: ${cleaned.length}. Falling back to raw.`);
    return rawText;
  }

  return cleaned;
}

/**
 * Дауыстық хабарлама транскрипциясын қазақша грамматикаға немесе діни терминдерге сай түзету
 */
export async function correctTranscribedText(rawText: string): Promise<string> {
  if (!rawText || rawText.trim().length === 0) return rawText;

  try {
    console.log(`[🎙 CORRECTOR] Correcting speech transcription with Gemini: "${rawText}"`);
    const response = await generateContentFixed({
      model: GEMINI_GENERATION_MODEL,
      contents: [{ role: 'user', parts: [{ text: rawText }] }],
      config: {
        systemInstruction: TRANSCRIPTION_CORRECTION_PROMPT,
        temperature: 0.1,
        thinkingConfig: {
          thinkingLevel: ThinkingLevel.MINIMAL
        }
      }
    });

    const result = (response.text || '').trim();
    if (result && result.length > 0) {
      const validated = validateAndCleanCorrection(rawText, result);
      console.log(`[🎙 CORRECTOR] Successfully corrected transcription: "${validated}" (original: "${rawText}")`);
      return validated;
    }
  } catch (error: any) {
    console.error('[❌ CORRECTOR ERROR]: Failed to correct voice transcription, falling back to raw:', error.message || error);
  }

  return rawText;
}
