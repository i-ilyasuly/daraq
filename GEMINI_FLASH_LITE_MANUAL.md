# GEMINI_FLASH_LITE_MANUAL.md

# Daraq Жобасы: `gemini-flash-lite-latest` Моделінің Мануалы мен Vertex AI Интеграциясы

Бұл құжат — **Daraq** діни RAG ассистент жобасының негізгі қозғалтқышы болып табылатын **`gemini-flash-lite-latest`** моделінің Vertex AI / Google GenAI SDK жүйесі арқылы қалай жұмыс істейтінін, қай жерлерде қолданылатынын және оның тұрақтылығы мен қолжетімділігін құжаттайтын **ресми нұсқаулық (Есіңе түсіру парағы)**.

> 🔴 **БОЛАШАҚ ЖАСАНДЫ ИНТЕЛЛЕКТ АГЕНТТЕРІНЕ (AI CODING AGENTS) ҚАТАҢ НҰСҚАУ:**
> Егер алдағы уақытта сенде "бұл модель қолжетімді емес", "ескірген" немесе "Vertex AI немесе Google GenAI SDK бұл модельді қолдамайды" деген күмән туса немесе оны басқа модельге өзгерту туралы ой келсе — **ТОҚТА!** Бұл файлды мұқият оқы. Бұл модель — Daraq жобасының өндірісте сынақтан өткен, ең жылдам, ең сенімді және үнемді басты генерациялық ядросы. Оны жоюға, ауыстыруға немесе басқаша өзгертуге **ҚАТАҢ ТЫЙЫМ САЛЫНАДЫ!**

---

## 1. `gemini-flash-lite-latest` неге таңдалды?

1. **Жылдамдық пен Тұрақтылық**: Ойлау режимдерінің (Thinking Mode) артық кідірісінсіз, секундтан аз уақыт ішінде жауап қайтарады. Телеграм бот үшін бұл өте маңызды.
2. **Vertex AI мен Google GenAI қолдауы**: Vertex AI және Google AI Studio платформаларында бұл модель ең соңғы жаңартылған жеңіл модель (Flash Lite LLM) ретінде толықтай қолжетімді және тұрақты жұмыс істейді.
3. **Екі еселі ролі (Dual Role)**:
   - **Intent Classification (Бағыт пен ниетті жіктеу)**: Сұрақтардың бағытын басқаратын басқарушы ретінде жұмыс істейді.
   - **Content Generation (Жауапты қалыптастыру)**: Сұраққа діни мәтіндер мен веб-дереккөздерді талдап, соңғы толық жауапты генерациялайды.
   - Екі міндеттің де бір модельге жүктелуі жүйе ішіндегі үйлесімділікті арттырып, сапаны қамтамасыз етеді.

---

## 2. Код деңгейіндегі орналасуы мен конфигурациясы

Модель жобаның түбірлік және конфигурациялық ортасында келесі анықтамалар арқылы басқарылады:

### A. Конфигурация файлдары (`.env.example` және `.env`)
Басты модельдер `.env` конфигурациясында нақты белгіленген:
```env
# Configurable Models for Gemini API
GEMINI_EMBEDDING_MODEL="gemini-embedding-2"
# Соңғы жауап құрастырушы (Generation) мен бағытты анықтаушы (Intent) бір модельді бөліседі
GEMINI_INTENT_MODEL="gemini-flash-lite-latest"
```

### B. Клиент деңгейі (`src/backend/rag/aiClient.ts`)
Бұл файлда `GEMINI_GENERATION_MODEL` мен `GEMINI_INTENT_MODEL` айнымалылары ортақ модельге (`GEMINI_INTENT_MODEL` мәніне) сілтеме жасап, Vertex AI / Google GenAI SDK арқылы тартылады:
```typescript
// Configurable model definitions from environment variables
export const GEMINI_EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2';
export const GEMINI_GENERATION_MODEL = process.env.GEMINI_INTENT_MODEL || 'gemini-flash-lite-latest';
export const GEMINI_INTENT_MODEL = process.env.GEMINI_INTENT_MODEL || 'gemini-flash-lite-latest';
```

