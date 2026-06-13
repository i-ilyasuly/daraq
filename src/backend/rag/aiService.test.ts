import { generateAgentAnswerStream } from './aiService';
import { ai, generateContentFixed, generateContentStreamFixed, embedText } from './aiClient';
import { db } from '../db/firestore';
import * as searchService from './searchService';
import * as quranService from './quranService';

jest.mock('./aiClient', () => ({
  ai: {
    models: {
      generateContent: jest.fn(),
      generateContentStream: jest.fn(),
      embedContent: jest.fn()
    }
  },
  generateContentFixed: jest.fn(),
  generateContentStreamFixed: jest.fn(),
  embedText: jest.fn().mockResolvedValue({
    embeddings: [{ values: new Array(1536).fill(0.1) }]
  })
}));

jest.mock('./searchService', () => ({
  searchAnswers: jest.fn().mockResolvedValue([])
}));

jest.mock('./cacheService', () => ({
  checkCache: jest.fn().mockResolvedValue({ hit: null, vector: undefined }),
  writeCache: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('./quranService', () => ({
  fetchSingleVerse: jest.fn(),
  searchQuran: jest.fn()
}));

jest.mock('../db/firestore', () => ({
  db: {
    collection: jest.fn().mockReturnThis(),
    doc: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({
      empty: true,
      docs: []
    }),
    add: jest.fn().mockResolvedValue({})
  }
}));

describe('aiService (Agentic RAG)', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('generateAgentAnswerStream', () => {
    it('returns streaming answer without calling tool if not needed', async () => {
      async function* mockStream() {
        yield { text: 'Hello ' };
        yield { text: 'world!' };
      }

      (generateContentStreamFixed as jest.Mock).mockResolvedValue(mockStream());
      const onChunk = jest.fn();
      const onAction = jest.fn();

      const res = await generateAgentAnswerStream('chat_1', 'hello?', onChunk, onAction);

      expect(onChunk).toHaveBeenCalledTimes(2);
      expect(onChunk).toHaveBeenNthCalledWith(1, 'Hello ');
      expect(onChunk).toHaveBeenNthCalledWith(2, 'Hello world!');
      expect(res.answer).toBe('Hello world!');
      expect(res.sources).toEqual([]);
      expect(onAction).not.toHaveBeenCalled();
    });

    it('calls parallel search on database and handles response stream', async () => {
      // Clean mock state
      (generateContentStreamFixed as jest.Mock).mockReset();

      async function* mockStream() {
        yield { text: 'This is ' };
        yield { text: 'about Namaz.' };
      }

      (generateContentStreamFixed as jest.Mock).mockResolvedValue(mockStream());

      const mockSearchResults = [{ book: 'Namaz Book', page: 1, text: 'Namaz is...', score: 0.9 }];
      (searchService.searchAnswers as jest.Mock).mockResolvedValueOnce(mockSearchResults);

      const onChunk = jest.fn();
      const onAction = jest.fn();

      const res = await generateAgentAnswerStream('chat_2', 'намаз деген не?', onChunk, onAction);

      // Verify Actions
      expect(onAction).toHaveBeenCalledWith('Дереккөздерден іздеу');
      expect(onAction).toHaveBeenCalledWith('Жауапты қалыптастыру');
      
      // Verify book search was called with query
      expect(searchService.searchAnswers).toHaveBeenCalledWith('намаз деген не?', undefined);
      
      // Verify final response
      expect(onChunk).toHaveBeenCalledTimes(3);
      expect(onChunk).toHaveBeenNthCalledWith(1, 'This is ');
      expect(onChunk).toHaveBeenNthCalledWith(2, 'This is about Namaz.');
      expect(onChunk).toHaveBeenNthCalledWith(3, expect.stringContaining('This is about Namaz.'));
      expect(res.answer).toContain('This is about Namaz.');
      expect(res.sources).toEqual(mockSearchResults);
    });

    it('identifies Quran reference in query, searches Quran, and handles response stream', async () => {
      // Clean mock state
      (generateContentStreamFixed as jest.Mock).mockReset();

      async function* mockStream() {
        yield { text: 'Oraza ' };
        yield { text: 'ayaty.' };
      }

      (generateContentStreamFixed as jest.Mock).mockResolvedValue(mockStream());

      const mockQuranVerse = {
        verseKey: '2:183',
        arabicText: 'يَا أَيُّهَا الَّذِينَ...',
        translationText: 'Әй іман келтіргендер...',
        surahNameKk: 'Бақара',
        quranComUrl: 'https://quran.com/2/183'
      };
      (quranService.fetchSingleVerse as jest.Mock).mockResolvedValue(mockQuranVerse);

      const onChunk = jest.fn();
      const onAction = jest.fn();

      const res = await generateAgentAnswerStream('chat_4', '2:183 аяты', onChunk, onAction);

      // Verify actions
      expect(onAction).toHaveBeenCalledWith('Дереккөздерден іздеу');
      expect(onAction).toHaveBeenCalledWith('Жауапты қалыптастыру');
      
      // Verify Quran service was called
      expect(quranService.fetchSingleVerse).toHaveBeenCalledWith('2:183');
      
      // Verify final response
      expect(onChunk).toHaveBeenCalledTimes(2);
      expect(onChunk).toHaveBeenNthCalledWith(1, 'Oraza ');
      expect(onChunk).toHaveBeenNthCalledWith(2, 'Oraza ayaty.');
      expect(res.answer).toBe('Oraza ayaty.');
      expect(res.sources[0]).toEqual({
        book: 'Бақара сүресі',
        page: 183,
        text: 'يَا أَيُّهَا الَّذِينَ...\nӘй іман келтіргендер...',
        imageUrl: '',
        score: 1.0,
        isQuran: true,
        url: 'https://quran.com/2/183'
      });
    });

    it('isolates memory per topic using threadId and defaults to general', async () => {
      async function* mockStream() {
        yield { text: 'test' };
      }
      (generateContentStreamFixed as jest.Mock).mockResolvedValue(mockStream());

      const onChunk = jest.fn();
      const onAction = jest.fn();

      // Test general fallback
      await generateAgentAnswerStream('chat_iso', 'Hello general', onChunk, onAction);
      expect(db.collection).toHaveBeenCalledWith('users');
      expect(db.doc).toHaveBeenCalledWith('chat_iso');
      expect(db.collection).toHaveBeenCalledWith('topics');
      expect(db.doc).toHaveBeenCalledWith('general');

      // Test specific threadId
      await generateAgentAnswerStream('chat_iso', 'Hello topic', onChunk, onAction, 12345);
      expect(db.doc).toHaveBeenCalledWith('12345');
    });

    it('handles errors gracefully by throwing', async () => {
      (generateContentStreamFixed as jest.Mock).mockRejectedValue(new Error('Network error'));
      
      const onChunk = jest.fn();
      const onAction = jest.fn();

      await expect(generateAgentAnswerStream('chat_3', 'hello?', onChunk, onAction)).rejects.toThrow('Network error');
    });

    it('uses fast track semantic cache hit and paraphrases the response using LLM instead of returning verbatim', async () => {
      (generateContentStreamFixed as jest.Mock).mockReset();
      const cacheService = require('./cacheService');
      const mockCachedSources = [{ book: 'Cache Book', page: 12, text: 'Some cached text', score: 1.0 }];
      (cacheService.checkCache as jest.Mock).mockResolvedValueOnce({
        hit: {
          answer: 'Бұл ораза бұзылса қазасын өтеу керек деген ескі жауап мәтіні.',
          sources: mockCachedSources
        },
        vector: [0.1, 0.2]
      });

      // LLM paraphrase response
      async function* mockParaphraseStream() {
        yield { text: 'Жаңаша өңделген жылы ' };
        yield { text: 'жауап мәтіні.' };
      }
      (generateContentStreamFixed as jest.Mock).mockResolvedValueOnce(mockParaphraseStream());

      const onChunk = jest.fn();
      const onAction = jest.fn();

      const result = await generateAgentAnswerStream(
        'chat_cache_test',
        'ораза бұзылса ne болады?',
        onChunk,
        onAction
      );

      // Verify onAction was called with paraphrasing/processing status
      expect(onAction).toHaveBeenCalledWith('Контексті біріктіру');

      // Verify LLM was asked to restructure/paraphrase the cached answer
      expect(generateContentStreamFixed).toHaveBeenCalledWith(expect.objectContaining({
        contents: expect.arrayContaining([
          expect.objectContaining({
            parts: expect.arrayContaining([
              expect.objectContaining({
                text: expect.stringContaining('мағынасын сақтай отырып, оны пайдаланушы үшін жаңадан')
              })
            ])
          })
        ])
      }));

      // Verify chunking and final response correctly return the paraphrased text instead of verbatim cached answer
      expect(onChunk).toHaveBeenCalledWith('Жаңаша өңделген жылы жауап мәтіні.');
      expect(result.answer).toBe('Жаңаша өңделген жылы жауап мәтіні.');
      expect(result.sources).toEqual(mockCachedSources);
    });
  });
});
