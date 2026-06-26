/**
 * worker.service.js
 * Despierta el worker de Render de forma fire-and-forget con cooldown de 10 min.
 */
import fetch from 'node-fetch';

const WORKER_URL = process.env.WORKER_URL;
const COOLDOWN_MS = 10 * 60 * 1000; // 10 minutos
let ultimoPing = 0;

export function despertarWorker(motivo = 'request') {
  if (!WORKER_URL) return;

  const ahora = Date.now();
  if (ahora - ultimoPing < COOLDOWN_MS) return;
  ultimoPing = ahora;

  fetch(`${WORKER_URL}/wakeup`, {
    method: 'GET',
    signal: AbortSignal.timeout(8000),
  })
    .then(() => console.log(`[worker] Despertado por: ${motivo}`))
    .catch((err) => console.warn(`[worker] No se pudo despertar (${motivo}):`, err.message));
}