import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  PageBreak,
  Footer,
  PageNumber,
  ExternalHyperlink,
  InternalHyperlink,
  BookmarkStart,
  BookmarkEnd,
  HeadingLevel,
  LevelFormat,
} from 'docx';

/**
 * Genera el documento Word con las especificaciones definitivas:
 * - Fuente: Times New Roman
 * - Interlineado: 1.15 (276 twips)
 * - Justificado
 * - Color texto: negro
 * - Márgenes moderados: Sup/Inf 1440 twips (2.54cm), Izq/Der 1080 twips (1.91cm)
 * - Título capítulo: 16pt (32 half-points)
 * - Subtítulo índice: 14pt (28 half-points)
 * - Texto cuerpo: 12pt (24 half-points)
 * - Índice con hipervínculos internos a cada capítulo
 * - Numeración de páginas en pie de página
 */
export async function generarWordLibro({ capitulos, config }) {

  // Conversiones:
  // 1 pt = 20 twips | 1 cm = 567 twips
  // Márgenes moderados: 2.54cm = 1440 twips | 1.91cm = 1080 twips
  // Interlineado 1.15: en docx se expresa en twips = 1.15 * 240 = 276

  const FUENTE = 'Times New Roman';
  const TAMANO_CUERPO = 24;        // 12pt en half-points
  const TAMANO_SUBTITULO = 28;     // 14pt
  const TAMANO_TITULO_CAP = 32;    // 16pt
  const TAMANO_TITULO_LIBRO = 48;  // 24pt
  const INTERLINEADO = 276;        // 1.15 en twips (1.15 × 240)
  const COLOR_NEGRO = '000000';

  const MARGENES = {
    top: 1440,    // 2.54 cm
    bottom: 1440, // 2.54 cm
    left: 1080,   // 1.91 cm
    right: 1080,  // 1.91 cm
  };

  // Helper: párrafo de cuerpo con todas las especificaciones
  function parrafoCuerpo(texto) {
    return new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      spacing: {
        line: INTERLINEADO,
        lineRule: 'exact',
        after: 120, // 6pt después del párrafo
      },
      children: [
        new TextRun({
          text: texto,
          font: FUENTE,
          size: TAMANO_CUERPO,
          color: COLOR_NEGRO,
        }),
      ],
    });
  }

  // Helper: párrafo de título de capítulo
  function parrafoTituloCapitulo(texto) {
    return new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: {
        line: INTERLINEADO,
        lineRule: 'exact',
        after: 240,
      },
      children: [
        new TextRun({
          text: texto,
          font: FUENTE,
          size: TAMANO_TITULO_CAP,
          bold: true,
          color: COLOR_NEGRO,
        }),
      ],
    });
  }

  // Helper: párrafo de fecha
  function parrafoFecha(texto) {
    return new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: {
        line: INTERLINEADO,
        lineRule: 'exact',
        after: 200,
      },
      children: [
        new TextRun({
          text: texto,
          font: FUENTE,
          size: 20, // 10pt
          italics: true,
          color: COLOR_NEGRO,
        }),
      ],
    });
  }

  const children = [];
  let bookmarkId = 1;

  // ── Portada ──────────────────────────────────────────────
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 4000, after: 400, line: INTERLINEADO, lineRule: 'exact' },
      children: [
        new TextRun({
          text: config.titulo_libro || 'Prédicas',
          font: FUENTE,
          size: TAMANO_TITULO_LIBRO,
          bold: true,
          color: COLOR_NEGRO,
        }),
      ],
    })
  );

  if (config.subtitulo) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 240, line: INTERLINEADO, lineRule: 'exact' },
        children: [
          new TextRun({
            text: config.subtitulo,
            font: FUENTE,
            size: TAMANO_SUBTITULO,
            italics: true,
            color: COLOR_NEGRO,
          }),
        ],
      })
    );
  }

  if (config.autor) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 2000, line: INTERLINEADO, lineRule: 'exact' },
        children: [
          new TextRun({
            text: config.autor,
            font: FUENTE,
            size: TAMANO_CUERPO,
            color: COLOR_NEGRO,
          }),
        ],
      })
    );
  }

  children.push(new Paragraph({ children: [new PageBreak()] }));

  // ── Índice con hipervínculos internos ────────────────────
  children.push(
    new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { after: 400, line: INTERLINEADO, lineRule: 'exact' },
      children: [
        new TextRun({
          text: 'Índice',
          font: FUENTE,
          size: TAMANO_TITULO_CAP,
          bold: true,
          color: COLOR_NEGRO,
        }),
      ],
    })
  );

  capitulos.forEach((cap, i) => {
    const anchorId = `capitulo${i + 1}`;
    const textoLink = `Capítulo ${i + 1}: ${cap.titulo}`;
    const fecha = formatearFecha(cap.fecha_sermon);

    children.push(
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { after: 100, line: INTERLINEADO, lineRule: 'exact' },
        children: [
          new InternalHyperlink({
            anchor: anchorId,
            children: [
              new TextRun({
                text: textoLink,
                font: FUENTE,
                size: TAMANO_CUERPO,
                color: '0000EE',
                underline: { type: 'single', color: '0000EE' },
              }),
            ],
          }),
          new TextRun({
            text: `  ${fecha}`,
            font: FUENTE,
            size: 20,
            color: COLOR_NEGRO,
          }),
        ],
      })
    );
  });

  children.push(new Paragraph({ children: [new PageBreak()] }));

  // ── Capítulos ─────────────────────────────────────────────
  capitulos.forEach((cap, i) => {
    const anchorId = `capitulo${i + 1}`;

    // Bookmark (ancla del hipervínculo del índice)
    children.push(
      new Paragraph({
        spacing: { after: 0 },
        children: [
          new BookmarkStart({ id: bookmarkId, name: anchorId }),
          new BookmarkEnd({ id: bookmarkId }),
        ],
      })
    );
    bookmarkId++;

    // Título del capítulo
    children.push(parrafoTituloCapitulo(`Capítulo ${i + 1}: ${cap.titulo}`));

    // Fecha
    children.push(parrafoFecha(formatearFecha(cap.fecha_sermon)));

    // Cuerpo del capítulo
    const parrafos = (cap.texto_final || '').split(/\n\n+/);
    for (const parrafo of parrafos) {
      if (!parrafo.trim()) continue;
      children.push(parrafoCuerpo(parrafo.trim()));
    }

    // Salto de página entre capítulos (excepto el último)
    if (i < capitulos.length - 1) {
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }
  });

  // ── Pie de página con numeración ─────────────────────────
  const footer = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { line: INTERLINEADO, lineRule: 'exact' },
        children: [
          new TextRun({
            children: [PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES],
            font: FUENTE,
            size: 18, // 9pt
            color: COLOR_NEGRO,
          }),
        ],
      }),
    ],
  });

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: MARGENES,
          },
        },
        footers: {
          default: footer,
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}

function formatearFecha(fecha) {
  if (!fecha) return '';
  const d = new Date(fecha + 'T00:00:00');
  return d.toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });
}