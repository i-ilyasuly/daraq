import fs from 'fs';

try {
  const pem = fs.readFileSync('test-clean.pem', 'utf8');
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, '');
  console.log("Body length:", body.length);
  const buffer = Buffer.from(body, 'base64');
  console.log("Decoded buffer length:", buffer.length);
  console.log("First 10 bytes hex:", buffer.subarray(0, 10).toString('hex'));
} catch (e: any) {
  console.error("Error base64 decoding:", e);
}
