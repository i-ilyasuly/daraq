import { Storage } from '@google-cloud/storage';
import fs from 'fs';
import path from 'path';

// Initialize Google Cloud Storage
export function initStorage() {
  let projectId;
  let credentials;

  const keyPath = process.env.FIREBASE_KEY_PATH || './firebase-key.json';

  try {
    const fullPath = path.resolve(process.cwd(), keyPath);
    if (fs.existsSync(fullPath)) {
      const serviceAccount = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      projectId = serviceAccount.project_id;
      credentials = {
        client_email: serviceAccount.client_email,
        private_key: serviceAccount.private_key
      };
    } else {
      throw new Error(`File ${fullPath} not found`);
    }
  } catch (error) {
    projectId = process.env.FIREBASE_PROJECT_ID; // Usually matches Firebase project if using the same GCP project
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    if (!projectId || !clientEmail || !privateKey || !privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
      console.warn('GCP credentials not provided. Google Cloud Storage will not be initialized.');
      return null;
    }
    
    credentials = {
      client_email: clientEmail,
      private_key: privateKey,
    };
  }

  try {
    const storage = new Storage({
      projectId,
      credentials,
    });

    console.log('Google Cloud Storage initialized.');
    return storage;
  } catch (error) {
    console.error('Failed to initialize Google Cloud Storage:', error);
    return null;
  }
}

export const storage = initStorage();
