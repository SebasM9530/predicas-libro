import { supabase } from './supabase.service.js';

const BUCKET = 'audios';

const CONTENT_TYPES = {
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
};

/**
 * Sube un archivo de audio al bucket de Supabase Storage.
 * @param {string} capituloId
 * @param {Buffer} buffer - contenido del archivo
 * @param {string} nombreOriginal - nombre original del archivo (para extensión)
 * @returns {Promise<string>} path del archivo dentro del bucket
 */
export async function subirAudio(capituloId, buffer, nombreOriginal) {
  const extension = nombreOriginal.split('.').pop().toLowerCase();
  const path = `${capituloId}/original.${extension}`;
  const contentType = CONTENT_TYPES[extension] || 'application/octet-stream';

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, {
      contentType,
      upsert: true,
    });

  if (error) {
    throw new Error(`Error subiendo audio a Storage: ${error.message}`);
  }

  return path;
}

/**
 * Obtiene una URL firmada temporal para descargar el audio (usada por el worker).
 * @param {string} path
 * @param {number} expiresInSeconds
 * @returns {Promise<string>}
 */
export async function obtenerUrlFirmada(path, expiresInSeconds = 3600) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, expiresInSeconds);

  if (error) {
    throw new Error(`Error generando URL firmada: ${error.message}`);
  }

  return data.signedUrl;
}

/**
 * Elimina el audio del bucket (limpieza tras procesar, para ahorrar espacio).
 * @param {string} path
 */
export async function eliminarAudio(path) {
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) {
    // No lanzamos error duro: si falla la limpieza no debe tumbar el flujo.
    console.error(`No se pudo eliminar el audio ${path}:`, error.message);
  }
}
