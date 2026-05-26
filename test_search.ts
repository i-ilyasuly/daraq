import { searchAnswers } from './src/backend/rag/searchService';

async function test() {
  const sq = "Белгісіз адам еңбегі";
  console.log(`Searching for: ${sq}`);
  const searchResults = await searchAnswers(sq);
  if (searchResults && searchResults.length > 0) {
      const contextText = searchResults.map((c, i) => 
        `[Дерек ${i + 1}] Кітап: "${c.book}", Бет: ${c.page}\nМәтін: ${c.text}`
      ).join('\n\n');
      console.log(contextText);
  } else {
      console.log("No results");
  }
}

test();
