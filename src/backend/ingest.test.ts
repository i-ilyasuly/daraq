// Hoisted mock variables
var mockUploadToGCS = jest.fn();
var mockGetCollections = jest.fn();
var mockGetCollection = jest.fn();
var mockCreateCollection = jest.fn();
var mockDeleteCollection = jest.fn();
var mockCreatePayloadIndex = jest.fn();
var mockDeletePoints = jest.fn();
var mockUpsertPoints = jest.fn();

// Mock uuid completely before any imports
jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValue('mocked-uuid-v4-id-123')
}));

import { ingestBook } from './ingest';
import { embedText } from './rag/aiClient';
import { qdrant } from './db/qdrant';
import fs from 'fs';

// Mock Qdrant
jest.mock('./db/qdrant', () => ({
  qdrant: {
    getCollections: (...args: any[]) => mockGetCollections(...args),
    getCollection: (...args: any[]) => mockGetCollection(...args),
    createCollection: (...args: any[]) => mockCreateCollection(...args),
    deleteCollection: (...args: any[]) => mockDeleteCollection(...args),
    createPayloadIndex: (...args: any[]) => mockCreatePayloadIndex(...args),
    delete: (...args: any[]) => mockDeletePoints(...args),
    upsert: (...args: any[]) => mockUpsertPoints(...args)
  }
}));

// Mock embedding utility
jest.mock('./rag/aiClient', () => ({
  ai: {},
  embedText: jest.fn()
}));

// Mock PDF-JS-dist
jest.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  getDocument: jest.fn().mockImplementation(() => ({
    promise: Promise.resolve({
      numPages: 2,
      getPage: jest.fn().mockResolvedValue({
        getTextContent: jest.fn().mockResolvedValue({
          items: [{ str: 'Бұл ораза туралы бірінші парақ мәтіні.' }]
        }),
        getViewport: jest.fn().mockReturnValue({ width: 100, height: 100 }),
        render: jest.fn().mockReturnValue({ promise: Promise.resolve() })
      })
    })
  })),
  Util: {
    transform: jest.fn().mockReturnValue([0, 0, 0, 0, 10, 20])
  }
}));

// Mock canvas
jest.mock('canvas', () => ({
  createCanvas: jest.fn().mockReturnValue({
    getContext: jest.fn().mockReturnValue({
      fillStyle: 'black',
      fillText: jest.fn(),
      toBuffer: jest.fn().mockReturnValue(Buffer.from('dummy-image'))
    }),
    toBuffer: jest.fn().mockReturnValue(Buffer.from('dummy-image-buffer'))
  })
}));

// Mock Google Cloud Storage client
jest.mock('./storage', () => ({
  storage: {
    bucket: jest.fn().mockImplementation(() => ({
      file: jest.fn().mockImplementation(() => ({
        save: mockUploadToGCS
      }))
    }))
  }
}));

// Mock fs readFileSync and existsSync
jest.mock('fs', () => {
  const original = jest.requireActual('fs');
  return {
    ...original,
    readFileSync: jest.fn().mockReturnValue(Buffer.from('fake pdf data')),
    existsSync: jest.fn().mockReturnValue(true)
  };
});

