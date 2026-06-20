import express from 'express';
import { Worker } from 'bullmq';
import dotenv from 'dotenv';

import { connection } from './queues/connection.js';
import { procesarTranscripcion } from './jobs/transcripcion.job.js';
import { procesarAnalisisIA } from './jobs/analisisIA.job.js';

dotenv.config();

const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '2', 10);

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
  }
);

worker.on('completed', (job) => {
  console.log(`Job "${job.name}" (id=${job.id}) completado`);
});

worker.on('failed', (job, err) => {
  console.error(`Job "${job?.name}" (id=${job?.id}) falló:`, err.message);
});

console.log(`Worker iniciado con concurrencia ${CONCURRENCY}, esperando trabajos...`);

// ─────────────────────────────────────────────────────────────
// Servidor HTTP mínimo: necesario para que Render acepte este
// proceso como "Web Service" (gratis) en vez de "Background Worker"
// (de pago). También sirve como endpoint de "ping" para mantenerlo
// despierto desde un servicio externo como cron-job.org.
// ─────────────────────────────────────────────────────────────

const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
  res.json({
    ok: true,
    servicio: 'predicas-libro-worker',
    timestamp: new Date().toISOString(),
  });
});

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Servidor HTTP del worker escuchando en el puerto ${PORT} (solo para health-check)`);
});