import { Router } from 'express';
import { rechazarSugerencia } from '../controllers/sugerencias.controller.js';

const router = Router();

// Rechazar una sugerencia puntual
router.patch('/:id/rechazar', rechazarSugerencia);

export default router;
