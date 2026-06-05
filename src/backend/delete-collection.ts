import { qdrant } from './db/qdrant.js';

async function run() {
  if (qdrant) {
    try {
      await qdrant.deleteCollection('daraq_books');
      console.log('Collection daraq_books deleted successfully.');
    } catch (e) {
      console.error(e);
    }
  }
}
run();
