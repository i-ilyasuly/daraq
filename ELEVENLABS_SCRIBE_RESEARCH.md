# ElevenLabs Scribe v2: Дауыстық хабарламаларды мәтінге айналдыру және Telegram Ботқа интеграциялау зерттеуі

Осы құжатта **Daraq** жобасындағы Telegram ботқа дауыстық (voice) хабарламаларды қабылдау және оларды өте жылдам, аса дәлдікпен қазақ тілінде мәтінге айналдыру үшін **ElevenLabs Scribe v2** (Speech-to-Text / STT) технологиясын қолдану бойынша жүргізілген толық зерттеу нәтижелері, ресми API құрылымы, қазақ тілі үшін оңтайландыру әдістері және дайын интеграциялық код үлгілері жинақталған.

---

## 1. Технологияға шолу және Оның негізгі артықшылықтары
**ElevenLabs Scribe** — бұл нарықтағы ең озық және өте жылдам көптілді (multilingual) дауысты мәтінге айналдыру (STT) моделі. 

### Негізгі артықшылықтары:
1. **Жоғары Жылдамдық (Ultra-low Latency):** Нақты уақытта жылдам жұмыс істеуге негізделген. Орташа есеппен 1 минуттық аудионы өңдеу уақыты санаулы секундтарды ғана алады.
2. **Қазақ тілін толық сенімді қолдау (Kazakh Language Support):** ElevenLabs Scribe қазақ тілінің ерекше дыбыстарын (ә, ө, ү, ұ, і, ң, ғ, қ, һ) өте жоғары деңгейде таниды.
3. **Контекстті түсіну (Hallucination & Noise filtering):** Аудиодағы сықырларды, бос шуларды және кідірістерді ақылды түрде сүзіп тастап, тек сөйлеген сөзді ғана мәтін ретінде транскрипциялайды.
4. **Спикерлерді анықтау (Speaker Diarization):** Егер аудиода бірнеше адам сөйлесе, олардың кім екенін бөліп бере алады (бұл біздің жағдайда 1 қолданушы сұрақ қоятындықтан маңызды емес, бірақ қосымша артықшылық).

---

## 2. Telegram Бот пен Дауыстық Хабарламалар Сәулеті (Architecture)
Telegram арқылы дауыстық хабарлама жібергенде процестің жұмыс істеу принципі:

1. **Дауыс жіберу:** Қолданушы ботқа дауыстық хабарлама (Telegram-да бұл автоматты түрде өте жоғары сапалы **OGG/OPUS** форматында болады) жібереді.
2. **Файлды алу:** Бот `Telegraf` кітапханасы арқылы `ctx.message.voice` объектісін ұстап алып, оның `file_id` мәнін алады.
3. **Жүктеу:** Бот Telegram серверінен дауыстық файлды тікелей уақытша Buffer немесе Stream ретінде жүктейді.
4. **Транскрипция (Scribe API):** Бот жүктелген аудио файлды (немесе буферді) бірден ElevenLabs Scribe API-не жібереді (сұраныс баптауында қазақ тілі код ретінде міндетті түрде көрсетіледі).
5. **LLM Ядросына беру:** Scribe қайтарған қазақша таза мәтін біздің бұрыннан жұмыс істеп тұрған `gemini-flash-lite-latest` RAG ядромызға кәдімгі мәтіндік сұрақ ретінде бағытталады.
6. **Жауап беру:** Бот қолданушыға дайын діни жауапты мәтінмен және қажет болса дәлелді сурет батырмасымен қайтарады.

> 💡 **Маңызды факт:** Telegram-да хабарламалар табиғаты бойынша қолданушы сөйлеп біткен соң ғана толық файл ретінде бір-ақ жіберіледі. Сондықтан бұл жерде дәстүрлі WebSocket ағыны емес, кәдімгі аса тиімді әрі өте жылдам **REST API (POST /v1/speech-to-text)** сұранысы қолданылады. Бұл жүйенің архитектурасын жүксіз, өте сенімді әрі жылдам етеді.

---

## 3. Ресми API Құжаттамасы және Параметрлері (Scribe v2)

ElevenLabs Speech-to-Text API-дің ресми URL мекенжайы:
`POST https://api.elevenlabs.io/v1/speech-to-text`

### Сұраныстың Headers бөлігі:
- `xi-api-key`: `YOUR_ELEVENLABS_API_KEY` (Оны `.env` файлында сақтаймыз)
- Content-Type: `multipart/form-data` (себебі аудио файлды binary ретінде жібереміз)

### Сұраныстың FormData Body параметрлері:

| Параметр | Типі | Міндетті ме? | Сипаттамасы | Нақты мысалы |
| :--- | :--- | :---: | :--- | :--- |
| **`file`** | File / Web API Blob / Buffer | **Иә** | Жиілігі жоғары кез келген танымал аудио файл (mp3, wav, ogg, m4a, etc). Telegram беретін ogg-ді тікелей қабылдайды. | `audio.ogg` |
| **`model_id`** | String | Жоқ | Қолданылатын транскрипция моделінің ID-і. Scribe негізгі моделі. | `scribe_v1` (немесе default) |
| **`language_code`** | String | Жоқ (бірақ өте ұсынылады) | **Қазақ тілін нақты тану үшін "kk" кодын береміз.** Бұл моделдің фонетикалық іздеуін тек қазақ тіліне шектеп, қателерді жояды. | `"kk"` |
| **`tag_speakers`** | Boolean | Жоқ | Бірнеше адамды ажырату керек пе деген баптау. Бізге қажет емес. | `false` |

