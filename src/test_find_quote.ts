import { findExactQuoteForHighlight } from './backend/rag/aiService';
import { generateContentFixed } from './backend/rag/aiClient';

async function run() {
  const query = "Шағбан айында не парыз болды?";
  const chunkText = `Тіпті басқа бірнеше діндерде де ораза ұстау бар. Адамдар барлық ғасырда ораза тұтқан. Бұлардың ішінде тек немен және қалай ашығу керектігінде ғана айырмашылық бар.
Ораза құлшылығы ең алғаш хижраның 2 жылында Шағбан айында парыз болды.
Ораза сөзінің араб тіліндегі мағынасы
Ораза сөзі араб тілінде «ас-соум» деп аталады. Бұл сөз сөздікте «тыйылу, тоқтату» деген мағынаны білдіреді.`;
  
  const extracted = await findExactQuoteForHighlight(query, chunkText);
  console.log("EXTRACTED FOR SHAGBAN:\\n", extracted);
}

run();
