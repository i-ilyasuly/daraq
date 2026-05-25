import { qdrant } from './src/backend/db/qdrant';

async function check() {
  if (!qdrant) {
    console.log("Qdrant not connected");
    return;
  }
  const col = await qdrant.getCollection('daraq_books');
  console.log("Points count:", col.points_count);
  
  // Try to scroll some points to see payload
  const points = await qdrant.scroll('daraq_books', { limit: 10, with_payload: true });
  console.log("Sample point books:");
  points.points.forEach(p => {
    console.log("- ", p.payload?.book);
  });

  process.exit(0);
}

check().catch(e => console.error(e));
