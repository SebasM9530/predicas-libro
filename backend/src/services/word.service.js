/**
 * Convierte HTML de Tiptap a array de TextRun para docx.
 * Maneja <strong>, <em>, <span style="font-size:Xpx">, texto plano.
 * Usa un parser iterativo en vez de regex para manejar HTML anidado.
 */
function htmlATextRuns(html, tamanoBase = TAMANO_CUERPO) {
  if (!html) return [new TextRun({ text: '', font: FUENTE, size: tamanoBase, color: COLOR_NEGRO })];

  // Si no tiene etiquetas HTML es texto plano
  if (!/<[a-z]/i.test(html)) {
    const texto = html.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
    return [new TextRun({ text: texto, font: FUENTE, size: tamanoBase, bold: false, italics: false, color: COLOR_NEGRO })];
  }

  const runs = [];

  // Parser iterativo con pila de estado de formato
  function parsear(nodo, bold, italic, tamano) {
    if (nodo.nodeType === 3) {
      // Nodo de texto
      const texto = nodo.textContent || '';
      if (texto) {
        runs.push(new TextRun({
          text: texto,
          font: FUENTE,
          size: tamano,
          bold,
          italics: italic,
          color: COLOR_NEGRO,
        }));
      }
      return;
    }

    if (nodo.nodeType !== 1) return; // solo elementos

    const tag = nodo.tagName?.toLowerCase();
    let nuevoBold = bold;
    let nuevoItalic = italic;
    let nuevoTamano = tamano;

    if (tag === 'strong' || tag === 'b') nuevoBold = true;
    if (tag === 'em' || tag === 'i') nuevoItalic = true;

    if (tag === 'span') {
      const style = nodo.getAttribute('style') || '';
      const match = style.match(/font-size:\s*([\d.]+)px/i);
      if (match) {
        const px = parseFloat(match[1]);
        // Convertir px → half-points: (px / 96 * 72) * 2
        nuevoTamano = Math.round((px / 96) * 72 * 2);
      }
    }

    // Ignorar marks de sugerencia y sección (son solo visuales)
    if (tag === 'mark') {
      for (const hijo of nodo.childNodes) parsear(hijo, nuevoBold, nuevoItalic, nuevoTamano);
      return;
    }

    for (const hijo of nodo.childNodes) {
      parsear(hijo, nuevoBold, nuevoItalic, nuevoTamano);
    }
  }

  // Usar DOMParser — disponible en Node 18+ con el flag --experimental-vm-modules
  // o mediante linkedom. Como estamos en Node, usamos un parser manual simple.
  // Alternativa más robusta: parsear manualmente el HTML.
  const segmentos = parsearHTMLManual(html, false, false, tamanoBase, runs);
  return runs.length > 0 ? runs : [new TextRun({ text: html.replace(/<[^>]+>/g, ''), font: FUENTE, size: tamanoBase, color: COLOR_NEGRO })];
}

/**
 * Parser manual de HTML que extrae TextRuns con su formato correcto.
 * No usa DOM (no disponible de forma limpia en Node.js sin dependencias extra).
 */
function parsearHTMLManual(html, boldInicial, italicInicial, tamanoInicial, runs) {
  // Limpiar marks de sugerencia y sección antes de parsear
  let htmlLimpio = html
    .replace(/<mark[^>]*>/gi, '')
    .replace(/<\/mark>/gi, '')
    .replace(/<span[^>]*data-seccion-id[^>]*>/gi, '')
    .replace(/<\/span>/gi, '');

  // Pila de estado: [{ bold, italic, tamano }]
  const pila = [{ bold: boldInicial, italic: italicInicial, tamano: tamanoInicial }];

  // Dividir en tokens: etiquetas y texto
  const tokens = htmlLimpio.split(/(<[^>]+>)/);

  for (const token of tokens) {
    if (!token) continue;

    if (token.startsWith('<')) {
      const tagMatch = token.match(/^<\/?([a-z][a-z0-9]*)/i);
      if (!tagMatch) continue;
      const tag = tagMatch[1].toLowerCase();
      const esCierre = token.startsWith('</');

      if (esCierre) {
        if (pila.length > 1) pila.pop();
      } else {
        const estado = { ...pila[pila.length - 1] };

        if (tag === 'strong' || tag === 'b') estado.bold = true;
        else if (tag === 'em' || tag === 'i') estado.italic = true;
        else if (tag === 'span') {
          const sizeMatch = token.match(/font-size:\s*([\d.]+)px/i);
          if (sizeMatch) {
            const px = parseFloat(sizeMatch[1]);
            estado.tamano = Math.round((px / 96) * 72 * 2);
          }
        }

        pila.push(estado);
      }
    } else {
      // Texto plano
      const estado = pila[pila.length - 1];
      const texto = token
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ');

      if (texto.trim() || texto.includes(' ')) {
        runs.push(new TextRun({
          text: texto,
          font: FUENTE,
          size: estado.tamano,
          bold: estado.bold,
          italics: estado.italic,
          color: COLOR_NEGRO,
        }));
      }
    }
  }
}/**
 * Convierte HTML de Tiptap a array de TextRun para docx.
 * Maneja <strong>, <em>, <span style="font-size:Xpx">, texto plano.
 * Usa un parser iterativo en vez de regex para manejar HTML anidado.
 */
