# Басты принциптер (Project Rules)

1. **AI Модельдері**:
   - **Generation (Жауап генерациялау)**: `gemini-3-flash-preview`
   - **Embedding (Векторлау)**: `gemini-embedding-2` (ол үшін `outputDimensionality: 1536` қолданылады)

2. **Қайдан бапталған (Configuration Environment)**:
   - Біз AI Studio ішінен емес, **Google Cloud Console (Vertex AI)** арқылы баптадық. API кілті емес, Service Account қолданылады (`momyn-t1` жобасында).

3. **Қателіктер**:
   - 403 (Permission Denied) қатесін немесе үлгінің табылмауын "API Key Leaked" деп қате көрсетіп, пайдаланушыны шатастыруға болмайды. Тек шын мәнінде "leaked" немесе "security" сөздері кездескенде ғана Leaked деп көрсету қажет.

Бұл ережелер тұрақты сақталып, алдағы уақытта басшылыққа алынады.