---

## 4. Қазақ тілін тануды Максималды Жақсарту Жолдары

API-де ең басты оңтайландыру сәті — реалды уақытта қазақ тіліндегі дыбыстарды дұрыс анықтау.
1. **`language_code: "kk"` қолдану:** Егер бұл параметрді бос қалдырсақ, жүйе тілді автоматты анықтауға (auto-detect) тырысады. Бұл кезде қазақша сөйлемнің басын орысша немесе ұқсас басқа тілдермен шатастыру қаупі бар. Нақты `"kk"` деп көрсету модельді тек қазақша сөздік пен грамматикаға негіздейді.
2. **Аудио Пішімін сақтау:** Telegram дауыстық хабарламалары Opus кодегімен сығылады. ElevenLabs Scribe Opus OGG пішімін жергілікті деңгейде ешқандай конвертациясыз (ffmpeg-сіз) бірден тани алады. Бұл ортадағы уақыт шығынын 0-ге түсіріп, барынша жылдамдықты қамтамасыз етеді.

---

## 5. Дайын Интеграциялық Код Үлгісі (TypeScript)

Алдағы уақытта мақұлдағаннан кейін қосуға арналған өндірістік деңгейдегі екі түрлі интеграциялық код жобасы:

### Тәсіл А: Ресми HTTP `axios` / `fetch` және `Form-Data` арқылы (Ең сенімді балама)

Бұл тәсіл сыртқы ауыр кітапханаларға тәуелділікті толығымен азайтады және кез келген ортада тұрақты істейді.

```typescript
import axios from 'express';
import FormData from 'form-data';
import { Readable } from 'stream';

interface ScribeResponse {
  text: string;
  language_code?: string;
  duration?: number;
}

/**
 * Дауыстық хабарламаны қазақ тілінде мәтінге айналдыру функциясы
 * @param audioStream Telegram-нан алынған аудио ағыны (Stream) немесе Buffer
 * @param fileName Файл атауы (мысалы, voice.ogg)
 */
export async function transcribeKazakhVoice(
  audioStream: Readable | Buffer,
  fileName: string = 'voice.ogg'
): Promise<string> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error('ELEVENLABS_API_KEY орта айнымалысы бапталмаған!');
  }

  const form = new FormData();
  form.append('file', audioStream, { filename: fileName });
  form.append('model_id', 'scribe_v1');
  form.append('language_code', 'kk'); // Қазақ тілін міндетті түрде бекіту

  try {
    const response = await axios.post<ScribeResponse>(
      'https://api.elevenlabs.io/v1/speech-to-text',
      form,
      {
        headers: {
          ...form.getHeaders(),
          'xi-api-key': apiKey,
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      }
    );

    return response.data.text.trim();
  } catch (error: any) {
    console.error('[❌ ELEVENLABS SCRIBE ERROR]:', error?.response?.data || error.message);
    throw new Error('Дауыстық хабарламаны мәтінге айналдыру сәтсіз аяқталды.');
  }
}
```

### Тәсіл Б: Ресми `@elevenlabs/node` (немесе `elevenlabs`) SDK арқылы

Егер болашақта ElevenLabs SDK-ны толық қолданғымыз келсе:

```typescript
import { ElevenLabsClient } from 'elevenlabs';
import { Readable } from 'stream';

const client = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY
});

export async function transcribeKazakhVoiceWithSDK(
  audioStream: Readable | Buffer
): Promise<string> {
  try {
    const result = await client.speechToText.convert({
      file: audioStream,
      model_id: 'scribe_v1',
      language_code: 'kk', // Қазақ тілін белсендіру
    });

    return result.text;
  } catch (error) {
    console.error('SDK Scribe Error:', error);
    throw error;
  }
}
```

---

## 6. Жобаны Іске Асыру Кезеңдерінің (Next Steps) Ұсынысы

Егер осы зерттеуді мақұлдасаңыз, жұмысты келесі реттілікпен жүргіземіз:

1. **Баптау:** `.env` файлына `ELEVENLABS_API_KEY` айнымалысын қосу және оны `.env.example`-ге белгілеу.
2. **Сервис Жазу:** `src/backend/rag/` папкасының ішінде жаңа `scribeService.ts` файлын құрып, жоғарыдағы транскрипция логикасын орналастыру.
3. **Бот Интеграциясы:** `src/backend/bot/index.ts` файлында `bot.on('voice', ...)` оқиғасын (event listener) тыңдау:
   - Қолданушы дауыс жібергенде `Processing... / Дауысты талдау...` деген уақытша хабарлама шығару.
   - Дауыстық файлды Telegram сілтемесі арқылы жүктеп алып, ElevenLabs API-ге бағыттау.
   - Алынған қазақша мәтінді біздің жауап беруші RAG ядросына сұрақ ретінде жіберу.
4. **Тесттеу:** Нақты қазақша дауыстық сұрақтар жіберіп, оның қаншалықты жылдам (TTFT және жалпы секундтар) және сапалы шешілетінін бағалау.

---
*Осы зерттеумен толық танысып, мақұлдауыңызды күтемін. Бұл мүмкіндік Daraq жобасының мобильді қолдану ыңғайлылығын (UX) жаңа деңгейге көтереді!*
