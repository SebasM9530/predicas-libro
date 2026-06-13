import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  PageBreak,
} from 'docx';

/**
 * Genera el documento Word del libro a partir de los capítulos y configuración.
 *
 * config.config_estilos puede incluir:
 * {
 *   fuente_cuerpo: "Georgia",
 *   tamano_cuerpo: 24,        // en half-points (24 = 12pt)
 *   tamano_titulo_capitulo: 32, // half-points (32 = 16pt)
 *   margenes: { top: 1440, bottom: 1440, left: 1440, right: 1440 } // en twips (1440 = 1 pulgada)
 * }
 *
 * @param {{ capitulos: Array, config: object }} datos
 * @returns {Promise<Buffer>}
 */
export async function generarWordLibro({ capitulos, config }) {
  const estilos = config.config_estilos || {};

  const fuenteCuerpo = estilos.fuente_cuerpo || 'Georgia';
  const tamanoCuerpo = estilos.tamano_cuerpo || 24; // 12pt
  const tamanoTituloCapitulo = estilos.tamano_titulo_capitulo || 32; // 16pt
  const tamanoTituloLibro = estilos.tamano_titulo_libro || 56; // 28pt

  const margenes = estilos.margenes || {
    top: 1440,
    bottom: 1440,
    left: 1440,
    right: 1440,
  };

  const children = [];

  // ---------- Portada ----------
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 2000, after: 200 },
      children: [
        new TextRun({
          text: config.titulo_libro || 'Prédicas',
          bold: true,
          size: tamanoTituloLibro,
          font: fuenteCuerpo,
        }),
      ],
    })
  );

  if (config.subtitulo) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
        children: [
          new TextRun({
            text: config.subtitulo,
            italics: true,
            size: 28,
            font: fuenteCuerpo,
            color: '6B7280',
          }),
        ],
      })
    );
  }

  if (config.autor) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 1000 },
        children: [
          new TextRun({
            text: config.autor,
            size: 24,
            font: fuenteCuerpo,
          }),
        ],
      })
    );
  }

  children.push(new Paragraph({ children: [new PageBreak()] }));

  // ---------- Índice ----------
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: 'Índice', font: fuenteCuerpo })],
    })
  );

  capitulos.forEach((cap, i) => {
    children.push(
      new Paragraph({
        spacing: { after: 100 },
        children: [
          new TextRun({
            text: `Capítulo ${i + 1}: ${cap.titulo}`,
            size: tamanoCuerpo,
            font: fuenteCuerpo,
          }),
        ],
      })
    );
  });

  children.push(new Paragraph({ children: [new PageBreak()] }));

  // ---------- Capítulos ----------
  capitulos.forEach((cap, i) => {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { after: 100 },
        children: [
          new TextRun({
            text: `Capítulo ${i + 1}: ${cap.titulo}`,
            size: tamanoTituloCapitulo,
            bold: true,
            font: fuenteCuerpo,
          }),
        ],
      })
    );

    children.push(
      new Paragraph({
        spacing: { after: 300 },
        children: [
          new TextRun({
            text: formatearFecha(cap.fecha_sermon),
            italics: true,
            size: 18,
            color: '9CA3AF',
            font: fuenteCuerpo,
          }),
        ],
      })
    );

    const parrafos = (cap.texto_final || '').split(/\n\n+/);
    for (const parrafo of parrafos) {
      if (!parrafo.trim()) continue;
      children.push(
        new Paragraph({
          alignment: AlignmentType.JUSTIFIED,
          spacing: { after: 200 },
          children: [
            new TextRun({
              text: parrafo.trim(),
              size: tamanoCuerpo,
              font: fuenteCuerpo,
            }),
          ],
        })
      );
    }

    if (i < capitulos.length - 1) {
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }
  });

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: margenes,
          },
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
