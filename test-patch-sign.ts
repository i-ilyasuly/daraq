import crypto from 'crypto';
import fs from 'fs';

// Let's monkeypatch both crypto.createPrivateKey AND crypto.Sign.prototype.sign!
const originalCreatePrivateKey = crypto.createPrivateKey;
const cleanPEMToBuffer = (pem: string) => {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, '');
  return Buffer.from(body, 'base64');
};

(crypto as any).createPrivateKey = function(keyInput: any) {
  if (typeof keyInput === 'string' && keyInput.includes('-----BEGIN PRIVATE KEY-----')) {
    const buffer = cleanPEMToBuffer(keyInput);
    return originalCreatePrivateKey({
      key: buffer,
      format: 'der',
      type: 'pkcs8'
    });
  }
  if (keyInput && typeof keyInput === 'object') {
    if (typeof keyInput.key === 'string' && keyInput.key.includes('-----BEGIN PRIVATE KEY-----')) {
      const buffer = cleanPEMToBuffer(keyInput.key);
      return originalCreatePrivateKey({
        ...keyInput,
        key: buffer,
        format: 'der',
        type: 'pkcs8'
      });
    }
  }
  return originalCreatePrivateKey(keyInput);
};

// Now patch Sign.prototype.sign
const SignPrototype = Object.getPrototypeOf(crypto.createSign('SHA256'));
const originalSign = SignPrototype.sign;

SignPrototype.sign = function(privateKey: any, outputEncoding: any) {
  let key = privateKey;
  if (typeof privateKey === 'string' && privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
    console.log("[🔑] SignPrototype.sign: Automatically converting PEM private key to KeyObject to bypass OpenSSL PEM decoder issues.");
    key = crypto.createPrivateKey(privateKey);
  } else if (privateKey && typeof privateKey === 'object') {
    if (typeof privateKey.key === 'string' && privateKey.key.includes('-----BEGIN PRIVATE KEY-----')) {
       console.log("[🔑] SignPrototype.sign: Automatically converting PEM key options to KeyObject.");
       key = {
         ...privateKey,
         key: crypto.createPrivateKey(privateKey.key)
       };
    }
  }
  return originalSign.call(this, key, outputEncoding);
};

// Test if we can sign a payload with our PEM key without throwing OpenSSL Unsupported error!
try {
  const pem = fs.readFileSync('test-clean.pem', 'utf8');
  const sign = crypto.createSign('SHA256');
  sign.update('hello');
  const signature = sign.sign(pem, 'hex');
  console.log("Success! Signature length:", signature.length);
} catch (e: any) {
  console.error("Signing failed:", e.message);
}
