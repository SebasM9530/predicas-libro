import express from 'express';
import { Worker } from 'bullmq';
import dotenv from 'dotenv';

import { connection } from './queues/connection.js';
import { procesarTranscripcion } from './jobs/transcripcion.job.js';
import { procesarAnalisisIA } from './jobs/analisisIA.job.js';

dotenv.config();

const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '1', 10);

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
    // Reducir polling a Redis para no agotar el límite gratuito de
    // Upstash (500k requests/mes).
    stalledInterval: 60000,    // revisar jobs atascados: cada 60s (default 30s)
    lockDuration: 1800000,     // 30 minutos máximo por job antes de marcarlo fallido
    lockRenewTime: 30000,      // renovar el bloqueo cada 30s
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
// (de pago). El endpoint /wakeup es llamado por el backend cuando
// encola un job nuevo — así el worker se despierta bajo demanda
// en vez de necesitar un ping externo constante.
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

app.get('/wakeup', (req, res) => {
  console.log('[worker] Wakeup recibido desde el backend');
  res.json({ ok: true, mensaje: 'Worker despertado, procesando jobs...' });
});

app.listen(PORT, () => {
  console.log(`Servidor HTTP del worker escuchando en el puerto ${PORT}`);
});