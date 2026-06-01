import { setupBot, processAndDeduplicateSources, buildKeyboard, getSourceInfo, setSourceInfo, getGroupInfo, setGroupInfo } from './index';
import { formatTelegramMessage, transliterateToLatin, isAskingForProof } from './formatters';

jest.mock('telegraf', () => {
  return {
    Telegraf: jest.fn().mockImplementation(() => {
      const mockBotInstance = {
        start: jest.fn(),
        command: jest.fn(),
        on: jest.fn(),
        action: jest.fn(),
        catch: jest.fn(),
        launch: jest.fn().mockResolvedValue(true),
        telegram: {
          deleteWebhook: jest.fn().mockResolvedValue(true),
          setWebhook: jest.fn().mockResolvedValue(true),
        }
      };
      return mockBotInstance;
    }),
    Markup: {
      inlineKeyboard: jest.fn().mockImplementation((buttons) => ({ reply_markup: { inline_keyboard: buttons } })),
      button: { 
        callback: jest.fn().mockImplementation((text, data) => ({ text, callback_data: data })),
        url: jest.fn().mockImplementation((text, url) => ({ text, url }))
      }
    }
  };
});

jest.mock('uuid', () => ({ v4: () => '123' }));
jest.mock('sharp', () => jest.fn());
jest.mock('@google-cloud/storage', () => ({
  Storage: jest.fn().mockImplementation(() => ({
    bucket: jest.fn()
  }))
}));

const mockDocGet = jest.fn();
const mockDocSet = jest.fn();
const mockCollection = jest.fn().mockImplementation(() => ({
  doc: jest.fn().mockImplementation(() => ({
    get: mockDocGet,
    set: mockDocSet
  }))
}));

jest.mock('../db/firestore', () => ({
  db: {
    collection: (name: string) => mockCollection(name)
  }
}));

