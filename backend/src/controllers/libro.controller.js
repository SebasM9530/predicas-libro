import { supabase } from '../services/supabase.service.js';
import { generarPdfLibro } from '../services/pdf.service.js';
import { generarWordLibro } from '../services/word.service.js';

/**
 * POST /api/capitulos/:id/promover
 * Botón "Subir al libro": toma texto_actual del capítulo y crea/actualiza
 * su entrada en libro_capitulos.
 */
export async function promoverCapitulo(req, res) {
  try {
    const { id } = req.params;

    const { data: capitulo, error: errorCap } = await supabase
      .from('capitulos')
      .select('id, titulo, fecha_sermon, texto_actual, numero_orden')
      .eq('id', id)
      .single();

    if (errorCap || !capitulo) {
      return res.status(404).json({ error: 'Capítulo no encontrado' });
    }

    if (!capitulo.texto_actual || !capitulo.texto_actual.trim()) {
      return res.status(400).json({ error: 'El capítulo no tiene texto para promover' });
    }

    let numeroOrden = capitulo.numero_orden;
    if (!numeroOrden) {
      const { data: maxData } = await supabase
        .from('libro_capitulos')
        .select('numero_orden')
        .order('numero_orden', { ascending: false })
        .limit(1)
        .maybeSingle();

      numeroOrden = (maxData?.numero_orden || 0) + 1;
    }

    const titulo = capitulo.titulo || `Sermón del ${capitulo.fecha_sermon}`;

    // Primero intentar eliminar si ya existe (para evitar conflictos de upsert)
    await supabase.from('libro_capitulos').delete().eq('capitulo_id', capitulo.id);

    // Luego insertar limpio
    const { error: errorInsert } = await supabase
      .from('libro_capitulos')
      .insert({
        capitulo_id: capitulo.id,
        numero_orden: numeroOrden,
        titulo,
        fecha_sermon: capitulo.fecha_sermon,
        texto_final: capitulo.texto_actual,
      });

    if (errorInsert) {
      console.error('Error insertando en libro_capitulos:', errorInsert);
      throw errorInsert;
    }

    const { error: errorUpdate } = await supabase
      .from('capitulos')
      .update({ promovido: true, numero_orden: numeroOrden })
      .eq('id', id);

    if (errorUpdate) throw errorUpdate;

    return res.json({ mensaje: 'Capítulo agregado/actualizado en el libro', numero_orden: numeroOrden });
  } catch (err) {
    console.error('Error en promoverCapitulo:', err);
    return res.status(500).json({ error: `Error interno al promover el capítulo: ${err.message}` });
  }
}

/**
 * DELETE /api/capitulos/:id/promover
 * Quita un capítulo del libro (lo elimina de libro_capitulos) y renumera
 * los capítulos restantes para que no queden huecos.
 */
export async function despromoverCapitulo(req, res) {
  try {
    const { id } = req.params;

    const { error: errorDelete } = await supabase
      .from('libro_capitulos')
      .delete()
      .eq('capitulo_id', id);

    if (errorDelete) throw errorDelete;

    await supabase
      .from('capitulos')
      .update({ promovido: false, numero_orden: null })
      .eq('id', id);

    // Renumerar capítulos restantes en orden
    const { data: restantes, error: errorList } = await supabase
      .from('libro_capitulos')
      .select('id, capitulo_id, numero_orden')
      .order('numero_orden', { ascending: true });

    if (errorList) throw errorList;

    for (let i = 0; i < restantes.length; i++) {
      const nuevoOrden = i + 1;
      if (restantes[i].numero_orden !== nuevoOrden) {
        await supabase.from('libro_capitulos').update({ numero_orden: nuevoOrden }).eq('id', restantes[i].id);
        await supabase.from('capitulos').update({ numero_orden: nuevoOrden }).eq('id', restantes[i].capitulo_id);
      }
    }

    return res.json({ mensaje: 'Capítulo quitado del libro' });
  } catch (err) {
    console.error('Error en despromoverCapitulo:', err);
    return res.status(500).json({ error: 'Error interno al quitar el capítulo del libro' });
  }
}

/**
 * GET /api/libro
 * Devuelve la lista de capítulos del libro (ordenados) + configuración.
 */
export async function obtenerLibro(req, res) {
  try {
    const { data: capitulos, error: errorCaps } = await supabase
      .from('libro_capitulos')
      .select('id, numero_orden, titulo, fecha_sermon, capitulo_id')
      .order('numero_orden', { ascending: true });

    if (errorCaps) throw errorCaps;

    const { data: config, error: errorConfig } = await supabase
      .from('libro_config')
      .select('*')
      .eq('id', 1)
      .single();

    if (errorConfig) throw errorConfig;

    return res.json({ capitulos, config });
  } catch (err) {
    console.error('Error DETALLADO en obtenerLibro:', JSON.stringify(err, null, 2));
    return res.status(500).json({ error: `Error interno: ${err.message}`, detalle: err });
  }
}

