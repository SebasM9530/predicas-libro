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
const CHUNK_CHARS = 6000;
const PAUSA_ENTRE_LLAMADAS_MS = 7000;

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

/**
 * Recorre el texto y determina qué llaves/corchetes/strings quedaron
 * abiertos, devolviendo el string necesario para cerrarlos en orden
 * inverso (LIFO). Devuelve null si el texto tiene una estructura
 * inválida que no se puede determinar con seguridad.
 */
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

function parsearJSON(texto, contexto) {
  const jsonLimpio = limpiarRespuestaJSON(texto);

  if (!jsonLimpio) {
    console.warn(`[ia] Respuesta vacía en "${contexto}", intentando reparar desde texto crudo...`);
    const reparadoDesdeOriginal = repararJSONTruncado(texto.trim());
    if (reparadoDesdeOriginal && Object.keys(reparadoDesdeOriginal).length > 0) {
      console.warn(`[ia] Se recuperaron datos parciales para "${contexto}" desde respuesta truncada.`);
      return reparadoDesdeOriginal;
    }
    if (contexto === 'global') {
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
 * Búsqueda tolerante: intenta encontrar el fragmento en el texto
 * completo con distintos niveles de tolerancia:
 * 1. Búsqueda exacta
 * 2. Normalizando espacios múltiples
 * 3. Ignorando diferencias de puntuación al inicio/fin
 * 4. Buscando con los primeros 60 caracteres (para fragmentos
 *    donde la IA alargó el texto)
 *
 * Devuelve la posición de inicio o -1 si no se encuentra.
 */
function buscarFragmentoTolerante(textoCompleto, fragmento) {
  if (!fragmento || typeof fragmento !== 'string') return -1;

  // 1. Exacto
  let idx = textoCompleto.indexOf(fragmento);
  if (idx !== -1) return idx;

  // 2. Normalizando espacios
  const fragNorm = fragmento.replace(/\s+/g, ' ').trim();
  const textoNorm = textoCompleto.replace(/\s+/g, ' ');
  idx = textoNorm.indexOf(fragNorm);
  if (idx !== -1) {
    // Mapear posición del texto normalizado al texto real
    return mapearPosicionNormalizada(textoCompleto, idx);
  }

  // 3. Con los primeros 50 caracteres (la IA puede haber extendido el fragmento)
  const prefijo = fragNorm.slice(0, 50);
  if (prefijo.length >= 20) {
    idx = textoNorm.indexOf(prefijo);
    if (idx !== -1) return mapearPosicionNormalizada(textoCompleto, idx);
  }

  // 4. Ignorando puntuación al inicio del fragmento (comas, puntos, etc.)
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
      while (posReal < textoReal.length && /\s/.test(textoReal[posReal])) {
        posReal++;
      }
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
- Para "secciones": identifica SOLO las partes que el pastor anuncia explícitamente. Si no hay, devuelve [].
- Para "parrafos": identifica los cortes naturales de párrafo en TODO el sermón. No pongas más de 80 entradas en total entre parrafos y secciones. Prioriza los cortes más claros e importantes.
- Las palabras en fragmento_inicio deben ser EXACTAS (carácter por carácter) tal como aparecen en el texto.
- Responde ÚNICAMENTE con el JSON, sin texto extra, sin markdown.`;

async function analizarGlobal(textoCompleto, capituloId = null) {
  console.log(`[ia] Análisis global (${textoCompleto.length} chars)`);
  await actualizarEstadoDetalle(capituloId, 'Analizando el sermón completo: detectando tema, tono y estructura general...');

  const response = await openai.chat.completions.create({
    model: MODELO,
    max_completion_tokens: 24000,
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

Recibes un FRAGMENTO del sermón. Debes generar sugerencias de mejora para TODO el fragmento de principio a fin.

═══════════════════════════════════════════
REGLA MÁS IMPORTANTE — CATEGORÍAS OBLIGATORIAS
═══════════════════════════════════════════
Tienes 7 categorías. DEBES usar la más específica que aplique. Solo usa "mejorar_redaccion" cuando ninguna otra categoría más específica aplica mejor. Revisa SIEMPRE en este orden:

1. ¿Es una muletilla oral, llamado a la audiencia, o saludo del culto? → "eliminar_muletilla"
   Ejemplos: "eh", "o sea", "verdad", "¿no?", "dígale al de al lado", "levante la mano", "repita conmigo", "buenos días hermanos", "bienvenidos a la iglesia", "oremos para iniciar", anuncios del culto.

2. ¿Es una idea repetida que ya se dijo con otras palabras? → "eliminar_redundancia"
   Ejemplos: cuando el pastor dice lo mismo dos o tres veces para enfatizar, pero por escrito sobra.

3. ¿Es un error claro de transcripción de Whisper, nombre bíblico deformado, o frase sin sentido? → "corregir_transcripcion"
   Ejemplos: palabras inventadas, nombres propios mal escritos, frases que no tienen sentido en contexto.

4. ¿Es un conector abrupto entre dos párrafos o ideas? → "mejorar_transicion"
   Ejemplos: cambios de tema sin conectar, párrafos que no fluyen entre sí.

5. ¿Es un comentario personal, anécdota tangencial, o aparte que interrumpe el tema? → "eliminar_opinion_personal"
   Ejemplos: opiniones del pastor no relacionadas con la enseñanza, digresiones personales.

6. ¿Es una idea incompleta que quedó cortada y necesita una frase de cierre? → "ampliar"
   Ejemplos: frases que empiezan una idea y la dejan sin concluir.

7. Solo si ninguna de las anteriores aplica: ¿Es una frase oral que funciona hablando pero no como texto escrito? → "mejorar_redaccion"
   Ejemplos: oraciones largas, frases coloquiales, voz inconsistente, preguntas retóricas poco claras, ambigüedad al leer.

═══════════════════════════════════════════
REGLAS DE FORMATO
═══════════════════════════════════════════
1. "fragmento_original": copia el texto EXACTAMENTE como aparece en el fragmento (carácter por carácter). Máximo 35 palabras. NUNCA parafrasees ni modifiques ni una coma.
2. "fragmento_nuevo": texto propuesto como reemplazo. Máximo 80 palabras. Si necesitas más, escribe las primeras 80 palabras + "...".
3. "problema": máximo 12 palabras explicando el problema específico detectado.
4. Cubre TODO el fragmento de principio a fin sin omitir secciones.
5. Responde ÚNICAMENTE con: { "sugerencias": [...] } — sin texto extra, sin markdown, sin backticks.
6. Si genuinamente no hay nada que mejorar: { "sugerencias": [] }`;

async function procesarChunk(chunk, contextoGlobal, totalChunks, capituloId = null) {
  console.log(`[ia] Chunk ${chunk.index + 1}/${totalChunks} (${chunk.contenido.length} chars)`);
  await actualizarEstadoDetalle(
    capituloId,
    `Generando recomendaciones: parte ${chunk.index + 1} de ${totalChunks} (GPT-5 mini)...`
  );

  const contextoResumido = `CONTEXTO DEL SERMÓN:
- Tema: ${contextoGlobal.tema_central}
- Tono: ${contextoGlobal.tono}
- Resumen: ${contextoGlobal.resumen}
- Instrucciones: ${contextoGlobal.instrucciones_editoriales}`.trim();

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

export async function analizarTexto(textoCompleto, instruccionAdicional = null, esAnalisisInicial = true, capituloId = null) {
  if (esAnalisisInicial) {
    const global = await analizarGlobal(textoCompleto, capituloId);
    const parrafos = Array.isArray(global.parrafos) ? global.parrafos : [];
    const secciones = Array.isArray(global.secciones) ? global.secciones : [];

    await actualizarEstadoDetalle(
      capituloId,
      `Análisis general listo (${secciones.length} sección(es) detectadas). Iniciando revisión de redacción...`
    );

    await dormir(PAUSA_ENTRE_LLAMADAS_MS);

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