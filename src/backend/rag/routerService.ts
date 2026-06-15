import { generateContentFixed, GEMINI_INTENT_MODEL } from './aiClient';
import { Type } from '@google/genai';

export interface RouterResult {
  intent: 'CHITCHAT' | 'KNOWLEDGE_SEARCH';
  is_complete: boolean;
  clarification_prompt: string;
  chitchat_response: string;
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
      chitchat_response: 'Уағалейкумассалам! <b>Daraq</b> көмекшісіне қош келдіңіз. Діни мәселелер бойынша сұрағыңыз болса, қоя беріңіз. 😊',
      refined_query: query
    };
  }

  try {
    console.log(`\n[🔍 ROUTER] Analyzing query for intent & completeness using Gemini... Query: "${query}"`);

    const formattedHistoryText = history
      .slice(-10) // analyze the last 10 turns to avoid token inflation
      .map(h => `${h.role === 'model' ? 'Бот' : 'Пайдаланушы'}: "${h.parts[0].text}"`)
      .join('\n');

    const promptText = `Сен — Daraq діни ассистент жүйесінің ақылды роутері және талдаушысысың. Пайдаланушының жаңа сұрағын чат тарихымен бірге талдап, тиісті санатты, сұрақтың толықтығын, қажет болса нақтылау сұрағын, ал егер сәлемдесу болса дайын жауапты (chitchat_response) және қайта құрылған сұранысты белгіле.

ЖҰМЫС ШЕҢБЕРІ мен ЕРЕЖЕЛЕРІ:
1. 'intent':
   - 'CHITCHAT': Пайдаланушы сәлемдесе, алғыс айтса, боттың атын/мүмкіндіктерін сұраса немесе эмоциялық қысқа пікір білдірсе.
   - 'KNOWLEDGE_SEARCH': діни білім, пәтуалар, шариғат ережелері бойынша сұрақтар.

2. 'is_complete' (тек KNOWLEDGE_SEARCH үшін маңызды):
   - Пайдаланушының сұрағы өте қысқа, мағынасыз немесе мүлдем түсініксіз болған жағдайда ғана (мысалы: "бірдеңе", "қалай", "жіберу") 'is_complete: false' деп бағала.
   - Егер сұрақ жалпылама болса да, мағынасы айқын әрі түсінікті болса (мысалы: "Оразаны не бұзады?", "Дәрет қалай алынады?", "Қандай жағдайларда намаз оқылмайды?"), оны МІНДЕТТІ ТҮРДЕ 'is_complete: true' деп бағала. Ақылға салып қарағанда түсінікті сұрақтарға орынсыз нақтылау сұрай берудің ҚАЖЕТІ ЖОҚ! Жалпы сұрақтарға біз базадан жалпылама жауап тауып бере аламыз.
   - Егер пайдаланушы бұған дейінгі боттың нақтылауына жауап берсе, бұл сұрақ толықтырылды деп санап, 'is_complete: true' деп бер.
   - Егер сұрақтың өзінде бірден нақты оқиға/іс-әрекет сипатталса, бұл толық сұрақ. 'is_complete: true' деп бер.
   - ТЕК CHITCHAT немесе Құран аяттарына тікелей сілтейтін сұрақтар үшін 'is_complete: true' болсын.

3. 'clarification_prompt' және 'chitchat_response':
   - ВИЗУАЛДЫ ӘДЕМІЛІК (АСА МАҢЫЗДЫ): 'clarification_prompt' немесе 'chitchat_response' өрісіне мәтін жазғанда міндетті түрде Telegram HTML тегтерін қолданып (<b>қалың қаріп</b>, <i>курсив</i>, <ul><li>тізімдер</li></ul>) жаз! Сіздің сұрағыңыз не жауабыңыз жалаң мәтін болмауы керек. Маңызды сөздерді қалың етіп белгілеп, эмодзилер (🌸, 😊, т.б.) қос.
   - Егер 'is_complete: false' болса, 'clarification_prompt' өрісіне нақтылау сұрағын жаз, ал 'chitchat_response' бос қалсын.
   - Егер intent 'CHITCHAT' болса, 'chitchat_response' өрісіне пайдаланушыға арналған өзіңнің жылы, сыпайы жауабыңды HTML форматпен жаз (мысалы: "Уағалейкумассалам! <b>Daraq</b> көмекшісіне қош келдіңіз. 😊"), ал 'clarification_prompt' бос қалсын.

4. 'refined_query':
   - Егер 'is_complete: true' болса, чат тарихындағы бастапқы жалпы сұрақты және пайдаланушының жаңа жауаптарын біріктіріп, ең нақты, қысқа діни іздеу сұранысын (refined query) жаса.
   - Сұрақ тілі сұрақ қойылған тілмен (Қазақша/Орысша/Ағылшынша) дәл СӘЙКЕС БОЛСЫН.

===
ЖҰМЫС ҮЛГІЛЕРІ (Few-Shot Examples):

Сұрақ: "Дәрет қалай алынады?"
Чат тарихы: (бос)
Нәтиже:
{
  "intent": "KNOWLEDGE_SEARCH",
  "is_complete": true,
  "clarification_prompt": "",
  "chitchat_response": "",
  "refined_query": "Дәретті қалай алады, дәрет алу үлгісі"
}

Сұрақ: "қандай"
Чат тарихы: (бос)
Нәтиже:
{
  "intent": "KNOWLEDGE_SEARCH",
  "is_complete": false,
  "clarification_prompt": "Кешіріңіз, сұрағыңыз түсініксіз болды. <b>Нақтырақ</b> сипаттап жаза аласыз ба? 😊",
  "chitchat_response": "",
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
  "chitchat_response": "",
  "refined_query": "мұрыннан қан аққанда дәрет бұзыла ма"
}

Сұрақ: "Нарушается ли омовение?"
Чат тарихы: (бос)
Нәтиже:
{
  "intent": "KNOWLEDGE_SEARCH",
  "is_complete": false,
  "clarification_prompt": "Опишите, пожалуйста, какая именно ситуация произошла? Например, выделилась ли <b>кровь</b>, был ли <b>сон</b> или произошло что-то другое? <i>Это поможет мне найти точный ответ по мазхабу Ханафи.</i> 😊",
  "chitchat_response": "",
  "refined_query": ""
}

Сұрақ: "Рахмет көп көп!"
Чат тарихы: (бос)
Нәтиже:
{
  "intent": "CHITCHAT",
  "is_complete": true,
  "clarification_prompt": "",
  "chitchat_response": "Оқасы жоқ! Алла разы болсын! 🌸 Егер басқа да сұрақтарыңыз болса, қоя беріңіз.",
  "refined_query": "Рахмет көп көп!"
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
            chitchat_response: {
              type: Type.STRING
            },
            refined_query: {
              type: Type.STRING
            }
          },
          required: ["intent", "is_complete", "clarification_prompt", "chitchat_response", "refined_query"]
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
      chitchat_response: parsedData.chitchat_response || '',
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
      chitchat_response: isReligious ? '' : 'Уағалейкумассалам! <b>Daraq</b> көмекшісіне қош келдіңіз. Діни мәселелер бойынша сұрағыңыз болса, қоя беріңіз. 😊',
      refined_query: query
    };
  }
}

