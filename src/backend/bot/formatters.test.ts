import { formatForStandardTelegramHTML, formatTelegramMessage } from './formatters';

describe('formatForStandardTelegramHTML', () => {
  it('should extract audio URLs and remove audio tags from the HTML text', () => {
    const input = 'Мәтін <audio src="https://example.com/audio1.mp3"></audio> соңындағы <audio src="https://example.com/audio2.mp3"></audio> сөз.';
    const result = formatForStandardTelegramHTML(input);

    expect(result.text).toBe('Мәтін  соңындағы  сөз.');
    expect(result.audios).toEqual([
      'https://example.com/audio1.mp3',
      'https://example.com/audio2.mp3',
    ]);
  });

  it('should convert <aside> tags to expandable blockquotes', () => {
    const input = '<aside>Бұл маңызды діни мәтін немесе аят.</aside>';
    const result = formatForStandardTelegramHTML(input);

    expect(result.text).toBe('<blockquote expandable>Бұл маңызды діни мәтін немесе аят.</blockquote>');
    expect(result.audios).toEqual([]);
  });

  it('should convert <details> and <summary> blocks to expandable blockquotes', () => {
    const input = '<details><summary>Толығырақ білу үшін басыңыз</summary>Бұл жасырын мәтіннің мазмұны.</details>';
    const result = formatForStandardTelegramHTML(input);

    expect(result.text).toBe('<blockquote expandable><b>Толығырақ білу үшін басыңыз</b>\nБұл жасырын мәтіннің мазмұны.</blockquote>');
  });

  it('should convert leftover details, summary, and mark tags', () => {
    const input = '<details>Қарапайым блок</details><summary>Тақырыбы</summary> және <mark>ерекше мәтін</mark>';
    const result = formatForStandardTelegramHTML(input);

    expect(result.text).toBe('<blockquote>Қарапайым блок</blockquote><b>Тақырыбы</b>\n және <b><u>ерекше мәтін</u></b>');
  });

  it('should convert <tg-reference> tags to italic references with bracketed names', () => {
    const input = 'Мәтін <tg-reference name="Сапар фиқһы, 45-бет">Толық мәлімет осында</tg-reference>';
    const result = formatForStandardTelegramHTML(input);

    expect(result.text).toBe('Мәтін \n\n<i>[Сапар фиқһы, 45-бет]: Толық мәлімет осында</i>');
  });

  it('should handle complex mixed HTML formatting with multiple transformations', () => {
    const input = `
      <aside>
        <b>Бақара сүресі, 183-аят</b>
        <audio src="https://audio.qurancdn.com/Baqarah_183.mp3"></audio>
      </aside>
      <details>
        <summary>Түсіндірме</summary>
        Бұл ораза туралы аят. <mark>Міндетті</mark> амал.
      </details>
    `.trim();

    const result = formatForStandardTelegramHTML(input);

    expect(result.text).toContain('<blockquote expandable>');
    expect(result.text).toContain('</blockquote>');
    expect(result.text).toContain('<b><u>Міндетті</u></b>');
    expect(result.audios).toEqual(['https://audio.qurancdn.com/Baqarah_183.mp3']);
  });
});

describe('formatTelegramMessage Extra Edge Cases', () => {
  it('should normalize consecutive blank lines without breaking HTML tags', () => {
    const input = 'Жол 1\n\n\n\n\nЖол 2';
    const result = formatTelegramMessage(input);
    expect(result).toBe('Жол 1<br><br>Жол 2');
  });

  it('should clean up extra line breaks inside and around asides', () => {
    const input = '<aside><br><br>Мәтін<br><br></aside>';
    const result = formatTelegramMessage(input);
    // Should collapse multiple br tags near boundaries, keeping <aside> intact
    expect(result).toBe('<br><aside><br>Мәтін<br></aside>');
  });

  it('should correct order and ensure <hr/> comes after the <audio> player', () => {
    const input = '<hr/>\n<audio src="https://example.com/audio.mp3"></audio>';
    const result = formatTelegramMessage(input);
    expect(result).toContain('<audio src="https://example.com/audio.mp3"></audio><hr/>');
  });

  it('should match multiple Quran references with varying suffix types and hyper-link them', () => {
    const quranSources = [
      { book: 'Ниса сүресі', page: 103, url: 'https://quran.com/4/103' },
      { book: 'Мәида сүресі', page: 6, url: 'https://quran.com/5/6' }
    ];

    const input = 'Оқыңыз: Ниса сүресі, 103-аят және Мәида сүресінің 6-аятында.';
    const result = formatTelegramMessage(input, quranSources);

    expect(result).toContain('<a href="https://quran.com/4/103">Ниса сүресі, 103-аят</a>');
    expect(result).toContain('<a href="https://quran.com/5/6">Мәида сүресінің 6-аятында</a>');
  });
});