describe('Bot Setup & Helpers', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns null if TELEGRAM_BOT_TOKEN is missing', () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const bot = setupBot();
    expect(bot).toBeNull();
  });

  it('returns a bot instance if TELEGRAM_BOT_TOKEN is provided', () => {
    process.env.TELEGRAM_BOT_TOKEN = 'mock_token';
    const bot = setupBot();
    expect(bot).toBeDefined();
  });

  describe('formatTelegramMessage', () => {
    it('converts markdown double-asterisks to bold tags', () => {
      const result = formatTelegramMessage('Бұл **маңызды** мәтін.');
      expect(result).toBe('Бұл <b>маңызды</b> мәтін.');
    });

    it('converts markdown single-asterisks to italic tags', () => {
      const result = formatTelegramMessage('Бұл *көлбеу* мәтін.');
      expect(result).toBe('Бұл <i>көлбеу</i> мәтін.');
    });

    it('replaces list asterisk lines with bullet characters', () => {
      const result = formatTelegramMessage('* бірінші\n* екінші');
      expect(result).toBe('• бірінші\n• екінші');
    });

    it('reduces three or more blank lines to maximum two blank lines', () => {
      const result = formatTelegramMessage('Қатар 1\n\n\n\nҚатар 2');
      expect(result).toBe('Қатар 1\n\nҚатар 2');
    });

    it('successfully embeds blue HTML links for matched Quran verses from sources', () => {
      const quranSources = [
        { book: 'Бақара сүресі', page: 184, url: 'https://quran.com/2/184' },
        { book: 'Ахзаб сүресі', page: 35, url: 'https://quran.com/33/35' }
      ];

      const text = 'Ораза туралы Бақара сүресі, 184-аят ішінде жазылған. Сондай-ақ Ахзаб сүресінің 35-аятында да бар.';
      const result = formatTelegramMessage(text, quranSources);

      expect(result).toContain('<a href="https://quran.com/2/184">Бақара сүресі, 184-аят</a>');
      expect(result).toContain('<a href="https://quran.com/33/35">Ахзаб сүресінің 35-аятында</a>');
    });

    it('avoids double wrapping or altering already hyperlinked Quran verses', () => {
      const quranSources = [
        { book: 'Бақара сүресі', page: 184, url: 'https://quran.com/2/184' }
      ];

      const originalText = 'Сілтеме: <a href="https://quran.com/2/184">Бақара сүресі, 184-аят</a> бар.';
      const result = formatTelegramMessage(originalText, quranSources);

      expect(result).toBe(originalText);
    });
  });

  describe('processAndDeduplicateSources', () => {
    it('returns empty lists for null or empty sources input', () => {
      expect(processAndDeduplicateSources([])).toEqual({ quranSources: [], bookSources: [] });
      expect(processAndDeduplicateSources(null as any)).toEqual({ quranSources: [], bookSources: [] });
    });

    it('correctly processes and categorizes sources into Quran and general books', () => {
      const raw = [
        { book: 'Бақара сүресі', page: 184, url: 'https://quran.com/2/184', text: 'Аят сипаттамасы' },
        { book: 'Ораза құлшылығы', page: 42, imageUrl: 'https://storage/page_42.png', text: 'Кітап беті мәтіні' },
        { book: 'Ораза құлшылығы', page: 42, imageUrl: 'https://storage/page_42.png', text: 'Кітап беті мәтіні' } // duplicate
      ];

      const processed = processAndDeduplicateSources(raw);

      expect(processed.quranSources).toHaveLength(1);
      expect(processed.quranSources[0].book).toBe('Бақара сүресі');
      expect(processed.bookSources).toHaveLength(1); // deduplicated duplicate
      expect(processed.bookSources[0].book).toBe('Ораза құлшылығы');
    });
  });

  describe('transliterateToLatin', () => {
    it('correctly transliterates Kazakh cyrillic characters to latin', () => {
      expect(transliterateToLatin('Ораза')).toBe('Oraza');
      expect(transliterateToLatin('нұр')).toBe('nur');
      expect(transliterateToLatin('құлшылық')).toBe('qulshylyq');
    });
  });

  describe('Persistent Cache Helpers', () => {
    it('should set and get single source info from Firestore when memory cache is empty', async () => {
      const sourceId = 'src_123';
      const info = { book: 'Test Book', page: 55, imageUrl: 'https://image.com' };

      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => info
      });

      // Initially get should fetch from firestore
      const result = await getSourceInfo(sourceId);
      expect(result).toEqual(info);
      expect(mockDocGet).toHaveBeenCalled();
    });

    it('should write source cache to Firestore on setSourceInfo', () => {
      const sourceId = 'src_456';
      const info = { book: 'Another Book', page: 77, imageUrl: 'https://image2.com' };

      mockDocSet.mockResolvedValue(true);

      setSourceInfo(sourceId, info);
      expect(mockCollection).toHaveBeenCalledWith('sourceCache');
    });

    it('should set and get group sources from Firestore when memory cache is empty', async () => {
      const groupId = 'group_123';
      const sourcesList = [
        { book: 'G1', page: 1, imageUrl: 'url1' },
        { book: 'G2', page: 2, imageUrl: 'url2' }
      ];

      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({ sources: sourcesList })
      });

      const result = await getGroupInfo(groupId);
      expect(result).toEqual(sourcesList);
    });
  });

  describe('isAskingForProof', () => {
    it('returns true when query contains proof keywords', () => {
      expect(isAskingForProof('дәлелдерді көрмей тұрмын')).toBe(true);
      expect(isAskingForProof('кітабының суреті бар ма?')).toBe(true);
      expect(isAskingForProof('дәлелін көрсетші')).toBe(true);
    });

    it('returns false when query does not contain proof keywords', () => {
      expect(isAskingForProof('намаз қалай оқылады?')).toBe(false);
      expect(isAskingForProof('сәлем, қал қалай')).toBe(false);
    });
  });

  describe('buildKeyboard', () => {
    it('returns null if there are no sources at all', () => {
      expect(buildKeyboard([], [], 0, '123')).toBeNull();
    });

    it('generates a single proof image callback button if only one book source exists', () => {
      const bookSources = [{ book: 'Фиқһ әл-ғибадат', page: 25, imageUrl: 'https://img.com/p25.png' }];
      const result = buildKeyboard([], bookSources, 0, 'test_pag');
      
      expect(result).toBeDefined();
      expect(result.reply_markup.inline_keyboard[0][0].text).toContain('Дәлел: Фиқһ әл-ғибадат, 25-бет');
      expect(result.reply_markup.inline_keyboard[0][0].callback_data).toContain('view_source_');
    });

    it('generates a media group button with the correct view_srcgrp_ prefix when multiple book sources exist', () => {
      const bookSources = [
        { book: 'Кітап 1', page: 12, imageUrl: 'img1' },
         { book: 'Кітап 2', page: 34, imageUrl: 'img2' }
      ];
      const result = buildKeyboard([], bookSources, 0, 'test_pag');
      
      expect(result).toBeDefined();
      expect(result.reply_markup.inline_keyboard[0][0].text).toContain('Барлық дәлел суреттерін көру (2 сурет)');
      expect(result.reply_markup.inline_keyboard[0][0].callback_data).toContain('view_srcgrp_');
      expect(result.reply_markup.inline_keyboard[0][0].callback_data).not.toContain('view_source_group_');
    });

    it('excludes Quran buttons entirely', () => {
      const quranSources = [
        { book: 'Бақара сүресі', page: 184, url: 'https://quran.com/2/184' },
        { book: 'Бақара сүресі', page: 185, url: 'https://quran.com/2/185' }
      ];

      const result = buildKeyboard(quranSources, [], 0, 'my_pag');
      expect(result).toBeNull(); // No buttons generated because only Quran sources are provided and Quran buttons are excluded
    });
  });
});
