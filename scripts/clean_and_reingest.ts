import { qdrant } from '../src/backend/db/qdrant';
import { storage } from '../src/backend/storage';
import { ingestBook } from '../src/backend/ingest';
import 'dotenv/config';

const BUCKET_NAME = process.env.GCS_BUCKET_NAME || 'daraq-bot-storage';

async function main() {
  console.log("=====================================================");
  console.log("             DARAQ DATA WIPE & RE-INGEST             ");
  console.log("=====================================================");

  if (!qdrant) {
    console.error("Qdrant is not configured/initialized!");
    process.exit(1);
  }

  const collectionsToClean = ['daraq_books', 'daraq_cache'];

  for (const collectionName of collectionsToClean) {
    try {
      console.log(`Checking collection '${collectionName}'...`);
      const list = await qdrant.getCollections();
      const exists = list.collections.some(c => c.name === collectionName);
      if (exists) {
        console.log(`[🗑️] Deleting collection '${collectionName}'...`);
        await qdrant.deleteCollection(collectionName);
        console.log(`[✅] Deleted collection '${collectionName}'.`);
      } else {
        console.log(`[ℹ️] Collection '${collectionName}' does not exist.`);
      }
    } catch (err: any) {
      console.error(`[❌] Error handling collection '${collectionName}':`, err.message || err);
    }
  }

  try {
    const bucket = storage.bucket(BUCKET_NAME);
    const [exists] = await bucket.exists();
    if (!exists) {
      console.log(`[☁️] Creating bucket ${BUCKET_NAME}...`);
      await bucket.create();
    }
  } catch (err) {
    console.warn("[☁️] Error checking/creating bucket:", err);
  }

  console.log("\nStarting ingestion process for 'Ораза құлшылығы'...");
  const pdfPath = "books/Oraza_qulshylygy.pdf";
  const bookName = "Ораза құлшылығы";

  try {
    await ingestBook(pdfPath, bookName);
    console.log("\n=====================================================");
    console.log("     CLEAN AND INGESTION COMPLETED SUCCESSFULLY!     ");
    console.log("=====================================================");
  } catch (err: any) {
    console.error("\n[❌] Ingestion process failed:", err.message || err);
    process.exit(1);
  }
}

main().then(() => process.exit(0)).catch(err => {
  console.error("Main execution caught:", err);
  process.exit(1);
});
