import { generateContentFixed, GEMINI_INTENT_MODEL } from './aiClient';
import { Type } from '@google/genai';

export interface RouterResult {
  intent: 'CHITCHAT' | 'KNOWLEDGE_SEARCH';
  is_complete: boolean;
  clarification_prompt: string;
  refined_query: string;
}

export async function classifyIntent(query: string, history: {role: string, parts: any[]}[]): Promise<RouterResult> {
  const clean = query.trim().toLowerCase();

  // If the query is incredibly short and matches greetings/thanks directly to optimize latency:
  const shortChitchat = [
    'сәлем', 'салем', 'ассалау', 'ассаламу', 'алейкум', 'әлейкум', 'қалайсың', 'қалайсыз', 'қалайсын', 'амансыз',
    'рахмет', 'рақмет', 'ризамын', 'алғыс',
    'спасибо', 'благодарю', 'привет', 'здравствуйте', 'салам',
    'сен кімсің', 'сен кімсін', 'атың кім',
    'сау бол', 'сау болыңыз', 'сау болыныз', 'пока', 'до свидания',
    'окей', 'ok', 'жарайды'
  ];
  if (clean.length < 15 && shortChitchat.some(kw => clean.includes(kw))) {
    return {
      intent: 'CHITCHAT',
      is_complete: true,
      clarification_prompt: '',
      refined_query: query
    };
  }

  try {
    console.log(`\n[🔍 ROUTER] Analyzing query for intent & completeness using Gemini... Query: "${query}"`);

    const formattedHistoryText = history
      .slice(-10) // analyze the last 10 turns to avoid token inflation
      .map(h => `${h.role === 'model' ? 'Бот' : 'Пайдаланушы'}: "${h.parts[0].text}"`)
      .join('\n');

    const promptText = `Сен — Daraq діни ассистент жүйесінің ақылды роутері және талдаушысысың. Пайдаланушының жаңа сұрағын чат тарихымен бірге талдап, тиісті санатты, сұрақтың толықтығын, қажет болса нақтылау сұрағын және қайта құрылған сұранысты белгіле.

ЖҰМЫС ШЕҢБЕРІ мен ЕРЕЖЕЛЕРІ:
1. 'intent':
   - 'CHITCHAT': Пайдаланушы сәлемдесе, алғыс айтса, боттың атын/мүмкіндіктерін сұраса немесе эмоциялық қысқа пікір білдірсе.
   - 'KNOWLEDGE_SEARCH': діни білім, пәтуалар, шариғат ережелері бойынша сұрақтар.

2. 'is_complete' (тек KNOWLEDGE_SEARCH үшін маңызды):
   - Пайдаланушы тым жалпылама, нақты белгісіз мәселе қойса (мысалы: "Дәрет бұзыла ма?", "Ораза бұзыла ма?", "Намазым қабыл ма?"), оны 'is_complete: false' деп бағала. Бізге нақты жағдайды (мұрын қанау, ұйықтау, тіс жуу т.б.) білу шарт.
   - Егер пайдаланушы бұған дейінгі боттың нақтылауына жауап берсе (мысалы, бұрын "Ораза бұзыла ма?" деген, бот нақтылау сұраған, енді ол "Тіс жудым/дәрі іштім" немесе "Еріксіз тамақ жұтып қойдым" дейді), бұл сұрақ толықтырылды деп санап, 'is_complete: true' деп бер.
   - Егер сұрақтың өзінде бірден нақты оқиға/іс-әрекет сипатталса (мысалы: "Жыласа дәрет бұзыла ма?", "Көз жасы дәретке әсер ете ме?"), бұл толық сұрақ. 'is_complete: true' деп бер.
   - ТЕК CHITCHAT немесе Құран аяттарына тікелей сілтейтін сұрақтар үшін 'is_complete: true' болсын.

3. 'clarification_prompt':
   - Егер 'is_complete: false' болса, пайдаланушы сұраған тілде (Қазақша, Орысша немесе Ағылшынша) сыпайы, жұмсақ түрде дәлелдемелі бапты анықтау сұрағын жаз. Сұрақта оған балама мысалдарды көрсетіп бағытта (мысалы: "Дәретіңізді дәл қандай жағдай бұзды деп ойлайсыз? Жел шығуы, мұрын қанауы немесе ұйықтау сияқты нақты не болғанын сипаттап берсеңіз, сізге дұрыс пәтуа тауып беремін. 😊").
   - 'is_complete: true' болса, бұл өріс бос ("") болсын.

4. 'refined_query':
   - Егер 'is_complete: true' болса, чат тарихындағы бастапқы жалпы сұрақты және пайдаланушының жаңа жауаптарын біріктіріп, ең нақты, қысқа діни іздеу сұранысын (refined query) жаса.
   - Мысалы: Пайдаланушы "Ораза бұзыла ма?" деп бастап, кейін "Тіс жусам" десе, refined_query: "Тіс жуғанда ораза бұзыла ма" деп құрастырылсын.
   - Сұрақ тілі сұрақ қойылған тілмен (Қазақша/Орысша/Ағылшынша) дәл СӘЙКЕС БОЛСЫН.

===
ЖҰМЫС ҮЛГІЛЕРІ (Few-Shot Examples):

Сұрақ: "Дәрет бұзыла ма?"
Чат тарихы: (бос)
Нәтиже:
{
  "intent": "KNOWLEDGE_SEARCH",
  "is_complete": false,
  "clarification_prompt": "Дәретіңізді дәл қандай жағдай бұзды деп ойлайсыз? Қан ағуы, жел шығуы немесе ұйықтап қалу өкілі сияқты нақты бір оқиға болды ма? Сипаттап жазсаңыз, нақты жауап табамын. 😊",
  "refined_query": ""
}

Сұрақ: "мұрыннан қан шықса"
Чат тарихы:
Пайдаланушы: "Дәрет бұзыла ма?"
Бот: "Дәретіңізді дәл қандай жағдай бұзды деп ойлайсыз?"
Нәтиже:
{
  "intent": "KNOWLEDGE_SEARCH",
  "is_complete": true,
  "clarification_prompt": "",
  "refined_query": "мұрыннан қан аққанда дәрет бұзыла ма"
}

Сұрақ: "Нарушается ли омовение?"
Чат тарихы: (бос)
Нәтиже:
{
  "intent": "KNOWLEDGE_SEARCH",
  "is_complete": false,
  "clarification_prompt": "Опишите, пожалуйста, какая именно ситуация произошла? Например, выделилась ли кровь, был ли сон или произошло что-то другое? Это поможет мне найти точный ответ по мазхабу Ханафи. 😊",
  "refined_query": ""
}

Сұрақ: "текла кровь"
Чат тарихы:
Пайдаланушы: "Нарушается ли омовение?"
Бот: "Опишите, пожалуйста, какая именно ситуация произошла?"
Нәтиже:
{
  "intent": "KNOWLEDGE_SEARCH",
  "is_complete": true,
  "clarification_prompt": "",
  "refined_query": "Нарушается ли омовение при выделении крови"
}

===
Пайдаланушы хабарламасы: "${query}"
Чат тарихы:
${formattedHistoryText || '(бос)'}`;

    const response = await generateContentFixed({
      model: GEMINI_INTENT_MODEL,
      contents: [{ role: 'user', parts: [{ text: promptText }] }],
      config: {
        temperature: 0.1,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            intent: {
              type: Type.STRING
            },
            is_complete: {
              type: Type.BOOLEAN
            },
            clarification_prompt: {
              type: Type.STRING
            },
            refined_query: {
              type: Type.STRING
            }
          },
          required: ["intent", "is_complete", "clarification_prompt", "refined_query"]
        }
      }
    });

    const resultText = (response.text || '').trim();
    const parsedData = JSON.parse(resultText);

    console.log(`[🔍 ROUTER] Analysis Result:`, JSON.stringify(parsedData, null, 2));

    return {
      intent: (parsedData.intent === 'CHITCHAT') ? 'CHITCHAT' : 'KNOWLEDGE_SEARCH',
      is_complete: parsedData.is_complete === true,
      clarification_prompt: parsedData.clarification_prompt || '',
      refined_query: parsedData.refined_query || query
    };

  } catch (error: any) {
    console.error(`[❌ ROUTER ERROR] Failed to classify intent with GenAI, fallback to heuristics:`, error.message || error);
    
    // Fallback logic
    const religiousKeywords = [
      'намаз', 'ораза', 'дәрет', 'дарет', 'аят', 'сүре', 'суре', 'хадис', 'үндеу', 'үкім', 'укім', 'парыз', 'сүннет', 'суннет', 
      'уәжіп', 'уажип', 'халал', 'харам', 'мәкруһ', 'макрух', 'мустахаб', 'неке', 'талақ', 'талак', 'зекет', 'ажырасу', 'қаза', 'каза',
      'сапар', 'мүсәпір', 'мусапир', 'құран', 'куран', 'аллаһ', 'аллах', 'құдай', 'кудай', 'пайғамбар', 'пайгамбар',
      'күнә', 'куна', 'жәннат', 'жаннат', 'тозақ', 'тозак', 'ислам', 'дін', 'дин', 'иман', 'періште', 'периште', 'жұма', 'жума'
    ];
    let isReligious = false;
    for (const kw of religiousKeywords) {
      if (clean.includes(kw)) {
        isReligious = true;
        break;
      }
    }
    return {
      intent: isReligious ? 'KNOWLEDGE_SEARCH' : 'CHITCHAT',
      is_complete: true,
      clarification_prompt: '',
      refined_query: query
    };
  }
}

