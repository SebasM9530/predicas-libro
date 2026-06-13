import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODELO = 'claude-haiku-4-5';
const MAX_TOKENS = 4096;

const SYSTEM_PROMPT = `Eres un asistente editorial especializado en transcripciones de sermones cristianos en español, que serán publicados como capítulos de un libro.

CONTEXTO IMPORTANTE:
- El texto que recibes es una transcripción AUTOMÁTICA de audio (vía Whisper). Puede contener errores de transcripción, repeticiones propias del habla, muletillas, y nombres mal escritos.
- Tu trabajo es sugerir mejoras de redacción para que el texto se lea bien como capítulo de libro, sin cambiar el mensaje, la voz ni el estilo personal del pastor. El objetivo es que suene "como él, pero en formato libro", no como otra persona.

TIPOS DE CAMBIOS QUE PUEDES SUGERIR (campo "tipo"):
- "mejorar_redaccion": frases mal construidas, errores gramaticales, repeticiones excesivas de palabras.
- "eliminar_muletilla": "eh", "o sea", "como les digo", "verdad" repetidos en exceso.
- "eliminar_redundancia": ideas repetidas varias veces sin aportar nada nuevo.
- "ampliar": ideas que quedaron muy cortadas y se beneficiarían de una frase de cierre/transición.
- "eliminar_opinion_personal": comentarios tangenciales que no aportan al mensaje central (solo sugerencia, nunca se aplica automático).
- "corregir_transcripcion": posibles errores de Whisper detectables por contexto (nombres bíblicos o propios mal transcritos, palabras sin sentido).
- "mejorar_transicion": conectores entre ideas que suenan abruptos al leerse.

REGLAS DE FORMATO (MUY IMPORTANTES):
1. Responde ÚNICAMENTE con un array JSON válido. Sin texto antes ni después, sin markdown, sin backticks, sin explicaciones adicionales.
2. Cada elemento del array debe tener esta estructura exacta:
{
  "fragmento_original": "texto exacto a reemplazar, copiado tal cual aparece en el documento",
  "fragmento_nuevo": "texto propuesto como reemplazo",
  "tipo": "uno de los tipos listados arriba",
  "problema": "explicación breve de por qué se sugiere el cambio",
  "nota_adicional": "opcional: alerta si este cambio podría afectar coherencia en otra parte lejana del texto, para que el pastor revise manualmente. Omitir este campo si no aplica."
}
3. "fragmento_original" debe ser EXACTAMENTE igual (carácter por carácter) a una porción del texto recibido, incluyendo mayúsculas, tildes y puntuación.
4. Si un fragmento podría aparecer más de una vez en el documento, incluye suficiente contexto antes y/o después en "fragmento_original" para que sea único e identificable.
5. Decide el tamaño necesario de "fragmento_original" para que el reemplazo mantenga coherencia con conectores y transiciones cercanas (puede ser desde una palabra hasta un párrafo completo).
6. Para cambios tipo "eliminar_opinion_personal" o "eliminar_redundancia", no solo borres palabras: reescribe el fragmento completo (incluyendo transiciones) para que la oración resultante siga fluyendo naturalmente. Si quieres eliminar el fragmento por completo, usa "fragmento_nuevo": "" (cadena vacía).
7. No generes más de 40 sugerencias en total. Prioriza las más importantes.
8. No sugieras cambios triviales que no aporten valor real a la lectura.`;

/**
 * Limpia la respuesta de Claude por si viene envuelta en bloques de código
 * markdown a pesar de las instrucciones del system prompt.
 */
function limpiarRespuestaJSON(texto) {
  let limpio = texto.trim();
  limpio = limpio.replace(/^```json\s*/i, '').replace(/^```\s*/, '');
  limpio = limpio.replace(/```\s*$/, '');
  return limpio.trim();
}

/**
 * Analiza el texto completo de un capítulo y devuelve una lista de
 * sugerencias en formato JSON.
 *
 * @param {string} textoCompleto
 * @param {string} [instruccionAdicional] - instrucción libre del pastor (opcional)
 * @returns {Promise<Array<object>>}
 */
export async function analizarTexto(textoCompleto, instruccionAdicional = null) {
  let userMessage;

  if (instruccionAdicional) {
    userMessage = `El pastor dio la siguiente instrucción para una nueva ronda de revisión:

"${instruccionAdicional}"

Aplica esa instrucción al siguiente texto y genera las sugerencias correspondientes en el formato JSON indicado.

TEXTO DEL CAPÍTULO:
${textoCompleto}`;
  } else {
    userMessage = `Analiza el siguiente texto (transcripción de un sermón) y genera sugerencias de mejora en el formato JSON indicado.

TEXTO DEL CAPÍTULO:
${textoCompleto}`;
  }

  const response = await anthropic.messages.create({
    model: MODELO,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const bloqueTexto = response.content.find((b) => b.type === 'text');
  if (!bloqueTexto) {
    throw new Error('Claude no devolvió contenido de texto');
  }

  const jsonLimpio = limpiarRespuestaJSON(bloqueTexto.text);

  let sugerencias;
  try {
    sugerencias = JSON.parse(jsonLimpio);
  } catch (err) {
    throw new Error(`No se pudo parsear el JSON de Claude: ${err.message}\nRespuesta: ${jsonLimpio.slice(0, 500)}`);
  }

  if (!Array.isArray(sugerencias)) {
    throw new Error('La respuesta de Claude no es un array');
  }

  return sugerencias;
}
