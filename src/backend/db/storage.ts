import { Storage } from '@google-cloud/storage';

// Initialize Google Cloud Storage
export function initStorage() {
  const projectId = process.env.FIREBASE_PROJECT_ID; // Usually matches Firebase project if using the same GCP project
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    console.warn('GCP credentials not provided. Google Cloud Storage will not be initialized.');
    return null;
  }

  const storage = new Storage({
    projectId,
    credentials: {
      client_email: clientEmail,
      private_key: privateKey,
    },
  });

  console.log('Google Cloud Storage initialized.');
  return storage;
}

export const storage = initStorage();
