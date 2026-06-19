/**
 * ia.service.js (mantenemos el nombre claude.service.js para no cambiar imports)
 *
 * Modelo: gpt-5-mini (OpenAI)
 * Estrategia: análisis global liviano → chunks secuenciales para sugerencias
 * Límites: 60,000 TPM / 10 RPM → procesamiento secuencial con pausas
 */

import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODELO = 'gpt-5-mini';

// Tamaño de cada chunk en caracteres
// ~8000 chars ≈ ~2000 tokens de input por chunk
// Con system prompt (~800 tokens) + chunk (~2000) + output (~8000) = ~10800 tokens
// Bien dentro del límite de 60k TPM incluso con chunks consecutivos
const CHUNK_CHARS = 8000;

// Pausa entre llamadas para respetar 10 RPM (1 llamada cada 6 segundos mínimo)
const PAUSA_ENTRE_LLAMADAS_MS = 7000;

// ─────────────────────────────────────────────────────────────
// Utilidades
// ─────────────────────────────────────────────────────────────

function dormir(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function limpiarRespuestaJSON(texto) {
  let limpio = texto.trim();
  limpio = limpio.replace(/^```json\s*/i, '').replace(/^```\s*/, '');
  limpio = limpio.replace(/```\s*$/, '');
  return limpio.trim();
}

function repararJSONTruncado(jsonTexto) {
  // Busca el último objeto completo dentro de un array
  let mejorCorte = -1;

  for (let i = jsonTexto.length - 1; i >= 0; i--) {
    if (jsonTexto[i] !== '}') continue;

    const candidato = jsonTexto.slice(0, i + 1);
    let balanceLlaves = 0;
    let balanceCorchetes = 0;
    let dentroString = false;
    let escape = false;

    for (const ch of candidato) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { dentroString = !dentroString; continue; }
      if (dentroString) continue;
      if (ch === '{') balanceLlaves++;
      else if (ch === '}') balanceLlaves--;
      else if (ch === '[') balanceCorchetes++;
      else if (ch === ']') balanceCorchetes--;
    }

    // Estamos justo después de cerrar un elemento de array dentro del objeto raíz
    if (balanceLlaves === 1 && balanceCorchetes === 1) {
      mejorCorte = i + 1;
      break;
    }
  }

  if (mejorCorte === -1) return null;

  try {
    return JSON.parse(jsonTexto.slice(0, mejorCorte) + ']}');
  } catch {
    return null;
  }
}

function parsearJSON(texto, contexto) {
  const jsonLimpio = limpiarRespuestaJSON(texto);

  if (!jsonLimpio) {
    console.warn(`[ia] Respuesta vacía en "${contexto}", devolviendo objeto vacío`);
    return {};
  }

  try {
    return JSON.parse(jsonLimpio);
  } catch (err) {
    console.warn(`[ia] JSON truncado en "${contexto}", intentando reparar...`);

    const reparado = repararJSONTruncado(jsonLimpio);
    if (reparado && Object.keys(reparado).length > 0) {
      console.warn(`[ia] JSON reparado para "${contexto}" (algunos elementos finales descartados)`);
      return reparado;
    }

    // Si el reparador no funciona, intentar extraer lo que sea válido
    // para el análisis global: devolver estructura mínima usable
    if (contexto === 'global') {
      console.warn(`[ia] No se pudo reparar "${contexto}", devolviendo estructura mínima`);
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

    throw new Error(
      `No se pudo parsear JSON (${contexto}): ${err.message}\n` +
      `Respuesta (primeros 400 chars): ${jsonLimpio.slice(0, 400)}`
    );
  }
}

/**
 * Divide el texto en chunks respetando límites de párrafos.
 * Cada chunk incluye su índice, startChar y endChar.
 */
function dividirEnChunks(texto) {
  const chunks = [];
  let inicio = 0;

  while (inicio < texto.length) {
    let fin = Math.min(inicio + CHUNK_CHARS, texto.length);

    // Intentar cortar en salto de párrafo doble
    if (fin < texto.length) {
      const cortePárrafo = texto.lastIndexOf('\n\n', fin);
      if (cortePárrafo > inicio + CHUNK_CHARS * 0.5) {
        fin = cortePárrafo;
      } else {
        // Fallback: cortar en punto seguido de espacio
        const cortePunto = texto.lastIndexOf('. ', fin);
        if (cortePunto > inicio + CHUNK_CHARS * 0.5) {
          fin = cortePunto + 1;
        }
      }
    }

    const contenido = texto.slice(inicio, fin).trim();
    if (contenido) {
      chunks.push({
        index: chunks.length,
        startChar: inicio,
        endChar: fin,
        contenido,
      });
    }

    inicio = fin;
  }

  return chunks;
}

/**
 * Valida que fragmento_original exista exactamente en el texto completo.
 * Devuelve la posición de inicio o -1 si no se encuentra.
 */
function validarFragmento(textoCompleto, fragmento) {
  if (!fragmento || typeof fragmento !== 'string') return -1;
  return textoCompleto.indexOf(fragmento);
}

/**
 * Elimina sugerencias duplicadas basándose en fragmento_original.
 */
function deduplicarSugerencias(sugerencias) {
  const vistas = new Set();
  return sugerencias.filter((s) => {
    if (vistas.has(s.fragmento_original)) return false;
    vistas.add(s.fragmento_original);
    return true;
  });
}

// ─────────────────────────────────────────────────────────────
// LLAMADA 1 — Análisis global liviano
// Lee el sermón completo y devuelve contexto sin sugerencias extensas
// ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT_GLOBAL = `Eres un asistente editorial especializado en sermones cristianos en español.

Recibes la transcripción completa de un sermón. Tu tarea es hacer un análisis GLOBAL Y LIVIANO — no generes sugerencias de redacción aquí.

Devuelve un JSON con esta estructura exacta:
{
  "tema_central": "frase corta",
  "tono": "descripción breve del estilo del pastor (ej: didáctico, narrativo, exhortativo)",
  "resumen": "2-3 oraciones resumiendo el mensaje principal",
  "terminos_clave": ["término1", "término2", "..."],
  "secciones": [
    { "titulo": "título corto", "fragmento_inicio": "primeras 6-8 palabras EXACTAS del texto donde inicia esta sección" }
  ],
  "parrafos": [
    { "fragmento_inicio": "primeras 6-8 palabras EXACTAS del texto donde debe iniciar este párrafo" }
  ],
  "instrucciones_editoriales": "nota breve sobre cómo mantener la voz del pastor al editar"
}

Para "secciones": identifica SOLO las partes que el pastor anuncia explícitamente ("la primera parte...", "el segundo punto...", etc.). Si no hay, devuelve [].
Para "parrafos": identifica los cortes naturales de párrafo en TODO el sermón de inicio a fin. Cubre todo el texto.
Las palabras en fragmento_inicio deben ser EXACTAS (carácter por carácter) tal como aparecen en el texto.
Responde ÚNICAMENTE con el JSON, sin texto extra, sin markdown.`;

async function analizarGlobal(textoCompleto) {
  console.log(`[ia] Análisis global (${textoCompleto.length} chars)`);

  const response = await openai.chat.completions.create({
    model: MODELO,
    max_completion_tokens: 16000,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT_GLOBAL },
      { role: 'user', content: `Analiza este sermón completo:\n\n${textoCompleto}` },
    ],
  });

  const texto = response.choices?.[0]?.message?.content || '';
  console.log(`[ia] Global — tokens: input=${response.usage?.prompt_tokens} output=${response.usage?.completion_tokens}`);

  const data = parsearJSON(texto, 'global');
  return data;
}

// ─────────────────────────────────────────────────────────────
// LLAMADA 2 — Sugerencias por chunk (secuencial)
// ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT_CHUNK = `Eres un asistente editorial especializado en transformar transcripciones orales de sermones cristianos en español en capítulos de libro bien escritos.

Recibes un FRAGMENTO del sermón junto con contexto global del sermón completo.

Tu trabajo: generar sugerencias de mejora SOLO para este fragmento, cubriéndolo de principio a fin.

TIPOS DE CAMBIOS:
- "mejorar_redaccion": transforma frases orales en prosa escrita. MÁS IMPORTANTE — úsalo generosamente.
- "eliminar_muletilla": elimina "eh", "o sea", "como les digo", "verdad", "¿no?" repetidos.
- "eliminar_redundancia": elimina ideas repetidas innecesariamente por escrito.
- "ampliar": completa ideas que quedaron muy cortadas.
- "eliminar_opinion_personal": marca comentarios tangenciales (nunca se aplica automáticamente).
- "corregir_transcripcion": corrige palabras/frases sin sentido por error de Whisper. Incluye TODAS las que encuentres.
- "mejorar_transicion": mejora conectores abruptos entre ideas.

REGLAS CRÍTICAS:
1. "fragmento_original": copia texto EXACTO del fragmento (carácter por carácter). Máximo 35 palabras pero suficiente para ser único.
2. "fragmento_nuevo": texto propuesto. Máximo 80 palabras. Si necesitas más, escribe las primeras 80 palabras + "...".
3. "problema": máximo 12 palabras.
4. Cubre TODO el fragmento de inicio a fin. No te detengas a mitad.
5. No inventes fragmentos. No parafrasees fragmento_original.
6. Responde ÚNICAMENTE con: { "sugerencias": [...] } — sin texto extra, sin markdown.
7. Si no hay sugerencias útiles: { "sugerencias": [] }`;

async function procesarChunk(chunk, contextoGlobal, totalChunks) {
  console.log(`[ia] Chunk ${chunk.index + 1}/${totalChunks} (${chunk.contenido.length} chars)`);

  const contextoResumido = `
CONTEXTO DEL SERMÓN COMPLETO:
- Tema: ${contextoGlobal.tema_central}
- Tono del pastor: ${contextoGlobal.tono}
- Resumen: ${contextoGlobal.resumen}
- Instrucciones editoriales: ${contextoGlobal.instrucciones_editoriales}
`.trim();

  const userContent = `${contextoResumido}

FRAGMENTO ${chunk.index + 1} DE ${totalChunks}:
${chunk.contenido}`;

  const response = await openai.chat.completions.create({
    model: MODELO,
    max_completion_tokens: 12000,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT_CHUNK },
      { role: 'user', content: userContent },
    ],
  });

  const texto = response.choices?.[0]?.message?.content || '';
  const tokens = response.usage;
  console.log(`[ia] Chunk ${chunk.index + 1} — tokens: input=${tokens?.prompt_tokens} output=${tokens?.completion_tokens}`);

  const data = parsearJSON(texto, `chunk-${chunk.index + 1}`);
  return Array.isArray(data.sugerencias) ? data.sugerencias : [];
}

// ─────────────────────────────────────────────────────────────
// LLAMADA INSTRUCCIÓN ADICIONAL — Ronda extra del pastor
// ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT_INSTRUCCION = `Eres un asistente editorial especializado en sermones cristianos en español.

Recibes un FRAGMENTO del sermón y una instrucción específica del pastor.

Aplica esa instrucción al fragmento y genera sugerencias SOLO relacionadas con lo que el pastor pidió.

REGLAS:
1. "fragmento_original": texto EXACTO del fragmento (carácter por carácter). Máximo 35 palabras.
2. "fragmento_nuevo": texto propuesto. Máximo 80 palabras.
3. "problema": máximo 12 palabras.
4. No inventes fragmentos ni parafrasees fragmento_original.
5. Responde ÚNICAMENTE con: { "sugerencias": [...] } — sin texto extra, sin markdown.
6. Si no hay sugerencias aplicables: { "sugerencias": [] }`;

async function procesarChunkConInstruccion(chunk, instruccion, totalChunks) {
  console.log(`[ia] Instrucción chunk ${chunk.index + 1}/${totalChunks}`);

  const response = await openai.chat.completions.create({
    model: MODELO,
    max_completion_tokens: 8000,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT_INSTRUCCION },
      {
        role: 'user',
        content: `INSTRUCCIÓN DEL PASTOR: "${instruccion}"\n\nFRAGMENTO ${chunk.index + 1} DE ${totalChunks}:\n${chunk.contenido}`,
      },
    ],
  });

  const texto = response.choices?.[0]?.message?.content || '';
  const data = parsearJSON(texto, `instruccion-chunk-${chunk.index + 1}`);
  return Array.isArray(data.sugerencias) ? data.sugerencias : [];
}

// ─────────────────────────────────────────────────────────────
// Funciones públicas exportadas
// ─────────────────────────────────────────────────────────────

export async function analizarEstructura(textoCompleto) {
  const global = await analizarGlobal(textoCompleto);
  return {
    parrafos: Array.isArray(global.parrafos) ? global.parrafos : [],
    secciones: Array.isArray(global.secciones) ? global.secciones : [],
  };
}

export async function analizarSugerencias(textoCompleto, instruccion = null) {
  const chunks = dividirEnChunks(textoCompleto);
  console.log(`[ia] ${chunks.length} chunks para sugerencias`);

  const todasSugerencias = [];

  for (let i = 0; i < chunks.length; i++) {
    let sugerenciasChunk;

    if (instruccion) {
      sugerenciasChunk = await procesarChunkConInstruccion(chunks[i], instruccion, chunks.length);
    } else {
      // Solo en el primer chunk hacemos el análisis global (ya fue hecho antes si es inicial)
      // Aquí solo necesitamos el contexto mínimo — lo pasamos inline en el prompt
      sugerenciasChunk = await procesarChunkSinContexto(chunks[i], chunks.length);
    }

    // Validar que fragmento_original exista en el texto completo
    const validadas = sugerenciasChunk.filter((s) => {
      const pos = validarFragmento(textoCompleto, s.fragmento_original);
      if (pos === -1) {
        console.warn(`[ia] Sugerencia descartada (fragmento no encontrado): "${s.fragmento_original?.slice(0, 60)}"`);
        return false;
      }
      s._posicion = pos;
      return true;
    });

    todasSugerencias.push(...validadas);
    console.log(`[ia] Chunk ${i + 1}: ${validadas.length} sugerencias válidas`);

    // Pausa entre llamadas para respetar 10 RPM
    if (i < chunks.length - 1) {
      await dormir(PAUSA_ENTRE_LLAMADAS_MS);
    }
  }

  // Deduplicar y ordenar por posición en el texto
  const deduplicadas = deduplicarSugerencias(todasSugerencias);
  deduplicadas.sort((a, b) => (a._posicion || 0) - (b._posicion || 0));

  // Limpiar campo auxiliar _posicion antes de devolver
  deduplicadas.forEach((s) => delete s._posicion);

  console.log(`[ia] Total sugerencias válidas: ${deduplicadas.length}`);
  return deduplicadas;
}

// Versión sin contexto global (para rondas de sugerencias sin análisis previo)
async function procesarChunkSinContexto(chunk, totalChunks) {
  const response = await openai.chat.completions.create({
    model: MODELO,
    max_completion_tokens: 12000,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT_CHUNK },
      {
        role: 'user',
        content: `FRAGMENTO ${chunk.index + 1} DE ${totalChunks}:\n${chunk.contenido}`,
      },
    ],
  });

  const texto = response.choices?.[0]?.message?.content || '';
  const data = parsearJSON(texto, `chunk-${chunk.index + 1}`);
  return Array.isArray(data.sugerencias) ? data.sugerencias : [];
}

// ─────────────────────────────────────────────────────────────
// Función combinada — usada por analisisIA.job.js (mantiene firma)
// ─────────────────────────────────────────────────────────────

export async function analizarTexto(textoCompleto, instruccionAdicional = null, esAnalisisInicial = true) {
  if (esAnalisisInicial) {
    // 1. Análisis global liviano (párrafos + secciones + contexto)
    const global = await analizarGlobal(textoCompleto);
    const parrafos = Array.isArray(global.parrafos) ? global.parrafos : [];
    const secciones = Array.isArray(global.secciones) ? global.secciones : [];

    await dormir(PAUSA_ENTRE_LLAMADAS_MS);

    // 2. Sugerencias por chunks secuenciales con contexto global
    const chunks = dividirEnChunks(textoCompleto);
    console.log(`[ia] ${chunks.length} chunks para análisis inicial`);

    const todasSugerencias = [];

    for (let i = 0; i < chunks.length; i++) {
      const sugerenciasChunk = await procesarChunk(chunks[i], global, chunks.length);

      const validadas = sugerenciasChunk.filter((s) => {
        const pos = validarFragmento(textoCompleto, s.fragmento_original);
        if (pos === -1) {
          console.warn(`[ia] Descartada (no encontrada): "${s.fragmento_original?.slice(0, 60)}"`);
          return false;
        }
        s._posicion = pos;
        return true;
      });

      todasSugerencias.push(...validadas);
      console.log(`[ia] Chunk ${i + 1}/${chunks.length}: ${validadas.length} sugerencias válidas`);

      if (i < chunks.length - 1) {
        await dormir(PAUSA_ENTRE_LLAMADAS_MS);
      }
    }

    const deduplicadas = deduplicarSugerencias(todasSugerencias);
    deduplicadas.sort((a, b) => (a._posicion || 0) - (b._posicion || 0));
    deduplicadas.forEach((s) => delete s._posicion);

    console.log(`[ia] Análisis completo: ${parrafos.length} párrafos, ${secciones.length} secciones, ${deduplicadas.length} sugerencias`);

    return { parrafos, secciones, sugerencias: deduplicadas };
  }

  // Ronda adicional con instrucción del pastor
  const chunks = dividirEnChunks(textoCompleto);
  const todasSugerencias = [];

  for (let i = 0; i < chunks.length; i++) {
    const sug = await procesarChunkConInstruccion(chunks[i], instruccionAdicional, chunks.length);

    const validadas = sug.filter((s) => {
      const pos = validarFragmento(textoCompleto, s.fragmento_original);
      if (pos === -1) return false;
      s._posicion = pos;
      return true;
    });

    todasSugerencias.push(...validadas);

    if (i < chunks.length - 1) {
      await dormir(PAUSA_ENTRE_LLAMADAS_MS);
    }
  }

  const deduplicadas = deduplicarSugerencias(todasSugerencias);
  deduplicadas.sort((a, b) => (a._posicion || 0) - (b._posicion || 0));
  deduplicadas.forEach((s) => delete s._posicion);

  return { parrafos: [], secciones: [], sugerencias: deduplicadas };
}