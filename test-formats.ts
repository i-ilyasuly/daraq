import crypto from 'crypto';
import fs from 'fs';

try {
  const pem = fs.readFileSync('test-clean.pem', 'utf8');
  const key = crypto.createPrivateKey({
    key: pem,
    format: 'pem',
    type: 'pkcs8'
  });
  console.log("Success with options! Type:", key.type);
} catch (e: any) {
  console.error("Failed with options:", e.message);
}

try {
  const pem = fs.readFileSync('test-clean.pem', 'utf8');
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, '');
  const buffer = Buffer.from(body, 'base64');
  const key2 = crypto.createPrivateKey({
    key: buffer,
    format: 'der',
    type: 'pkcs8'
  });
  console.log("Success with DER buffer! Type:", key2.type);
} catch (e: any) {
  console.error("Failed with DER buffer:", e.message);
}
