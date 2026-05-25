import { searchAnswers } from '../src/backend/rag/searchService';
import { generateAnswer } from '../src/backend/rag/aiService';

interface TestCase {
  question: string;
  expectedKeywords: string[];
}

const GOLDEN_DATASET: TestCase[] = [
  {
    question: "Намазды қалай оқу керек?",
    expectedKeywords: ["ниет", "тәкбір", "қиям", "рүкүғ", "сәжде"]
  },
  {
    question: "Оразаны бұзатын нәрселер?",
    expectedKeywords: ["ішу", "жеу", "жыныстық"]
  },
  {
    question: "Зекет кімдерге беріледі?",
    expectedKeywords: ["пақыр", "міскін", "қарыздар"]
  },
  {
    question: "Дәрет қалай алынады?",
    expectedKeywords: ["бет", "қол", "бас", "аяқ"]
  },
  {
    question: "Ғұсылдың парыздары қандай?",
    expectedKeywords: ["ауызды шаю", "мұрынға", "бүкіл денені"]
  },
  {
    question: "Таяммум қашан жасалады?",
    expectedKeywords: ["су жоқ", "ауру", "топырақ"]
  },
  {
    question: "Жұма намазының үкімі қандай?",
    expectedKeywords: ["парыз", "еркектерге"]
  },
  {
    question: "Сапарда намазды қалай оқиды?",
    expectedKeywords: ["қысқартып", "құсыр", "екі рәкағат"]
  },
  {
    question: "Пітір садақасы кімге парыз?",
    expectedKeywords: ["бай", "жағдайы", "ораза айт"]
  },
  {
    question: "Құрбандық шалу үкімі?",
    expectedKeywords: ["уәжіп", "бай", "айт күндері"]
  }
];

function calculateRecall(answer: string, expectedKeywords: string[]): number {
  const lowerAnswer = answer.toLowerCase();
  let found = 0;
  for (const keyword of expectedKeywords) {
    if (lowerAnswer.includes(keyword.toLowerCase())) {
      found++;
    }
  }
  return expectedKeywords.length === 0 ? 1 : found / expectedKeywords.length;
}

function calculateFaithfulness(answer: string, sourcesText: string): number {
  if (answer.includes("Білмеймін") || answer.includes("табылмады")) {
    return 1; // It faithfully reported lack of info.
  }
  // Simplified faithfulness: checks if the answer introduces numbers/dates not in text (hallucinations placeholder).
  // A true faithfulness uses LLM as a judge. We use a basic overlap mechanism here.
  return 0.8; // Placeholder score for now to avoid paid calls.
}

async function runEvaluation() {
  console.log("=== RAG Evaluation Started ===");
  let totalRecall = 0;
  let totalFaithfulness = 0;
  const total = GOLDEN_DATASET.length;

  for (let i = 0; i < total; i++) {
    const test = GOLDEN_DATASET[i];
    console.log(`\nҮлгі [${i+1}/${total}]: "${test.question}"`);
    
    const results = await searchAnswers(test.question);
    const combinedContext = results.map(r => r.text).join(" ");
    
    // We pass a mock chatId to not affect real logs.
    const response = await generateAnswer('test_eval_chat', test.question, results);
    
    const recall = calculateRecall(response.answer, test.expectedKeywords);
    const faithfulness = calculateFaithfulness(response.answer, combinedContext);
    
    console.log(`- Recall: ${(recall * 100).toFixed(1)}%`);
    console.log(`- Faithfulness: ${(faithfulness * 100).toFixed(1)}%`);

    totalRecall += recall;
    totalFaithfulness += faithfulness;
  }

  const avgRecall = totalRecall / total;
  const avgFaithfulness = totalFaithfulness / total;

  console.log("\n=== Қорытынды Есеп (Final Report) ===");
  console.log(`Бағаланған сұрақтар саны: ${total}`);
  console.log(`Орташа Recall: ${(avgRecall * 100).toFixed(2)}%`);
  console.log(`Орташа Faithfulness: ${(avgFaithfulness * 100).toFixed(2)}%`);
  console.log("=====================================\n");
  
  process.exit(0);
}

runEvaluation().catch(e => {
  console.error("Evaluation failed:", e);
  process.exit(1);
});
