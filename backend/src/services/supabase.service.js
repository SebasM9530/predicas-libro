import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Faltan variables de entorno SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY'
  );
}

// El backend usa siempre la service_role key porque corre en un entorno
// confiable (servidor), nunca en el navegador del usuario.
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
  },
});
