import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import capitulosRoutes from './routes/capitulos.routes.js';
import sugerenciasRoutes from './routes/sugerencias.routes.js';
import libroRoutes from './routes/libro.routes.js';
import { despertarWorker } from './services/worker.service.js';

dotenv.config();

const app = express();

const frontendUrl = process.env.FRONTEND_URL || '*';
app.use(cors({ origin: frontendUrl }));
app.use(express.json({ limit: '10mb' }));

// Middleware global: despierta el worker en cualquier request del frontend
// fire-and-forget con cooldown de 10 min — no bloquea ni afecta respuestas
app.use((req, res, next) => {
  despertarWorker(`${req.method} ${req.path}`);
  next();
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.use('/api/capitulos', capitulosRoutes);
app.use('/api/sugerencias', sugerenciasRoutes);
app.use('/api/libro', libroRoutes);

app.use((err, req, res, next) => {
  console.error('Error no manejado:', err);
  if (err.message && err.message.includes('Solo se permiten archivos MP3')) {
    return res.status(400).json({ error: err.message });
  }
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'El archivo de audio es demasiado grande' });
  }
  res.status(500).json({ error: 'Error interno del servidor' });
});

export default app;