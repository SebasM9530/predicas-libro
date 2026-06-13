import { Router } from 'express';
import {
  obtenerLibro,
  actualizarConfigLibro,
  reordenarLibro,
  descargarPdfLibro,
  descargarWordLibro,
} from '../controllers/libro.controller.js';

const router = Router();

// Obtener libro (capítulos + config)
router.get('/', obtenerLibro);

// Descargar libro completo
router.get('/pdf', descargarPdfLibro);
router.get('/word', descargarWordLibro);

// Actualizar configuración (portada, tipografía, márgenes, etc.)
router.put('/config', actualizarConfigLibro);

// Reordenar capítulos del libro
router.put('/orden', reordenarLibro);

export default router;
