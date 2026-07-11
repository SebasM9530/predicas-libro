import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  PageBreak,
  Footer,
  PageNumber,
  InternalHyperlink,
  BookmarkStart,
  BookmarkEnd,
} from 'docx';

const FUENTE = 'Times New Roman';
const TAMANO_CUERPO = 24;
const TAMANO_SUBTITULO = 28;
const TAMANO_TITULO_CAP = 32;
const TAMANO_TITULO_LIBRO = 48;
const INTERLINEADO = 276;
const COLOR_NEGRO = '000000';

/**
 * Parsea un string HTML (puede contener <strong>, <em>, <span style="font-size:...">)
 * y lo convierte en un array de TextRun de docx, respetando el formato.
 * Soporta texto plano sin etiquetas también.
 */
function htmlATextRuns(html, tamanoBase = TAMANO_CUERPO) {
  if (!html) return [new TextRun({ text: '', font: FUENTE, size: tamanoBase, color: COLOR_NEGRO })];

  // Si no tiene etiquetas HTML, es texto plano
  if (!/<[a-z][\s\S]*>/i.test(html)) {
    return [new TextRun({ text: html, font: FUENTE, size: tamanoBase, color: COLOR_NEGRO })];
  }

  // Parsear HTML con DOMParser no disponible en Node — usamos regex simple
  // para extraer segmentos con sus formatos
  const runs = [];
  const regex = /<(strong|em|span[^>]*)>(.*?)<\/(?:strong|em|span)>|([^<]+)/gis;
  let match;

  // Función recursiva para procesar HTML anidado
  function procesarHtml(htmlStr, bold = false, italic = false, tamano = tamanoBase) {
    const partes = [];
    const re = /<(strong|b)>([\s\S]*?)<\/(?:strong|b)>|<(em|i)>([\s\S]*?)<\/(?:em|i)>|<span[^>]*font-size:\s*([\d.]+)px[^>]*>([\s\S]*?)<\/span>|([^<]+)/gi;
    let m;

    while ((m = re.exec(htmlStr)) !== null) {
      if (m[1]) {
        // <strong> o <b>
        procesarHtml(m[2], true, italic, tamano).forEach((r) => partes.push(r));
      } else if (m[3]) {
        // <em> o <i>
        procesarHtml(m[4], bold, true, tamano).forEach((r) => partes.push(r));
      } else if (m[5]) {
        // <span> con font-size
        const px = parseFloat(m[5]);
        const halfPoints = Math.round((px / 96) * 72 * 2); // px → pt → half-points
        procesarHtml(m[6], bold, italic, halfPoints).forEach((r) => partes.push(r));
      } else if (m[7]) {
        // Texto plano
        const texto = m[7].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        if (texto) {
          partes.push(new TextRun({
            text: texto,
            font: FUENTE,
            size: tamano,
            bold,
            italics: italic,
            color: COLOR_NEGRO,
          }));
        }
      }
    }

    return partes;
  }

  return procesarHtml(html, false, false, tamanoBase);
}

/**
 * Convierte un párrafo HTML en un Paragraph de docx respetando el formato.
 */
function parrafoCuerpoHtml(htmlParrafo) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { line: INTERLINEADO, lineRule: 'exact', after: 120 },
    children: htmlATextRuns(htmlParrafo),
  });
}

function parrafoTituloCapitulo(texto) {
  return new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { line: INTERLINEADO, lineRule: 'exact', after: 240 },
    children: [new TextRun({ text: texto, font: FUENTE, size: TAMANO_TITULO_CAP, bold: true, color: COLOR_NEGRO })],
  });
}

function parrafoFecha(texto) {
  return new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { line: INTERLINEADO, lineRule: 'exact', after: 200 },
    children: [new TextRun({ text: texto, font: FUENTE, size: 20, italics: true, color: COLOR_NEGRO })],
  });
}

/**
 * Divide el texto_final (HTML o texto plano) en párrafos.
 * Maneja tanto el formato antiguo (texto plano con \n\n) como el nuevo (HTML con <p>).
 */
