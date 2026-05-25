import crypto from 'crypto';

// Monkey patch crypto.createPrivateKey globally
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
  if (keyInput && typeof keyInput === 'object') {
    if (typeof keyInput.key === 'string' && keyInput.key.includes('-----BEGIN PRIVATE KEY-----')) {
      const body = keyInput.key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, '');
      const buffer = Buffer.from(body, 'base64');
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

// Monkey patch Sign.prototype.sign globally
try {
  const SignPrototype = Object.getPrototypeOf(crypto.createSign('SHA256'));
  const originalSign = SignPrototype.sign;

  SignPrototype.sign = function(privateKey: any, outputEncoding: any) {
    let key = privateKey;
    if (typeof privateKey === 'string' && privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
      key = crypto.createPrivateKey(privateKey);
    } else if (privateKey && typeof privateKey === 'object') {
      if (typeof privateKey.key === 'string' && privateKey.key.includes('-----BEGIN PRIVATE KEY-----')) {
         key = {
           ...privateKey,
           key: crypto.createPrivateKey(privateKey.key)
         };
      }
    }
    return originalSign.call(this, key, outputEncoding);
  };
} catch (e: any) {
  console.error('[⚠️] Failed to patch Sign.prototype.sign:', e.message);
}

console.log('[🔑] Crypto-patch: Applied OpenSSL private key decoder override & Sign prototype interceptor.');
