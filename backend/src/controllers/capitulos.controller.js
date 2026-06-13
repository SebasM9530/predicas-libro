import { supabase } from '../services/supabase.service.js';
import { subirAudio } from '../services/storage.service.js';
import { encolarTranscripcion, encolarInstruccionManual } from '../services/queue.service.js';

/**
 * POST /api/capitulos
 * Crea un nuevo capítulo a partir de un audio subido y encola la transcripción.
 * Espera multipart/form-data con: audio (file), fecha_sermon, titulo (opcional)
 */
export async function crearCapitulo(req, res) {
  try {
    const { fecha_sermon, titulo } = req.body;
    const archivo = req.file;

    if (!archivo) {
      return res.status(400).json({ error: 'Falta el archivo de audio (campo "audio")' });
    }
    if (!fecha_sermon) {
      return res.status(400).json({ error: 'Falta el campo "fecha_sermon" (YYYY-MM-DD)' });
    }

    // 1. Crear registro del capítulo en estado "pendiente"
    const { data: capitulo, error: errorInsert } = await supabase
      .from('capitulos')
      .insert({
        fecha_sermon,
        titulo: titulo || null,
        estado: 'pendiente',
      })
      .select()
      .single();

    if (errorInsert) throw errorInsert;

    // 2. Subir el audio a Storage usando el id del capítulo
    const path = await subirAudio(capitulo.id, archivo.buffer, archivo.originalname);

    // 3. Guardar la ruta del audio y pasar a estado "transcribiendo"
    const { error: errorUpdate } = await supabase
      .from('capitulos')
      .update({ audio_url: path, estado: 'transcribiendo' })
      .eq('id', capitulo.id);

    if (errorUpdate) throw errorUpdate;

    // 4. Crear registro en trabajos_cola y encolar el job
    await supabase.from('trabajos_cola').insert({
      capitulo_id: capitulo.id,
      tipo: 'transcripcion',
      estado: 'pendiente',
    });

    await encolarTranscripcion(capitulo.id);

    return res.status(201).json({
      mensaje: 'Audio recibido, procesando transcripción',
      capitulo: { ...capitulo, audio_url: path, estado: 'transcribiendo' },
    });
  } catch (err) {
    console.error('Error en crearCapitulo:', err);
    return res.status(500).json({ error: 'Error interno al crear el capítulo' });
  }
}

/**
 * GET /api/capitulos
 * Lista todos los capítulos (resumen, sin el texto completo) ordenados por fecha desc.
 */
export async function listarCapitulos(req, res) {
  try {
    const { data, error } = await supabase
      .from('capitulos')
      .select('id, numero_orden, titulo, fecha_sermon, estado, promovido, created_at, updated_at')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return res.json({ capitulos: data });
  } catch (err) {
    console.error('Error en listarCapitulos:', err);
    return res.status(500).json({ error: 'Error interno al listar capítulos' });
  }
}

/**
 * GET /api/capitulos/:id
 * Obtiene un capítulo completo (incluye texto_actual) para abrir en el editor.
 */
export async function obtenerCapitulo(req, res) {
  try {
    const { id } = req.params;

    const { data: capitulo, error } = await supabase
      .from('capitulos')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !capitulo) {
      return res.status(404).json({ error: 'Capítulo no encontrado' });
    }

    return res.json({ capitulo });
  } catch (err) {
    console.error('Error en obtenerCapitulo:', err);
    return res.status(500).json({ error: 'Error interno al obtener el capítulo' });
  }
}

/**
 * GET /api/capitulos/:id/estado
 * Endpoint ligero para hacer polling del estado de procesamiento.
 */
export async function obtenerEstadoCapitulo(req, res) {
  try {
    const { id } = req.params;

    const { data: capitulo, error } = await supabase
      .from('capitulos')
      .select('id, estado, error_detalle, updated_at')
      .eq('id', id)
      .single();

    if (error || !capitulo) {
      return res.status(404).json({ error: 'Capítulo no encontrado' });
    }

    return res.json({ capitulo });
  } catch (err) {
    console.error('Error en obtenerEstadoCapitulo:', err);
    return res.status(500).json({ error: 'Error interno al obtener el estado' });
  }
}

/**
 * PATCH /api/capitulos/:id/texto
 * Autosave: actualiza el texto_actual editado manualmente por el pastor.
 * Body: { texto_actual: string }
 */
export async function actualizarTextoCapitulo(req, res) {
  try {
    const { id } = req.params;
    const { texto_actual } = req.body;

    if (typeof texto_actual !== 'string') {
      return res.status(400).json({ error: 'Falta el campo "texto_actual" (string)' });
    }

    const { error } = await supabase
      .from('capitulos')
      .update({ texto_actual })
      .eq('id', id);

    if (error) throw error;

    return res.json({ mensaje: 'Texto actualizado' });
  } catch (err) {
    console.error('Error en actualizarTextoCapitulo:', err);
    return res.status(500).json({ error: 'Error interno al actualizar el texto' });
  }
}

/**
 * PATCH /api/capitulos/:id/titulo
 * Actualiza el título del capítulo.
 * Body: { titulo: string }
 */
export async function actualizarTituloCapitulo(req, res) {
  try {
    const { id } = req.params;
    const { titulo } = req.body;

    if (typeof titulo !== 'string' || !titulo.trim()) {
      return res.status(400).json({ error: 'Falta el campo "titulo" (string no vacío)' });
    }

    const { error } = await supabase
      .from('capitulos')
      .update({ titulo })
      .eq('id', id);

    if (error) throw error;

    return res.json({ mensaje: 'Título actualizado' });
  } catch (err) {
    console.error('Error en actualizarTituloCapitulo:', err);
    return res.status(500).json({ error: 'Error interno al actualizar el título' });
  }
}

/**
 * POST /api/capitulos/:id/instrucciones
 * Recibe una instrucción general en texto libre y encola una nueva ronda de análisis IA.
 * Body: { instruccion: string }
 */
export async function enviarInstruccion(req, res) {
  try {
    const { id } = req.params;
    const { instruccion } = req.body;

    if (typeof instruccion !== 'string' || !instruccion.trim()) {
      return res.status(400).json({ error: 'Falta el campo "instruccion" (string no vacío)' });
    }

    // Verificar que el capítulo existe y está listo
    const { data: capitulo, error: errorGet } = await supabase
      .from('capitulos')
      .select('id, estado')
      .eq('id', id)
      .single();

    if (errorGet || !capitulo) {
      return res.status(404).json({ error: 'Capítulo no encontrado' });
    }

    await supabase.from('trabajos_cola').insert({
      capitulo_id: id,
      tipo: 'instruccion_manual',
      estado: 'pendiente',
      payload: { instruccion },
    });

    await encolarInstruccionManual(id, instruccion);

    return res.status(202).json({ mensaje: 'Instrucción recibida, generando nuevas sugerencias' });
  } catch (err) {
    console.error('Error en enviarInstruccion:', err);
    return res.status(500).json({ error: 'Error interno al enviar la instrucción' });
  }
}