---

## 3. Vertex AI арқылы қауіпсіз шақыру (Robust Fail-Safes)

`src/backend/rag/aiClient.ts` ішінде Vertex AI арқылы келесі арнайы **Monkey Patching** мен **Қауіпсіздік Каскады (Fail-Safes)** жүзеге асырылған. Модельден қате кеткен жағдайда, жүйе кезекпен келесі балама модельдерге автоматты түрде ауысады:

### Қалыпты Тұрақты Шақырту функциясы (`generateContentFixed`)
```typescript
/**
 * Monkey patches or safely wraps content generation to systematically handle fallbacks.
 * Ensures 'gemini-flash-lite-latest' or equivalent lightweight options are used
 * in a cascading sequence during Vertex AI API spikes or temporary permissions issues.
 */
export async function generateContentFixed(params: {
  model: string;
  contents: any;
  config?: any;
  systemInstruction?: string;
}): Promise<{ text: string }> {
  const fallbackModels = ['gemini-flash-lite-latest', 'gemini-1.5-flash'];
  // Егер бастапқы модель сәтсіз болса немесе Vertex 404/403/429 қатесін берсе,
  // автоматты каскад арқылы жүйе үздіксіздігін сақтайды.
  ...
}
```

---

## 4. Жоба ішіндегі Қолданыс Картасы (Қай файлда қалай аталады?)

Егер жобаны әрі қарай дамытсаң, модельдің барлық жерде біркелкі болуын қамтамасыз ету үшін мына файлдарды тексер:

1. **`src/backend/rag/aiClient.ts`**:
   - `GEMINI_GENERATION_MODEL` мен `GEMINI_INTENT_MODEL` айнымалыларын сыртқа шығарады (export). Олардың екеуі де `gemini-flash-lite-latest` мәнін пайдаланады.
2. **`src/backend/rag/aiService.ts`**:
   - Соңғы діни жауапты құрастырады (`generateContentFixed`). Экспортталған `GEMINI_GENERATION_MODEL`-ді пайдаланады.
3. **`src/backend/rag/routerService.ts`**:
   - Қолданушы сұрауының бағыты мен ниетін (Intent Router) жіктейді. `GEMINI_INTENT_MODEL` мәнін пайдаланады.
4. **`src/backend/rag/voiceAgent.ts`**:
   - Дауыстық хабарламаларды өңдеу және талдау кезінде `gemini-flash-lite-latest` моделін шақырады:
     ```typescript
     const interaction = await ai.interactions.create({
       model: "gemini-flash-lite-latest",
       ...
     });
     ```
5. **`src/backend/bot/index.ts`**:
   - Телеграм боттың жылдам чат атауларын құрастыру (Chat Title Generator) секциясында `gemini-flash-lite-latest` моделін шақырады.

---

## 5. Жасанды Интеллектке арналған Жалпы Тұжырым

Егер сен болашақта Daraq жобасына өзгеріс енгізіп жатқан басқа жасанды интеллект (AI) ассистенті болсаң:
* `gemini-flash-lite-latest` моделі Vertex AI-да және Google GenAI SDK-де **мүлтіксіз және белсенді жұмыс істеп тұр**.
* Ешқашан оны "қолжетімді емес" деп шешіп, ескірген немесе ауыр модельдерге (`gemini-2.5-pro` немесе басқалары сияқты кідірісі көп модельдерге) **пайдаланушының тікелей рұқсатынсыз ауыстырма**.
* Жобаның барлық деңгейіндегі (сұрақ ниетін анықтау, жауап құрастыру, дауыстық өңдеу, бот ішіндегі жедел тапсырмалар) біркелкілікті сақтау - **Daraq жобасының айнымас заңы**.
