import multer from 'multer';

// Guardamos el archivo en memoria (buffer) porque lo vamos a re-subir
// directamente a Supabase Storage, sin necesidad de escribirlo a disco.
const storage = multer.memoryStorage();

const LIMITE_TAMANO_MB = 300; // margen amplio para un MP3 de ~1h sin comprimir

export const uploadAudio = multer({
  storage,
  limits: {
    fileSize: LIMITE_TAMANO_MB * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const tiposPermitidos = ['audio/mpeg', 'audio/mp3', 'audio/x-mpeg-3'];
    if (tiposPermitidos.includes(file.mimetype) || file.originalname.toLowerCase().endsWith('.mp3')) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos MP3'));
    }
  },
});
