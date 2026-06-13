import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  throw new Error('Falta la variable de entorno REDIS_URL');
}

// Conexión compartida a Redis (Upstash requiere TLS, por eso usamos rediss://)
export const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null, // requerido por BullMQ
  tls: redisUrl.startsWith('rediss://') ? {} : undefined,
});

// Cola única donde se encolan los trabajos de transcripción y análisis IA.
// El worker (proceso aparte) escucha esta misma cola.
export const colaCapitulos = new Queue('capitulos', { connection });

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
}
