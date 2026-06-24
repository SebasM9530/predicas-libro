import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  throw new Error('Falta la variable de entorno REDIS_URL');
}

const WORKER_URL = process.env.WORKER_URL || 'https://predicas-worker.onrender.com';

// Conexión compartida a Redis (Upstash requiere TLS, por eso usamos rediss://)
export const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null, // requerido por BullMQ
  tls: redisUrl.startsWith('rediss://') ? {} : undefined,
});

// Cola única donde se encolan los trabajos de transcripción y análisis IA.
// El worker (proceso aparte) escucha esta misma cola.
export const colaCapitulos = new Queue('capitulos', { connection });

/**
 * Envía una petición HTTP al worker para despertarlo si está dormido
 * en Render (los servicios gratuitos se duermen tras 15 min de inactividad).
 * No lanza error si falla — el job ya está en Redis y el worker lo
 * procesará cuando despierte por cualquier medio.
 */
async function despertarWorker() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${WORKER_URL}/wakeup`, { signal: controller.signal });
    clearTimeout(timeout);
    console.log(`[queue] Wakeup al worker: ${res.status}`);
  } catch (err) {
    console.log(`[queue] Worker no respondió al wakeup (puede estar procesando ya): ${err.message}`);
  }
}

/**
 * Encola un trabajo de transcripción para un capítulo.
 * @param {string} capituloId
 */
export async function encolarTranscripcion(capituloId) {
  await colaCapitulos.add(
    'transcripcion',
    { capituloId, tipo: 'transcripcion' },
    {
      attempts: 5,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: true,
      removeOnFail: false,
    }
  );

  // Despertar el worker inmediatamente para que procese el job
  await despertarWorker();
}

/**
 * Encola un trabajo de análisis IA para un capítulo (sugerencias automáticas).
 * @param {string} capituloId
 */
export async function encolarAnalisisIA(capituloId) {
  await colaCapitulos.add(
    'analisis_ia',
    { capituloId, tipo: 'analisis_ia' },
    {
      attempts: 5,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: true,
      removeOnFail: false,
    }
  );

  // No hace falta despertar aquí porque encolarAnalisisIA siempre
  // se llama desde dentro del worker (después de transcribir),
  // así que el worker ya está despierto y procesará este job solo.
}

/**
 * Encola un trabajo de instrucción manual (cuadro de instrucciones generales).
 * @param {string} capituloId
 * @param {string} instruccion - texto libre escrito por el pastor
 */
export async function encolarInstruccionManual(capituloId, instruccion) {
  await colaCapitulos.add(
    'instruccion_manual',
    { capituloId, tipo: 'instruccion_manual', instruccion },
    {
      attempts: 5,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: true,
      removeOnFail: false,
    }
  );

  // Despertar el worker porque esta llamada viene del frontend
  // (el worker puede estar dormido)
  await despertarWorker();
}