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

// 1. Initialize Google AI Studio Client (Primary)
const aiStudioOptions: any = {
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build-studio',
    }
  }
};
const aiStudio = new GoogleGenAI(aiStudioOptions);

// 2. Initialize Vertex AI Client (Secondary / GCP Billing backed)
let vertexAi: GoogleGenAI | null = null;
if (hasServiceAccountFile) {
  try {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = serviceAccountPath;
    vertexAi = new GoogleGenAI({
      vertexai: true,
      project: saProjectId,
      location: 'us-central1',
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build-vertex',
        }
      }
    });
    console.log(`[🚀] Vertex AI (Service Account) secondary client loaded. Project: ${saProjectId}`);
  } catch (e) {
    console.error("[⚠️] Failed to load Vertex AI secondary client:", e);
  }
}

// Export the primary client name expected by external code
export const ai = aiStudio;
export const vertexAiClient = vertexAi;

// --- Dual-Resolver Monkey Patching for Maximum Resilience ---
const originalGenerateContent = aiStudio.models.generateContent.bind(aiStudio.models);
const originalGenerateContentStream = aiStudio.models.generateContentStream.bind(aiStudio.models);
const originalEmbedContent = aiStudio.models.embedContent.bind(aiStudio.models);

let isAiStudioDepleted = false;

function checkDepleted(err: any): boolean {
  if (!err) return false;
  const errorStr = String(err?.message || err).toLowerCase();
  return (
    errorStr.includes("prepayment credits are depleted") ||
    errorStr.includes("depleted") ||
    errorStr.includes("resource_exhausted") ||
    errorStr.includes("billing") ||
    errorStr.includes("quota") ||
    errorStr.includes("429") ||
    errorStr.includes("403") ||
    errorStr.includes("404") ||
    errorStr.includes("forbidden") ||
    errorStr.includes("permission_denied") ||
    errorStr.includes("access_denied") ||
    errorStr.includes("denied access") ||
    errorStr.includes("not found")
  );
}

function mapModelForVertex(modelName: string): string {
  const clean = String(modelName || '').toLowerCase();
  if (clean.includes('embed')) {
    return 'text-multilingual-embedding-002';
  }
  if (clean.includes('pro')) {
    return 'gemini-1.5-pro';
  }
  // All other flash/lite or unknown models:
  return 'gemini-flash-lite-latest';
}

aiStudio.models.generateContent = async function(args: any) {
  const initialModel = args?.model || '';
  let cleanedArgs = { ...args };
  if (!initialModel.includes('thinking') && cleanedArgs.config?.thinkingConfig) {
    cleanedArgs.config = { ...cleanedArgs.config };
    delete cleanedArgs.config.thinkingConfig;
  }

  // Safe helper to invoke on Vertex AI secondary client
  const tryVertex = async (params: any) => {
    if (vertexAi) {
      const mappedModel = mapModelForVertex(params.model);
      console.log(`[🔄] Redirecting generation to Vertex AI client with model '${mappedModel}' (original: '${params.model}')...`);
      const vertexParams = { ...params, model: mappedModel };
      return await vertexAi.models.generateContent(vertexParams);
    }
    throw new Error("Vertex AI client is not available.");
  };

  // If we already know AI Studio is depleted, bypass it completely!
  if (isAiStudioDepleted && vertexAi) {
    try {
      return await tryVertex(cleanedArgs);
    } catch (vertexErr: any) {
      console.warn(`[⚠️] Direct Vertex AI generation attempt failed:`, vertexErr.message || vertexErr);
    }
  }

  try {
    // Stage 1: Try Primary AI Studio Client
    return await originalGenerateContent(cleanedArgs);
  } catch (err: any) {
    if (checkDepleted(err)) {
      isAiStudioDepleted = true;
    }
    const errorStr = String(err?.message || err).toLowerCase();
    
    // Only log if we didn't expect it to fail (403/404) and if it's not handled
    if (!checkDepleted(err)) {
      console.warn(`[⚠️] AI Studio Generation error with model ${initialModel}:`, errorStr);
    }

    // If thinking config is not supported, strip and retry on AI Studio first
    if (!isAiStudioDepleted && (errorStr.includes('thinking_level') || errorStr.includes('thinkingconfig') || errorStr.includes('thinking_level is not supported'))) {
      if (args.config?.thinkingConfig) {
        console.log(`[🔄] Stripping thinkingConfig and retrying on AI Studio for '${initialModel}'...`);
        const strippedArgs = { ...args };
        strippedArgs.config = { ...strippedArgs.config };
        delete strippedArgs.config.thinkingConfig;
        try {
          return await originalGenerateContent(strippedArgs);
        } catch (retryErr: any) {
          err = retryErr;
          if (checkDepleted(retryErr)) {
            isAiStudioDepleted = true;
          }
        }
      }
    }

    // Stage 2: Try Primary Model mapping on Secondary Vertex AI Client
    if (vertexAi) {
      try {
        const vertexArgs = { ...cleanedArgs };
        if (vertexArgs.config) {
          vertexArgs.config = { ...vertexArgs.config };
          delete vertexArgs.config.thinkingConfig;
        }
        return await tryVertex(vertexArgs);
      } catch (vertexErr: any) {
        console.warn(`[⚠️] Vertex AI original model generation failed too:`, vertexErr.message || vertexErr);
      }
    }

    // Stage 3: Cascade fallbacks through both AI Studio and Vertex AI
    const fallbackModels = ['gemini-flash-lite-latest', 'gemini-1.5-flash'];
    for (const fallbackModel of fallbackModels) {
      console.log(`[🔄] Cascading content generation fallback to: '${fallbackModel}'...`);
      const fallbackArgs = { ...args, model: fallbackModel };
      if (fallbackArgs.config) {
        fallbackArgs.config = { ...fallbackArgs.config };
        delete fallbackArgs.config.thinkingConfig;
      }

      // Try AI Studio fallback
      if (!isAiStudioDepleted) {
        try {
          return await originalGenerateContent(fallbackArgs);
        } catch (studioErr: any) {
          if (checkDepleted(studioErr)) {
            isAiStudioDepleted = true;
          }
          console.warn(`[⚠️] AI Studio fallback to '${fallbackModel}' failed:`, studioErr.message || studioErr);
        }
      }
      
      // Try Vertex AI fallback
      if (vertexAi) {
        try {
          return await tryVertex(fallbackArgs);
        } catch (vertexEnvErr: any) {
          console.warn(`[⚠️] Vertex AI fallback to '${fallbackModel}' failed:`, vertexEnvErr.message || vertexEnvErr);
        }
      }
    }
    throw err;
  }
};

