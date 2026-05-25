import { generateAgentAnswerStream } from './aiService';
import { ai } from './aiClient';
import { db } from '../db/firestore';
import * as searchService from './searchService';
import * as quranService from './quranService';

jest.mock('./aiClient', () => ({
  ai: {
    models: {
      generateContent: jest.fn(),
      generateContentStream: jest.fn()
    }
  }
}));

jest.mock('./searchService', () => ({
  searchAnswers: jest.fn()
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

      (ai.models.generateContentStream as jest.Mock).mockResolvedValue(mockStream());
      const onChunk = jest.fn();
      const onAction = jest.fn();

      const res = await generateAgentAnswerStream('chat_1', 'hello?', onChunk, onAction);

      expect(onChunk).toHaveBeenCalledTimes(2);
      expect(onChunk).toHaveBeenNthCalledWith(1, 'Hello ');
      expect(onChunk).toHaveBeenNthCalledWith(2, 'Hello world!');
      expect(res.answer).toBe('Hello world!');
      expect(res.sources).toEqual([]);
      expect(onAction).toHaveBeenCalledWith(`Сұрақты талдаудамын...`);
    });

    it('calls tool, searches database, and handles subsequent stream', async () => {
      // First iteration: Model returns a function call
      async function* mockStream1() {
        yield {
          functionCalls: [{ name: 'searchDatabase', args: { searchQuery: 'namaz' } }]
        };
      }
      
      // Second iteration: Model computes final answer
      async function* mockStream2() {
        yield { text: 'This is ' };
        yield { text: 'about Namaz.' };
      }

      (ai.models.generateContentStream as jest.Mock)
        .mockResolvedValueOnce(mockStream1())
        .mockResolvedValueOnce(mockStream2());

      const mockSearchResults = [{ book: 'Namaz Book', page: 1, text: 'Namaz is...', score: 0.9 }];
      (searchService.searchAnswers as jest.Mock).mockResolvedValue(mockSearchResults);

      const onChunk = jest.fn();
      const onAction = jest.fn();

      const res = await generateAgentAnswerStream('chat_2', 'what is namaz?', onChunk, onAction);

      // Verify Actions
      expect(onAction).toHaveBeenCalledWith(`Сұрақты талдаудамын...`);
      expect(onAction).toHaveBeenCalledWith(`Жадыны қараудамын...`);
      expect(onAction).toHaveBeenCalledWith(`Дерекқордан іздеудемін...`);
      expect(onAction).toHaveBeenCalledWith(`Жауапты құрастырудамын...`);
      
      // Verify Function Calling behavior
      expect(searchService.searchAnswers).toHaveBeenCalledWith('namaz');
      
      // Verify final response
      expect(onChunk).toHaveBeenCalledTimes(2);
      expect(onChunk).toHaveBeenNthCalledWith(1, 'This is ');
      expect(onChunk).toHaveBeenNthCalledWith(2, 'This is about Namaz.');
      expect(res.answer).toBe('This is about Namaz.');
      expect(res.sources).toEqual(mockSearchResults);
    });

    it('calls get_quran_verse tool, searches Quran, and handles subsequent stream', async () => {
      // First iteration: Model returns a function call for Quran
      async function* mockStream1() {
        yield {
          functionCalls: [{ name: 'get_quran_verse', args: { verseKeyOrQuery: '2:183' } }]
        };
      }
      
      // Second iteration: Model computes final answer
      async function* mockStream2() {
        yield { text: 'Oraza ' };
        yield { text: 'ayaty.' };
      }

      (ai.models.generateContentStream as jest.Mock)
        .mockResolvedValueOnce(mockStream1())
        .mockResolvedValueOnce(mockStream2());

      const mockQuranVerse = {
        verseKey: '2:183',
        arabicText: 'يَا أَيُّهَا الَّذِينَ...',
        translationText: 'Әй иман келтіргендер...',
        surahNameKk: 'Бақара',
        quranComUrl: 'https://quran.com/2/183'
      };
      (quranService.fetchSingleVerse as jest.Mock).mockResolvedValue(mockQuranVerse);

      const onChunk = jest.fn();
      const onAction = jest.fn();

      const res = await generateAgentAnswerStream('chat_4', '2:183 аяты', onChunk, onAction);

      // Verify actions
      expect(onAction).toHaveBeenCalledWith(`Сұрақты талдаудамын...`);
      expect(onAction).toHaveBeenCalledWith(`Жадыны қараудамын...`);
      expect(onAction).toHaveBeenCalledWith(`Аяттарды қараудамын...`);
      expect(onAction).toHaveBeenCalledWith(`Жауапты құрастырудамын...`);
      
      // Verify Function Calling behavior
      expect(quranService.fetchSingleVerse).toHaveBeenCalledWith('2:183');
      
      // Verify final response
      expect(onChunk).toHaveBeenCalledTimes(2);
      expect(onChunk).toHaveBeenNthCalledWith(1, 'Oraza ');
      expect(onChunk).toHaveBeenNthCalledWith(2, 'Oraza ayaty.');
      expect(res.answer).toBe('Oraza ayaty.');
      expect(res.sources[0]).toEqual({
        book: 'Бақара сүресі',
        page: 183,
        text: 'يَا أَيُّهَا الَّذِينَ...\nӘй иман келтіргендер...',
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
      (ai.models.generateContentStream as jest.Mock).mockResolvedValue(mockStream());

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

    it('handles errors gracefully', async () => {
      (ai.models.generateContentStream as jest.Mock).mockRejectedValue(new Error('Network error'));
      
      const onChunk = jest.fn();
      const onAction = jest.fn();

      const res = await generateAgentAnswerStream('chat_3', 'hello?', onChunk, onAction);

      expect(res.answer).toContain('Кешіріңіз');
      expect(res.sources).toEqual([]);
    });
  });
});

