import '../src/backend/crypto-patch';
import { GoogleGenAI } from '@google/genai';
import { readFileSync, writeFileSync } from 'fs';

const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS || './gcp-service-account.json';
let ai;
let sa: any;
try {
  process.env.GOOGLE_APPLICATION_CREDENTIALS = SERVICE_ACCOUNT_PATH;
  const saRaw = readFileSync(SERVICE_ACCOUNT_PATH, 'utf8');
  sa = JSON.parse(saRaw);
  console.log(`Setting project to daraq-1cb6b in file just to test`);
  sa.project_id = 'daraq-1cb6b';
  writeFileSync(SERVICE_ACCOUNT_PATH, JSON.stringify(sa), 'utf8');
  console.log(`Trying project: ${sa.project_id}`);
  ai = new GoogleGenAI({
      vertexai: true,
      project: sa.project_id,
      location: 'us-central1',
  });
} catch (e) {
  console.error("Failed sa:", e.message);
  process.exit(1);
}

async function testModelInLocation(location, modelName) {
  try {
    const aiTest = new GoogleGenAI({
      vertexai: true,
      project: sa.project_id,
      location: location,
    });
    console.log(`Testing model: ${modelName} in ${location}...`);
    const resp = await aiTest.models.generateContent({
      model: modelName,
      contents: "Hello",
    });
    console.log(`✅ Success with ${modelName} in ${location}`);
  } catch (e) {
    if (e.message.includes('NOT_FOUND') || e.message.includes('not found')) {
      // ignore
    } else {
      console.log(`❌ Failed ${modelName} in ${location}:`, e.message);
    }
  }
}

async function run() {
  const locs = ['us-central1', 'us-east1', 'us-west1', 'us-west4', 'europe-west1', 'europe-west4', 'asia-northeast1', 'asia-southeast1'];
  for (const loc of locs) {
    await testModelInLocation(loc, 'gemini-2.0-flash-lite-preview-02-05');
    await testModelInLocation(loc, 'gemini-flash-lite-latest');
    await testModelInLocation(loc, 'gemini-2.0-flash-lite');
  }
}

run();