aiStudio.models.generateContentStream = async function(args: any) {
  const initialModel = args?.model || '';
  let cleanedArgs = { ...args };
  if (!initialModel.includes('thinking') && cleanedArgs.config?.thinkingConfig) {
    cleanedArgs.config = { ...cleanedArgs.config };
    delete cleanedArgs.config.thinkingConfig;
  }

  // Safe helper to invoke stream on Vertex AI
  const tryVertexStream = async (params: any) => {
    if (vertexAi) {
      const mappedModel = mapModelForVertex(params.model);
      console.log(`[🔄] Redirecting stream to Vertex AI client with model '${mappedModel}' (original: '${params.model}')...`);
      const vertexParams = { ...params, model: mappedModel };
      return await vertexAi.models.generateContentStream(vertexParams);
    }
    throw new Error("Vertex AI client is not available.");
  };

  // If we already know AI Studio is depleted, bypass it completely!
  if (isAiStudioDepleted && vertexAi) {
    try {
      return await tryVertexStream(cleanedArgs);
    } catch (vertexErr: any) {
      console.warn(`[⚠️] Direct Vertex AI stream generation attempt failed:`, vertexErr.message || vertexErr);
    }
  }

  try {
    // Stage 1: Try Primary AI Studio Client
    return await originalGenerateContentStream(cleanedArgs);
  } catch (err: any) {
    if (checkDepleted(err)) {
      isAiStudioDepleted = true;
    }
    const errorStr = String(err?.message || err).toLowerCase();
    if (!checkDepleted(err)) {
      console.warn(`[⚠️] AI Studio Generation stream error with model ${initialModel}:`, errorStr);
    }

    // If thinking config is not supported, strip and retry on AI Studio first
    if (!isAiStudioDepleted && (errorStr.includes('thinking_level') || errorStr.includes('thinkingconfig') || errorStr.includes('thinking_level is not supported'))) {
      if (args.config?.thinkingConfig) {
        console.log(`[🔄] Stripping thinkingConfig and retrying stream on AI Studio for '${initialModel}'...`);
        const strippedArgs = { ...args };
        strippedArgs.config = { ...strippedArgs.config };
        delete strippedArgs.config.thinkingConfig;
        try {
          return await originalGenerateContentStream(strippedArgs);
        } catch (retryErr: any) {
          err = retryErr;
          if (checkDepleted(retryErr)) {
            isAiStudioDepleted = true;
          }
        }
      }
    }

    // Stage 2: Try Primary Model mapping on Vertex AI
    if (vertexAi) {
      try {
        const vertexArgs = { ...cleanedArgs };
        if (vertexArgs.config) {
          vertexArgs.config = { ...vertexArgs.config };
          delete vertexArgs.config.thinkingConfig;
        }
        return await tryVertexStream(vertexArgs);
      } catch (vertexErr: any) {
        console.warn(`[⚠️] Vertex AI original model stream generation failed too:`, vertexErr.message || vertexErr);
      }
    }

    // Stage 3: Cascade fallbacks for Stream
    const fallbackModels = ['gemini-flash-lite-latest', 'gemini-1.5-flash'];
    for (const fallbackModel of fallbackModels) {
      console.log(`[🔄] Cascading stream generation fallback to: '${fallbackModel}'...`);
      const fallbackArgs = { ...args, model: fallbackModel };
      if (fallbackArgs.config) {
        fallbackArgs.config = { ...fallbackArgs.config };
        delete fallbackArgs.config.thinkingConfig;
      }

      // Try AI Studio fallback
      if (!isAiStudioDepleted) {
        try {
          return await originalGenerateContentStream(fallbackArgs);
        } catch (studioErr: any) {
          if (checkDepleted(studioErr)) {
            isAiStudioDepleted = true;
          }
          console.warn(`[⚠️] AI Studio stream fallback to '${fallbackModel}' failed:`, studioErr.message || studioErr);
        }
      }
      
      // Try Vertex fallback
      if (vertexAi) {
        try {
          return await tryVertexStream(fallbackArgs);
        } catch (vertexEnvErr: any) {
          console.warn(`[⚠️] Vertex AI stream fallback to '${fallbackModel}' failed:`, vertexEnvErr.message || vertexEnvErr);
        }
      }
    }
    throw err;
  }
};

