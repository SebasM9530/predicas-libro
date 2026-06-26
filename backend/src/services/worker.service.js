const WORKER_URL = process.env.WORKER_URL;
const COOLDOWN_MS = 10 * 60 * 1000;
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