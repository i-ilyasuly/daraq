import { searchAnswers } from './searchService';
import { ai } from './aiClient';
import { qdrant } from '../db/qdrant';

jest.mock('./aiClient', () => ({
  ai: {
    models: {
      embedContent: jest.fn()
    }
  }
}));

jest.mock('../db/qdrant', () => ({
  qdrant: {
    query: jest.fn()
  }
}));

describe('searchService', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    // Mock global fetch for Cohere API
    fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        results: [
          { index: 0, relevance_score: 0.95 }
        ]
      })
    });
    global.fetch = fetchMock;
    process.env.COHERE_API_KEY = "test_key";
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should search answers successfully', async () => {
    // Mock the embeddings response
    (ai.models.embedContent as jest.Mock).mockResolvedValue({
      embeddings: [{ values: [0.1, 0.2, 0.3] }]
    });

    // Mock Qdrant query
    (qdrant.query as jest.Mock).mockResolvedValue({
      points: [
        {
          score: 0.9,
          payload: {
            text: 'This is a test text',
            book: 'Test Book',
            page: 10,
            imageUrl: 'http://test.com/image.jpg'
          }
        }
      ]
    });

    const results = await searchAnswers('how to pray?');

    expect(results).toHaveLength(1);
    expect(results[0].text).toBe('This is a test text');
    expect(results[0].book).toBe('Test Book');
    expect(results[0].page).toBe(10);
    expect(results[0].score).toBe(0.95); // updated by reranker mock

    expect(qdrant.query).toHaveBeenCalledWith('daraq_books', expect.objectContaining({
      query: { fusion: "rrf" },
      limit: 30,
      with_payload: true
    }));
  });

  it('should return empty array on embedding error', async () => {
    (ai.models.embedContent as jest.Mock).mockRejectedValue(new Error('API Error'));
    const results = await searchAnswers('test query');
    expect(results).toEqual([]);
  });

  it('should return empty array if no vectors generated', async () => {
    (ai.models.embedContent as jest.Mock).mockResolvedValue({
      embeddings: []
    });
    const results = await searchAnswers('test query');
    expect(results).toEqual([]);
  });
});
