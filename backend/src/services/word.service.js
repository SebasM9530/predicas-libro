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

function parsearHTMLaRuns(html, tamanoBase) {
  const runs = [];
  if (!html) return runs;

  let htmlLimpio = html
    .replace(/<mark[^>]*>/gi, '')
    .replace(/<\/mark>/gi, '')
    .replace(/<span[^>]*data-seccion-id[^>]*>([\s\S]*?)<\/span>/gi, '$1');

  const pila = [{ bold: false, italic: false, tamano: tamanoBase }];
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
        const estadoActual = pila[pila.length - 1];
        const nuevoEstado = { ...estadoActual };

        if (tag === 'strong' || tag === 'b') {
          nuevoEstado.bold = true;
        } else if (tag === 'em' || tag === 'i') {
          nuevoEstado.italic = true;
        } else if (tag === 'span') {
          const sizeMatch = token.match(/font-size:\s*([\d.]+)px/i);
          if (sizeMatch) {
            const px = parseFloat(sizeMatch[1]);
            nuevoEstado.tamano = Math.round((px / 96) * 72 * 2);
          }
        }

        pila.push(nuevoEstado);
      }
    } else {
      const estado = pila[pila.length - 1];
      const texto = token
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ');

      if (texto) {
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

  return runs;
}

function parrafoCuerpoHtml(htmlParrafo, tamanoBase = TAMANO_CUERPO) {
  let runs;

  if (!htmlParrafo) {
    runs = [new TextRun({ text: '', font: FUENTE, size: tamanoBase, color: COLOR_NEGRO })];
  } else if (!/<[a-z]/i.test(htmlParrafo)) {
    const texto = htmlParrafo
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
    runs = [new TextRun({ text: texto, font: FUENTE, size: tamanoBase, color: COLOR_NEGRO })];
  } else {
    runs = parsearHTMLaRuns(htmlParrafo, tamanoBase);
    if (runs.length === 0) {
      runs = [new TextRun({ text: '', font: FUENTE, size: tamanoBase, color: COLOR_NEGRO })];
    }
  }

  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { line: INTERLINEADO, lineRule: 'exact', after: 120 },
    children: runs,
  });
}

function dividirEnParrafos(textoFinal) {
  if (!textoFinal) return [];

  if (/<p[\s>]/i.test(textoFinal)) {
    const matches = [...textoFinal.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
    return matches.map((m) => m[1].trim()).filter(Boolean);
  }

  return textoFinal.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
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

export async function generarWordLibro({ capitulos, config }) {
  const estilos = config.config_estilos || {};
  const MARGENES = estilos.margenes || { top: 1440, bottom: 1440, left: 1080, right: 1080 };

  const children = [];
  let bookmarkId = 1;

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

    const parrafos = dividirEnParrafos(cap.texto_final);
    for (const parrafo of parrafos) {
      children.push(parrafoCuerpoHtml(parrafo));
    }

    if (i < capitulos.length - 1) {
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }
  });

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