/**
 * PUT /api/libro/config
 * Actualiza la configuración del libro (portada, tipografía, márgenes, etc.)
 */
export async function actualizarConfigLibro(req, res) {
  try {
    const { titulo_libro, autor, subtitulo, config_estilos } = req.body;

    const updateData = {};
    if (titulo_libro !== undefined) updateData.titulo_libro = titulo_libro;
    if (autor !== undefined) updateData.autor = autor;
    if (subtitulo !== undefined) updateData.subtitulo = subtitulo;
    if (config_estilos !== undefined) updateData.config_estilos = config_estilos;

    const { error } = await supabase
      .from('libro_config')
      .update(updateData)
      .eq('id', 1);

    if (error) throw error;

    return res.json({ mensaje: 'Configuración actualizada' });
  } catch (err) {
    console.error('Error en actualizarConfigLibro:', err);
    return res.status(500).json({ error: 'Error interno al actualizar la configuración' });
  }
}

/**
 * PUT /api/libro/orden
 * Reordena los capítulos del libro.
 * Body: { orden: [{ id: libro_capitulos.id, numero_orden: number }, ...] }
 */
export async function reordenarLibro(req, res) {
  try {
    const { orden } = req.body;

    if (!Array.isArray(orden) || orden.length === 0) {
      return res.status(400).json({ error: 'Falta "orden" (array no vacío)' });
    }

    for (const item of orden) {
      if (!item.id || typeof item.numero_orden !== 'number') continue;

      await supabase
        .from('libro_capitulos')
        .update({ numero_orden: item.numero_orden })
        .eq('id', item.id);

      const { data: lc } = await supabase
        .from('libro_capitulos')
        .select('capitulo_id')
        .eq('id', item.id)
        .single();

      if (lc?.capitulo_id) {
        await supabase
          .from('capitulos')
          .update({ numero_orden: item.numero_orden })
          .eq('id', lc.capitulo_id);
      }
    }

    return res.json({ mensaje: 'Orden actualizado' });
  } catch (err) {
    console.error('Error en reordenarLibro:', err);
    return res.status(500).json({ error: 'Error interno al reordenar el libro' });
  }
}

/**
 * Obtiene los capítulos del libro (ordenados) y la configuración.
 * Usado por los endpoints de descarga PDF/Word.
 */
async function obtenerDatosLibroParaDescarga() {
  const { data: capitulos, error: errorCaps } = await supabase
    .from('libro_capitulos')
    .select('numero_orden, titulo, fecha_sermon, texto_final')
    .order('numero_orden', { ascending: true });

  if (errorCaps) throw errorCaps;

  const { data: config, error: errorConfig } = await supabase
    .from('libro_config')
    .select('*')
    .eq('id', 1)
    .single();

  if (errorConfig) throw errorConfig;

  return { capitulos, config };
}

/**
 * GET /api/libro/pdf
 * Genera y descarga el PDF del libro completo (con numeración de páginas).
 */
export async function descargarPdfLibro(req, res) {
  try {
    const { capitulos, config } = await obtenerDatosLibroParaDescarga();

    if (capitulos.length === 0) {
      return res.status(400).json({ error: 'El libro no tiene capítulos todavía' });
    }

    const pdfBuffer = await generarPdfLibro({ capitulos, config });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="libro-predicas.pdf"');
    res.setHeader('Content-Length', pdfBuffer.length);
    return res.end(pdfBuffer);
  } catch (err) {
    console.error('Error en descargarPdfLibro:', err);
    return res.status(500).json({ error: 'Error interno al generar el PDF' });
  }
}

/**
 * GET /api/libro/word
 * Genera y descarga el documento Word del libro completo (con numeración de páginas).
 */
export async function descargarWordLibro(req, res) {
  try {
    const { capitulos, config } = await obtenerDatosLibroParaDescarga();

    if (capitulos.length === 0) {
      return res.status(400).json({ error: 'El libro no tiene capítulos todavía' });
    }

    const wordBuffer = await generarWordLibro({ capitulos, config });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', 'attachment; filename="libro-predicas.docx"');
    res.setHeader('Content-Length', wordBuffer.length);
    return res.end(wordBuffer);
  } catch (err) {
    console.error('Error en descargarWordLibro:', err);
    return res.status(500).json({ error: 'Error interno al generar el Word' });
  }
}