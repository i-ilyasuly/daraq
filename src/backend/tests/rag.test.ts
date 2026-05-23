import { vi, describe, it, expect, beforeEach } from 'vitest';

// --- Hoisted Mocks ---
const { 
  mockEmbedContent, 
  mockGenerateContent, 
  mockQdrantSearch, 
  mockGet, 
  mockAdd, 
  mockCollection 
} = vi.hoisted(() => {
  const mockGet = vi.fn();
  const mockAdd = vi.fn();
  return {
    mockEmbedContent: vi.fn(),
    mockGenerateContent: vi.fn(),
    mockQdrantSearch: vi.fn(),
    mockGet,
    mockAdd,
    mockCollection: vi.fn().mockReturnValue({
      doc: vi.fn().mockReturnValue({
        collection: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              get: mockGet
            })
          }),
          add: mockAdd
        })
      })
    })
  };
});

// Mock GoogleGenAI SDK
vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class {
      models = {
        embedContent: mockEmbedContent,
        generateContent: mockGenerateContent
      };
    }
  };
});

// Mock Qdrant Database Connections
vi.mock('../db/qdrant', () => {
  return {
    qdrant: {
      search: mockQdrantSearch
    }
  };
});

// Mock Firestore Database Connections
vi.mock('../db/firestore', () => {
  return {
    db: {
      collection: mockCollection
    }
  };
});

// Import the modules under test
import { searchAnswers } from '../rag/searchService';
import { generateAnswer } from '../rag/aiService';
import { formatTelegramMessage } from '../bot/index';

