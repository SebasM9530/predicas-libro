import { supabase } from '../services/supabase.service.js';
import { subirAudio, eliminarAudio } from '../services/storage.service.js';
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

    const path = await subirAudio(capitulo.id, archivo.buffer, archivo.originalname);

    const { error: errorUpdate } = await supabase
      .from('capitulos')
      .update({ audio_url: path, estado: 'transcribiendo' })
      .eq('id', capitulo.id);

    if (errorUpdate) throw errorUpdate;

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
 * PATCH /api/capitulos/:id/metadatos
 * Actualiza título y/o fecha del sermón de un capítulo.
 * Body: { titulo?: string, fecha_sermon?: string }
 */
export async function actualizarMetadatosCapitulo(req, res) {
  try {
    const { id } = req.params;
    const { titulo, fecha_sermon } = req.body;

    const updateData = {};
    if (typeof titulo === 'string' && titulo.trim()) updateData.titulo = titulo.trim();
    if (typeof fecha_sermon === 'string' && fecha_sermon.trim()) updateData.fecha_sermon = fecha_sermon;

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'No se proporcionaron campos para actualizar (titulo o fecha_sermon)' });
    }

    const { data, error } = await supabase
      .from('capitulos')
      .update(updateData)
      .eq('id', id)
      .select('id, titulo, fecha_sermon')
      .single();

    if (error) throw error;

    // Si el capítulo está en el libro, sincronizar también ahí
    if (updateData.titulo || updateData.fecha_sermon) {
      const libroUpdate = {};
      if (updateData.titulo) libroUpdate.titulo = updateData.titulo;
      if (updateData.fecha_sermon) libroUpdate.fecha_sermon = updateData.fecha_sermon;

      await supabase.from('libro_capitulos').update(libroUpdate).eq('capitulo_id', id);
    }

    return res.json({ mensaje: 'Metadatos actualizados', capitulo: data });
  } catch (err) {
    console.error('Error en actualizarMetadatosCapitulo:', err);
    return res.status(500).json({ error: 'Error interno al actualizar los metadatos' });
  }
}

/**
 * DELETE /api/capitulos/:id
 * Elimina un capítulo por completo: registro en BD (cascada a sugerencias,
 * trabajos_cola y libro_capitulos) y el audio en Storage.
 */
export async function eliminarCapitulo(req, res) {
  try {
    const { id } = req.params;

    const { data: capitulo, error: errorGet } = await supabase
      .from('capitulos')
      .select('id, audio_url')
      .eq('id', id)
      .single();

    if (errorGet || !capitulo) {
      return res.status(404).json({ error: 'Capítulo no encontrado' });
    }

    const { error: errorDelete } = await supabase
      .from('capitulos')
      .delete()
      .eq('id', id);

    if (errorDelete) throw errorDelete;

    if (capitulo.audio_url) {
      await eliminarAudio(capitulo.audio_url);
    }

    return res.json({ mensaje: 'Capítulo eliminado' });
  } catch (err) {
    console.error('Error en eliminarCapitulo:', err);
    return res.status(500).json({ error: 'Error interno al eliminar el capítulo' });
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

    const { data: capitulo, error: errorGet } = await supabase
      .from('capitulos')
      .select('id, estado')
      .eq('id', id)
      .single();

    if (errorGet || !capitulo) {
      return res.status(404).json({ error: 'Capítulo no encontrado' });
    }

    const { data: trabajo, error: errorInsert } = await supabase
      .from('trabajos_cola')
      .insert({
        capitulo_id: id,
        tipo: 'instruccion_manual',
        estado: 'pendiente',
        payload: { instruccion },
      })
      .select('id')
      .single();

    if (errorInsert) throw errorInsert;

    await encolarInstruccionManual(id, instruccion);

    return res.status(202).json({
      mensaje: 'Instrucción recibida, generando nuevas sugerencias',
      trabajo_id: trabajo.id,
    });
  } catch (err) {
    console.error('Error en enviarInstruccion:', err);
    return res.status(500).json({ error: 'Error interno al enviar la instrucción' });
  }
}

/**
 * GET /api/capitulos/:id/trabajos/:trabajoId
 * Consulta el estado de un trabajo específico (usado para la barra de
 * progreso al enviar instrucciones al editor).
 */
export async function obtenerEstadoTrabajo(req, res) {
  try {
    const { trabajoId } = req.params;

    const { data: trabajo, error } = await supabase
      .from('trabajos_cola')
      .select('id, estado, error_detalle, tipo')
      .eq('id', trabajoId)
      .single();

    if (error || !trabajo) {
      return res.status(404).json({ error: 'Trabajo no encontrado' });
    }

    return res.json({ trabajo });
  } catch (err) {
    console.error('Error en obtenerEstadoTrabajo:', err);
    return res.status(500).json({ error: 'Error interno al obtener el estado del trabajo' });
  }
}