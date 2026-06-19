import { Router } from 'express';
import {
  obtenerLibro,
  actualizarConfigLibro,
  reordenarLibro,
  descargarPdfLibro,
  descargarWordLibro,
} from '../controllers/libro.controller.js';


const router = Router();

router.get('/debug', async (req, res) => {
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  
  const { data: lc, error: e1 } = await sb.from('libro_capitulos').select('*');
  const { data: cfg, error: e2 } = await sb.from('libro_config').select('*');
  const { data: caps, error: e3 } = await sb.from('capitulos').select('id, titulo, promovido');
  
  res.json({
    libro_capitulos: { data: lc, error: e1 },
    libro_config: { data: cfg, error: e2 },
    capitulos_promovidos: { data: caps?.filter(c => c.promovido), error: e3 },
  });
});

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