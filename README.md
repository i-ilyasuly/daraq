# Daraq - Ханафи мазһабы бойынша діни AI ассистент

Daraq - бұл Google Gemini AI мен Qdrant векторлық дерекқорын пайдалана отырып, Ханафи мазһабының сенімді кітаптарына негізделген жауаптар беретін Telegram бот. Жоба RAG (Retrieval-Augmented Generation) архитектурасын қолданады.

## ⚙️ Қажетті орта айнымалылары (.env)

Жоба дұрыс жұмыс істеуі үшін түбірлік каталогта (root) `.env` файлын жасап, төмендегі кілттерді толтыруыңыз қажет:

```env
# Телеграм бот токені (BotFather-ден алынады)
TELEGRAM_BOT_TOKEN="your_telegram_bot_token"

# Gemini API кілті (AI Studio арқылы алынады)
GEMINI_API_KEY="your_gemini_api_key"

# Жобаның хостинг URL мекенжайы (Webhook үшін қажет)
APP_URL="https://your-app-url.com"

# Qdrant векторлық дерекқорының баптаулары
QDRANT_URL="https://your-qdrant-cluster.qdrant.io"
QDRANT_API_KEY="your_qdrant_api_key"

# Google Cloud Storage (Кітап суреттерін сақтау үшін)
GCS_BUCKET_NAME="daraq_books_bucket"

# Firebase Admin конфигурациясы (Чат тарихын сақтау үшін)
FIREBASE_PROJECT_ID="your_firebase_project_id"
FIREBASE_CLIENT_EMAIL="your_firebase_client_email"
FIREBASE_PRIVATE_KEY="your_firebase_private_key"
```

## 📚 Кітаптарды жүйеге енгізу (Ingest)

Кітапты (PDF) жүйенің дерекқорына векторлап, бөлшектеп салу үшін арнайы `ingest` скрипті жазылған.

Оны іске қосу үшін терминалда мына пәрменді орындаңыз:

```bash
npm run ingest <pdf_файл_жолы> "<кітап_аты>"
```

**Мысалы:**
```bash
npm run ingest ./books/sapar_fiqhy.pdf "Сапар фиқһы"
```

Бұл скрипт:
1. PDF файлды оқиды.
2. Мәтінді мағыналық бөліктерге (chunk) бөледі.
3. Gemini Embedding моделі арқылы оларды векторға айналдырады.
4. Qdrant Cloud-қа сақтайды.
5. Суреттерді өңдеп, GCS-ке сақтайды.

## 🚀 Серверді іске қосу

### Әзірлеу (Development) ортасында:
Кодты жазып, сынап көру үшін:
```bash
npm run dev
```

### Өндіріс (Production) ортасында:
Жобаны толыққанды серверге немесе бұлтқа (Cloud Run) орнату үшін:
```bash
# Алдымен жобаны жинақтаймыз (build)
npm run build

# Серверді іске қосамыз
npm run start
```

## 🛠️ Құралдар мен технологиялар
- **Backend:** Node.js, Express, TypeScript
- **AI/LLM:** Google Gemini (`gemini-flash-lite-latest`, `gemini-embedding-2`)
- **Векторлық база:** Qdrant Cloud
- **Дерекқор & Файлдар:** Firebase Firestore, Google Cloud Storage
- **Бот фреймворкі:** Telegraf (Telegram)
- **Сурет өңдеу:** Sharp
