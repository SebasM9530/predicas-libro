/**
 * ia.service.js (mantenemos el nombre claude.service.js para no cambiar imports)
 *
 * Modelo: gpt-5-mini (OpenAI)
 * Estrategia: análisis global liviano → chunks secuenciales para sugerencias
 * Límites: 60,000 TPM / 10 RPM → procesamiento secuencial con pausas
 */

import OpenAI from 'openai';
import dotenv from 'dotenv';
import { supabase } from './supabase.service.js';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODELO = 'gpt-5-mini';

// Tamaño de cada chunk en caracteres
// ~8000 chars ≈ ~2000 tokens de input por chunk
// Con system prompt (~800 tokens) + chunk (~2000) + output (~8000) = ~10800 tokens
// Bien dentro del límite de 60k TPM incluso con chunks consecutivos
const CHUNK_CHARS = 6000;

// Pausa entre llamadas para respetar 10 RPM (1 llamada cada 6 segundos mínimo)
const PAUSA_ENTRE_LLAMADAS_MS = 7000;

// ─────────────────────────────────────────────────────────────
// Utilidades
// ─────────────────────────────────────────────────────────────

function dormir(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Actualiza el mensaje de estado detallado visible en el frontend.
 * No lanza error si falla (no debe tumbar el análisis por un problema
 * de reporte de progreso).
 */
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

async function analizarGlobal(textoCompleto, capituloId = null) {
  console.log(`[ia] Análisis global (${textoCompleto.length} chars)`);
  await actualizarEstadoDetalle(capituloId, 'Analizando el sermón completo: detectando tema, tono y estructura general...');

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

Tu trabajo: generar sugerencias de mejora SOLO para este fragmento, cubriéndolo de principio a fin, aplicando los siguientes criterios editoriales:

TIPOS DE CAMBIOS Y CRITERIOS DETALLADOS:

- "mejorar_redaccion": transforma frases orales en prosa escrita. Esta es la categoría más amplia e incluye:
  1. Preguntas retóricas: identifica todas las del fragmento y mejora su redacción para que resulten más claras e impactantes en formato de libro, sin cambiar su intención.
  2. Expresiones demasiado informales o coloquiales: propón una versión más apropiada para un libro, manteniendo la voz cercana del pastor.
  3. Frases que se entienden al escucharlas pero resultan ambiguas o confusas al leerlas: reescríbelas para que sean claras en formato de libro.
  4. Cambios innecesarios entre primera persona singular, primera persona plural y segunda persona: propón una voz narrativa más consistente.
  5. Puntuación y construcción de frases: corrige cuando sea necesario para que la oración sea correcta, sin cambiar ideas, ejemplos ni vocabulario salvo que sea imprescindible.

- "mejorar_transicion": revisa ÚNICAMENTE los conectores entre párrafos e ideas. Sugiere cambios donde la transición sea abrupta, confusa o inexistente.

- "eliminar_opinion_personal": identifica comentarios personales, anécdotas o apartes que interrumpan el tema principal. Sugiere eliminarlos o integrarlos mejor al argumento. También incluye saludos, agradecimientos, anuncios o instrucciones propias del culto que no deban aparecer en el capítulo final (sugiere eliminarlos manteniendo la continuidad).

- "eliminar_muletilla": elimina "eh", "o sea", "como les digo", "verdad", "¿no?" repetidos en exceso. También incluye llamados a la audiencia propios de una prédica oral en vivo, como "dígale al que está a su lado", "levante la mano" o "repita conmigo" — propón una adaptación adecuada para un capítulo de libro (puede ser reformular como afirmación o eliminar si no aporta al texto escrito).

- "eliminar_redundancia": elimina ideas repetidas innecesariamente por escrito. Incluye específicamente cuando el pastor repite la misma enseñanza usando palabras diferentes — conserva la versión más clara y propón una redacción unificada.

- "ampliar": identifica ideas que comienzan pero no terminan de desarrollarse. Propón una frase breve de cierre, SIN agregar enseñanzas nuevas que no estén respaldadas por el sermón.

- "corregir_transcripcion": revisa todas las referencias bíblicas, nombres bíblicos y términos cristianos. Corrige ÚNICAMENTE aquellos que parezcan errores de transcripción (palabras inventadas, nombres deformados, frases incoherentes por error de Whisper).

REGLAS CRÍTICAS:
1. "fragmento_original": copia texto EXACTO del fragmento (carácter por carácter). Máximo 35 palabras pero suficiente para ser único.
2. "fragmento_nuevo": texto propuesto. Máximo 80 palabras. Si necesitas más, escribe las primeras 80 palabras + "...".
3. "problema": máximo 12 palabras, indicando claramente cuál de los criterios aplicaste (ej. "pregunta retórica poco clara", "oración demasiado larga", "llamado oral de culto").
4. Cubre TODO el fragmento de inicio a fin. No te detengas a mitad.
5. No inventes fragmentos. No parafrasees fragmento_original.
6. Nunca cambies el mensaje, la enseñanza ni la intención del pastor — solo la forma en que está expresado.
7. Responde ÚNICAMENTE con: { "sugerencias": [...] } — sin texto extra, sin markdown.
8. Si no hay sugerencias útiles: { "sugerencias": [] }`;

async function procesarChunk(chunk, contextoGlobal, totalChunks, capituloId = null) {
  console.log(`[ia] Chunk ${chunk.index + 1}/${totalChunks} (${chunk.contenido.length} chars)`);
  await actualizarEstadoDetalle(
    capituloId,
    `Generando recomendaciones de redacción: parte ${chunk.index + 1} de ${totalChunks} (GPT-5 mini)...`
  );

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

async function procesarChunkConInstruccion(chunk, instruccion, totalChunks, capituloId = null) {
  console.log(`[ia] Instrucción chunk ${chunk.index + 1}/${totalChunks}`);
  await actualizarEstadoDetalle(
    capituloId,
    `Aplicando tu instrucción: parte ${chunk.index + 1} de ${totalChunks}...`
  );

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
// Versión sin contexto global (para rondas de sugerencias sin análisis previo)
// ─────────────────────────────────────────────────────────────

async function procesarChunkSinContexto(chunk, totalChunks, capituloId = null) {
  await actualizarEstadoDetalle(
    capituloId,
    `Generando recomendaciones: parte ${chunk.index + 1} de ${totalChunks}...`
  );

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
    let sugerenciasChunk;

    if (instruccion) {
      sugerenciasChunk = await procesarChunkConInstruccion(chunks[i], instruccion, chunks.length, capituloId);
    } else {
      sugerenciasChunk = await procesarChunkSinContexto(chunks[i], chunks.length, capituloId);
    }

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

    await actualizarEstadoDetalle(
      capituloId,
      `Parte ${i + 1} de ${chunks.length} analizada (${validadas.length} recomendaciones encontradas)...`
    );

    if (i < chunks.length - 1) {
      await dormir(PAUSA_ENTRE_LLAMADAS_MS);
    }
  }

  const deduplicadas = deduplicarSugerencias(todasSugerencias);
  deduplicadas.sort((a, b) => (a._posicion || 0) - (b._posicion || 0));
  deduplicadas.forEach((s) => delete s._posicion);

  console.log(`[ia] Total sugerencias válidas: ${deduplicadas.length}`);
  return deduplicadas;
}

// ─────────────────────────────────────────────────────────────
// Función combinada — usada por analisisIA.job.js (mantiene firma)
// ─────────────────────────────────────────────────────────────

export async function analizarTexto(textoCompleto, instruccionAdicional = null, esAnalisisInicial = true, capituloId = null) {
  if (esAnalisisInicial) {
    // 1. Análisis global liviano (párrafos + secciones + contexto)
    const global = await analizarGlobal(textoCompleto, capituloId);
    const parrafos = Array.isArray(global.parrafos) ? global.parrafos : [];
    const secciones = Array.isArray(global.secciones) ? global.secciones : [];

    await actualizarEstadoDetalle(
      capituloId,
      `Análisis general listo (${secciones.length} sección(es) detectadas). Iniciando revisión de redacción...`
    );

    await dormir(PAUSA_ENTRE_LLAMADAS_MS);

    // 2. Sugerencias por chunks secuenciales con contexto global
    const chunks = dividirEnChunks(textoCompleto);
    console.log(`[ia] ${chunks.length} chunks para análisis inicial`);

    const todasSugerencias = [];

    for (let i = 0; i < chunks.length; i++) {
      const sugerenciasChunk = await procesarChunk(chunks[i], global, chunks.length, capituloId);

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

      await actualizarEstadoDetalle(
        capituloId,
        `Redacción revisada: parte ${i + 1} de ${chunks.length} completada (${todasSugerencias.length} recomendaciones hasta ahora)...`
      );

      if (i < chunks.length - 1) {
        await dormir(PAUSA_ENTRE_LLAMADAS_MS);
      }
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
    const sug = await procesarChunkConInstruccion(chunks[i], instruccionAdicional, chunks.length, capituloId);

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