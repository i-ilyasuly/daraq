// Hoisted variables for mock must start with "mock" and be declared before any mocked imports
var mockRequest = jest.fn();

import { searchAnswers } from './searchService';
import { embedText } from './aiClient';
import { qdrant } from '../db/qdrant';

// Mock Qdrant Client
jest.mock('../db/qdrant', () => ({
  qdrant: {
    query: jest.fn()
  }
}));

// Mock aiClient embedding function
jest.mock('./aiClient', () => ({
  ai: {
    models: {
      embedContent: jest.fn()
    }
  },
  embedText: jest.fn(),
  GEMINI_EMBEDDING_MODEL: 'gemini-embedding-2-preview'
}));

// Mock Google Auth and Discovery Engine Ranking API
jest.mock('google-auth-library', () => {
  return {
    GoogleAuth: jest.fn().mockImplementation(() => {
      return {
        getClient: jest.fn().mockResolvedValue({
          request: mockRequest
        }),
        getProjectId: jest.fn().mockResolvedValue('test-project-id')
      };
    })
  };
});

describe('searchService (Feature 1: Hybrid Search & Reranking)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should successfully perform hybrid search and rerank results with high score', async () => {
    // 1. Mock embedText
    (embedText as jest.Mock).mockResolvedValue({
      embeddings: [{ values: new Array(1536).fill(0.15) }]
    });

    // 2. Mock Qdrant points returned
    (qdrant.query as jest.Mock).mockResolvedValue({
      points: [
        {
          id: '1',
          score: 0.025,
          payload: {
            text: 'Ораза парыз етілген құлшылық.',
            parentText: 'Рамазан айында ораза ұстау әрбір мұсылманға парыз етілген.',
            book: 'Сапар Фиқһы',
            page: 15,
            imageUrl: 'https://storage.googleapis.com/daraq/page15.png'
          }
        },
        {
          id: '2',
          score: 0.021,
          payload: {
            text: 'Намаз оқу ережелері.',
            book: 'Фиқһ Әл-Ғибадат',
            page: 40,
            imageUrl: 'https://storage.googleapis.com/daraq/page40.png'
          }
        }
      ]
    });

    // 3. Mock Vertex AI Ranking API successful response
    mockRequest.mockResolvedValue({
      data: {
        records: [
          { id: '0', score: 0.85 }, // matches first doc
          { id: '1', score: 0.15 }  // matches second doc
        ]
      }
    });

    const results = await searchAnswers('ораза парыз ба?');

    // Expectations
    expect(results).toHaveLength(1); // Only first doc because its reranked score (0.85) >= 0.40, while second is 0.15 (below 0.40 strict threshold)
    expect(results[0].text).toBe('Рамазан айында ораза ұстау әрбір мұсылманға парыз етілген.'); // uses parentText as context
    expect(results[0].book).toBe('Сапар Фиқһы');
    expect(results[0].page).toBe(15);
    expect(results[0].score).toBe(0.85);

    expect(qdrant.query).toHaveBeenCalledWith('daraq_books', expect.objectContaining({
      prefetch: expect.arrayContaining([
        expect.objectContaining({ limit: 30 })
      ]),
      query: { fusion: "rrf" },
      limit: 30,
      with_payload: true
    }));
  });

  it('should fallback to soft threshold (Score >= 0.05) and return top items if no docs exceed 0.40', async () => {
    (embedText as jest.Mock).mockResolvedValue({
      embeddings: [{ values: new Array(1536).fill(0.1) }]
    });

    (qdrant.query as jest.Mock).mockResolvedValue({
      points: [
        {
          id: '1',
          score: 0.025,
          payload: { text: 'Тәяммум алу тәсілдері.', book: 'Сапар Фиқһы', page: 22, imageUrl: 'img22' }
        },
        {
          id: '2',
          score: 0.020,
          payload: { text: 'Дәрет бұзылу себептері.', book: 'Фиқһ Әл-Ғибадат', page: 31, imageUrl: 'img31' }
        }
      ]
    });

    // Mock Vertex AI to return scores below 0.40, but above 0.05
    mockRequest.mockResolvedValue({
      data: {
        records: [
          { id: '0', score: 0.35 },
          { id: '1', score: 0.12 }
        ]
      }
    });

    const results = await searchAnswers('тәяммум қалай алынады?');

    // Expectations: strict threshold >= 0.40 fails, so it falls back to soft threshold (score >= 0.05) and takes top 3
    expect(results).toHaveLength(2);
    expect(results[0].text).toBe('Тәяммум алу тәсілдері.');
    expect(results[0].score).toBe(0.35);
    expect(results[1].text).toBe('Дәрет бұзылу себептері.');
    expect(results[1].score).toBe(0.12);
  });

  it('should gracefully fallback to Qdrant top-5 results when Vertex AI Ranking Config call fails', async () => {
    (embedText as jest.Mock).mockResolvedValue({
      embeddings: [{ values: new Array(1536).fill(0.1) }]
    });

    (qdrant.query as jest.Mock).mockResolvedValue({
      points: [
        {
          id: '1',
          score: 0.03, // Qdrant RRF score
          payload: { text: 'Сапар намазының қысқартылуы.', book: 'Сапар Фиқһы', page: 5, imageUrl: 'img5' }
        },
        {
          id: '2',
          score: 0.001, // lower than fallback threshold (0.005)
          payload: { text: 'Басқа тақырып.', book: 'Фиқһ Әл-Ғибадат', page: 99, imageUrl: 'img99' }
        }
      ]
    });

    // Vertex Reranker throws error
    mockRequest.mockRejectedValue(new Error('Vertex Ranking API Limit Exceeded'));

    const results = await searchAnswers('сапарда намаз қысқара ма?');

    // Expectations: Fallback returns top results from Qdrant where score >= 0.005
    expect(results).toHaveLength(1);
    expect(results[0].text).toBe('Сапар намазының қысқартылуы.');
    expect(results[0].score).toBe(0.03);
  });

  it('should deduplicate search results when multiple child chunks share the same parentText', async () => {
    (embedText as jest.Mock).mockResolvedValue({
      embeddings: [{ values: new Array(1536).fill(0.1) }]
    });

    (qdrant.query as jest.Mock).mockResolvedValue({
      points: [
        {
          id: '1',
          score: 0.03,
          payload: {
            text: 'Бірінші бөлік.',
            parentText: 'Ораза тұтудың пайдалары мен маңызы өте зор.',
            book: 'Ораза құлшылығы',
            page: 5
          }
        },
        {
          id: '2',
          score: 0.028,
          payload: {
            text: 'Екінші бөлік.',
            parentText: 'Ораза тұтудың пайдалары мен маңызы өте зор.', // duplicate parent
            book: 'Ораза құлшылығы',
            page: 5
          }
        }
      ]
    });

    mockRequest.mockResolvedValue({
      data: {
        records: [
          { id: '0', score: 0.90 },
          { id: '1', score: 0.88 }
        ]
      }
    });

    const results = await searchAnswers('ораза маңызы');

    // Expectations: Deduplicated by parent text
    expect(results).toHaveLength(1);
    expect(results[0].text).toBe('Ораза тұтудың пайдалары мен маңызы өте зор.');
  });
});