aiStudio.models.embedContent = async function(args: any) {
  const initialModel = args?.model || '';
  let cleanedArgs = { ...args };
  if (cleanedArgs.config) {
    cleanedArgs.config = { ...cleanedArgs.config };
    delete cleanedArgs.config.outputDimensionality;
  }

  // Safe helper to invoke embedding on Vertex AI
  const tryVertexEmbed = async (params: any) => {
    if (vertexAi) {
      const mappedModel = mapModelForVertex(params.model);
      console.log(`[🔄] Redirecting embedding to Vertex AI client with model '${mappedModel}' (original: '${params.model}')...`);
      const vertexParams = { ...params, model: mappedModel };
      return await vertexAi.models.embedContent(vertexParams);
    }
    throw new Error("Vertex AI client is not available.");
  };

  const normalizeResponse = (res: any) => {
    if (res?.embeddings) {
      for (const emb of res.embeddings) {
        if (emb?.values) {
          let denseVector = emb.values;
          if (denseVector.length > 1536) {
            emb.values = denseVector.slice(0, 1536);
          } else if (denseVector.length < 1536) {
            emb.values = [...denseVector, ...Array(1536 - denseVector.length).fill(0)];
          }
        }
      }
    }
    return res;
  };

  // If we already know AI Studio is depleted, bypass it completely!
  if (isAiStudioDepleted && vertexAi) {
    try {
      const res = await tryVertexEmbed(cleanedArgs);
      return normalizeResponse(res);
    } catch (vertexErr: any) {
      console.warn(`[⚠️] Direct Vertex AI embedding attempt failed:`, vertexErr.message || vertexErr);
    }
  }

  try {
    // Stage 1: Try Primary AI Studio Client
    const res = await originalEmbedContent(cleanedArgs);
    return normalizeResponse(res);
  } catch (err: any) {
    if (checkDepleted(err)) {
      isAiStudioDepleted = true;
    }
    const errorStr = String(err?.message || err).toLowerCase();
    
    // Only log if we didn't expect it to fail (403/404) and if it's not handled
    if (!checkDepleted(err)) {
      console.warn(`[⚠️] AI Studio Embedding error with model ${initialModel}:`, errorStr);
    }

    // Stage 2: Try Vertex AI with same model
    if (vertexAi) {
      try {
        const res = await tryVertexEmbed(cleanedArgs);
        return normalizeResponse(res);
      } catch (vertexErr: any) {
        console.warn(`[⚠️] Vertex AI original model embedding failed too:`, vertexErr.message || vertexErr);
      }
    }

    // Stage 3: Cascade fallback models (with different names tailored to Vertex and AI Studio)
    const fallbackEmbeddingModels = [
      'text-multilingual-embedding-002',
      'text-embedding-004',
      'gemini-embedding-2-preview',
      'gemini-embedding-001'
    ];

    for (const fallbackModel of fallbackEmbeddingModels) {
      console.log(`[🔄] Cascading embedding fallback to: '${fallbackModel}'...`);
      const fallbackArgs = { ...cleanedArgs, model: fallbackModel };

      // Try AI Studio
      if (!isAiStudioDepleted) {
        try {
          const res = await originalEmbedContent(fallbackArgs);
          return normalizeResponse(res);
        } catch (studioErr: any) {
          if (checkDepleted(studioErr)) {
            isAiStudioDepleted = true;
          }
          console.warn(`[⚠️] AI Studio embedding fallback to '${fallbackModel}' failed:`, studioErr.message || studioErr);
        }
      }
      
      // Try Vertex AI
      if (vertexAi) {
        try {
          const res = await tryVertexEmbed(fallbackArgs);
          return normalizeResponse(res);
        } catch (vertexEnvErr: any) {
          console.warn(`[⚠️] Vertex AI embedding fallback to '${fallbackModel}' failed:`, vertexEnvErr.message || vertexEnvErr);
        }
      }
    }
    throw err;
  }
};

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

// Configurable model definitions from environment variables
export const GEMINI_EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2';
export const GEMINI_GENERATION_MODEL = process.env.GEMINI_GENERATION_MODEL || 'gemini-flash-lite-latest';
export const GEMINI_INTENT_MODEL = process.env.GEMINI_INTENT_MODEL || 'gemini-flash-lite-latest';

