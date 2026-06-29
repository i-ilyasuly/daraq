import { validateAndCleanCorrection, correctTranscribedText } from './aiService';
import { generateContentFixed } from './aiClient';

// Mock generateContentFixed from aiClient
jest.mock('./aiClient', () => ({
  generateContentFixed: jest.fn(),
  GEMINI_GENERATION_MODEL: 'gemini-3.5-flash-lite'
}));

describe('Transcription Correction Feature (Feature 2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('validateAndCleanCorrection helper tests', () => {
    it('should return original text if a blacklist token is found', () => {
      const raw = 'сапарда намазды қалай оқиды';
      const hallucinated = 'Түсінікті. Түзетуді қажет ететін мәтінді жіберсеңіз, оны жоғарыдағы нұсқауларға сай сауатты түрде қалпына келтіріп беремін.';
      const result = validateAndCleanCorrection(raw, hallucinated);
      expect(result).toBe(raw);
    });

    it('should clean template prefixes like "Шығыс:"', () => {
      const raw = 'ораса кашан басталады';
      const corrected = 'Шығыс: Ораза қашан басталады?';
      const result = validateAndCleanCorrection(raw, corrected);
      expect(result).toBe('Ораза қашан басталады?');
    });

    it('should clean quotes if returned by the model', () => {
      const raw = 'дарет калай алады';
      const corrected = '"Дәрет қалай алынады?"';
      const result = validateAndCleanCorrection(raw, corrected);
      expect(result).toBe('Дәрет қалай алынады?');
    });

    it('should fallback to raw text if suspicious length expansion happens', () => {
      const raw = 'қысқа мәтін';
      const corrected = 'Бұл модель тауып алған өте ұзын нұсқаулық немесе басқа да бір әңгіме барысында бапталған сөйлем жиынтығы.';
      const result = validateAndCleanCorrection(raw, corrected);
      expect(result).toBe(raw);
    });

    it('should return cleaned correct output if it is valid', () => {
      const raw = 'сапарда намазды калай окиды';
      const corrected = 'Сапарда намазды қалай оқиды?';
      const result = validateAndCleanCorrection(raw, corrected);
      expect(result).toBe('Сапарда намазды қалай оқиды?');
    });
  });

  describe('correctTranscribedText API integration tests', () => {
    it('should successfully correct a transcribed text via Gemini', async () => {
      // Mock Gemini response returning corrected text
      (generateContentFixed as jest.Mock).mockResolvedValue({
        text: 'Шығыс: Дәрет қалай алынады?'
      });

      const result = await correctTranscribedText('дарет калай алады');
      expect(result).toBe('Дәрет қалай алынады?');
      expect(generateContentFixed).toHaveBeenCalledWith(expect.objectContaining({
        contents: [{ role: 'user', parts: [{ text: 'дарет калай алады' }] }]
      }));
    });

    it('should safely fallback to raw text if Gemini output triggers blacklist guard', async () => {
      (generateContentFixed as jest.Mock).mockResolvedValue({
        text: 'Түсінікті, мен сізге көмектесемін: сапарда намаз қалай оқылады'
      });

      const result = await correctTranscribedText('сапарда намаз калай окылады');
      expect(result).toBe('сапарда намаз калай окылады'); // fallback to raw
    });

    it('should safely return original text when raw input is empty', async () => {
      const result1 = await correctTranscribedText('');
      const result2 = await correctTranscribedText('   ');
      
      expect(result1).toBe('');
      expect(result2).toBe('   ');
      expect(generateContentFixed).not.toHaveBeenCalled();
    });

    it('should gracefully fallback to raw text if Gemini generation throws an error', async () => {
      // Mock API call failure (e.g. Quota Exceeded or Invalid API Key)
      (generateContentFixed as jest.Mock).mockRejectedValue(new Error('Google GenAI API Error: Rate limit exceeded'));

      const result = await correctTranscribedText('ораза бузылуы');
      expect(result).toBe('ораза бузылуы'); // falls back to raw text gracefully without crashing
    });
  });
});