describe('Document Ingestion Pipeline (Feature 3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should successfully run ingestBook with correct chunking, normalization, and saving', async () => {
    // 1. Mock Qdrant collection to already exist and match required schema
    mockGetCollections.mockResolvedValue({
      collections: [{ name: 'daraq_books' }]
    });
    mockGetCollection.mockResolvedValue({
      config: {
        params: {
          vectors: { size: 1536 },
          sparse_vectors: { text_sparse: {} }
        }
      }
    });
    mockDeletePoints.mockResolvedValue({ status: 'ok' });
    mockUpsertPoints.mockResolvedValue({ status: 'ok' });

    // 2. Mock GCS upload success
    mockUploadToGCS.mockResolvedValue(true);

    // 3. Mock embedText API success
    (embedText as jest.Mock).mockResolvedValue({
      embeddings: [{ values: new Array(1536).fill(0.01) }]
    });

    const promise = ingestBook('dummy_path.pdf', 'Сынақ Кітабы');

    // Run interval timers since sleep delays inside loop are expected
    for (let i = 0; i < 50; i++) {
      await jest.advanceTimersByTimeAsync(2500);
    }

    await promise;

    // Verify PDF loading, GCS uploading, and Qdrant upserting
    expect(mockUploadToGCS).toHaveBeenCalled();
    expect(mockGetCollections).toHaveBeenCalled();
    expect(mockDeletePoints).toHaveBeenCalledWith('daraq_books', expect.objectContaining({
      filter: { must: [{ key: 'book', match: { value: 'Сынақ Кітабы' } }] }
    }));
    expect(mockUpsertPoints).toHaveBeenCalled();
  });

  it('should recreate Qdrant collection if current size does not match 1536', async () => {
    mockGetCollections.mockResolvedValue({
      collections: [{ name: 'daraq_books' }]
    });
    // Vector size is 768 in existing collection -> needs recreation
    mockGetCollection.mockResolvedValue({
      config: {
        params: {
          vectors: { size: 768 }
        }
      }
    });
    mockDeleteCollection.mockResolvedValue(true);
    mockCreateCollection.mockResolvedValue(true);
    mockUpsertPoints.mockResolvedValue({ status: 'ok' });

    (embedText as jest.Mock).mockResolvedValue({
      embeddings: [{ values: new Array(1536).fill(0.01) }]
    });

    const promise = ingestBook('dummy_path.pdf', 'Сынақ Кітабы 2');

    for (let i = 0; i < 50; i++) {
      await jest.advanceTimersByTimeAsync(2500);
    }
    await promise;

    expect(mockDeleteCollection).toHaveBeenCalledWith('daraq_books');
    expect(mockCreateCollection).toHaveBeenCalledWith('daraq_books', expect.objectContaining({
      vectors: { size: 1536, distance: 'Cosine' },
      sparse_vectors: expect.any(Object)
    }));
  });

  it('should automatically pad small fallback embedding vectors to exactly 1536 size', async () => {
    mockGetCollections.mockResolvedValue({ collections: [{ name: 'daraq_books' }] });
    mockGetCollection.mockResolvedValue({
      config: { params: { vectors: { size: 1536 }, sparse_vectors: { text_sparse: {} } } }
    });
    mockUpsertPoints.mockResolvedValue({ status: 'ok' });

    // Mock embedText to return 768 vector (fallback multilingual embedding size)
    (embedText as jest.Mock).mockResolvedValue({
      embeddings: [{ values: new Array(768).fill(0.5) }]
    });

    const promise = ingestBook('dummy_path.pdf', 'Сынақ Кітабы 3');

    for (let i = 0; i < 50; i++) {
      await jest.advanceTimersByTimeAsync(2500);
    }
    await promise;

    // Verify upserted vector is padded to 1536
    expect(mockUpsertPoints).toHaveBeenCalledWith('daraq_books', expect.objectContaining({
      points: expect.arrayContaining([
        expect.objectContaining({
          vector: expect.objectContaining({
            "": expect.any(Array)
          })
        })
      ])
    }));

    const upsertCall = mockUpsertPoints.mock.calls[0][1];
    const firstPointVector = upsertCall.points[0].vector[""];
    expect(firstPointVector.length).toBe(1536);
    expect(firstPointVector[767]).toBe(0.5);
    expect(firstPointVector[768]).toBe(0); // Zero padded
  });

  it('should execute exponential backoff retries when embedding API fails', async () => {
    mockGetCollections.mockResolvedValue({ collections: [] });
    mockCreateCollection.mockResolvedValue(true);
    mockUpsertPoints.mockResolvedValue({ status: 'ok' });

    // First embedding call fails, second succeeds
    (embedText as jest.Mock)
      .mockRejectedValueOnce(new Error('Quota Exceeded'))
      .mockResolvedValueOnce({
        embeddings: [{ values: new Array(1536).fill(0.01) }]
      });

    const promise = ingestBook('dummy_path.pdf', 'Сынақ Кітабы 4');

    // Start running timers in loop
    const tickInterval = 1000;
    const execute = async () => {
      // Run timers dynamically to proceed past retry sleep and main loop sleep
      for (let i = 0; i < 15; i++) {
        await jest.advanceTimersByTimeAsync(5000);
      }
    };

    await Promise.all([promise, execute()]);

    expect(embedText).toHaveBeenCalledTimes(2); // Retried once and succeeded on second try!
  });
});
