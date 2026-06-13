# Plataforma de Libro de Prédicas

Aplicación web que recibe sermones en audio (MP3), los transcribe automáticamente,
los analiza con IA para sugerir mejoras de redacción, permite al pastor editarlos
y acumula cada sermón como capítulo de un libro descargable en PDF o Word.

## Estructura del proyecto

```
predicas-libro/
├── backend/    -> API REST (Node + Express)
├── worker/     -> Procesa transcripción y análisis IA en segundo plano (BullMQ)
├── frontend/   -> Interfaz web (React + Vite + Tiptap)
├── database/   -> schema.sql para Supabase
└── render.yaml -> configuración de despliegue en Render
```

---

## 1. Configuración de servicios externos

### 1.1 Supabase

1. Crea un proyecto en https://supabase.com
2. Ve a **SQL Editor** y ejecuta el contenido completo de `database/schema.sql`.
3. Ve a **Storage** y crea un bucket llamado `audios` (privado).
4. Ve a **Project Settings → API** y copia:
   - `Project URL` -> será `SUPABASE_URL`
   - `service_role key` -> será `SUPABASE_SERVICE_ROLE_KEY` (no se sube a GitHub)

### 1.2 Groq (transcripción)

1. Crea una cuenta en https://console.groq.com
2. Ve a **API Keys** y genera una -> será `GROQ_API_KEY`

### 1.3 Anthropic (análisis IA)

1. Crea una cuenta en https://console.anthropic.com
2. Carga saldo (mínimo $5 USD, se recomienda $10-15 para development)
3. Ve a **API Keys** y genera una -> será `ANTHROPIC_API_KEY`

### 1.4 Redis (Upstash)

1. Crea una cuenta en https://upstash.com
2. Crea una base de datos Redis (elige una región cercana a Render)
3. Copia la URL en formato `rediss://...` -> será `REDIS_URL`

---

## 2. Configuración local (desarrollo)

### 2.1 Backend

```bash
cd backend
cp .env.example .env
# Completa .env con tus keys reales
npm install
npm run dev
```

El backend corre en http://localhost:3000

### 2.2 Worker

```bash
cd worker
cp .env.example .env
# Completa .env con tus keys reales
npm install
npm run dev
```

El worker no expone un puerto; solo procesa trabajos de la cola. Debe estar
corriendo para que la transcripción y el análisis IA funcionen.

Importante: el worker necesita ffmpeg instalado en el sistema.
- Ubuntu/Debian: sudo apt install ffmpeg
- Mac: brew install ffmpeg
- En Render, las imágenes de Node ya incluyen ffmpeg.

### 2.3 Frontend

```bash
cd frontend
cp .env.example .env
# Por defecto apunta a http://localhost:3000/api
npm install
npm run dev
```

El frontend corre en http://localhost:5173

---

## 3. Flujo de prueba local

1. Abre http://localhost:5173
2. Sube un archivo MP3 corto (1-2 minutos) con la fecha del sermón
3. El backend lo sube a Supabase Storage y encola el trabajo de transcripción
4. El worker lo toma, lo convierte con ffmpeg, lo transcribe con Groq
5. Al terminar, encola el análisis IA con Claude
6. Cuando el capítulo pase a estado "listo", ábrelo desde el dashboard
7. Revisa las sugerencias resaltadas, marca checkboxes y aplica cambios
8. Usa el botón "Subir al libro"
9. Ve a la pestaña "Libro" y descarga el PDF o Word

---

## 4. Despliegue en Render

### Opción A: usando render.yaml (Blueprint)

1. Sube el proyecto a GitHub (revisa que .env NO esté incluido)
2. En Render, ve a New -> Blueprint y selecciona el repo
3. Render detectará render.yaml y creará los 3 servicios automáticamente
4. Completa las variables de entorno marcadas como sync: false desde el
   dashboard de cada servicio (Settings -> Environment)

### Opción B: manual

Crea 3 servicios por separado:

1. Web Service (predicas-backend): root dir backend, build npm install, start npm start
2. Background Worker (predicas-worker): root dir worker, build npm install, start npm start
3. Static Site (predicas-frontend): root dir frontend, build npm install && npm run build, publish dir dist

En cada uno, configura las variables de entorno correspondientes (ver
.env.example de cada carpeta).

### Notas sobre el plan gratuito

- Los servicios "free" de Render se duermen tras 15 minutos de inactividad
  y tardan ~30s en despertar con la siguiente solicitud.
- El Background Worker en plan free también se duerme; si no hay
  trabajos en la cola, no consume recursos, pero al llegar un nuevo audio
  puede tardar un poco más en empezar a procesarlo.
- Puppeteer (usado para generar PDFs) descarga Chromium durante el build;
  esto puede hacer que el primer build tarde varios minutos.

---

## 5. Personalización pendiente

Estas partes quedaron con valores genéricos/por defecto y se ajustarán
cuando el cliente entregue las especificaciones:

- Diseño del libro (portada, tipografía, márgenes, tamaños): se configura
  vía PUT /api/libro/config, guardado en la tabla libro_config (columna
  config_estilos, JSON). La plantilla está en
  backend/src/services/plantillaLibro.service.js (PDF) y
  backend/src/services/word.service.js (Word).
- Prompt de Whisper (vocabulario bíblico/jerga local): variable de entorno
  WHISPER_PROMPT en el worker, o editable directamente en
  worker/src/services/groq.service.js
- Tipos de sugerencias y tono del prompt de Claude: definidos en
  worker/src/services/claude.service.js (SYSTEM_PROMPT)

---

## 6. Modelo de datos (resumen)

Ver database/schema.sql para el detalle completo. Tablas principales:

- capitulos: cada sermón subido, con su transcripción y texto editable
- sugerencias: sugerencias de la IA, vinculadas a un capítulo
- trabajos_cola: registro de trabajos en proceso (transcripción/análisis)
- libro_capitulos: capítulos ya promovidos al libro final
- libro_config: configuración global de portada/tipografía/márgenes
