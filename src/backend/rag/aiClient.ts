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

if (hasServiceAccountFile) {
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
const originalGenerateContent = ai.models.generateContent.bind(ai.models);
ai.models.generateContent = async function(args: any) {
  try {
    return await originalGenerateContent(args);
  } catch (err: any) {
    const errorStr = String(err?.message || err).toLowerCase();
    const isNotFoundOrPermission = errorStr.includes("not found") || errorStr.includes("404") || errorStr.includes("permission_denied") || errorStr.includes("403") || errorStr.includes("429") || errorStr.includes("quota") || errorStr.includes("resource_exhausted");
    
    if (isNotFoundOrPermission && args.model !== 'gemini-2.5-flash') {
      console.warn(`\n[⚠️] Vertex AI: Сұралған "${args.model}" моделі табылмады немесе рұқсат/квота жоқ.`);
      console.warn(`[🔄] Сенімді әрі 100% тұрақты "gemini-2.5-flash" моделіне автоматты түрде ауысу жүзеге асырылуда...`);
      args.model = 'gemini-2.5-flash';
      return await originalGenerateContent(args);
    }
    throw err;
  }
};

const originalGenerateContentStream = ai.models.generateContentStream.bind(ai.models);
ai.models.generateContentStream = async function(args: any) {
  try {
    return await originalGenerateContentStream(args);
  } catch (err: any) {
    const errorStr = String(err?.message || err).toLowerCase();
    const isNotFoundOrPermission = errorStr.includes("not found") || errorStr.includes("404") || errorStr.includes("permission_denied") || errorStr.includes("403") || errorStr.includes("429") || errorStr.includes("quota") || errorStr.includes("resource_exhausted");
    
    if (isNotFoundOrPermission && args.model !== 'gemini-2.5-flash') {
      console.warn(`\n[⚠️] Vertex AI Stream: Сұралған "${args.model}" моделі табылмады немесе рұқсат/квота жоқ.`);
      console.warn(`[🔄] Сенімді әрі 100% тұрақты "gemini-2.5-flash" моделіне автоматты түрде ауысу жүзеге асырылуда...`);
      args.model = 'gemini-2.5-flash';
      return await originalGenerateContentStream(args);
    }
    throw err;
  }
};

const originalEmbedContent = ai.models.embedContent.bind(ai.models);
ai.models.embedContent = async function(args: any) {
  try {
    // Vertex AI defaults to 'gemini-embedding-2-preview' for gemini-embedding-2
    if (hasServiceAccountFile && args.model === 'gemini-embedding-2') {
      args.model = 'gemini-embedding-2-preview';
    }
    return await originalEmbedContent(args);
  } catch (err: any) {
    const errorStr = String(err?.message || err).toLowerCase();
    const isNotFoundOrPermission = errorStr.includes("not found") || errorStr.includes("404") || errorStr.includes("permission_denied") || errorStr.includes("403") || errorStr.includes("429") || errorStr.includes("quota") || errorStr.includes("resource_exhausted");
    
    if (isNotFoundOrPermission && args.model !== 'text-multilingual-embedding-002') {
      console.warn(`\n[⚠️] Vertex AI: Сұралған "${args.model}" векторлау моделі табылмады немесе рұқсат/квота жоқ.`);
      console.warn(`[🔄] Сенімді, заманауи әрі 100% тұрақты "text-multilingual-embedding-002" көптілді векторлау моделіне ауысу жүзеге асырылуда (Өлшемі: 768)...`);
      args.model = 'text-multilingual-embedding-002';
      if (args.config) {
        args.config.outputDimensionality = 768; // text-multilingual-embedding-002 үшін 768 өлшемі
      }
      return await originalEmbedContent(args);
    }
    throw err;
  }
};

