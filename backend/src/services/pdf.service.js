import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { generarHtmlLibro } from './plantillaLibro.service.js';

let browserInstance = null;

/**
 * Usa @sparticuz/chromium: una versión de Chromium empaquetada como
 * dependencia npm, diseñada para entornos restringidos (Render,
 * Lambda, etc.) que no dependen de una descarga separada de Chrome
 * durante el build (la cual no persiste de forma confiable en runtime
 * en el plan gratuito de Render).
 */
async function obtenerBrowser() {
  if (!browserInstance || !browserInstance.isConnected()) {
    browserInstance = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
  }
  return browserInstance;
}

// Pie de página: SOLO número de página actual (sin total), para
// evitar que se rompa con documentos largos de múltiples capítulos.
// Puppeteer expone la clase CSS "pageNumber" automáticamente cuando
// displayHeaderFooter está activo; "totalPages" se omite a propósito.
const FOOTER_TEMPLATE = `
<div style="width:100%; font-size:9pt; font-family:'Times New Roman',Times,serif; color:#000000; text-align:center; padding-top:4px;">
  <span class="pageNumber"></span>
</div>
`;

/**
 * Genera el PDF del libro a partir de los capítulos y configuración.
 * Incluye numeración de página actual (sin total) en el pie de página.
 *
 * @param {{ capitulos: Array, config: object }} datos
 * @returns {Promise<Buffer>}
 */
export async function generarPdfLibro({ capitulos, config }) {
  const html = generarHtmlLibro({ capitulos, config });

  const browser = await obtenerBrowser();
  const page = await browser.newPage();

  try {
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfUint8Array = await page.pdf({
      format: 'A4',
      printBackground: true,
      // Márgenes y numeración ya van definidos en el CSS @page de la
      // plantilla HTML (más confiable que el header/footer de Puppeteer)
    });

    return Buffer.from(pdfUint8Array);
  } finally {
    await page.close();
  }
}