describe('Daraq Bot Subsystem Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  // ==========================================
  // 1. TELEGRAM MESSAGE FORMATTING TESTS
  // ==========================================
  describe('Telegram Message Formatting', () => {
    it('should correctly replace HTML break-lines with newlines', () => {
      const input = 'Бірінші хабарлама.<br>Екінші хабарлама.<br />Үшінші хабарлама.';
      const output = formatTelegramMessage(input);
      expect(output).toBe('Бірінші хабарлама.\nЕкінші хабарлама.\nҮшінші хабарлама.');
    });

    it('should replace paragraphs <p> and </p> tags properly', () => {
      const input = '<p>Бірінші абзац.</p><p>Екінші абзац.</p>';
      const output = formatTelegramMessage(input);
      expect(output).toBe('Бірінші абзац.\n\nЕкінші абзац.\n\n');
    });

    it('should fallback formatting for markdown bold and italic', () => {
      const input = 'Бұл **маңызды** сөз және *көлбеу* сөз.';
      const output = formatTelegramMessage(input);
      expect(output).toBe('Бұл <b>маңызды</b> сөз және <i>көлбеу</i> сөз.');
    });
  });

  // ==========================================
  // 2. SEMANTIC SEARCH & VECTOR RETRIEVAL TESTS
  // ==========================================
  describe('Semantic Search Pipeline', () => {
    it('should succeed and map values correctly when embedding and Qdrant searches work', async () => {
      // Mock model embeddings response
      mockEmbedContent.mockResolvedValueOnce({
        embeddings: [{ values: new Array(1536).fill(0.1) }]
      });

      // Mock Qdrant retrieval search response
      mockQdrantSearch.mockResolvedValueOnce([
        {
          id: '123-chunk',
          score: 0.89,
          payload: {
            text: 'Сапар барысында намаз қысқартылады.',
            book: 'Фиқһ Әл-Ибадат',
            page: 45,
            imageUrl: 'https://example.com/page45.jpg'
          }
        }
      ]);

      const results = await searchAnswers('Сапар намазы қалай оқылады?');

      expect(mockEmbedContent).toHaveBeenCalledTimes(1);
      expect(mockQdrantSearch).toHaveBeenCalledTimes(1);
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        text: 'Сапар барысында намаз қысқартылады.',
        book: 'Фиқһ Әл-Ибадат',
        page: 45,
        imageUrl: 'https://example.com/page45.jpg',
        score: 0.89
      });
    });

    it('should handle embedding generation errors gracefully and return an empty array', async () => {
      // simulate leased or leaked token / API Key error
      mockEmbedContent.mockRejectedValueOnce(new Error('Your API key was reported as leaked.'));

      const results = await searchAnswers('Жолаушы намазды қалай оқиды?');

      expect(results).toEqual([]);
      expect(mockQdrantSearch).not.toHaveBeenCalled();
    });
  });

  // ==========================================
  // 3. ANSWER GENERATION (GEMINI TEXT SHAPING) TESTS
  // ==========================================
  describe('Answer Generation & Chat History', () => {
    it('should generate an answer and save the interactions to Firestore history', async () => {
      // Mock empty chat history from Firestore
      mockGet.mockResolvedValueOnce({
        empty: true,
        docs: []
      });

      // Mock model response
      mockGenerateContent.mockResolvedValueOnce({
        text: 'Жолаушы 4 рәкағаттық парыз намаздарды қысқартып оқиды.'
      });

      const searchContext = [{
        text: 'Жолаушы 4 рәкағатты парыз намаздарын 2 рәкағат етіп оқиды.',
        book: 'Сапар фиқһы',
        page: 5,
        imageUrl: 'https://example.com/image.jpg',
        score: 0.95
      }];

      const result = await generateAnswer('chat-123', 'Жолаушы намазы?', searchContext);

      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      expect(mockAdd).toHaveBeenCalledTimes(2); // One for user prompt, one for bot reply
      expect(result.answer).toBe('Жолаушы 4 рәкағаттық парыз намаздарды қысқартып оқиды.');
      expect(result.sources).toEqual(searchContext);
    });

    it('should format premium error messages when API key is reported as exhausted or blocked', async () => {
      // Mock empty chat history
      mockGet.mockResolvedValueOnce({
        empty: true,
        docs: []
      });

      // Simulate credits depleted or RESOURCE_EXHAUSTED error
      mockGenerateContent.mockRejectedValueOnce(
        new Error('RESOURCE_EXHAUSTED: Your API key quota has been depleted.')
      );

      const result = await generateAnswer('chat-123', 'Парз намаздар?', []);

      expect(result.answer).toContain('Resource Exhausted / Billing/Credits Depleted');
    });

    it('should stitch contiguous chat histories of identical roles together to keep alternate role system correct', async () => {
      // Mock consecutive same-role history (Firestore descending order: newest message first)
      const mockHistoryDocs = [
        { data: () => ({ role: 'bot', text: 'Жауап 1', timestamp: new Date(Date.now() - 10 * 1000) }) },
        { data: () => ({ role: 'user', text: 'Сұрақ 2', timestamp: new Date(Date.now() - 20 * 1000) }) },
        { data: () => ({ role: 'user', text: 'Сұрақ 1', timestamp: new Date(Date.now() - 30 * 1000) }) }
      ];
      mockGet.mockResolvedValueOnce({
        empty: false,
        docs: mockHistoryDocs
      });

      mockGenerateContent.mockResolvedValueOnce({
        text: 'Жауап 2'
      });

      const result = await generateAnswer('chat-123', 'Сұрақ 3', []);

      // Verify that generateContent was called with stitched together messages
      // Mock history should merge user messages into a single user block
      expect(mockGenerateContent).toHaveBeenCalled();
      const calledArgs = mockGenerateContent.mock.calls[0][0];
      
      // Let's inspect the stitched structure passed as contents to Gemini
      const contents = calledArgs.contents;
      expect(contents).toBeDefined();
      
      // First is the user history block (merged Сұрақ 1 & Сұрақ 2)
      expect(contents[0].role).toBe('user');
      expect(contents[0].parts[0].text).toContain('Сұрақ 1');
      expect(contents[0].parts[0].text).toContain('Сұрақ 2');
      
      // Second is model reply
      expect(contents[1].role).toBe('model');
      expect(contents[1].parts[0].text).toBe('Жауап 1');
    });
  });
});
