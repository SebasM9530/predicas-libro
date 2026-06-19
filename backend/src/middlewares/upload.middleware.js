import multer from 'multer';

// Guardamos el archivo en memoria (buffer) porque lo vamos a re-subir
// directamente a Supabase Storage, sin necesidad de escribirlo a disco.
const storage = multer.memoryStorage();

const LIMITE_TAMANO_MB = 300; // margen amplio para 1h de audio sin comprimir

const EXTENSIONES_PERMITIDAS = ['.mp3', '.ogg', '.oga', '.m4a', '.wav'];
const MIMETYPES_PERMITIDOS = [
  'audio/mpeg',
  'audio/mp3',
  'audio/x-mpeg-3',
  'audio/ogg',
  'audio/x-vorbis+ogg',
  'application/ogg',
  'audio/m4a',
  'audio/mp4',
  'audio/x-m4a',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
];

export const uploadAudio = multer({
  storage,
  limits: {
    fileSize: LIMITE_TAMANO_MB * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const nombreLower = file.originalname.toLowerCase();
    const extensionValida = EXTENSIONES_PERMITIDAS.some((ext) => nombreLower.endsWith(ext));
    const mimetypeValido = MIMETYPES_PERMITIDOS.includes(file.mimetype);

    if (extensionValida || mimetypeValido) {
      cb(null, true);
    } else {
      cb(new Error('Formato de audio no soportado. Usa MP3, OGG, M4A o WAV'));
    }
  },
});
