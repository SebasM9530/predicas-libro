/**
 * Une los textos transcritos de varios chunks, intentando eliminar
 * la duplicación generada por el solapamiento entre ellos.
 *
 * Estrategia: para cada par (anterior, actual), se busca la subcadena
 * más larga del final del texto anterior que coincida con el inicio
 * del texto actual, y se recorta esa coincidencia del texto actual
 * antes de concatenar.
 *
 * @param {Array<{ index: number, texto: string }>} chunks - ordenados por index
 * @returns {string} texto completo unido
 */
export function unirTranscripciones(chunks) {
  const ordenados = [...chunks].sort((a, b) => a.index - b.index);

  if (ordenados.length === 0) return '';
  if (ordenados.length === 1) return ordenados[0].texto.trim();

  let resultado = ordenados[0].texto.trim();

  for (let i = 1; i < ordenados.length; i++) {
    const anterior = resultado;
    const actual = ordenados[i].texto.trim();

    const solape = encontrarSolapamiento(anterior, actual);

    resultado = resultado + ' ' + actual.slice(solape).trim();
  }

  // Normalizar espacios múltiples
  return resultado.replace(/\s+/g, ' ').trim();
}

/**
 * Busca el largo del solapamiento entre el final de `anterior` y el
 * inicio de `actual`, comparando por palabras (más robusto que por
 * caracteres frente a transcripciones que difieren ligeramente).
 *
 * Devuelve la cantidad de CARACTERES desde el inicio de `actual` que
 * deben recortarse.
 */
function encontrarSolapamiento(anterior, actual) {
  const MAX_PALABRAS_SOLAPE = 30; // buscamos hasta ~30 palabras de coincidencia

  const palabrasAnterior = anterior.split(/\s+/);
  const palabrasActual = actual.split(/\s+/);

  const maxN = Math.min(MAX_PALABRAS_SOLAPE, palabrasAnterior.length, palabrasActual.length);

  // Probamos desde la coincidencia más larga posible hacia la más corta
  for (let n = maxN; n >= 3; n--) {
    const finAnterior = palabrasAnterior.slice(-n).join(' ').toLowerCase();
    const inicioActual = palabrasActual.slice(0, n).join(' ').toLowerCase();

    if (finAnterior === inicioActual) {
      // Calcular cuántos caracteres ocupan esas n palabras al inicio de `actual`
      const fragmento = palabrasActual.slice(0, n).join(' ');
      return fragmento.length;
    }
  }

  return 0; // no se encontró solapamiento claro, no se recorta nada
}

/**
 * Verifica si un fragmento aparece exactamente una vez en el texto.
 * @returns {{ unico: boolean, ocurrencias: number, posicion: number }}
 */
export function localizarFragmento(texto, fragmento) {
  if (!fragmento) return { unico: false, ocurrencias: 0, posicion: -1 };

  let ocurrencias = 0;
  let posicion = -1;
  let desde = 0;

  while (true) {
    const idx = texto.indexOf(fragmento, desde);
    if (idx === -1) break;
    ocurrencias++;
    if (posicion === -1) posicion = idx;
    desde = idx + 1;
    if (ocurrencias > 1) break; // ya sabemos que no es único, no seguimos contando
  }

  return { unico: ocurrencias === 1, ocurrencias, posicion };
}
