import { ArchitectureNode } from '../types';

export const DARAQ_NODES: ArchitectureNode[] = [
  {
    id: 'step1',
    title: '1. Енгізу шлюзі / Оқиғаларды тыңдаушы (Input Gateway)',
    subtitle: 'Telegram Webhook & Polling',
    type: 'GATEWAY',
    colorTheme: 'green',
    description: 'Телеграм боттың webhook немесе ұзақ сұрау (long polling) арқылы қолданушының барлық кіріс хабарламаларын, олардың өңделуін (edited_message) немесе геолокация оқиғаларын қабылдайтын кіру нүктесі.',
    role: 'Серверге түскен алғашқы сұраныстарды қабылдау, пішімдеу және қорғаныс скрипттерінен өткізіп, кезектілікті реттеу.',
    fallbackPolicy: 'Егер Webhook негізгі байланысы бұзылса немесе сервер жауап бермей қалса, жүйе автоматты түрде резервтік Long Polling режиміне ауысады. Желі қателері орын алған жағдайда Telegraf кітапханасы ретрансляциялық экспоненциалды кідіріс (exponential backoff) арқылы қайта қосылуды ұйымдастырады.',
    metric: 'Latency < 50ms, Availability 99.99%',
    backgroundTasks: [
      'Пайдаланушы жіберген геолокацияны анықтау: егер геолокация болса, оны Firestore-дағы пайдаланушы профиліне сақтап, геолокацияға негізделген намаз уақыттары мен сұранысты автоматты түрде жалғастыру.',
      'Қарапайым мәтіндік сұранымдарды арнайы тазартудан (escaping/sanitization) өткізу.',
      'Сұраныстарды өңдеу уақытын белгілеу және логтау серіппесін іске қосу.'
    ],
    connections: ['step2'],
    edgeLabels: {
      'step2': 'Клиент мәтіні'
    }
  },
  {
    id: 'step2',
    title: '2. Ақылды роутер және Чит-чат сүзгісі (Smart Router)',
    subtitle: 'Gemini Flash-Lite Intent Classifier',
    type: 'ROUTER',
    colorTheme: 'blue',
    description: 'Сұраныстың мақсатын жылдам бағалайтын басты интеллектуалды сүзгі. Ол сұраныстың діни пәтуа іздеу екенін немесе жай ғана амандасу екенін секундтан аз уақытта анықтайды.',
    role: 'Резервтерді үнемдеу мақсатында діни емес (сәлемдесу, бот туралы сұрақтар немесе жалпы әңгіме) хабарламаларды семантикалық іздеусіз (RAG бұрмалаусыз) тікелей өңдеп қайтару.',
    fallbackPolicy: 'Егер Vertex AI серверінен 403 немесе 404 (Permission Denied) қатесі орын алса, жүйедегі Monkey Patching логикасы іске қосылады. Бұзылған модель орнына резервтік көптілді модель көмекке келеді, сондай-ак локальды лингвистикалық эвристикалық фильтр (кілт сөздер сәйкестігі) арқылы Intent автоматты түрде клиент деңгейінде анықталады.',
    metric: 'Inference Time < 500ms',
    backgroundTasks: [
      'Пайдаланушының хабарлама мәтінін талдау және тарихи контекстті жүктеу.',
      'Чат тарихын ескере отырып, контекстік мақсатты (Chitchat негізі немесе Діни сұрақ) анықтау.',
      'Егер CHITCHAT табылса, RAG конвейерін айналып өтіп, жедел достық жауап нұсқасын дайындап жіберу.'
    ],
    connections: ['chitchat_done', 'step3'],
    edgeLabels: {
      'chitchat_done': 'ИӘ (Chitchat)',
      'step3': 'ЖОҚ (Діни сұрақ)'
    }
  },
  {
    id: 'chitchat_done',
    title: 'CHITCHAT Жауабы (Instant Friendly Reply)',
    subtitle: 'RAG bypassed',
    type: 'DECISION',
    colorTheme: 'amber',
    description: 'Жылдам жауап қайтару. Пайдаланушымен амандасу, хал-жағдай сұрау, Daraq жүйесінің мүмкіндіктерін түсіндіру.',
    role: 'Пайдаланушыға жайлы чат тәжірибесін сыйлау.',
    fallbackPolicy: 'Статикалық дайындалған сәлемдесу мәтіндерін ұсыну.',
    metric: 'Latency < 150ms',
    backgroundTasks: [
      'Пайдаланушы есімін алу.',
      'Сәлемдесу немесе сұрақ бағыты бойынша қысқа интерактивті мәзір (Inline Buttons) ұсыну.'
    ],
    connections: []
  },
  {
    id: 'step3',
    title: '3. Енгізу валидаторы және Нақтылау циклі (Input Validator)',
    subtitle: 'Query Completeness Evaluator',
    type: 'VALIDATOR',
    colorTheme: 'purple',
    description: 'Семантикалық Qdrant іздеуіне жібермес бұрын, пайдаланушы қойған сұрақтың толықтығын және мағыналық тұтастығын тексеру (мысалы, "Дәрет бұзыла ма?" деген сұрақ өте жалпылама, бұған нақтылау қажет).',
    role: 'Векторлық дерекқордан бос немесе тым көлемді емес, нақты контекст алу үшін пайдаланушыдан жағдайды нақтылау.',
    fallbackPolicy: 'Егер жүйе сұрақтың толықтығын тани алмаса, сұрақты бар күйінде келесі іздеу сатысына (Step 4) жібере салады.',
    metric: 'Validation Recall: 96%',
    backgroundTasks: [
      'Толық емес сұрақтар бойынша (мыс: "Ораза бұзыла ма?", "Намазым қабыл ма?") пайдаланушыға бірден балама нұсқаларды ұсынып нақтылау сұрағын жолдау.',
      'Пайдаланушы нақты жауап бергенде, чат тарихын біріктіріп, "Тіс жуғанда ораза бұзыла ма" деген сияқты нақты іздеу сұранысын (Refined Query) синтездеу.'
    ],
    connections: ['clarification_loop', 'step4'],
    edgeLabels: {
      'clarification_loop': 'Толық емес / Жалпылама',
      'step4': 'Толық / Нақты сұрақ'
    }
  },
  {
    id: 'clarification_loop',
    title: 'Нақтылау сұрағы (Clarifying Loop)',
    subtitle: 'Bot sends friendly guiding menu',
    type: 'DECISION',
    colorTheme: 'amber',
    description: 'Бот пайдаланушыға бағыттаушы сұрақ тастап, одан нақты қандай жағдай орын алғанын сипаттауды сұрайды.',
    role: 'Қажетті контекст жиналғанша іздеу конвейерін кідірте тұру.',
    fallbackPolicy: 'Пайдаланушыға ең көп тараған діни тақырыптардың батырмаларын көрсету.',
    metric: 'Blocking loop active',
    backgroundTasks: [
      'Пайдаланушыға мысалдар ұсыну (Мысалы, су жұтылып кету, дәрі қолдану).',
      'Чат тақырыбын белсенді күйде сақтау.'
    ],
    connections: ['step1'],
    edgeLabels: {
      'step1': 'Пайдаланушының жаңа жауабы'
    }
  },
  {
    id: 'step4',
    title: '4. Гибридті семантикалық іздеу (Hybrid Search Pipeline)',
    subtitle: 'Qdrant Cloud Prefetch & Fusion',
    type: 'PIPELINE',
    colorTheme: 'blue',
    description: 'Сұранысты бір мезгілде векторлық (Dense) және лексикалық (Sparse) жолмен параллель іздеп, олардың нәтижелерін өзара үйлестіру.',
    role: 'Кітаптардың жүктелген миллиондаған абзацтарының (chunks) ішінен сұраққа мағыналық жағынан да, сөздік құрамы жағынан да ең сәйкес келетін 30 үміткерді табу.',
    fallbackPolicy: 'Басты векторлау моделі ретінде gemini-embedding-2 (1536 өлшемді) қолданылады. Егер ол істен шықса, автономды Monkey Patching арқылы жүйе бірден text-multilingual-embedding-002 (768 өлшемді) модуліне көшеді. Егер Qdrant Cloud қолжетімсіз болса, жедел пәтуа алу үшін Google іздеу жүйесімен және бекітілген ресми сайттармен біріктіру (Google Search Grounding) іске қосылады.',
    metric: 'Search Latency < 180ms',
    backgroundTasks: [
      'Dense Retrieval: Сұраныстың 1536-визуалды векторлық нүктесін генерациялау және Qdrant-та семантикалық ұқсастық іздеу.',
      'Sparse Retrieval: BM25 алгоритмі бойынша сұраныстағы сөздердің таза жиілігі мен MurmurHash3 хэштеуі арқылы мәтіндік іздеу жүргізу.',
      'Reciprocal Rank Fusion (RRF): Екі іздеу жолынан алынған Top-20 нәтижелерді қайта реттеп, бірыңғай Top-30 тізімін құру.'
    ],
    connections: ['step5']
  },
  {
    id: 'step5',
    title: '5. Vertex AI рейтингтеу және Қорғаныс қалқаны (Reranking & Retrieval Guard)',
    subtitle: 'BGE-Reranker-v2-m3 Cross-Encoder',
    type: 'RERANKER',
    colorTheme: 'purple',
    description: 'Табылған 30 кандидаттың ішінен ең жоғары релеванттылығы бар ең үздік 3-5 үзіндіні сапалы іріктеп алу.',
    role: 'Мақаланың мазмұнына сүйеніп ең өзекті кітап беттерін фокустау, шулы немесе қатысы жоқ үзінділерді алып тастау.',
    fallbackPolicy: 'Егер Reranker қызметі жауап бермесе, Qdrant ұсынған бастапқы семантикалық ұқсастық косинусы (Cosine Similarity) бағасы негізінде ең үздік Top-5 тікелей таңдалып алынды.',
    metric: 'Rerank Time < 120ms, Min Score: 0.50',
    backgroundTasks: [
      'Ранжирлеу моделіне сұрақ пен мәтін параларын жіберу.',
      'Retrieval Guard бақылауы: Егер табылған үзінділердің ең жоғарғы ұқсастық бағасы белгіленген шектен (MIN_RELEVANCE_SCORE = 0.50) төмен болса, немесе мәселе заманауи болса, ресми пәтуа сайттарынан іздеу және егер мүлдем табылмаса "Дереккөздерде бұл туралы ақпарат табылмады" деген сыпайы жауап жіберіп, процесті аяқтау.'
    ],
    connections: ['fallback_empty', 'step6'],
    edgeLabels: {
      'fallback_empty': 'Score < 0.50',
      'step6': 'Score >= 0.50'
    }
  },
  {
    id: 'fallback_empty',
    title: 'Қорғаныс Қалқаны (Graceful Fallback)',
    subtitle: '"Мәлімет табылмады" хабарламасы',
    type: 'DECISION',
    colorTheme: 'amber',
    description: 'Жалған діни пәтуа немесе галлюцинация бермеу үшін іздеу нәтижесі тым төмен болған жағдайда жұмысты тоқтатып, ресми сайттарға бағыттау.',
    role: 'Жүйе сұраққа қате немесе негізсіз жауап беруінің алдын алу.',
    fallbackPolicy: 'Сыпайы нұсқаулық және қаласа ресми орталықтардың жедел байланысын ұсыну.',
    metric: 'Safety Triggered',
    backgroundTasks: [
      'Firestore-ға іздеу сәтсіздігі жайлы лог жазу.',
      'Пайдаланушыға сұрақты жеңілдетіп қоюды немесе ресми пәтуа бөліміне хабарласуды ұсыну.'
    ],
    connections: []
  },
  {
    id: 'step6',
    title: '6. Агенттік ойлау және Сақтану циклі (Agentic Reasoning & Thoughts)',
    subtitle: 'gemini-flash-lite-latest Strict Hanafi Reflection',
    type: 'REASONING',
    colorTheme: 'blue',
    description: 'Іріктелген мәтіндерге сүйеніп, заманауи LLM жүйесінің ішкі пайымдау (thought) логикасын қолдану арқылы шешім шығару.',
    role: 'Қандай да бір галлюцинацияға жол бермеу және Ханафи мазһабының қатаң шеңберін сақтау.',
    fallbackPolicy: 'Модель ретінде gemini-flash-lite-latest (немесе fallback үшін Gemini 2.5 Flash) пайдаланылады. Модель жүйелі түрде "Мәтінде жоқ мәліметті ойдан қоспа!" және "Өз пікіріңді араластырма!" деген қағидаларды жүзеге асырады. Егер Vertex AI сұранысын жүзеге асыру мүмкіндігі шектелсе, клиентке локальды локаут қателік хабарламасы бағытталады.',
    metric: 'Reasoning Time ~ 2.5s',
    backgroundTasks: [
      'Telegram-да пайдаланушыға жауап жылдамдығын сездіру үшін live "Thinking" анимациялық статустарын шығару ("Сұрақты талдаудамын...", "Жауапты тексерудемін...").',
      'Ішкі өзіндік рефлексия (Self-Reflection): Мәтіндерді салыстыру, Ханафи мазһабына қайшы пікірлердің болмауын қадағалау.',
      'Уақытша ойлау қабатын талдап, тек таза дәлелді мәліметті ғана соңғы жауапқа жіберіп, <thought> тегін тазарту.'
    ],
    connections: ['step7']
  },
  {
    id: 'step7',
    title: '7. Динамикалық шығысты жеткізу (Dynamic Output Delivery)',
    subtitle: 'Throttled HTML Stream & GCS Media Integrator',
    type: 'OUTPUT',
    colorTheme: 'green',
    description: 'Пайдаланушыға дайын болған дәлелді, таза талдауды қазақ тілінде жылдам жеткізу.',
    role: 'Әдемі безендірілген мәтіннің (HTML) табиғи түрде жазылуына қоса, интерактивті дыбыстық және визуалды батырмаларды басқару мүмкіндігін ұсыну.',
    fallbackPolicy: 'Дауыстық жауап құрастыру орындалмаса, тек мәтін ұсынылады. Кітап беті табылмаса, дереккөз мәтіндік релтеу бойынша бағытталады.',
    metric: 'Audio Gen < 1.5s, Visual Highlighting < 500ms',
    backgroundTasks: [
      'Типтік жазу әсерімен (typewriter effect) мәтінді 450мс шектеумен ағынды (stream) түрде шығару және жыпылықтайтын курсормен ▎ сүйемелдеу.',
      '1-батырма: "🎤 Дыбыстық жауапты тыңдау" -> gemini-3.1-flash-tts-preview көмегімен мәтінді дауысқа айналдыру (интонация белгілерін есептеп: [warmly]/[serious]), оны Google Cloud Storage бұлтында кэштеу және Телеграм аудио ретінде жіберу.',
      '2-батырма: "🖼 Дәлел суретін көру" -> Табылған кітап бетінің скриншотын Google Cloud Storage бұлтынан жүктеп, sharp арқылы қажетті абзацты қызыл түспен қоршап, пайдаланушыға Telegram MediaGroup Album ретінде жолдау.'
    ],
    connections: []
  }
];