function dividirEnParrafos(textoFinal) {
  if (!textoFinal) return [];

  if (/<p[\s>]/i.test(textoFinal)) {
    // Formato nuevo: extraer contenido de cada <p>
    const matches = [...textoFinal.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
    return matches.map((m) => m[1].trim()).filter(Boolean);
  }

  // Formato antiguo: texto plano separado por \n\n
  return textoFinal.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
}

export async function generarWordLibro({ capitulos, config }) {
  const estilos = config.config_estilos || {};
  const MARGENES = estilos.margenes || { top: 1440, bottom: 1440, left: 1080, right: 1080 };

  const children = [];
  let bookmarkId = 1;

  // ── Portada ──────────────────────────────────────────────
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 4000, after: 400, line: INTERLINEADO, lineRule: 'exact' },
    children: [new TextRun({ text: config.titulo_libro || 'Prédicas', font: FUENTE, size: TAMANO_TITULO_LIBRO, bold: true, color: COLOR_NEGRO })],
  }));

  if (config.subtitulo) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240, line: INTERLINEADO, lineRule: 'exact' },
      children: [new TextRun({ text: config.subtitulo, font: FUENTE, size: TAMANO_SUBTITULO, italics: true, color: COLOR_NEGRO })],
    }));
  }

  if (config.autor) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 2000, line: INTERLINEADO, lineRule: 'exact' },
      children: [new TextRun({ text: config.autor, font: FUENTE, size: TAMANO_CUERPO, color: COLOR_NEGRO })],
    }));
  }

  children.push(new Paragraph({ children: [new PageBreak()] }));

  // ── Índice con hipervínculos internos ────────────────────
  children.push(new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { after: 400, line: INTERLINEADO, lineRule: 'exact' },
    children: [new TextRun({ text: 'Índice', font: FUENTE, size: TAMANO_TITULO_CAP, bold: true, color: COLOR_NEGRO })],
  }));

  capitulos.forEach((cap, i) => {
    const anchorId = `capitulo${i + 1}`;
    children.push(new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { after: 100, line: INTERLINEADO, lineRule: 'exact' },
      children: [
        new InternalHyperlink({
          anchor: anchorId,
          children: [new TextRun({ text: `Capítulo ${i + 1}: ${cap.titulo}`, font: FUENTE, size: TAMANO_CUERPO, color: '0000EE', underline: { type: 'single', color: '0000EE' } })],
        }),
        new TextRun({ text: `  ${formatearFecha(cap.fecha_sermon)}`, font: FUENTE, size: 20, color: COLOR_NEGRO }),
      ],
    }));
  });

  children.push(new Paragraph({ children: [new PageBreak()] }));

  // ── Capítulos ─────────────────────────────────────────────
  capitulos.forEach((cap, i) => {
    const anchorId = `capitulo${i + 1}`;

    children.push(new Paragraph({
      spacing: { after: 0 },
      children: [
        new BookmarkStart({ id: bookmarkId, name: anchorId }),
        new BookmarkEnd({ id: bookmarkId }),
      ],
    }));
    bookmarkId++;

    children.push(parrafoTituloCapitulo(`Capítulo ${i + 1}: ${cap.titulo}`));
    children.push(parrafoFecha(formatearFecha(cap.fecha_sermon)));

    // Parsear párrafos respetando formato HTML (negrilla, cursiva, tamaño)
    const parrafos = dividirEnParrafos(cap.texto_final);
    for (const parrafo of parrafos) {
      children.push(parrafoCuerpoHtml(parrafo));
    }

    if (i < capitulos.length - 1) {
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }
  });

  // ── Pie de página ─────────────────────────────────────────
  const footer = new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { line: INTERLINEADO, lineRule: 'exact' },
      children: [new TextRun({ children: [PageNumber.CURRENT], font: FUENTE, size: 18, color: COLOR_NEGRO })],
    })],
  });

  const doc = new Document({
    sections: [{
      properties: { page: { margin: MARGENES } },
      footers: { default: footer },
      children,
    }],
  });

  return Packer.toBuffer(doc);
}

function formatearFecha(fecha) {
  if (!fecha) return '';
  const d = new Date(fecha + 'T00:00:00');
  return d.toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });
}