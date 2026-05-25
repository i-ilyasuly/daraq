import crypto from 'crypto';

let raw = process.env.FIREBASE_PRIVATE_KEY || '';
console.log("Raw starts with quote?", raw.startsWith('"'));

// Strip double quotes if present
if (raw.startsWith('"') && raw.endsWith('"')) {
  raw = raw.slice(1, -1);
}
// Strip single quotes if present
if (raw.startsWith("'") && raw.endsWith("'")) {
  raw = raw.slice(1, -1);
}

// Replace literal \n with raw newline characters
let keyStr = raw.replace(/\\n/g, '\n');

try {
  const pkey = crypto.createPrivateKey(keyStr);
  console.log("Success with cleaned key! Type:", pkey.type);
} catch (e: any) {
  console.error("Cleaned key failed too:", e.message);
}