export function generateMermaidCode(nodes: ArchitectureNode[]): string {
  let code = 'graph TD\n';
  
  // Define styles
  code += '  %% Styles and Classes\n';
  code += '  classDef gateway fill:#22c55e,stroke:#15803d,stroke-width:2px,color:#fff;\n';
  code += '  classDef router fill:#3b82f6,stroke:#1d4ed8,stroke-width:2px,color:#fff;\n';
  code += '  classDef validator fill:#a855f7,stroke:#7e22ce,stroke-width:2px,color:#fff;\n';
  code += '  classDef pipeline fill:#3b82f6,stroke:#1d4ed8,stroke-width:2px,color:#fff;\n';
  code += '  classDef reranker fill:#a855f7,stroke:#7e22ce,stroke-width:2px,color:#fff;\n';
  code += '  classDef reasoning fill:#3b82f6,stroke:#1d4ed8,stroke-width:2px,color:#fff;\n';
  code += '  classDef output fill:#10b981,stroke:#047857,stroke-width:2px,color:#fff;\n';
  code += '  classDef decision fill:#f59e0b,stroke:#b45309,stroke-width:2px,color:#fff;\n\n';

  nodes.forEach(node => {
    // Determine bracket type depending on node type
    let opener = '[';
    let closer = ']';
    if (node.type === 'DECISION') {
      opener = '{{';
      closer = '}}';
    } else if (node.type === 'ROUTER' || node.type === 'VALIDATOR') {
      opener = '{';
      closer = '}';
    }
    
    // Add node definition
    code += `  ${node.id}${opener}"${node.title.replace(/"/g, "'")}"${closer}\n`;
    
    // Apply class
    const typeLabel = node.type.toLowerCase();
    code += `  class ${node.id} ${typeLabel};\n`;
  });

  code += '\n  %% Connections\n';
  nodes.forEach(node => {
    node.connections.forEach(connId => {
      const edgeLabel = node.edgeLabels?.[connId];
      if (edgeLabel) {
        code += `  ${node.id} -->|"${edgeLabel}"| ${connId}\n`;
      } else {
        code += `  ${node.id} --> ${connId}\n`;
      }
    });
  });

  return code;
}
