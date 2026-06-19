import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import fetch from 'node-fetch';

import { supabase } from '../services/supabase.service.js';
import { procesarAudio, limpiarArchivosTemporales } from '../services/ffmpeg.service.js';
import { transcribirAudio } from '../services/groq.service.js';
import { unirTranscripciones } from '../services/coherencia.service.js';
import { encolarAnalisisIA } from './analisisIA.job.js';

const BUCKET = 'audios';

/**
 * Descarga el audio del capítulo desde Supabase Storage a un archivo temporal local.
 */
async function descargarAudio(audioPath) {
  const { data, error } = await supabase.storage.from(BUCKET).download(audioPath);

  if (error) {
    throw new Error(`Error descargando audio: ${error.message}`);
  }

  const buffer = Buffer.from(await data.arrayBuffer());
  const extension = path.extname(audioPath) || '.mp3';
  const localPath = path.join(os.tmpdir(), `audio_${Date.now()}${extension}`);

  await fs.writeFile(localPath, buffer);
  return localPath;
}

/**
 * Procesa el job de transcripción de un capítulo:
 * 1. Descarga el audio.
 * 2. Convierte a 16kHz mono y divide en chunks si es necesario.
 * 3. Transcribe cada chunk con Groq.
 * 4. Une los textos eliminando solapamiento.
 * 5. Guarda texto_original y texto_actual, marca estado "analizando".
 * 6. Encola el job de análisis IA.
 *
 * @param {{ capituloId: string }} data
 */
export async function procesarTranscripcion({ capituloId }) {
  console.log(`[transcripcion] Iniciando para capítulo ${capituloId}`);

  const archivosTemporales = [];

  try {
    // 1. Obtener datos del capítulo
    const { data: capitulo, error: errorCap } = await supabase
      .from('capitulos')
      .select('id, audio_url')
      .eq('id', capituloId)
      .single();

    if (errorCap || !capitulo) {
      throw new Error(`Capítulo ${capituloId} no encontrado`);
    }

    if (!capitulo.audio_url) {
      throw new Error(`Capítulo ${capituloId} no tiene audio_url`);
    }

    // 2. Descargar audio
    const audioLocal = await descargarAudio(capitulo.audio_url);
    archivosTemporales.push(audioLocal);

    // 3. Convertir y dividir en chunks
    const { chunks, archivoConvertido } = await procesarAudio(audioLocal);
    archivosTemporales.push(archivoConvertido);
    chunks.forEach((c) => archivosTemporales.push(c.path));

    console.log(`[transcripcion] ${chunks.length} chunk(s) a transcribir`);

    // 4. Transcribir cada chunk (secuencial para no saturar rate limits de Groq)
    const textosChunks = [];
    for (const chunk of chunks) {
      console.log(`[transcripcion] Transcribiendo chunk ${chunk.index}...`);
      const texto = await transcribirAudio(chunk.path);
      textosChunks.push({ index: chunk.index, texto });
    }

    // 5. Unir transcripciones eliminando solapamiento
    const textoCompleto = unirTranscripciones(textosChunks);

    if (!textoCompleto || !textoCompleto.trim()) {
      throw new Error('La transcripción resultó vacía');
    }

    // 6. Guardar resultado y avanzar estado
    const { error: errorUpdate } = await supabase
      .from('capitulos')
      .update({
        texto_original: textoCompleto,
        texto_actual: textoCompleto,
        estado: 'analizando',
      })
      .eq('id', capituloId);

    if (errorUpdate) throw errorUpdate;

    // 7. Marcar trabajo de transcripción como completado
    await supabase
      .from('trabajos_cola')
      .update({ estado: 'completado' })
      .eq('capitulo_id', capituloId)
      .eq('tipo', 'transcripcion');

    // 8. Crear y encolar trabajo de análisis IA automático
    await supabase.from('trabajos_cola').insert({
      capitulo_id: capituloId,
      tipo: 'analisis_ia',
      estado: 'pendiente',
    });

    await encolarAnalisisIA(capituloId);

    console.log(`[transcripcion] Completado para capítulo ${capituloId}`);
  } catch (err) {
    console.error(`[transcripcion] Error en capítulo ${capituloId}:`, err);

    await supabase
      .from('capitulos')
      .update({ estado: 'error', error_detalle: `Transcripción: ${err.message}` })
      .eq('id', capituloId);

    await supabase
      .from('trabajos_cola')
      .update({ estado: 'fallido', error_detalle: err.message })
      .eq('capitulo_id', capituloId)
      .eq('tipo', 'transcripcion');

    throw err; // permite que BullMQ reintente según la config del job
  } finally {
    await limpiarArchivosTemporales(archivosTemporales);
  }
}
