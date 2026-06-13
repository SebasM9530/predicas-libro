import { supabase } from '../services/supabase.service.js';

/**
 * GET /api/capitulos/:id/sugerencias
 * Lista todas las sugerencias pendientes de un capítulo.
 */
export async function listarSugerencias(req, res) {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('sugerencias')
      .select('*')
      .eq('capitulo_id', id)
      .order('posicion_inicio', { ascending: true });

    if (error) throw error;

    return res.json({ sugerencias: data });
  } catch (err) {
    console.error('Error en listarSugerencias:', err);
    return res.status(500).json({ error: 'Error interno al listar sugerencias' });
  }
}

/**
 * POST /api/capitulos/:id/sugerencias/aplicar
 * Aplica las sugerencias seleccionadas (checkboxes) sobre texto_actual.
 * Body: { sugerencia_ids: string[] }
 *
 * Estrategia: se reemplaza cada fragmento_original por su fragmento_nuevo
 * en texto_actual. Se procesan de la sugerencia con mayor posicion_inicio
 * a la de menor posición, para que los reemplazos no invaliden las
 * posiciones de las sugerencias restantes que aún no se han aplicado.
 */
export async function aplicarSugerencias(req, res) {
  try {
    const { id } = req.params;
    const { sugerencia_ids } = req.body;

    if (!Array.isArray(sugerencia_ids) || sugerencia_ids.length === 0) {
      return res.status(400).json({ error: 'Falta "sugerencia_ids" (array no vacío)' });
    }

    // 1. Obtener el capítulo y su texto actual
    const { data: capitulo, error: errorCap } = await supabase
      .from('capitulos')
      .select('id, texto_actual')
      .eq('id', id)
      .single();

    if (errorCap || !capitulo) {
      return res.status(404).json({ error: 'Capítulo no encontrado' });
    }

    // 2. Obtener las sugerencias seleccionadas
    const { data: sugerencias, error: errorSug } = await supabase
      .from('sugerencias')
      .select('*')
      .in('id', sugerencia_ids)
      .eq('capitulo_id', id);

    if (errorSug) throw errorSug;

    if (sugerencias.length === 0) {
      return res.status(404).json({ error: 'No se encontraron sugerencias para aplicar' });
    }

    let textoActualizado = capitulo.texto_actual || '';
    const aplicadas = [];
    const fallidas = [];

    // Ordenar de mayor a menor posicion_inicio para no desfasar índices
    const ordenadas = [...sugerencias].sort(
      (a, b) => (b.posicion_inicio ?? 0) - (a.posicion_inicio ?? 0)
    );

    for (const sug of ordenadas) {
      const indice = textoActualizado.indexOf(sug.fragmento_original);

      if (indice === -1) {
        // El fragmento ya no existe (probablemente otra sugerencia ya lo modificó)
        fallidas.push({ id: sug.id, motivo: 'fragmento_original no encontrado en el texto actual' });
        continue;
      }

      textoActualizado =
        textoActualizado.slice(0, indice) +
        sug.fragmento_nuevo +
        textoActualizado.slice(indice + sug.fragmento_original.length);

      aplicadas.push(sug.id);
    }

    // 3. Guardar el texto actualizado
    const { error: errorUpdate } = await supabase
      .from('capitulos')
      .update({ texto_actual: textoActualizado })
      .eq('id', id);

    if (errorUpdate) throw errorUpdate;

    // 4. Marcar como "aplicada" las que sí se aplicaron
    if (aplicadas.length > 0) {
      await supabase
        .from('sugerencias')
        .update({ estado: 'aplicada' })
        .in('id', aplicadas);
    }

    return res.json({
      mensaje: 'Sugerencias procesadas',
      texto_actual: textoActualizado,
      aplicadas,
      fallidas,
    });
  } catch (err) {
    console.error('Error en aplicarSugerencias:', err);
    return res.status(500).json({ error: 'Error interno al aplicar sugerencias' });
  }
}

/**
 * PATCH /api/sugerencias/:id/rechazar
 * Marca una sugerencia como rechazada (no se aplica, queda registro).
 */
export async function rechazarSugerencia(req, res) {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('sugerencias')
      .update({ estado: 'rechazada' })
      .eq('id', id);

    if (error) throw error;

    return res.json({ mensaje: 'Sugerencia rechazada' });
  } catch (err) {
    console.error('Error en rechazarSugerencia:', err);
    return res.status(500).json({ error: 'Error interno al rechazar la sugerencia' });
  }
}
