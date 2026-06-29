import { formatForStandardTelegramHTML, formatTelegramMessage } from './formatters';

// Simulated logic matching src/backend/bot/index.ts lines 406-410 for message effects
function getMessageEffectId(answerText: string): string | undefined {
  const lf = answerText.toLowerCase();
  if (
    lf.includes('мүбәрак') ||
    lf.includes('мубарак') ||
    lf.includes('айт қабыл болсын') ||
    lf.includes('айт кабыл болсын') ||
    lf.includes('благословенн') ||
    lf.includes('қабыл етсін')
  ) {
    return '5046509860389126442';
  }
  return undefined;
}

describe('Telegram Bot API 10.1 Features & Message Effects', () => {
  describe('Message Effects (message_effect_id)', () => {
    it('should assign effect ID for Kazakh Eid congratulations (мүбәрак)', () => {
      const text = 'Айт мүбәрак болсын! Ораза тұтушыларға жеңілдік тілеймін.';
      expect(getMessageEffectId(text)).toBe('5046509860389126442');
    });

    it('should assign effect ID for Kazakh Eid congratulations (айт қабыл болсын)', () => {
      const text = 'Ораза айт қабыл болсын, бауырлар!';
      expect(getMessageEffectId(text)).toBe('5046509860389126442');
    });

    it('should assign effect ID for Russian Eid congratulations (благословенного праздника)', () => {
      const text = 'Желаем вам благословенного праздника и процветания!';
      expect(getMessageEffectId(text)).toBe('5046509860389126442');
    });

    it('should assign effect ID for accepted prayer congratulations (қабыл етсін)', () => {
      const text = 'Алла тағала дұға-тілектеріңізді қабыл етсін!';
      expect(getMessageEffectId(text)).toBe('5046509860389126442');
    });

    it('should not assign effect ID for normal queries', () => {
      const text = 'Таң намазының уақыты қашан кіреді?';
      expect(getMessageEffectId(text)).toBeUndefined();
    });
  });

  describe('Expandable Blockquotes (<blockquote expandable>) and Details/Summary conversion', () => {
    it('should convert <aside> tags to expandable blockquotes', () => {
      const input = '<aside>Бұл - ақпараттық хабарлама.</aside>';
      const result = formatForStandardTelegramHTML(input);
      expect(result.text).toBe('<blockquote expandable>Бұл - ақпараттық хабарлама.</blockquote>');
    });

    it('should convert details and summary structure to expandable blockquote', () => {
      const input = '<details><summary>Толық нұсқаулық</summary>Жауаптың толық сипаттамасы осы жерде.</details>';
      const result = formatForStandardTelegramHTML(input);
      expect(result.text).toBe('<blockquote expandable><b>Толық нұсқаулық</b>\nЖауаптың толық сипаттамасы осы жерде.</blockquote>');
    });

    it('should clean up standalone details and summary elements gracefully', () => {
      const input = '<details>Контент</details><summary>Тақырыбы</summary>';
      const result = formatForStandardTelegramHTML(input);
      expect(result.text).toBe('<blockquote>Контент</blockquote><b>Тақырыбы</b>\n');
    });

    it('should handle nested formatted elements inside expandable blockquotes', () => {
      const input = '<details><summary>Маңызды ереже</summary>Намаздың <b>6 сыртқы</b> және <i>6 ішкі</i> парызы бар.</details>';
      const result = formatForStandardTelegramHTML(input);
      expect(result.text).toBe(
        '<blockquote expandable><b>Маңызды ереже</b>\nНамаздың <b>6 сыртқы</b> және <i>6 ішкі</i> парызы бар.</blockquote>'
      );
    });
  });

  describe('Audio URLs Extraction and Native Send Support', () => {
    it('should extract multiple audio tags and return their source URLs separately', () => {
      const input = 'Аят 1: <audio src="https://example.com/audio1.mp3"></audio> Аят 2: <audio src="https://example.com/audio2.mp3"></audio>';
      const result = formatForStandardTelegramHTML(input);
      expect(result.text).toBe('Аят 1:  Аят 2: ');
      expect(result.audios).toEqual(['https://example.com/audio1.mp3', 'https://example.com/audio2.mp3']);
    });

    it('should return empty list if no audio elements exist', () => {
      const input = 'Қарапайым мәтін.';
      const result = formatForStandardTelegramHTML(input);
      expect(result.text).toBe('Қарапайым мәтін.');
      expect(result.audios).toEqual([]);
    });
  });

  describe('Formatting & Line Break Normalization Rules', () => {
    it('should replace four or more consecutive breaks with exactly two breaks to keep readability clean', () => {
      const input = 'Сәлем!<br><br><br><br>Қалайсың?<br><br><br>Жақсы.';
      const result = formatTelegramMessage(input);
      expect(result).toBe('Сәлем!<br><br>Қалайсың?<br><br>Жақсы.');
    });

    it('should place <hr/> after <audio> even if originally before it', () => {
      const input = '<hr/><audio src="https://audio.com/file.mp3"></audio>';
      const result = formatTelegramMessage(input);
      expect(result).toBe('<audio src="https://audio.com/file.mp3"></audio><hr/>');
    });

    it('should clean up double br tags immediately inside aside block boundaries', () => {
      const input = '<aside><br><br>Ораза ережесі<br><br></aside>';
      const result = formatTelegramMessage(input);
      expect(result).toBe('<br><aside><br>Ораза ережесі<br></aside>');
    });
  });
});
