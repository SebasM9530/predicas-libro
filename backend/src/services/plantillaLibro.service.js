/**
 * Genera el HTML completo del libro a partir de los capítulos y la
 * configuración (libro_config.config_estilos).
 *
 * config_estilos puede incluir:
 * {
 *   fuente_titulo: "Georgia, serif",
 *   fuente_cuerpo: "Georgia, serif",
 *   tamano_titulo_capitulo: "24px",
 *   tamano_cuerpo: "12px",
 *   margenes: { top: "2cm", bottom: "2cm", left: "2.5cm", right: "2cm" },
 *   color_titulo: "#1f2937",
 *   alineacion_cuerpo: "justify"
 * }
 *
 * Esta plantilla es una base genérica y profesional; se ajustará cuando
 * el cliente entregue las especificaciones definitivas (portada, fuentes,
 * márgenes exactos, etc.)
 */
export function generarHtmlLibro({ capitulos, config }) {
  const estilos = config.config_estilos || {};

  const fuenteTitulo = estilos.fuente_titulo || "'Georgia', serif";
  const fuenteCuerpo = estilos.fuente_cuerpo || "'Georgia', serif";
  const tamanoTituloCapitulo = estilos.tamano_titulo_capitulo || '22px';
  const tamanoCuerpo = estilos.tamano_cuerpo || '12px';
  const colorTitulo = estilos.color_titulo || '#1f2937';
  const alineacionCuerpo = estilos.alineacion_cuerpo || 'justify';

  const margenes = estilos.margenes || {
    top: '2cm',
    bottom: '2cm',
    left: '2.5cm',
    right: '2cm',
  };

  const capitulosHtml = capitulos
    .map(
      (cap) => `
      <section class="capitulo">
        <h2>${escapeHtml(cap.titulo)}</h2>
        <p class="fecha-sermon">${formatearFecha(cap.fecha_sermon)}</p>
        ${parrafosHtml(cap.texto_final)}
      </section>
    `
    )
    .join('\n');

  const indiceHtml = capitulos
    .map((cap, i) => `<li>Capítulo ${i + 1}: ${escapeHtml(cap.titulo)}</li>`)
    .join('\n');

  return `
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<style>
  @page {
    margin-top: ${margenes.top};
    margin-bottom: ${margenes.bottom};
    margin-left: ${margenes.left};
    margin-right: ${margenes.right};
  }

  body {
    font-family: ${fuenteCuerpo};
    font-size: ${tamanoCuerpo};
    color: #1f2937;
    line-height: 1.6;
  }

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
    font-size: 36px;
    color: ${colorTitulo};
    margin-bottom: 8px;
  }

  .portada .subtitulo {
    font-size: 16px;
    color: #6b7280;
    margin-bottom: 24px;
  }

  .portada .autor {
    font-size: 14px;
    color: #374151;
    margin-top: 40px;
  }

  .indice {
    page-break-after: always;
  }

  .indice h2 {
    font-family: ${fuenteTitulo};
  }

  .indice ul {
    list-style: none;
    padding: 0;
    line-height: 2;
  }

  .capitulo {
    page-break-before: always;
  }

  .capitulo h2 {
    font-family: ${fuenteTitulo};
    font-size: ${tamanoTituloCapitulo};
    color: ${colorTitulo};
    margin-bottom: 4px;
  }

  .fecha-sermon {
    font-size: 11px;
    color: #9ca3af;
    margin-bottom: 16px;
    font-style: italic;
  }

  .capitulo p {
    text-align: ${alineacionCuerpo};
    margin-bottom: 12px;
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
</html>
`;
}

function parrafosHtml(texto) {
  if (!texto) return '';
  return texto
    .split(/\n\n+/)
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
