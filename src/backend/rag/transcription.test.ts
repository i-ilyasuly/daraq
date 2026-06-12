import { validateAndCleanCorrection } from './aiService';

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
