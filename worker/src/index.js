import express from 'express';
import { Worker } from 'bullmq';
import dotenv from 'dotenv';

import { connection } from './queues/connection.js';
import { procesarTranscripcion } from './jobs/transcripcion.job.js';
import { procesarAnalisisIA } from './jobs/analisisIA.job.js';

dotenv.config();

const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '1', 10);

// ─────────────────────────────────────────────────────────────
// Servidor HTTP — debe arrancar PRIMERO para que Render
// registre el puerto antes de que el worker empiece a procesar.
// Sin esto, Render puede matar el servicio por timeout de binding.
// ─────────────────────────────────────────────────────────────

const app = express();
const PORT = process.env.PORT || 10000;

let workerListo = false;

app.get('/', (req, res) => {
  res.json({
    ok: true,
    servicio: 'predicas-libro-worker',
    workerListo,
    timestamp: new Date().toISOString(),
  });
});

app.get('/health', (req, res) => {
  res.json({ ok: true, workerListo });
});

app.get('/wakeup', (req, res) => {
  console.log('[worker] Wakeup recibido desde el backend');
  res.json({ ok: true, mensaje: 'Worker activo, procesando jobs...' });
});

// Arrancar HTTP primero
app.listen(PORT, () => {
  console.log(`Servidor HTTP del worker escuchando en el puerto ${PORT}`);

  // Esperar 20s después de que el puerto esté listo antes de procesar jobs.
  // Render necesita este tiempo para terminar de configurar la red saliente.
  // Sin este delay, los requests a OpenAI fallan por timeout silencioso.
  const DELAY_RED_MS = 20000;
  console.log(`[worker] Esperando ${DELAY_RED_MS / 1000}s para que la red de Render esté lista...`);

  setTimeout(() => {
    console.log('[worker] Red lista. Iniciando procesamiento de jobs...');
    iniciarWorker();
  }, DELAY_RED_MS);
});

function iniciarWorker() {
  const worker = new Worker(
    'capitulos',
    async (job) => {
      console.log(`Procesando job "${job.name}" (id=${job.id})`);

      switch (job.name) {
        case 'transcripcion':
          return procesarTranscripcion(job.data);

        case 'analisis_ia':
          return procesarAnalisisIA({ capituloId: job.data.capituloId });

        case 'instruccion_manual':
          return procesarAnalisisIA({
            capituloId: job.data.capituloId,
            instruccion: job.data.instruccion,
          });

        default:
          throw new Error(`Tipo de job desconocido: ${job.name}`);
      }
    },
    {
      connection,
      concurrency: CONCURRENCY,
      stalledInterval: 60000,
      lockDuration: 1800000,
      lockRenewTime: 30000,
    }
  );

  worker.on('completed', (job) => {
    console.log(`Job "${job.name}" (id=${job.id}) completado`);
  });

  worker.on('failed', (job, err) => {
    console.error(`Job "${job?.name}" (id=${job?.id}) falló:`, err.message);
  });

  workerListo = true;
  console.log(`Worker iniciado con concurrencia ${CONCURRENCY}, esperando trabajos...`);
}