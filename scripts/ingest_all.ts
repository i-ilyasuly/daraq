import { execSync } from 'child_process';

console.log("Ingesting zhumanamazy...");
try {
  execSync('npx tsx src/backend/ingest.ts books/zhumanamazy.pdf zhumanamazy', { stdio: 'inherit' });
} catch (e) {
  console.error("Failed to ingest zhumanamazy", e);
}

console.log("Ingesting Oraza_qulshylygy...");
try {
  execSync('npx tsx src/backend/ingest.ts books/Oraza_qulshylygy.pdf Oraza_qulshylygy', { stdio: 'inherit' });
} catch (e) {
  console.error("Failed to ingest Oraza_qulshylygy", e);
}

console.log("Done.");
