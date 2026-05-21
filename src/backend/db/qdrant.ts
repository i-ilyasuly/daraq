import { QdrantClient } from '@qdrant/js-client-rest';

// Initialize Qdrant Client
export function initQdrant() {
  const url = process.env.QDRANT_URL;
  const apiKey = process.env.QDRANT_API_KEY;

  if (!url) {
    console.warn('QDRANT_URL is not provided. Qdrant client will not be initialized.');
    return null;
  }

  const client = new QdrantClient({
    url,
    apiKey, // API Key is optional if running local, but needed for Qdrant Cloud
  });

  console.log('Qdrant Client initialized.');
  return client;
}

export const qdrant = initQdrant();
