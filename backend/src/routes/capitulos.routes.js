import { Router } from 'express';
import { uploadAudio } from '../middlewares/upload.middleware.js';
import {
  crearCapitulo,
  listarCapitulos,
  obtenerCapitulo,
  obtenerEstadoCapitulo,
  actualizarTextoCapitulo,
  actualizarTituloCapitulo,
  enviarInstruccion,
} from '../controllers/capitulos.controller.js';
import {
  listarSugerencias,
  aplicarSugerencias,
} from '../controllers/sugerencias.controller.js';
import { promoverCapitulo } from '../controllers/libro.controller.js';

const router = Router();

// Crear capítulo (subir audio)
router.post('/', uploadAudio.single('audio'), crearCapitulo);

// Listar capítulos
router.get('/', listarCapitulos);

// Obtener un capítulo completo
router.get('/:id', obtenerCapitulo);

// Estado (para polling)
router.get('/:id/estado', obtenerEstadoCapitulo);

// Autosave de texto editado
router.patch('/:id/texto', actualizarTextoCapitulo);

// Actualizar título
router.patch('/:id/titulo', actualizarTituloCapitulo);

// Enviar instrucción general (cuadro de instrucciones)
router.post('/:id/instrucciones', enviarInstruccion);

// Sugerencias del capítulo
router.get('/:id/sugerencias', listarSugerencias);
router.post('/:id/sugerencias/aplicar', aplicarSugerencias);

// Promover al libro
router.post('/:id/promover', promoverCapitulo);

export default router;
