import { qdrant } from './src/backend/db/qdrant';

async function test() {
   if (!qdrant) return;
   
   try {
     await qdrant.deleteCollection("test_hybrid").catch(() => {});
     await qdrant.createCollection("test_hybrid", {
       vectors: { size: 2, distance: "Cosine" },
       sparse_vectors: {
         text_sparse: { modifier: "idf" }
       }
     });

     await qdrant.upsert("test_hybrid", {
       points: [
         {
           id: 1,
           vector: {
             "": [0.1, 0.2],
             "text_sparse": { indices: [1, 2], values: [1.0, 2.0] }
           }
         }
       ]
     });
     console.log("Upsert Success");
     
     const res = await qdrant.query("test_hybrid", {
       prefetch: [
         { query: [0.1, 0.2], limit: 1 },
         { query: { indices: [1], values: [1.0] }, using: "text_sparse", limit: 1 }
       ],
       query: { fusion: "rrf" },
       limit: 1
     });
     console.log("Query Success", res);
   } catch (e: any) {
     console.error(e.data || e);
   }
}
test();
