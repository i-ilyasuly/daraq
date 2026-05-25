import crypto from 'crypto';
import fs from 'fs';

const raw = process.env.FIREBASE_PRIVATE_KEY || '';
const clean = raw.replace(/\\n/g, '\n');

fs.writeFileSync('test-clean.pem', clean, 'utf8');
console.log("Wrote test-clean.pem. Length:", clean.length);

try {
  const key = crypto.createPrivateKey(clean);
  console.log("Success! Key loaded. Type:", key.type);
} catch (e: any) {
  console.error("Failed to load PEM directly:", e.message);
}
