import './src/backend/crypto-patch';
import { Storage } from '@google-cloud/storage';
import fs from 'fs';
import 'dotenv/config';

async function run() {
  const saPath = 'gcp-service-account.json';
  if (!fs.existsSync(saPath)) {
     // Reconstruct if possible
     if (process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
        let pk = process.env.FIREBASE_PRIVATE_KEY;
        if (pk.includes('\\n')) {
          pk = pk.replace(/\\n/g, '\n');
        }
        // Ensure it has headers/footers if missing, though usually they are there
        if (!pk.includes('-----BEGIN PRIVATE KEY-----')) {
           pk = `-----BEGIN PRIVATE KEY-----\n${pk}\n-----END PRIVATE KEY-----\n`;
        }
        
        fs.writeFileSync(saPath, JSON.stringify({
          project_id: 'momyn-t1',
          private_key: pk,
          client_email: process.env.FIREBASE_CLIENT_EMAIL
        }));
     } else {
        console.error("No credentials");
        return;
     }
  }

  const storage = new Storage({ keyFilename: saPath });
  const [buckets] = await storage.getBuckets();
  console.log("Buckets:");
  buckets.forEach(b => console.log("- ", b.name));

  const processedName = 'daraq-497018-daraq-processed-images';
  const bucket = storage.bucket(processedName);
  try {
     const [exists] = await bucket.exists();
     if (exists) {
        console.log(`[🎯 ACCESS GRANTED] Bucket ${processedName} exists and we have access!`);
        const [files] = await bucket.getFiles({ maxResults: 10 } as any);
        console.log("Files found in bucket:");
        files.forEach(f => console.log("  ", f.name));
     } else {
        console.log(`[❌ NOT FOUND] Bucket ${processedName} does not exist or we do not have permission to detect it.`);
     }
  } catch(e: any) {
     console.error(`[❌ PERMISSION DENIED] Error accessing bucket ${processedName}:`, e.message);
  }
  
  process.exit(0);
}

run().catch(console.error);