function htmlATextRuns(html, tamanoBase = TAMANO_CUERPO) {
  if (!html) return [new TextRun({ text: '', font: FUENTE, size: tamanoBase, color: COLOR_NEGRO })];

  // Si no tiene etiquetas HTML es texto plano
  if (!/<[a-z]/i.test(html)) {
    const texto = html.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
    return [new TextRun({ text: texto, font: FUENTE, size: tamanoBase, bold: false, italics: false, color: COLOR_NEGRO })];
  }

  const runs = [];

  // Parser iterativo con pila de estado de formato
  function parsear(nodo, bold, italic, tamano) {
    if (nodo.nodeType === 3) {
      // Nodo de texto
      const texto = nodo.textContent || '';
      if (texto) {
        runs.push(new TextRun({
          text: texto,
          font: FUENTE,
          size: tamano,
          bold,
          italics: italic,
          color: COLOR_NEGRO,
        }));
      }
      return;
    }

    if (nodo.nodeType !== 1) return; // solo elementos

    const tag = nodo.tagName?.toLowerCase();
    let nuevoBold = bold;
    let nuevoItalic = italic;
    let nuevoTamano = tamano;

    if (tag === 'strong' || tag === 'b') nuevoBold = true;
    if (tag === 'em' || tag === 'i') nuevoItalic = true;

    if (tag === 'span') {
      const style = nodo.getAttribute('style') || '';
      const match = style.match(/font-size:\s*([\d.]+)px/i);
      if (match) {
        const px = parseFloat(match[1]);
        // Convertir px → half-points: (px / 96 * 72) * 2
        nuevoTamano = Math.round((px / 96) * 72 * 2);
      }
    }

    // Ignorar marks de sugerencia y sección (son solo visuales)
    if (tag === 'mark') {
      for (const hijo of nodo.childNodes) parsear(hijo, nuevoBold, nuevoItalic, nuevoTamano);
      return;
    }

    for (const hijo of nodo.childNodes) {
      parsear(hijo, nuevoBold, nuevoItalic, nuevoTamano);
    }
  }

  // Usar DOMParser — disponible en Node 18+ con el flag --experimental-vm-modules
  // o mediante linkedom. Como estamos en Node, usamos un parser manual simple.
  // Alternativa más robusta: parsear manualmente el HTML.
  const segmentos = parsearHTMLManual(html, false, false, tamanoBase, runs);
  return runs.length > 0 ? runs : [new TextRun({ text: html.replace(/<[^>]+>/g, ''), font: FUENTE, size: tamanoBase, color: COLOR_NEGRO })];
}

/**
 * Parser manual de HTML que extrae TextRuns con su formato correcto.
 * No usa DOM (no disponible de forma limpia en Node.js sin dependencias extra).
 */
function parsearHTMLManual(html, boldInicial, italicInicial, tamanoInicial, runs) {
  // Limpiar marks de sugerencia y sección antes de parsear
  let htmlLimpio = html
    .replace(/<mark[^>]*>/gi, '')
    .replace(/<\/mark>/gi, '')
    .replace(/<span[^>]*data-seccion-id[^>]*>/gi, '')
    .replace(/<\/span>/gi, '');

  // Pila de estado: [{ bold, italic, tamano }]
  const pila = [{ bold: boldInicial, italic: italicInicial, tamano: tamanoInicial }];

  // Dividir en tokens: etiquetas y texto
  const tokens = htmlLimpio.split(/(<[^>]+>)/);

  for (const token of tokens) {
    if (!token) continue;

    if (token.startsWith('<')) {
      const tagMatch = token.match(/^<\/?([a-z][a-z0-9]*)/i);
      if (!tagMatch) continue;
      const tag = tagMatch[1].toLowerCase();
      const esCierre = token.startsWith('</');

      if (esCierre) {
        if (pila.length > 1) pila.pop();
      } else {
        const estado = { ...pila[pila.length - 1] };

        if (tag === 'strong' || tag === 'b') estado.bold = true;
        else if (tag === 'em' || tag === 'i') estado.italic = true;
        else if (tag === 'span') {
          const sizeMatch = token.match(/font-size:\s*([\d.]+)px/i);
          if (sizeMatch) {
            const px = parseFloat(sizeMatch[1]);
            estado.tamano = Math.round((px / 96) * 72 * 2);
          }
        }

        pila.push(estado);
      }
    } else {
      // Texto plano
      const estado = pila[pila.length - 1];
      const texto = token
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ');

      if (texto.trim() || texto.includes(' ')) {
        runs.push(new TextRun({
          text: texto,
          font: FUENTE,
          size: estado.tamano,
          bold: estado.bold,
          italics: estado.italic,
          color: COLOR_NEGRO,
        }));
      }
    }
  }
}