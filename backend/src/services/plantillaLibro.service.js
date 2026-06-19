/**
 * Genera el HTML completo del libro con las especificaciones definitivas:
 * - Fuente: Times New Roman
 * - Interlineado: 1.15
 * - Justificado
 * - Color texto: negro
 * - Márgenes moderados: Sup/Inf 2.54cm, Izq/Der 1.91cm
 * - Título capítulo: 16pt
 * - Subtítulo: 14pt
 * - Texto cuerpo: 12pt
 * - Índice con hipervínculos a cada capítulo
 * - Numeración de páginas en pie de página
 */
export function generarHtmlLibro({ capitulos, config }) {
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
  /* ── Márgenes moderados: Sup/Inf 2.54cm, Izq/Der 1.91cm ── */
  @page {
    margin-top: 2.54cm;
    margin-bottom: 2.54cm;
    margin-left: 1.91cm;
    margin-right: 1.91cm;
  }

  /* ── Fuente y tipografía base ── */
  @import url('https://fonts.cdnfonts.com/css/times-new-roman');

  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  body {
    font-family: 'Times New Roman', Times, serif;
    font-size: 12pt;
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
    font-family: 'Times New Roman', Times, serif;
    font-size: 24pt;
    font-weight: bold;
    color: #000000;
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
    font-family: 'Times New Roman', Times, serif;
    font-size: 16pt;
    font-weight: bold;
    color: #000000;
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

  /* Línea punteada entre título y fecha en el índice */
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
    font-family: 'Times New Roman', Times, serif;
    font-size: 16pt;
    font-weight: bold;
    color: #000000;
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
    font-size: 12pt;
    text-align: justify;
    margin-bottom: 10pt;
    line-height: 1.15;
    color: #000000;
  }

  /* ── Numeración de páginas (Puppeteer la inyecta en el footer) ── */
</style>
</head>
<body>

  <!-- Portada -->
  <div class="portada">
    <h1>${escapeHtml(config.titulo_libro || 'Prédicas')}</h1>
    ${config.subtitulo ? `<p class="subtitulo">${escapeHtml(config.subtitulo)}</p>` : ''}
    ${config.autor ? `<p class="autor">${escapeHtml(config.autor)}</p>` : ''}
  </div>

  <!-- Índice con hipervínculos -->
  <div class="indice">
    <h2>Índice</h2>
    <ul>
      ${indiceHtml}
    </ul>
  </div>

  <!-- Capítulos -->
  ${capitulosHtml}

</body>
</html>`;
}

function parrafosHtml(texto) {
  if (!texto) return '';
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