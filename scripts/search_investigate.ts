import '../src/backend/crypto-patch';
import { searchAnswers } from '../src/backend/rag/searchService';
import { qdrant } from '../src/backend/db/qdrant';

async function testSearch() {
    console.log("Scrolling through whole Qdrant to find 'аштық' or 'әлсіздік'...");
    
    let offset = undefined;
    let found = [];
    while (true) {
       const res = await qdrant.scroll("daraq_books", {
           limit: 100,
           offset: offset,
           with_payload: true
       });
       
       for (const p of res.points) {
           const text = p.payload?.text as string;
           if (text && (text.includes("аштық") || text.includes("әлсіздік") || text.includes("аш") || text.includes("әлсіз"))) {
               found.push({ text, book: p.payload?.book, page: p.payload?.page });
           }
       }
       
       if (!res.next_page_offset) break;
       offset = res.next_page_offset;
    }
    
    console.log(`Found ${found.length} matches.`);
    found.forEach(t => console.log("---------\n" + JSON.stringify(t, null, 2)));
}
testSearch();
