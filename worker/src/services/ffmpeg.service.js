import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

const TAMANO_MAX_BYTES = 25 * 1024 * 1024; // 25MB, límite de Groq
const DURACION_CHUNK_SEGUNDOS = 12 * 60; // 12 minutos por chunk
const SOLAPAMIENTO_SEGUNDOS = 15; // 15 segundos de solapamiento entre chunks

/**
 * Ejecuta un comando y espera su finalización.
 */
function ejecutarComando(comando, args) {
  return new Promise((resolve, reject) => {
    const proceso = spawn(comando, args);
    let stderr = '';

    proceso.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proceso.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${comando} terminó con código ${code}: ${stderr}`));
      }
    });

    proceso.on('error', reject);
  });
}

/**
 * Obtiene la duración de un archivo de audio en segundos usando ffprobe.
 */
function obtenerDuracion(filePath) {
  return new Promise((resolve, reject) => {
    const proceso = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrapper=1:nokey=1',
      filePath,
    ]);

    let stdout = '';
    let stderr = '';

    proceso.stdout.on('data', (data) => (stdout += data.toString()));
    proceso.stderr.on('data', (data) => (stderr += data.toString()));

    proceso.on('close', (code) => {
      if (code === 0) {
        resolve(parseFloat(stdout.trim()));
      } else {
        reject(new Error(`ffprobe falló: ${stderr}`));
      }
    });
  });
}

/**
 * Convierte un audio a MP3 16kHz mono (drástica reducción de tamaño).
 * @param {string} inputPath
 * @returns {Promise<string>} ruta del archivo convertido
 */
export async function convertirA16kMono(inputPath) {
  const outputPath = path.join(
    os.tmpdir(),
    `${path.basename(inputPath, path.extname(inputPath))}_16k.mp3`
  );

  await ejecutarComando('ffmpeg', [
    '-y',
    '-i', inputPath,
    '-ar', '16000',
    '-ac', '1',
    '-b:a', '32k',
    outputPath,
  ]);

  return outputPath;
}

/**
 * Divide un audio en chunks de DURACION_CHUNK_SEGUNDOS con solapamiento.
 * @param {string} inputPath - audio ya convertido a 16kHz mono
 * @returns {Promise<Array<{ path: string, index: number, inicioSegundos: number }>>}
 */
export async function dividirEnChunks(inputPath) {
  const duracionTotal = await obtenerDuracion(inputPath);
  const chunks = [];

  let inicio = 0;
  let index = 0;

  while (inicio < duracionTotal) {
    const duracionChunk = Math.min(DURACION_CHUNK_SEGUNDOS, duracionTotal - inicio);
    const outputPath = path.join(
      os.tmpdir(),
      `${path.basename(inputPath, path.extname(inputPath))}_chunk${index}.mp3`
    );

    await ejecutarComando('ffmpeg', [
      '-y',
      '-i', inputPath,
      '-ss', String(inicio),
      '-t', String(duracionChunk),
      '-c', 'copy',
      outputPath,
    ]);

    chunks.push({ path: outputPath, index, inicioSegundos: inicio });

    if (inicio + duracionChunk >= duracionTotal) break;

    // El siguiente chunk arranca antes del fin del actual (solapamiento)
    inicio = inicio + DURACION_CHUNK_SEGUNDOS - SOLAPAMIENTO_SEGUNDOS;
    index += 1;
  }

  return chunks;
}

/**
 * Procesa un archivo de audio: lo convierte a 16kHz mono y, si sigue
 * pesando más de 25MB, lo divide en chunks.
 * @param {string} inputPath - ruta del audio original (mp3)
 * @returns {Promise<{ chunks: Array<{ path: string, index: number, inicioSegundos: number }>, archivoConvertido: string }>}
 */
export async function procesarAudio(inputPath) {
  const convertido = await convertirA16kMono(inputPath);

  const stats = await fs.stat(convertido);

  if (stats.size <= TAMANO_MAX_BYTES) {
    return {
      chunks: [{ path: convertido, index: 0, inicioSegundos: 0 }],
      archivoConvertido: convertido,
    };
  }

  const chunks = await dividirEnChunks(convertido);
  return { chunks, archivoConvertido: convertido };
}

/**
 * Limpia archivos temporales generados durante el procesamiento.
 */
export async function limpiarArchivosTemporales(paths) {
  for (const p of paths) {
    try {
      await fs.unlink(p);
    } catch {
      // ignorar si ya no existe
    }
  }
}
