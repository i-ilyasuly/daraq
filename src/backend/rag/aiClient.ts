import '../crypto-patch';
import { GoogleGenAI } from '@google/genai';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';

/**
 * Validates if the GCP Service Account file exists and contains a valid private key.
 * If the service account's private_key field is corrupt or malformed, this returns false
 * and avoids crashing the Node.js server.
 */
export function validateServiceAccount(filePath: string): boolean {
  try {
    if (!fs.existsSync(filePath)) {
      return false;
    }
    
    const content = fs.readFileSync(filePath, 'utf8');
    const serviceAccount = JSON.parse(content);
    
    if (!serviceAccount.private_key) {
      console.warn(`[⚠️] Service Account key exists but is missing the "private_key" field.`);
      return false;
    }
    
    // Attempt parsing to see if cryptography can decode this private key
    crypto.createPrivateKey(serviceAccount.private_key);
    return true;
  } catch (err: any) {
    console.warn(`\n[⚠️] GCP Service Account private key is technically invalid: ${err.message}`);
    console.warn(`[ℹ️] Gracefully falling back to Google AI Studio API Key (GEMINI_API_KEY)...`);
    return false;
  }
}

const serviceAccountPath = path.join(process.cwd(), 'gcp-service-account.json');

// Reconstruct if missing
if (!fs.existsSync(serviceAccountPath) && process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
  try {
    let pk = process.env.FIREBASE_PRIVATE_KEY.trim();
    if (pk.includes('\\n')) pk = pk.replace(/\\n/g, '\n');
    
    // Ensure standard PEM format
    if (!pk.includes('-----BEGIN PRIVATE KEY-----')) {
       const cleanKey = pk.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, '');
       const chunks = cleanKey.match(/.{1,64}/g) || [];
       pk = `-----BEGIN PRIVATE KEY-----\n${chunks.join('\n')}\n-----END PRIVATE KEY-----\n`;
    }

    const content = JSON.stringify({
      type: "service_account",
      project_id: 'momyn-t1',
      private_key: pk,
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
    });
    fs.writeFileSync(serviceAccountPath, content, 'utf8');
    console.log('[✅] Runtime: gcp-service-account.json ("momyn-t1") қайта жасалды.');
  } catch (e) {
    console.error("Service-account файлын құру мүмкін болмады.", e);
  }
}

// We always want to try Vertex AI with momyn-t1 first as per rules
let saProjectId = 'momyn-t1'; 
const hasServiceAccountFile = fs.existsSync(serviceAccountPath);

const aiOptions: any = {
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
};

// --- ҚАУІПСІЗДІК ҮШІН VERTEX AI ӨШІРІЛДІ ---
// Болашақта іске қосу қажет болса, мына айнымалыны true деп өзгертіңіз:
const USE_VERTEX_AI = false;

if (USE_VERTEX_AI && hasServiceAccountFile) {
  process.env.GOOGLE_APPLICATION_CREDENTIALS = serviceAccountPath;
  aiOptions.vertexai = true;
  aiOptions.project = saProjectId;
  aiOptions.location = 'us-central1';
  console.log(`[🚀] Vertex AI (Service Account) дайындалды. Жоба: ${saProjectId}`);
} else {
  aiOptions.apiKey = process.env.GEMINI_API_KEY;
  console.warn(`[⚠️] Google AI Studio API Key қолданылуда.`);
}

export const ai = new GoogleGenAI(aiOptions);

// --- Robust Monkey Patching for Vertex AI Availability ---
// (Қазіргі уақытта AI Studio қолданылып жатқандықтан уақытша істен шығарылған)
/*
function wrapResult(res: any) { ... }
ai.models.generateContent = async function(args: any) { ... }
ai.models.generateContentStream = async function(args: any) { ... }
ai.models.embedContent = async function(args: any) { ... }
*/

/**
 * Robust helper for embedding text
 */
export async function embedText(args: any) {
  return await ai.models.embedContent(args);
}

/**
 * Robust helper for general content generation
 */
export async function generateContentFixed(args: any) {
  return await ai.models.generateContent(args);
}

/**
 * Robust helper for streaming content generation
 */
export async function generateContentStreamFixed(args: any) {
  return await ai.models.generateContentStream(args);
}

