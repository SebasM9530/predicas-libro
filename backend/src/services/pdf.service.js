import puppeteer from 'puppeteer';
import { generarHtmlLibro } from './plantillaLibro.service.js';

let browserInstance = null;

/**
 * Reutiliza una instancia del navegador headless entre llamadas, pero
 * la relanza si se desconectó (evita PDFs corruptos/vacíos tras un crash).
 */
async function obtenerBrowser() {
  if (!browserInstance || !browserInstance.isConnected()) {
    browserInstance = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }
  return browserInstance;
}

const FOOTER_TEMPLATE = `
<div style="width:100%; font-size:9pt; font-family:'Times New Roman',Times,serif; color:#000000; text-align:center; padding-top:4px;">
  <span class="pageNumber"></span> / <span class="totalPages"></span>
</div>
`;

/**
 * Genera el PDF del libro a partir de los capítulos y configuración.
 * Incluye numeración de páginas obligatoria (pie de página).
 *
 * @param {{ capitulos: Array, config: object }} datos
 * @returns {Promise<Buffer>}
 */
export async function generarPdfLibro({ capitulos, config }) {
  const html = generarHtmlLibro({ capitulos, config });
  const estilos = config.config_estilos || {};
  const margenes = estilos.margenes || {
    top: '2cm',
    bottom: '2cm',
    left: '2.5cm',
    right: '2cm',
  };

  const browser = await obtenerBrowser();
  const page = await browser.newPage();

  try {
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfUint8Array = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: FOOTER_TEMPLATE,
      margin: {
        top: '2.54cm',
        bottom: '2.54cm',
        left: '1.91cm',
        right: '1.91cm',
      },
    });

    return Buffer.from(pdfUint8Array);
  } finally {
    await page.close();
  }
}