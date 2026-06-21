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
 * Actualiza el mensaje de estado detallado visible en el frontend.
 */
async function actualizarEstadoDetalle(capituloId, mensaje) {
  await supabase.from('capitulos').update({ estado_detalle: mensaje }).eq('id', capituloId);
}

/**
 * Inserta saltos de párrafo ("\n\n") antes de cada fragmento_inicio indicado
 * por la IA, buscando cada fragmento en orden a partir de la posición del
 * anterior (para evitar coincidencias fuera de orden).
 *
 * @param {string} texto
 * @param {Array<{ fragmento_inicio: string }>} parrafos
 * @returns {string}
 */
function aplicarSaltosParrafo(texto, parrafos) {
  const posiciones = [];
  let cursor = 0;

  for (const p of parrafos) {
    if (!p?.fragmento_inicio) continue;

    const idx = texto.indexOf(p.fragmento_inicio, cursor);
    if (idx === -1) continue;
    if (idx === 0) continue; // no insertar salto al inicio absoluto

    posiciones.push(idx);
    cursor = idx + p.fragmento_inicio.length;
  }

  // Insertar de atrás hacia adelante para no desfasar posiciones ya calculadas
  posiciones.sort((a, b) => b - a);

  let resultado = texto;
  for (const idx of posiciones) {
    const antes = resultado.slice(0, idx).replace(/[ \t]+$/, '');
    const despues = resultado.slice(idx);
    resultado = `${antes}\n\n${despues}`;
  }

  return resultado;
}

/**
 * Dado un texto y una lista de sugerencias crudas de Claude/Groq, calcula
 * posiciones y descarta las que no sean localizables.
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
 * Convierte las secciones detectadas por la IA en marcadores guardados
 * en la tabla `sugerencias` con tipo='marcador_seccion' y estado='aplicada'
 * (no son "cambios a aprobar", son etiquetas estructurales para el editor).
 *
 * @param {string} texto
 * @param {Array<{ titulo: string, fragmento_inicio: string }>} secciones
 * @returns {Array<object>}
 */
function procesarSecciones(texto, secciones) {
  const marcadores = [];

  for (const sec of secciones) {
    if (!sec?.fragmento_inicio) continue;

    const { ocurrencias, posicion } = localizarFragmento(texto, sec.fragmento_inicio);
    if (ocurrencias === 0) {
      console.warn('[analisis_ia] Sección descartada: fragmento no encontrado', {
        titulo: sec.titulo,
        fragmento: sec.fragmento_inicio.slice(0, 80),
      });
      continue;
    }

    marcadores.push({
      fragmento_original: sec.fragmento_inicio,
      fragmento_nuevo: sec.titulo || '',
      tipo: 'marcador_seccion',
      problema: 'Inicio de sección del sermón',
      nota_adicional: null,
      posicion_inicio: posicion,
      posicion_fin: posicion + sec.fragmento_inicio.length,
      estado: 'aplicada',
    });
  }

  return marcadores;
}

/**
 * Procesa el job de análisis IA (automático o por instrucción manual):
 * 1. Obtiene el texto_actual del capítulo.
 * 2. Llama a la IA para obtener { parrafos, secciones, sugerencias }.
 * 3. Si es el análisis inicial: aplica saltos de párrafo y guarda marcadores de sección.
 * 4. Localiza cada sugerencia en el texto resultante y la guarda en BD.
 * 5. Si es el análisis automático inicial, marca el capítulo como "listo".
 *
 * @param {{ capituloId: string, instruccion?: string }} data
 */
