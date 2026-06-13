import { Queue } from 'bullmq';
import { connection } from '../queues/connection.js';
import { supabase } from '../services/supabase.service.js';
import { analizarTexto } from '../services/claude.service.js';
import { localizarFragmento } from '../services/coherencia.service.js';

const colaCapitulos = new Queue('capitulos', { connection });

/**
 * Encola un trabajo de análisis IA (usado por el job de transcripción al terminar).
 * @param {string} capituloId
 */
export async function encolarAnalisisIA(capituloId) {
  await colaCapitulos.add(
    'analisis_ia',
    { capituloId, tipo: 'analisis_ia' },
    {
      attempts: 5,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: true,
      removeOnFail: false,
    }
  );
}

/**
 * Dado un texto y una lista de sugerencias crudas de Claude, calcula
 * posiciones y descarta/ajusta las que no sean localizables de forma única.
 *
 * @param {string} texto
 * @param {Array<object>} sugerenciasCrudas
 * @returns {Array<object>} sugerencias listas para insertar en BD
 */
function procesarSugerencias(texto, sugerenciasCrudas) {
  const procesadas = [];

  for (const sug of sugerenciasCrudas) {
    if (!sug.fragmento_original || typeof sug.fragmento_original !== 'string') {
      console.warn('[analisis_ia] Sugerencia descartada: falta fragmento_original', sug);
      continue;
    }

    const { unico, ocurrencias, posicion } = localizarFragmento(texto, sug.fragmento_original);

    if (ocurrencias === 0) {
      console.warn('[analisis_ia] Sugerencia descartada: fragmento no encontrado en el texto', {
        fragmento: sug.fragmento_original.slice(0, 80),
      });
      continue;
    }

    if (!unico) {
      console.warn('[analisis_ia] Sugerencia con fragmento ambiguo (aparece varias veces), se usa la primera ocurrencia', {
        fragmento: sug.fragmento_original.slice(0, 80),
        ocurrencias,
      });
      // Se conserva pero se nota en el log; se usa la primera ocurrencia.
    }

    procesadas.push({
      fragmento_original: sug.fragmento_original,
      fragmento_nuevo: sug.fragmento_nuevo ?? '',
      tipo: sug.tipo || 'mejorar_redaccion',
      problema: sug.problema || '',
      nota_adicional: sug.nota_adicional || null,
      posicion_inicio: posicion,
      posicion_fin: posicion + sug.fragmento_original.length,
      estado: 'pendiente',
    });
  }

  return procesadas;
}

/**
 * Procesa el job de análisis IA (automático o por instrucción manual):
 * 1. Obtiene el texto_actual del capítulo.
 * 2. Llama a Claude para obtener sugerencias.
 * 3. Localiza cada fragmento en el texto y guarda las sugerencias en BD.
 * 4. Si es el análisis automático inicial, marca el capítulo como "listo".
 *
 * @param {{ capituloId: string, instruccion?: string }} data
 */
export async function procesarAnalisisIA({ capituloId, instruccion = null }) {
  const tipoTrabajo = instruccion ? 'instruccion_manual' : 'analisis_ia';
  console.log(`[${tipoTrabajo}] Iniciando para capítulo ${capituloId}`);

  try {
    const { data: capitulo, error: errorCap } = await supabase
      .from('capitulos')
      .select('id, texto_actual, estado')
      .eq('id', capituloId)
      .single();

    if (errorCap || !capitulo) {
      throw new Error(`Capítulo ${capituloId} no encontrado`);
    }

    if (!capitulo.texto_actual || !capitulo.texto_actual.trim()) {
      throw new Error('El capítulo no tiene texto para analizar');
    }

    // 1. Llamar a Claude
    const sugerenciasCrudas = await analizarTexto(capitulo.texto_actual, instruccion);

    // 2. Procesar y localizar fragmentos
    const sugerenciasListas = procesarSugerencias(capitulo.texto_actual, sugerenciasCrudas);

    // 3. Guardar en BD
    if (sugerenciasListas.length > 0) {
      const registros = sugerenciasListas.map((s) => ({
        ...s,
        capitulo_id: capituloId,
        origen: instruccion ? 'instruccion_manual' : 'automatico',
      }));

      const { error: errorInsert } = await supabase.from('sugerencias').insert(registros);
      if (errorInsert) throw errorInsert;
    }

    console.log(`[${tipoTrabajo}] ${sugerenciasListas.length} sugerencias guardadas para capítulo ${capituloId}`);

    // 4. Si es el análisis automático inicial (no instrucción manual), marcar como "listo"
    if (!instruccion) {
      await supabase
        .from('capitulos')
        .update({ estado: 'listo' })
        .eq('id', capituloId);
    }

    // 5. Marcar trabajo(s) en cola como completados
    let query = supabase
      .from('trabajos_cola')
      .update({ estado: 'completado' })
      .eq('capitulo_id', capituloId)
      .eq('estado', 'pendiente');

    query = query.eq('tipo', tipoTrabajo);
    await query;

    console.log(`[${tipoTrabajo}] Completado para capítulo ${capituloId}`);
  } catch (err) {
    console.error(`[${tipoTrabajo}] Error en capítulo ${capituloId}:`, err);

    // Solo marcamos el capítulo en estado "error" si es el análisis inicial;
    // si es una instrucción manual, el capítulo ya estaba "listo" y debe seguir así.
    if (!instruccion) {
      await supabase
        .from('capitulos')
        .update({ estado: 'error', error_detalle: `Análisis IA: ${err.message}` })
        .eq('id', capituloId);
    }

    await supabase
      .from('trabajos_cola')
      .update({ estado: 'fallido', error_detalle: err.message })
      .eq('capitulo_id', capituloId)
      .eq('tipo', tipoTrabajo)
      .eq('estado', 'pendiente');

    throw err;
  }
}
