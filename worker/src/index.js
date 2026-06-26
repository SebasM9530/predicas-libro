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

console.log(`Worker iniciado con concurrencia ${CONCURRENCY}, esperando trabajos...`);