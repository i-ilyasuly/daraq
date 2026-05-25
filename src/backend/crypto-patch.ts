import * as crypto from 'crypto';

// Monkey patch Sign.prototype.sign globally
try {
  const SignPrototype = Object.getPrototypeOf(crypto.createSign('SHA256'));
  const originalSign = SignPrototype.sign;

  function toDerFormat(pemString: string) {
    const body = pemString.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, '');
    const buffer = Buffer.from(body, 'base64');
    return {
      key: buffer,
      format: 'der' as const,
      type: 'pkcs8' as const
    };
  }

  SignPrototype.sign = function(privateKey: any, outputEncoding: any) {
    let keyOptions = privateKey;
    if (typeof privateKey === 'string' && privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
      keyOptions = toDerFormat(privateKey);
    } else if (privateKey && typeof privateKey === 'object') {
      if (typeof privateKey.key === 'string' && privateKey.key.includes('-----BEGIN PRIVATE KEY-----')) {
         keyOptions = {
           ...privateKey,
           ...toDerFormat(privateKey.key)
         };
      }
    }
    return originalSign.call(this, keyOptions, outputEncoding);
  };
} catch (e: any) {
  console.error('[⚠️] Failed to patch Sign.prototype.sign:', e.message);
}

console.log('[🔑] Crypto-patch: Applied OpenSSL private key decoder override & Sign prototype interceptor.');

