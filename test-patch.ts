import crypto from 'crypto';
import fs from 'fs';

// Let's monkey-patch crypto.createPrivateKey
const originalCreatePrivateKey = crypto.createPrivateKey;
(crypto as any).createPrivateKey = function(keyInput: any) {
  if (typeof keyInput === 'string' && keyInput.includes('-----BEGIN PRIVATE KEY-----')) {
    const body = keyInput.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, '');
    const buffer = Buffer.from(body, 'base64');
    return originalCreatePrivateKey({
      key: buffer,
      format: 'der',
      type: 'pkcs8'
    });
  }
  if (keyInput && typeof keyInput === 'object' && typeof keyInput.key === 'string' && keyInput.key.includes('-----BEGIN PRIVATE KEY-----')) {
    const body = keyInput.key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, '');
    const buffer = Buffer.from(body, 'base64');
    return originalCreatePrivateKey({
      ...keyInput,
      key: buffer,
      format: 'der',
      type: 'pkcs8'
    });
  }
  return originalCreatePrivateKey(keyInput);
};

// Now try loading the PEM key directly through the monkey-patched function!
try {
  const pem = fs.readFileSync('test-clean.pem', 'utf8');
  const key = crypto.createPrivateKey(pem);
  console.log("Monkey patch works! Key type is:", key.type);
} catch (e: any) {
  console.error("Monkey patch failed:", e.message);
}
