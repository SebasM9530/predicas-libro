import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import capitulosRoutes from './routes/capitulos.routes.js';
import sugerenciasRoutes from './routes/sugerencias.routes.js';
import libroRoutes from './routes/libro.routes.js';

dotenv.config();

const app = express();

// CORS: permitir solicitudes desde el frontend
const frontendUrl = process.env.FRONTEND_URL || '*';
app.use(cors({ origin: frontendUrl }));

app.use(express.json({ limit: '10mb' }));

// Healthcheck (útil para Render)
app.get('/api/health', (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

// Rutas principales
app.use('/api/capitulos', capitulosRoutes);
app.use('/api/sugerencias', sugerenciasRoutes);
app.use('/api/libro', libroRoutes);

// Manejo de errores genérico (ej. errores de Multer)
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
