import './crypto-patch';
import { Storage } from '@google-cloud/storage';
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

interface GcpCreds {
  projectId: string;
  credentials: {
    client_email: string;
    private_key: string;
  };
}

export function getGcpCredentials(): GcpCreds | null {
  let projectId;
  let credentials;

  const keyPath = process.env.GCS_KEY_PATH || process.env.FIREBASE_KEY_PATH || './firebase-key.json';

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
    const rawPrivateKey = process.env.FIREBASE_PRIVATE_KEY;

    if (!projectId || !clientEmail || !rawPrivateKey) {
      return null;
    }
    
    const privateKey = cleanPrivateKey(rawPrivateKey);
    
    credentials = {
      client_email: clientEmail,
      private_key: privateKey,
    };
  }

  return { projectId, credentials };
}

// Initialize Google Cloud Storage
export function initStorage() {
  const gcpCreds = getGcpCredentials();
  if (!gcpCreds) {
    console.warn('GCP credentials not provided. Google Cloud Storage will not be initialized.');
    return null;
  }

  try {
    const storage = new Storage({
      projectId: gcpCreds.projectId,
      credentials: gcpCreds.credentials,
    });

    console.log('Google Cloud Storage initialized.');
    return storage;
  } catch (error) {
    console.error('Failed to initialize Google Cloud Storage:', error);
    return null;
  }
}

export const storage = initStorage();
