import * as admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';

// Initialize Firebase Admin for Firestore
export function initFirestore() {
  if (admin.apps.length > 0) {
    return admin.firestore();
  }

  let credential;
  
  const keyPath = process.env.FIREBASE_KEY_PATH || './firebase-key.json';
  
  try {
    const fullPath = path.resolve(process.cwd(), keyPath);
    if (fs.existsSync(fullPath)) {
      const serviceAccount = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      credential = admin.credential.cert(serviceAccount);
    } else {
      throw new Error(`File ${fullPath} not found`);
    }
  } catch (error) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    // Handle newlines in private key if passed via env var
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    if (!projectId || !clientEmail || !privateKey) {
      console.warn('Firebase credentials not fully provided. Firestore will not be initialized.');
      return null;
    }
    
    credential = admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    });
  }

  admin.initializeApp({
    credential,
  });

  console.log('Firebase Firestore initialized.');
  return admin.firestore();
}

export const db = initFirestore();
