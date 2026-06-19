import { createReadStream } from 'fs';
import FormData from 'form-data';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MODELO = 'whisper-large-v3-turbo';

const PROMPT_DEFAULT =
  'Transcripción de una prédica cristiana evangélica en español. ' +
  'Incluye nombres bíblicos y términos religiosos como: Jehová, Yahvé, ' +
  'Jesucristo, Espíritu Santo, Pablo, Pedro, Moisés, Abraham, Isaac, ' +
  'Jacob, David, Salomón, Isaías, Jeremías, Ezequiel, Mateo, Marcos, ' +
  'Lucas, Juan, Romanos, Corintios, Gálatas, Efesios, Filipenses, ' +
  'Hebreos, Apocalipsis, Génesis, Éxodo, Levítico, Deuteronomio, ' +
  'Salmos, Proverbios, congregación, hermanos, versículo, capítulo, ' +
  'evangelio, Reino de Dios, Espíritu, gracia, salvación, redención.';

function dormir(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Transcribe un archivo de audio usando Groq Whisper.
 * Maneja rate limiting (429) con reintentos y backoff exponencial,
 * respetando el header Retry-After si viene presente.
 *
 * @param {string} filePath - ruta local del archivo de audio (chunk)
 * @param {number} maxReintentos
 * @returns {Promise<string>} texto transcrito
 */
export async function transcribirAudio(filePath, maxReintentos = 5) {
  if (!GROQ_API_KEY) {
    throw new Error('Falta la variable de entorno GROQ_API_KEY');
  }

  const prompt = process.env.WHISPER_PROMPT || PROMPT_DEFAULT;

  for (let intento = 0; intento <= maxReintentos; intento++) {
    const form = new FormData();
    form.append('file', createReadStream(filePath));
    form.append('model', MODELO);
    form.append('language', 'es');
    form.append('prompt', prompt);
    form.append('response_format', 'json');
    form.append('temperature', '0');

    const response = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        ...form.getHeaders(),
      },
      body: form,
    });

    if (response.ok) {
      const data = await response.json();
      return data.text || '';
    }

    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after');
      const esperaMs = retryAfter
        ? parseFloat(retryAfter) * 1000
        : 2 ** intento * 1000;

      console.warn(
        `Groq rate limit (429). Reintento ${intento + 1}/${maxReintentos} en ${esperaMs}ms`
      );
      await dormir(esperaMs);
      continue;
    }

    // Otros errores HTTP: lanzar con detalle
    const textoError = await response.text();
    throw new Error(`Groq error ${response.status}: ${textoError}`);
  }

  throw new Error('Groq: se agotaron los reintentos por rate limiting (429)');
}
