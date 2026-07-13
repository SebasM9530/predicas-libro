/**
 * claude.service.js
 *
 * Modelo: gpt-5-mini (OpenAI)
 * Estrategia: análisis global liviano → chunks secuenciales para sugerencias
 *
 * IMPORTANTE: Usa node-fetch directamente en vez del SDK de OpenAI.
 * El SDK usa undici internamente y su AbortController NO termina la conexión TCP
 * en entornos Linux como Render free tier, causando cuelgues silenciosos.
 * node-fetch + header "Connection: close" fuerza socket nuevo por llamada,
 * lo que garantiza que el timeout funcione correctamente.
 */

import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { supabase } from './supabase.service.js';

dotenv.config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';

const MODELO = 'gpt-5-mini';
const CHUNK_CHARS = 5000;

// ─────────────────────────────────────────────────────────────
// Control de TPM (tokens por minuto) — ventana deslizante
// ─────────────────────────────────────────────────────────────

const TPM_LIMITE = 450000;
const VENTANA_MS = 60000;
const historialTokens = [];

function registrarTokens(tokens) {
  historialTokens.push({ timestamp: Date.now(), tokens });
  const ahora = Date.now();
  while (historialTokens.length > 0 && ahora - historialTokens[0].timestamp > VENTANA_MS) {
    historialTokens.shift();
  }
}

function tokensUsadosEnVentana() {
  const ahora = Date.now();
  return historialTokens
    .filter((e) => ahora - e.timestamp < VENTANA_MS)
    .reduce((sum, e) => sum + e.tokens, 0);
}

async function esperarSiNecesario(tokensEstimados, contexto, capituloId = null) {
  const usados = tokensUsadosEnVentana();
  const disponibles = TPM_LIMITE - usados;
  if (tokensEstimados <= disponibles) return;

  const ahora = Date.now();
  let tokensALiberar = 0;
  let tiempoEspera = VENTANA_MS;

  for (const entrada of historialTokens) {
    tokensALiberar += entrada.tokens;
    if (usados - tokensALiberar + tokensEstimados <= TPM_LIMITE) {
      tiempoEspera = Math.max(0, (entrada.timestamp + VENTANA_MS) - ahora) + 2000;
      break;
    }
  }

  const segundos = Math.ceil(tiempoEspera / 1000);
  console.warn(`[ia] ${contexto}: cerca del límite TPM (${usados}/${TPM_LIMITE}). Esperando ${segundos}s...`);
  await actualizarEstadoDetalle(
    capituloId,
    `Límite de velocidad próximo. Esperando ${segundos}s para continuar...`
  );
  await dormir(tiempoEspera);
}

// ─────────────────────────────────────────────────────────────
// Utilidades
// ─────────────────────────────────────────────────────────────