export async function procesarAnalisisIA({ capituloId, instruccion = null }) {
  const esAnalisisInicial = !instruccion;
  const tipoTrabajo = instruccion ? 'instruccion_manual' : 'analisis_ia';
  console.log(`[${tipoTrabajo}] Iniciando para capítulo ${capituloId}`);

  try {
    const { data: capitulo, error: errorCap } = await supabase
      .from('capitulos')
      .select('id, texto_actual, estado')
      .eq('id', capituloId)
      .single();

    if (errorCap || !capitulo) {
      console.error('[analisis_ia] Detalle del error de Supabase:', errorCap);
      throw new Error(`Capítulo ${capituloId} no encontrado`);
    }

    if (!capitulo.texto_actual || !capitulo.texto_actual.trim()) {
      throw new Error('El capítulo no tiene texto para analizar');
    }

    if (instruccion) {
      await actualizarEstadoDetalle(capituloId, 'Procesando tu instrucción con IA...');
    }

    // 1. Llamar a la IA (le pasamos capituloId para que reporte progreso por chunk)
    const { parrafos, secciones, sugerencias: sugerenciasCrudas } = await analizarTexto(
      capitulo.texto_actual,
      instruccion,
      esAnalisisInicial,
      capituloId
    );

    let textoTrabajo = capitulo.texto_actual;

    // 2. Aplicar saltos de párrafo (solo en el análisis inicial)
    if (esAnalisisInicial && parrafos.length > 0) {
      const nuevoTexto = aplicarSaltosParrafo(textoTrabajo, parrafos);
      if (nuevoTexto !== textoTrabajo) {
        textoTrabajo = nuevoTexto;

        const { error: errorUpdateTexto } = await supabase
          .from('capitulos')
          .update({ texto_actual: textoTrabajo, texto_original: textoTrabajo })
          .eq('id', capituloId);

        if (errorUpdateTexto) throw errorUpdateTexto;

        console.log(`[${tipoTrabajo}] Texto dividido en párrafos (${parrafos.length} cortes detectados)`);
      }
    }

    // 3. Guardar marcadores de sección (solo en el análisis inicial)
    if (esAnalisisInicial && secciones.length > 0) {
      const marcadores = procesarSecciones(textoTrabajo, secciones);
      if (marcadores.length > 0) {
        const registros = marcadores.map((m) => ({
          ...m,
          capitulo_id: capituloId,
          origen: 'automatico',
        }));

        const { error: errorInsertMarcadores } = await supabase.from('sugerencias').insert(registros);
        if (errorInsertMarcadores) throw errorInsertMarcadores;

        console.log(`[${tipoTrabajo}] ${marcadores.length} sección(es) detectadas`);
      }
    }

    // 4. Procesar y localizar sugerencias normales
    await actualizarEstadoDetalle(capituloId, 'Guardando las recomendaciones encontradas...');
    const sugerenciasListas = procesarSugerencias(textoTrabajo, sugerenciasCrudas);

    if (sugerenciasListas.length > 0) {
      const registros = sugerenciasListas.map((s) => ({
        ...s,
        capitulo_id: capituloId,
        origen: instruccion ? 'instruccion_manual' : 'automatico',
      }));

      const { error: errorInsert } = await supabase.from('sugerencias').insert(registros);
      if (errorInsert) throw errorInsert;
    }

    console.log(`[${tipoTrabajo}] ${sugerenciasListas.length} sugerencia(s) guardadas para capítulo ${capituloId}`);

    // 5. Si es el análisis automático inicial, marcar como "listo"
    if (esAnalisisInicial) {
      await supabase
        .from('capitulos')
        .update({ estado: 'listo', estado_detalle: null })
        .eq('id', capituloId);
    } else {
      await actualizarEstadoDetalle(capituloId, null);
    }

    // 6. Marcar trabajo(s) en cola como completados
    await supabase
      .from('trabajos_cola')
      .update({ estado: 'completado' })
      .eq('capitulo_id', capituloId)
      .eq('estado', 'pendiente')
      .eq('tipo', tipoTrabajo);

    console.log(`[${tipoTrabajo}] Completado para capítulo ${capituloId}`);
  } catch (err) {
    console.error(`[${tipoTrabajo}] Error en capítulo ${capituloId}:`, err);

    if (esAnalisisInicial) {
      await supabase
        .from('capitulos')
        .update({ estado: 'error', error_detalle: `Análisis IA: ${err.message}`, estado_detalle: null })
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