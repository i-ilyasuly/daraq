import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

function cleanPrivateKey(key: string): string {
  try {
    let cleaned = key.trim();
    // Strip quotes if they exist
    if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
      cleaned = cleaned.slice(1, -1);
    }
    if (cleaned.startsWith("'") && cleaned.endsWith("'")) {
      cleaned = cleaned.slice(1, -1);
    }
    
    // Replace literal '\n' string representations with actual newlines
    cleaned = cleaned.replace(/\\n/g, '\n');

    const header = "-----BEGIN PRIVATE KEY-----";
    const footer = "-----END PRIVATE KEY-----";

    let body = cleaned;
    const headers = ["-----BEGIN PRIVATE KEY-----", "-----BEGIN RSA PRIVATE KEY-----"];
    const footers = ["-----END PRIVATE KEY-----", "-----END RSA PRIVATE KEY-----"];
    
    for (const h of headers) {
      if (body.includes(h)) {
        body = body.split(h)[1];
      }
    }
    for (const f of footers) {
      if (body.includes(f)) {
        body = body.split(f)[0];
      }
    }

    // Remove all whitespace and spaces from the body to get pure base64
    body = body.replace(/\s+/g, '');
    
    // Parse using standard Node crypto to guarantee correctness
    const buffer = Buffer.from(body, 'base64');
    const pkey = crypto.createPrivateKey({
      key: buffer,
      format: 'der',
      type: 'pkcs8'
    });
    
    // Export to guaranteed, perfectly-formatted PEM string
    return pkey.export({
      type: 'pkcs8',
      format: 'pem'
    }) as string;
  } catch (error: any) {
    console.error('[⚠️] Error parsing private key via crypto. Falling back to basic chunking:', error.message);
    // Fallback block
    let cleaned = key.trim();
    cleaned = cleaned.replace(/\\n/g, '\n');
    const header = "-----BEGIN PRIVATE KEY-----";
    const footer = "-----END PRIVATE KEY-----";
    let body = cleaned.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, '');
    const chunks = body.match(/.{1,64}/g) || [];
    return `${header}\n${chunks.join('\n')}\n${footer}\n`;
  }
}

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
  try {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const rawPrivateKey = process.env.FIREBASE_PRIVATE_KEY;

    if (!projectId || !clientEmail || !rawPrivateKey) {
      console.warn('Firebase credentials not fully provided. Firestore will not be initialized.');
      return null;
    }
    
    const privateKey = cleanPrivateKey(rawPrivateKey);
    
    credential = admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    });
  } catch (error) {
    console.error('Failed to parse Firebase credentials:', error);
    return null;
  }
}

  try {
    admin.initializeApp({
      credential,
    });
    console.log('Firebase Firestore initialized.');
    return admin.firestore();
  } catch (error) {
    console.error('Error initializing Firebase admin:', error);
    return null;
  }
}

export const db = initFirestore();
