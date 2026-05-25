import fs from 'fs';
import crypto from 'crypto';

try {
  const sa = JSON.parse(fs.readFileSync('gcp-service-account.json', 'utf8'));
  console.log("Private key starts with:", sa.private_key.substring(0, 50));
  console.log("Private key ends with:", sa.private_key.substring(sa.private_key.length - 50));
  const key = crypto.createPrivateKey(sa.private_key);
  console.log("Success! Key type is:", key.type);
} catch (e: any) {
  console.error("Error parsing key:", e);
}