function dormir(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function actualizarEstadoDetalle(capituloId, mensaje) {
  if (!capituloId) return;
  try {
    await supabase.from('capitulos').update({ estado_detalle: mensaje }).eq('id', capituloId);
  } catch (err) {
    console.warn('[ia] No se pudo actualizar estado_detalle:', err.message);
  }
}

function limpiarRespuestaJSON(texto) {
  let limpio = texto.trim();
  limpio = limpio.replace(/^```json\s*/i, '').replace(/^```\s*/, '');
  limpio = limpio.replace(/```\s*$/, '');
  return limpio.trim();
}

function construirCierre(texto) {
  const pila = [];
  let dentroString = false;
  let escape = false;

  for (const ch of texto) {
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { dentroString = !dentroString; continue; }
    if (dentroString) continue;
    if (ch === '{') pila.push('}');
    else if (ch === '[') pila.push(']');
    else if (ch === '}' || ch === ']') {
      if (pila.length === 0) return null;
      pila.pop();
    }
  }

  const prefijo = dentroString ? '"' : '';
  return prefijo + pila.reverse().join('');
}

function repararJSONTruncado(jsonTexto) {
  if (!jsonTexto) return null;

  for (let i = jsonTexto.length - 1; i >= 0; i--) {
    const candidato = jsonTexto.slice(0, i + 1);
    const ultimoChar = candidato[candidato.length - 1];
    if (!['}', ']', ',', '"'].includes(ultimoChar)) continue;

    const cierre = construirCierre(candidato);
    if (cierre === null) continue;

    let base = candidato;
    if (ultimoChar === ',') base = base.slice(0, -1);

    try {
      const resultado = JSON.parse(base + cierre);
      if (resultado && typeof resultado === 'object') return resultado;
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Parsea el JSON de respuesta de OpenAI.
 * Retorna { data, truncado } para que el caller sepa si el JSON vino cortado
 * y pueda decidir si reintentar en vez de aceptar un resultado parcial.
 */
function parsearJSON(texto, contexto) {
  const jsonLimpio = limpiarRespuestaJSON(texto);

  if (!jsonLimpio) {
    console.warn(`[ia] Respuesta vacía en "${contexto}"`);
    if (contexto === 'global') return { data: fallbackGlobal(), truncado: false };
    return { data: {}, truncado: false };
  }

  try {
    return { data: JSON.parse(jsonLimpio), truncado: false };
  } catch (err) {
    console.warn(`[ia] JSON truncado en "${contexto}", intentando reparar...`);
    const reparado = repararJSONTruncado(jsonLimpio);
    if (reparado && Object.keys(reparado).length > 0) {
      console.warn(`[ia] JSON reparado para "${contexto}" — resultado parcial, se reintentará`);
      return { data: reparado, truncado: true }; // ← marcamos como truncado
    }
    if (contexto === 'global') return { data: fallbackGlobal(), truncado: false };
    throw new Error(
      `No se pudo parsear JSON (${contexto}): ${err.message}\n` +
      `Respuesta (primeros 400 chars): ${jsonLimpio.slice(0, 400)}`
    );
  }
}

function fallbackGlobal() {
  return {
    tema_central: 'No disponible',
    tono: 'No disponible',
    resumen: 'No disponible',
    terminos_clave: [],
    secciones: [],
    parrafos: [],
    instrucciones_editoriales: 'Mantener la voz del pastor',
  };
}

function dividirEnChunks(texto) {
  const chunks = [];
  let inicio = 0;

  while (inicio < texto.length) {
    let fin = Math.min(inicio + CHUNK_CHARS, texto.length);

    if (fin < texto.length) {
      const corteParrafo = texto.lastIndexOf('\n\n', fin);
      if (corteParrafo > inicio + CHUNK_CHARS * 0.5) {
        fin = corteParrafo;
      } else {
        const cortePunto = texto.lastIndexOf('. ', fin);
        if (cortePunto > inicio + CHUNK_CHARS * 0.5) {
          fin = cortePunto + 1;
        }
      }
    }

    const contenido = texto.slice(inicio, fin).trim();
    if (contenido) {
      chunks.push({ index: chunks.length, startChar: inicio, endChar: fin, contenido });
    }
    inicio = fin;
  }

  return chunks;
}

function buscarFragmentoTolerante(textoCompleto, fragmento) {
  if (!fragmento || typeof fragmento !== 'string') return -1;

  let idx = textoCompleto.indexOf(fragmento);
  if (idx !== -1) return idx;

  const fragNorm = fragmento.replace(/\s+/g, ' ').trim();
  const textoNorm = textoCompleto.replace(/\s+/g, ' ');
  idx = textoNorm.indexOf(fragNorm);
  if (idx !== -1) return mapearPosicionNormalizada(textoCompleto, idx);

  const prefijo = fragNorm.slice(0, 50);
  if (prefijo.length >= 20) {
    idx = textoNorm.indexOf(prefijo);
    if (idx !== -1) return mapearPosicionNormalizada(textoCompleto, idx);
  }

  const fragSinPuntuacion = fragNorm.replace(/^[^a-záéíóúüñA-ZÁÉÍÓÚÜÑ]+/, '');
  if (fragSinPuntuacion !== fragNorm && fragSinPuntuacion.length >= 15) {
    idx = textoNorm.indexOf(fragSinPuntuacion.slice(0, 50));
    if (idx !== -1) return mapearPosicionNormalizada(textoCompleto, idx);
  }

  return -1;
}

function mapearPosicionNormalizada(textoReal, posNorm) {
  let posReal = 0;
  let posColapsada = 0;

  while (posColapsada < posNorm && posReal < textoReal.length) {
    if (/\s/.test(textoReal[posReal])) {
      while (posReal < textoReal.length && /\s/.test(textoReal[posReal])) posReal++;
      posColapsada++;
    } else {
      posReal++;
      posColapsada++;
    }
  }

  return posReal;
}

function validarFragmento(textoCompleto, fragmento) {
  return buscarFragmentoTolerante(textoCompleto, fragmento);
}

function deduplicarSugerencias(sugerencias) {
  const vistas = new Set();
  return sugerencias.filter((s) => {
    if (vistas.has(s.fragmento_original)) return false;
    vistas.add(s.fragmento_original);
    return true;
  });
}

// ─────────────────────────────────────────────────────────────
// Llamada a OpenAI con node-fetch directo
// ─────────────────────────────────────────────────────────────

/**
 * FIX 1 — AbortController limpio por llamada:
 * El AbortSignal.timeout() anterior no se cancelaba al terminar exitosamente,
 * quedaba corriendo 300s en background y llenaba los logs con timeouts fantasma
 * de llamadas que ya habían completado. Ahora usamos solo un setTimeout + clearTimeout.
 *
 * FIX 2 — Detección de JSON truncado:
 * parsearJSON ahora retorna { data, truncado }. Cuando el JSON viene cortado
 * (output_tokens == max_completion_tokens), llamarOpenAI lanza un error especial
 * para que el caller pueda reintentar el chunk completo en vez de aceptar
 * un resultado parcial con pocas sugerencias.
 */
async function llamarOpenAI(params, contexto, capituloId = null) {
  const tokensEstimados = Math.ceil(
    (JSON.stringify(params.messages).length / 4) + (params.max_completion_tokens || 8000)
  );

  await esperarSiNecesario(tokensEstimados, contexto, capituloId);

  let intentoTotal = 0;
  const TIMEOUT_MS = 300000; // 5 min — sin proxy de Render en Background Worker
  const MAX_REINTENTOS = 5;

  while (true) {
    intentoTotal++;

    // Un solo controller por intento — se cancela con clearTimeout si la llamada termina
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.warn(`[ia] ${contexto}: Timeout ${TIMEOUT_MS / 1000}s alcanzado, abortando socket...`);
      controller.abort();
    }, TIMEOUT_MS);

    try {
      console.log(`[ia] ${contexto}: enviando request a OpenAI (intento ${intentoTotal})...`);

      const res = await fetch(OPENAI_CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Connection': 'close',
        },
        body: JSON.stringify(params),
        signal: controller.signal,
      });

      clearTimeout(timeoutId); // ← cancelar siempre al terminar, éxito o error HTTP

      if (!res.ok) {
        const errorBody = await res.text().catch(() => '(sin body)');

        if (res.status === 429) {
          const retryAfter = res.headers.get('retry-after');
          const esperaMs = retryAfter ? parseFloat(retryAfter) * 1000 : 60000;
          const segundos = Math.ceil(esperaMs / 1000);
          console.warn(`[ia] ${contexto}: Rate limit 429 (intento ${intentoTotal}). Esperando ${segundos}s...`);
          await actualizarEstadoDetalle(
            capituloId,
            `OpenAI alcanzó su límite. Esperando ${segundos}s y reintentando...`
          );
          await dormir(esperaMs);
          continue;
        }

        throw new Error(`OpenAI HTTP ${res.status}: ${errorBody.slice(0, 300)}`);
      }

      const data = await res.json();
      const tokensReales = (data.usage?.prompt_tokens || 0) + (data.usage?.completion_tokens || 0);
      registrarTokens(tokensReales);

      const outputTokens = data.usage?.completion_tokens || 0;
      const maxTokens = params.max_completion_tokens || 8000;

      // Detectar respuesta cortada: si OpenAI usó exactamente el máximo de tokens,
      // es casi seguro que el JSON quedó truncado
      const probablementeTruncado = outputTokens >= maxTokens - 10;

      return {
        choices: data.choices,
        usage: data.usage,
        probablementeTruncado,
      };

    } catch (err) {
      clearTimeout(timeoutId);

      const esAbortado = err?.name === 'AbortError'
        || err?.message?.includes('aborted')
        || err?.message?.includes('abort');

      const esRedError = esAbortado
        || err?.message?.includes('timeout')
        || err?.code === 'ETIMEDOUT'
        || err?.code === 'ECONNRESET'
        || err?.code === 'ECONNREFUSED'
        || err?.code === 'ENOTFOUND';

      if (esRedError && intentoTotal <= MAX_REINTENTOS) {
        const esperaMs = 20000;
        console.warn(`[ia] ${contexto}: Timeout/red (intento ${intentoTotal}/${MAX_REINTENTOS}). Esperando ${esperaMs / 1000}s...`);
        await actualizarEstadoDetalle(
          capituloId,
          `OpenAI no respondió. Reintentando (${intentoTotal}/${MAX_REINTENTOS})...`
        );
        await dormir(esperaMs);
        continue;
      }

      console.error(`[ia] ${contexto}: error definitivo (intento ${intentoTotal}): ${err.message}`);
      throw err;
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Procesador de chunks con reintento en JSON truncado
// ─────────────────────────────────────────────────────────────

/**
 * Procesa un chunk y reintenta si el JSON vino truncado.
 * Si en el reintento también viene truncado, acepta el resultado parcial
 * para no bloquear el proceso completo.
 */
async function procesarChunkConReintento(fnChunk, contexto, capituloId, maxReintentosTruncado = 2) {
  for (let intento = 1; intento <= maxReintentosTruncado; intento++) {
    const { sugerencias, truncado } = await fnChunk();

    if (!truncado) return sugerencias;

    if (intento < maxReintentosTruncado) {
      console.warn(`[ia] ${contexto}: JSON truncado (intento ${intento}/${maxReintentosTruncado}), reintentando chunk completo...`);
      await actualizarEstadoDetalle(
        capituloId,
        `Respuesta incompleta de OpenAI, reintentando análisis...`
      );
      await dormir(5000);
    } else {
      console.warn(`[ia] ${contexto}: JSON truncado tras ${maxReintentosTruncado} intentos, aceptando resultado parcial`);
    }
  }

  // Último intento — acepta lo que haya
  const { sugerencias } = await fnChunk();
  return sugerencias;
}

// ─────────────────────────────────────────────────────────────
// LLAMADA 1 — Análisis global liviano
// ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT_GLOBAL = `Eres un asistente editorial especializado en sermones cristianos en español.

Recibes la transcripción completa de un sermón. Tu tarea es hacer un análisis GLOBAL Y LIVIANO — no generes sugerencias de redacción aquí.

Devuelve un JSON con esta estructura exacta:
{
  "tema_central": "frase corta",
  "tono": "descripción breve del estilo del pastor (ej: didáctico, narrativo, exhortativo)",
  "resumen": "2-3 oraciones resumiendo el mensaje principal",
  "terminos_clave": ["término1", "término2"],
  "secciones": [
    { "titulo": "título corto", "fragmento_inicio": "primeras 6-8 palabras EXACTAS del texto donde inicia esta sección" }
  ],
  "parrafos": [
    { "fragmento_inicio": "primeras 6-8 palabras EXACTAS del texto donde debe iniciar este párrafo" }
  ],
  "instrucciones_editoriales": "nota breve sobre cómo mantener la voz del pastor al editar"
}

REGLAS CRÍTICAS:
* Para "secciones": identifica SOLO las partes que el pastor anuncia explícitamente. Si no hay, devuelve [].
* Para "parrafos": identifica los cortes naturales de párrafo en TODO el sermón. No pongas más de 80 entradas en total entre parrafos y secciones. Prioriza los cortes más claros e importantes.
* Las palabras en fragmento_inicio deben ser EXACTAS (carácter por carácter) tal como aparecen en el texto.
* Responde ÚNICAMENTE con el JSON, sin texto extra, sin markdown.`;

async function analizarGlobal(textoCompleto, capituloId = null) {
  console.log(`[ia] Análisis global (${textoCompleto.length} chars)`);
  await actualizarEstadoDetalle(
    capituloId,
    'Analizando el sermón completo: detectando tema, tono y estructura general...'
  );

  const response = await llamarOpenAI({
    model: MODELO,
    max_completion_tokens: 16000,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT_GLOBAL },
      { role: 'user', content: `Analiza este sermón completo:\n\n${textoCompleto}` },
    ],
  }, 'global', capituloId);

  const texto = response.choices?.[0]?.message?.content || '';
  console.log(`[ia] Global — tokens: input=${response.usage?.prompt_tokens} output=${response.usage?.completion_tokens}`);

  const { data } = parsearJSON(texto, 'global');
  return data;
}

// ─────────────────────────────────────────────────────────────
// LLAMADA 2 — Sugerencias por chunk (secuencial)
// ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT_CHUNK = `Eres un asistente editorial especializado en transformar transcripciones orales de sermones cristianos en español en capítulos de libro bien escritos.

Recibes un FRAGMENTO del sermón. Debes generar sugerencias de mejora para TODO el fragmento de principio a fin.

═══════════════════════════════════════════
REGLA #0 — FIDELIDAD AL MENSAJE (por encima de cualquier categoría)
═══════════════════════════════════════════
Tu trabajo es de FORMA, no de FONDO. El pastor tiene ideas sólidas y bien pensadas, pero las expresa de forma oral, desordenada o repetitiva porque está hablando, no escribiendo. Tu única función es traducir esas ideas al lenguaje de un libro — nunca reinterpretarlas, suavizarlas, resumirlas de más o completarlas con contenido nuevo.

Prohibido en cualquier "fragmento_nuevo":
- Agregar matices, doctrina o interpretaciones que el pastor no dijo.
- Quitar o suavizar una afirmación aunque suene fuerte o polémica — esa es su convicción, no un error de redacción.
- Cambiar el orden lógico del argumento o la conclusión a la que llega.
- Fusionar dos ideas del pastor en una sola si eso pierde alguna de las dos.
- Cambiar o "mejorar" citas bíblicas, referencias o nombres que el pastor dio correctamente (eso solo aplica a errores reales de transcripción, categoría 3).

Antes de escribir un "fragmento_nuevo", pregúntate: "¿Alguien que escuchó la prédica en vivo reconocería esta idea exactamente igual, solo mejor puesta por escrito?". Si la respuesta es no, NO generes esa sugerencia.

El contexto del sermón (tema, tono, resumen) que recibes en el mensaje de usuario es la referencia de lo que el pastor quiso comunicar. Cualquier sugerencia debe ser coherente con ese contexto completo, no solo con la oración suelta que estás editando en ese momento.

═══════════════════════════════════════════
CATEGORÍAS OBLIGATORIAS
═══════════════════════════════════════════
Tienes 7 categorías. DEBES usar la más específica que aplique. Solo usa "mejorar_redaccion" cuando ninguna otra categoría más específica aplica mejor. Revisa SIEMPRE en este orden:

1. ¿Es una muletilla oral, llamado a la audiencia, o saludo del culto? → "eliminar_muletilla"
   Ejemplos: "eh", "o sea", "verdad", "¿no?", "dígale al de al lado", "levante la mano", "repita conmigo", "buenos días hermanos", "bienvenidos a la iglesia", "oremos para iniciar", anuncios del culto.

2. ¿Es una idea repetida que ya se dijo con otras palabras? → "eliminar_redundancia"
   Úsala SOLO si la repetición es literalmente la misma idea sin ningún matiz nuevo (ej: el pastor se traba y reinicia la misma frase). Si cada repetición agrega un ángulo, ejemplo o énfasis distinto, NO es redundancia — usa "mejorar_redaccion" para fusionarlas en una sola frase bien escrita que conserve ambos matices, nunca elimines contenido con un matiz propio.

3. ¿Es un error claro de transcripción de Whisper, nombre bíblico deformado, o frase sin sentido? → "corregir_transcripcion"
   Ejemplos: palabras inventadas, nombres propios mal escritos, frases que no tienen sentido en contexto.

4. ¿Es un conector abrupto entre dos párrafos o ideas? → "mejorar_transicion"
   Ejemplos: cambios de tema sin conectar, párrafos que no fluyen entre sí.

5. ¿Es un comentario personal, anécdota tangencial, o aparte que interrumpe el tema? → "eliminar_opinion_personal"
   Ejemplos: opiniones del pastor no relacionadas con la enseñanza, digresiones personales.

6. ¿Es una idea incompleta que quedó cortada y necesita una frase de cierre? → "ampliar"
   Úsala con mucha cautela — es la categoría de más riesgo porque implica agregar palabras que el pastor no dijo. Solo complétala si el cierre es 100% deducible del contexto inmediato (ej: una enumeración que se corta, una frase que claramente iba a terminar en la conclusión que el pastor ya dio un par de líneas antes). Si no estás seguro de cuál era la idea completa, NO generes la sugerencia — es mejor dejar el fragmento sin tocar que inventar contenido que el pastor no dijo.

7. Solo si ninguna de las anteriores aplica: ¿Es una frase oral que funciona hablando pero no como texto escrito? → "mejorar_redaccion"
   Ejemplos: oraciones largas, frases coloquiales, voz inconsistente, preguntas retóricas poco claras, ambigüedad al leer.

═══════════════════════════════════════════
REGLAS DE FORMATO
═══════════════════════════════════════════
1. "fragmento_original": copia el texto EXACTAMENTE como aparece en el fragmento (carácter por carácter). Máximo 35 palabras. NUNCA parafrasees ni modifiques ni una coma.
2. "fragmento_nuevo": texto propuesto como reemplazo. Máximo 80 palabras. Si necesitas más, escribe las primeras 80 palabras + "...".
3. "problema": máximo 12 palabras explicando el problema específico detectado.
4. Cubre TODO el fragmento de principio a fin sin omitir secciones.
5. Genera TODAS las sugerencias que encuentres — no hay límite artificial. El objetivo es cubrir el fragmento completo.
6. Responde ÚNICAMENTE con: { "sugerencias": [...] } — sin texto extra, sin markdown, sin backticks.
7. Si genuinamente no hay nada que mejorar: { "sugerencias": [] }`;

async function procesarChunk(chunk, contextoGlobal, totalChunks, capituloId = null) {
  console.log(`[ia] Chunk ${chunk.index + 1}/${totalChunks} (${chunk.contenido.length} chars)`);
  await actualizarEstadoDetalle(
    capituloId,
    `Generando recomendaciones: parte ${chunk.index + 1} de ${totalChunks}...`
  );

  const contextoResumido = `CONTEXTO DEL SERMÓN:
* Tema: ${contextoGlobal.tema_central}
* Tono: ${contextoGlobal.tono}
* Resumen: ${contextoGlobal.resumen}
* Instrucciones: ${contextoGlobal.instrucciones_editoriales}`.trim();

  const userContent = `${contextoResumido}\n\nFRAGMENTO ${chunk.index + 1} DE ${totalChunks}:\n${chunk.contenido}`;

  const response = await llamarOpenAI({
    model: MODELO,
    max_completion_tokens: 16000,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT_CHUNK },
      { role: 'user', content: userContent },
    ],
  }, `chunk-${chunk.index + 1}`, capituloId);

  const texto = response.choices?.[0]?.message?.content || '';
  const tokens = response.usage;
  console.log(`[ia] Chunk ${chunk.index + 1} — tokens: input=${tokens?.prompt_tokens} output=${tokens?.completion_tokens}`);

  const { data, truncado } = parsearJSON(texto, `chunk-${chunk.index + 1}`);
  const sugerencias = Array.isArray(data.sugerencias) ? data.sugerencias : [];
  return { sugerencias, truncado: truncado || response.probablementeTruncado };
}

// ─────────────────────────────────────────────────────────────
// LLAMADA INSTRUCCIÓN ADICIONAL — Ronda extra del pastor
// ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT_INSTRUCCION = `Eres un asistente editorial especializado en sermones cristianos en español.

Recibes un FRAGMENTO del sermón y una instrucción específica del pastor.

Aplica esa instrucción al fragmento y genera sugerencias SOLO relacionadas con lo que el pastor pidió.

Aunque la instrucción te pida cambios de forma (resumir, cortar, reordenar), nunca cambies el mensaje, la teología, los ejemplos ni las citas bíblicas del pastor — solo la manera en que están escritos. Si cumplir la instrucción al pie de la letra implicaría alterar una idea que el pastor quiso comunicar, prioriza conservar la idea sobre seguir la instrucción de forma literal.

REGLAS:
1. "fragmento_original": texto EXACTO del fragmento (carácter por carácter). Máximo 35 palabras.
2. "fragmento_nuevo": texto propuesto. Máximo 80 palabras.
3. "problema": máximo 12 palabras.
4. No inventes fragmentos ni parafrasees fragmento_original.
5. Genera todas las sugerencias que apliquen — sin límite artificial.
6. Responde ÚNICAMENTE con: { "sugerencias": [...] } — sin texto extra, sin markdown.
7. Si no hay sugerencias aplicables: { "sugerencias": [] }`;

async function procesarChunkConInstruccion(chunk, instruccion, totalChunks, capituloId = null) {
  console.log(`[ia] Instrucción chunk ${chunk.index + 1}/${totalChunks}`);
  await actualizarEstadoDetalle(
    capituloId,
    `Aplicando tu instrucción: parte ${chunk.index + 1} de ${totalChunks}...`
  );

  const response = await llamarOpenAI({
    model: MODELO,
    max_completion_tokens: 16000,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT_INSTRUCCION },
      {
        role: 'user',
        content: `INSTRUCCIÓN DEL PASTOR: "${instruccion}"\n\nFRAGMENTO ${chunk.index + 1} DE ${totalChunks}:\n${chunk.contenido}`,
      },
    ],
  }, `instruccion-chunk-${chunk.index + 1}`, capituloId);

  const texto = response.choices?.[0]?.message?.content || '';
  const { data, truncado } = parsearJSON(texto, `instruccion-chunk-${chunk.index + 1}`);
  const sugerencias = Array.isArray(data.sugerencias) ? data.sugerencias : [];
  return { sugerencias, truncado: truncado || response.probablementeTruncado };
}

async function procesarChunkSinContexto(chunk, totalChunks, capituloId = null) {
  await actualizarEstadoDetalle(
    capituloId,
    `Generando recomendaciones: parte ${chunk.index + 1} de ${totalChunks}...`
  );

  const response = await llamarOpenAI({
    model: MODELO,
    max_completion_tokens: 16000,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT_CHUNK },
      {
        role: 'user',
        content: `FRAGMENTO ${chunk.index + 1} DE ${totalChunks}:\n${chunk.contenido}`,
      },
    ],
  }, `chunk-sin-contexto-${chunk.index + 1}`, capituloId);

  const texto = response.choices?.[0]?.message?.content || '';
  const { data, truncado } = parsearJSON(texto, `chunk-${chunk.index + 1}`);
  const sugerencias = Array.isArray(data.sugerencias) ? data.sugerencias : [];
  return { sugerencias, truncado: truncado || response.probablementeTruncado };
}

// ─────────────────────────────────────────────────────────────
// Funciones públicas exportadas
// ─────────────────────────────────────────────────────────────

export async function analizarEstructura(textoCompleto, capituloId = null) {
  const global = await analizarGlobal(textoCompleto, capituloId);
  return {
    parrafos: Array.isArray(global.parrafos) ? global.parrafos : [],
    secciones: Array.isArray(global.secciones) ? global.secciones : [],
  };
}

export async function analizarSugerencias(textoCompleto, instruccion = null, capituloId = null) {
  const chunks = dividirEnChunks(textoCompleto);
  console.log(`[ia] ${chunks.length} chunks para sugerencias`);
  const todasSugerencias = [];

  for (let i = 0; i < chunks.length; i++) {
    let sugerenciasChunk = [];
    try {
      if (instruccion) {
        sugerenciasChunk = await procesarChunkConReintento(
          () => procesarChunkConInstruccion(chunks[i], instruccion, chunks.length, capituloId),
          `instruccion-chunk-${i + 1}`,
          capituloId
        );
      } else {
        sugerenciasChunk = await procesarChunkConReintento(
          () => procesarChunkSinContexto(chunks[i], chunks.length, capituloId),
          `chunk-${i + 1}`,
          capituloId
        );
      }
    } catch (err) {
      console.error(`[ia] Chunk ${i + 1} falló definitivamente: ${err.message}. Continuando...`);
      await actualizarEstadoDetalle(capituloId, `Parte ${i + 1} de ${chunks.length} no pudo procesarse. Continuando...`);
    }

    const validadas = sugerenciasChunk.filter((s) => {
      const pos = validarFragmento(textoCompleto, s.fragmento_original);
      if (pos === -1) {
        console.warn(`[ia] Descartada: "${s.fragmento_original?.slice(0, 60)}"`);
        return false;
      }
      s._posicion = pos;
      return true;
    });

    todasSugerencias.push(...validadas);
    console.log(`[ia] Chunk ${i + 1}: ${validadas.length} sugerencias válidas`);
    await actualizarEstadoDetalle(capituloId, `Parte ${i + 1} de ${chunks.length} analizada (${validadas.length} recomendaciones)...`);
  }

  const deduplicadas = deduplicarSugerencias(todasSugerencias);
  deduplicadas.sort((a, b) => (a._posicion || 0) - (b._posicion || 0));
  deduplicadas.forEach((s) => delete s._posicion);

  console.log(`[ia] Total sugerencias válidas: ${deduplicadas.length}`);
  return deduplicadas;
}

export async function analizarTexto(textoCompleto, instruccionAdicional = null, esAnalisisInicial = true, capituloId = null) {
  if (esAnalisisInicial) {
    const global = await analizarGlobal(textoCompleto, capituloId);
    const parrafos = Array.isArray(global.parrafos) ? global.parrafos : [];
    const secciones = Array.isArray(global.secciones) ? global.secciones : [];

    await actualizarEstadoDetalle(
      capituloId,
      `Análisis general listo (${secciones.length} sección(es) detectadas). Iniciando revisión de redacción...`
    );

    const chunks = dividirEnChunks(textoCompleto);
    console.log(`[ia] ${chunks.length} chunks para análisis inicial`);
    const todasSugerencias = [];

    for (let i = 0; i < chunks.length; i++) {
      let sugerenciasChunk = [];
      try {
        sugerenciasChunk = await procesarChunkConReintento(
          () => procesarChunk(chunks[i], global, chunks.length, capituloId),
          `chunk-${i + 1}`,
          capituloId
        );
      } catch (err) {
        console.error(`[ia] Chunk ${i + 1}/${chunks.length} falló definitivamente: ${err.message}. Continuando...`);
        await actualizarEstadoDetalle(capituloId, `Parte ${i + 1} de ${chunks.length} no pudo procesarse. Continuando...`);
      }

      const validadas = sugerenciasChunk.filter((s) => {
        const pos = validarFragmento(textoCompleto, s.fragmento_original);
        if (pos === -1) {
          console.warn(`[ia] Descartada: "${s.fragmento_original?.slice(0, 60)}"`);
          return false;
        }
        s._posicion = pos;
        return true;
      });

      todasSugerencias.push(...validadas);
      console.log(`[ia] Chunk ${i + 1}/${chunks.length}: ${validadas.length} sugerencias válidas`);
      await actualizarEstadoDetalle(
        capituloId,
        `Redacción revisada: parte ${i + 1} de ${chunks.length} completada (${todasSugerencias.length} recomendaciones hasta ahora)...`
      );
    }

    const deduplicadas = deduplicarSugerencias(todasSugerencias);
    deduplicadas.sort((a, b) => (a._posicion || 0) - (b._posicion || 0));
    deduplicadas.forEach((s) => delete s._posicion);

    console.log(`[ia] Análisis completo: ${parrafos.length} párrafos, ${secciones.length} secciones, ${deduplicadas.length} sugerencias`);
    await actualizarEstadoDetalle(capituloId, 'Análisis con IA completado. Preparando resultados...');

    return { parrafos, secciones, sugerencias: deduplicadas };
  }

  // Ronda adicional con instrucción del pastor
  const chunks = dividirEnChunks(textoCompleto);
  const todasSugerencias = [];

  for (let i = 0; i < chunks.length; i++) {
    let sug = [];
    try {
      sug = await procesarChunkConReintento(
        () => procesarChunkConInstruccion(chunks[i], instruccionAdicional, chunks.length, capituloId),
        `instruccion-chunk-${i + 1}`,
        capituloId
      );
    } catch (err) {
      console.error(`[ia] Instrucción chunk ${i + 1} falló: ${err.message}. Continuando...`);
    }

    const validadas = sug.filter((s) => {
      const pos = validarFragmento(textoCompleto, s.fragmento_original);
      if (pos === -1) return false;
      s._posicion = pos;
      return true;
    });

    todasSugerencias.push(...validadas);
  }

  const deduplicadas = deduplicarSugerencias(todasSugerencias);
  deduplicadas.sort((a, b) => (a._posicion || 0) - (b._posicion || 0));
  deduplicadas.forEach((s) => delete s._posicion);

  return { parrafos: [], secciones: [], sugerencias: deduplicadas };
}