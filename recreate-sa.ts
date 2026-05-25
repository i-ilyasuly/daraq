import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import 'dotenv/config';

function cleanPrivateKey(key: string): string {
  try {
    let cleaned = key.trim();
    if (cleaned.startsWith('"') && cleaned.endsWith('"')) cleaned = cleaned.slice(1, -1);
    if (cleaned.startsWith("'") && cleaned.endsWith("'")) cleaned = cleaned.slice(1, -1);
    cleaned = cleaned.replace(/\\n/g, '\n');

    const headers = ["-----BEGIN PRIVATE KEY-----", "-----BEGIN RSA PRIVATE KEY-----"];
    const footers = ["-----END PRIVATE KEY-----", "-----END RSA PRIVATE KEY-----"];
    
    let body = cleaned;
    for (const h of headers) if (body.includes(h)) body = body.split(h)[1];
    for (const f of footers) if (body.includes(f)) body = body.split(f)[0];

    body = body.replace(/\s+/g, '');
    const buffer = Buffer.from(body, 'base64');
    const pkey = crypto.createPrivateKey({
      key: buffer,
      format: 'der',
      type: 'pkcs8'
    });
    
    return pkey.export({
      type: 'pkcs8',
      format: 'pem'
    }) as string;
  } catch (error: any) {
    let cleaned = key.trim().replace(/\\n/g, '\n');
    const header = "-----BEGIN PRIVATE KEY-----";
    const footer = "-----END PRIVATE KEY-----";
    let body = cleaned.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, '');
    const chunks = body.match(/.{1,64}/g) || [];
    return `${header}\n${chunks.join('\n')}\n${footer}\n`;
  }
}

async function run() {
  const email = process.env.FIREBASE_CLIENT_EMAIL;
  const rawKey = process.env.FIREBASE_PRIVATE_KEY;
  
  if (email && rawKey) {
    const pk = cleanPrivateKey(rawKey);
    const sa = {
      type: "service_account",
      project_id: "momyn-t1",
      private_key: pk,
      client_email: email
    };
    fs.writeFileSync('gcp-service-account.json', JSON.stringify(sa, null, 2));
    console.log("Reconstructed gcp-service-account.json");
  } else {
    console.error("Missing ENV vars");
  }
}

run();
