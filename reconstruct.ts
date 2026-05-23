import fs from 'fs';

const fileContent = fs.readFileSync('gcp-service-account.json', 'utf8');
const serviceAccount = JSON.parse(fileContent);
const rawKey = serviceAccount.private_key;

const header = '-----BEGIN PRIVATE KEY-----';
const footer = '-----END PRIVATE KEY-----';

const startIdx = rawKey.indexOf(header);
const endIdx = rawKey.indexOf(footer);
const base64Part = rawKey.slice(startIdx + header.length, endIdx);

// Let's inspect the characters
const cleanBase64 = base64Part.replace(/\s+/g, '');
const nonBase64Chars: { char: string; index: number }[] = [];
for (let i = 0; i < cleanBase64.length; i++) {
  const char = cleanBase64[i];
  if (!/[A-Za-z0-9+/=]/.test(char)) {
    nonBase64Chars.push({ char, index: i });
  }
}

console.log('Non-base64 characters found:', nonBase64Chars);
console.log('Length of clean base64:', cleanBase64.length);
