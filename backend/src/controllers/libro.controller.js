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

    // Determinar numero_orden: si ya tiene uno (re-promoción), se mantiene;
    // si es nuevo, se asigna el siguiente disponible.
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

    // Upsert en libro_capitulos (capitulo_id es UNIQUE)
    const { error: errorUpsert } = await supabase
      .from('libro_capitulos')
      .upsert(
        {
          capitulo_id: capitulo.id,
          numero_orden: numeroOrden,
          titulo,
          fecha_sermon: capitulo.fecha_sermon,
          texto_final: capitulo.texto_actual,
        },
        { onConflict: 'capitulo_id' }
      );

    if (errorUpsert) throw errorUpsert;

    // Marcar el capítulo como promovido y guardar su numero_orden
    const { error: errorUpdate } = await supabase
      .from('capitulos')
      .update({ promovido: true, numero_orden: numeroOrden })
      .eq('id', id);

    if (errorUpdate) throw errorUpdate;

    return res.json({ mensaje: 'Capítulo agregado/actualizado en el libro', numero_orden: numeroOrden });
  } catch (err) {
    console.error('Error en promoverCapitulo:', err);
    return res.status(500).json({ error: 'Error interno al promover el capítulo' });
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
    console.error('Error en obtenerLibro:', err);
    return res.status(500).json({ error: 'Error interno al obtener el libro' });
  }
}

/**
 * PUT /api/libro/config
 * Actualiza la configuración del libro (portada, tipografía, márgenes, etc.)
 * Body: { titulo_libro?, autor?, subtitulo?, config_estilos? }
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

    // Actualizar uno por uno (la tabla es pequeña, no afecta rendimiento)
    for (const item of orden) {
      if (!item.id || typeof item.numero_orden !== 'number') continue;

      await supabase
        .from('libro_capitulos')
        .update({ numero_orden: item.numero_orden })
        .eq('id', item.id);

      // Mantener sincronizado el numero_orden en capitulos también
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
 * Genera y descarga el PDF del libro completo.
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
    return res.send(pdfBuffer);
  } catch (err) {
    console.error('Error en descargarPdfLibro:', err);
    return res.status(500).json({ error: 'Error interno al generar el PDF' });
  }
}

/**
 * GET /api/libro/word
 * Genera y descarga el documento Word del libro completo.
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
    return res.send(wordBuffer);
  } catch (err) {
    console.error('Error en descargarWordLibro:', err);
    return res.status(500).json({ error: 'Error interno al generar el Word' });
  }
}
