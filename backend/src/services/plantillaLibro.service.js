/**
 * Genera el HTML completo del libro con las especificaciones definitivas
 * (Times New Roman, interlineado 1.15, justificado, márgenes moderados,
 * índice con anclas para hipervínculos, y numeración de página vía
 * contador CSS nativo @page — más confiable que el header/footer de
 * Puppeteer, que @sparticuz/chromium no soporta correctamente).
 */
export function generarHtmlLibro({ capitulos, config }) {
  const estilos = config.config_estilos || {};

  const fuenteTitulo = estilos.fuente_titulo || "'Times New Roman', Times, serif";
  const fuenteCuerpo = estilos.fuente_cuerpo || "'Times New Roman', Times, serif";
  const tamanoTituloCapitulo = estilos.tamano_titulo_capitulo || '16pt';
  const tamanoCuerpo = estilos.tamano_cuerpo || '12pt';
  const colorTitulo = estilos.color_titulo || '#000000';
  const alineacionCuerpo = estilos.alineacion_cuerpo || 'justify';

  const margenes = estilos.margenes || {
    top: '2.54cm',
    bottom: '2.54cm',
    left: '1.91cm',
    right: '1.91cm',
  };

  // Generar IDs únicos para cada capítulo (para los hipervínculos del índice)
  const capitulosConId = capitulos.map((cap, i) => ({
    ...cap,
    anchorId: `capitulo-${i + 1}`,
    numeroCapitulo: i + 1,
  }));

  const indiceHtml = capitulosConId
    .map(
      (cap) => `
      <li>
        <a href="#${cap.anchorId}">
          Capítulo ${cap.numeroCapitulo}: ${escapeHtml(cap.titulo)}
        </a>
        <span class="indice-fecha">${formatearFecha(cap.fecha_sermon)}</span>
      </li>`
    )
    .join('\n');

  const capitulosHtml = capitulosConId
    .map(
      (cap) => `
      <section class="capitulo" id="${cap.anchorId}">
        <h2>${escapeHtml(cap.titulo)}</h2>
        <p class="fecha-sermon">${formatearFecha(cap.fecha_sermon)}</p>
        ${parrafosHtml(cap.texto_final)}
      </section>`
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<style>
  /* ── Numeración de página vía contador CSS nativo ──
     Más confiable que el header/footer de Puppeteer, que
     @sparticuz/chromium (versión "lite" de Chromium) no
     siempre soporta correctamente. Solo número actual,
     sin total (evita el bug de TOTAL_PAGES roto con
     documentos largos de múltiples capítulos). */
  @page {
    margin-top: ${margenes.top};
    margin-bottom: ${margenes.bottom};
    margin-left: ${margenes.left};
    margin-right: ${margenes.right};
  }

  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  body {
    font-family: ${fuenteCuerpo};
    font-size: ${tamanoCuerpo};
    color: #000000;
    line-height: 1.15;
    text-align: justify;
  }

  /* ── Portada ── */
  .portada {
    height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    page-break-after: always;
  }

  .portada h1 {
    font-family: ${fuenteTitulo};
    font-size: 24pt;
    font-weight: bold;
    color: ${colorTitulo};
    margin-bottom: 16pt;
    line-height: 1.15;
  }

  .portada .subtitulo {
    font-size: 14pt;
    color: #000000;
    margin-bottom: 20pt;
    line-height: 1.15;
  }

  .portada .autor {
    font-size: 12pt;
    color: #000000;
    margin-top: 40pt;
    line-height: 1.15;
  }

  /* ── Índice ── */
  .indice {
    page-break-after: always;
  }

  .indice h2 {
    font-family: ${fuenteTitulo};
    font-size: 16pt;
    font-weight: bold;
    color: ${colorTitulo};
    margin-bottom: 16pt;
    line-height: 1.15;
  }

  .indice ul {
    list-style: none;
    padding: 0;
  }

  .indice li {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 6pt;
    font-size: 12pt;
    line-height: 1.15;
  }

  .indice a {
    color: #000000;
    text-decoration: none;
  }

  .indice a:hover {
    text-decoration: underline;
  }

  .indice li::after {
    content: '';
    flex: 1;
    border-bottom: 1px dotted #000000;
    margin: 0 6pt;
    position: relative;
    top: -3pt;
  }

  .indice-fecha {
    font-size: 10pt;
    color: #000000;
    white-space: nowrap;
  }

  /* ── Capítulos ── */
  .capitulo {
    page-break-before: always;
  }

  .capitulo h2 {
    font-family: ${fuenteTitulo};
    font-size: ${tamanoTituloCapitulo};
    font-weight: bold;
    color: ${colorTitulo};
    margin-bottom: 4pt;
    line-height: 1.15;
  }

  .fecha-sermon {
    font-size: 10pt;
    color: #000000;
    margin-bottom: 14pt;
    font-style: italic;
    line-height: 1.15;
  }

  .capitulo p {
    font-size: ${tamanoCuerpo};
    text-align: ${alineacionCuerpo};
    margin-bottom: 10pt;
    line-height: 1.15;
    color: #000000;
  }
</style>
</head>
<body>

  <div class="portada">
    <h1>${escapeHtml(config.titulo_libro || 'Prédicas')}</h1>
    ${config.subtitulo ? `<p class="subtitulo">${escapeHtml(config.subtitulo)}</p>` : ''}
    ${config.autor ? `<p class="autor">${escapeHtml(config.autor)}</p>` : ''}
  </div>

  <div class="indice">
    <h2>Índice</h2>
    <ul>
      ${indiceHtml}
    </ul>
  </div>

  ${capitulosHtml}

</body>
</html>`;
}

function parrafosHtml(texto) {
  if (!texto) return '';

  // Formato nuevo: el texto ya es HTML con <p>, <strong>, <em>, <span>
  // Solo limpiar las marcas visuales de sugerencias/secciones
  if (/<p[\s>]/i.test(texto)) {
    return texto
      .replace(/<mark[^>]*>([\s\S]*?)<\/mark>/gi, '$1')
      .replace(/<span[^>]*data-seccion-id[^>]*>([\s\S]*?)<\/span>/gi, '$1');
  }

  // Formato antiguo: texto plano → convertir a párrafos HTML
  return texto
    .split(/\n\n+/)
    .filter((p) => p.trim())
    .map((p) => `<p>${escapeHtml(p.trim())}</p>`)
    .join('\n');
}

function escapeHtml(texto) {
  if (!texto) return '';
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatearFecha(fecha) {
  if (!fecha) return '';
  const d = new Date(fecha + 'T00:00:00');
  return d.toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });
}