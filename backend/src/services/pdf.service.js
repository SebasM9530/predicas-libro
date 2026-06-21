import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { generarHtmlLibro } from './plantillaLibro.service.js';

let browserInstance = null;

/**
 * Usa @sparticuz/chromium: una versión de Chromium empaquetada como
 * dependencia npm, diseñada para entornos restringidos (Render,
 * Lambda, etc.) que no dependen de una descarga separada de Chrome
 * durante el build.
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

/**
 * Genera el PDF base (sin numeración) con Puppeteer a partir del HTML.
 */
async function generarPdfBase(html) {
  const browser = await obtenerBrowser();
  const page = await browser.newPage();

  try {
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfUint8Array = await page.pdf({
      format: 'A4',
      printBackground: true,
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

/**
 * Dibuja el número de página (solo el actual, sin total) en el pie de
 * cada página del PDF ya generado, usando pdf-lib. Esto NO depende de
 * que Chromium soporte @page/header-footer — funciona dibujando texto
 * directamente sobre el PDF como una operación posterior, confiable
 * en cualquier entorno (incluyendo @sparticuz/chromium).
 *
 * @param {Buffer} pdfBuffer
 * @returns {Promise<Buffer>}
 */
async function agregarNumeracionPaginas(pdfBuffer) {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const fuente = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const paginas = pdfDoc.getPages();

  paginas.forEach((pagina, index) => {
    const { width } = pagina.getSize();
    const numero = String(index + 1);
    const tamanoFuente = 9;
    const anchoTexto = fuente.widthOfTextAtSize(numero, tamanoFuente);

    pagina.drawText(numero, {
      x: width / 2 - anchoTexto / 2,
      y: 28, // ~1cm desde el borde inferior, dentro del margen de 2.54cm
      size: tamanoFuente,
      font: fuente,
      color: rgb(0, 0, 0),
    });
  });

  const pdfBytesFinal = await pdfDoc.save();
  return Buffer.from(pdfBytesFinal);
}

/**
 * Genera el PDF del libro a partir de los capítulos y configuración,
 * con numeración de página (solo número actual, sin total) dibujada
 * de forma confiable independientemente del soporte de Chromium para
 * paginación CSS avanzada.
 *
 * @param {{ capitulos: Array, config: object }} datos
 * @returns {Promise<Buffer>}
 */
export async function generarPdfLibro({ capitulos, config }) {
  const html = generarHtmlLibro({ capitulos, config });

  const pdfBase = await generarPdfBase(html);
  const pdfConNumeracion = await agregarNumeracionPaginas(pdfBase);

  return pdfConNumeracion;
}