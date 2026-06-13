import puppeteer from 'puppeteer';
import { generarHtmlLibro } from './plantillaLibro.service.js';

let browserPromise = null;

/**
 * Reutiliza una única instancia del navegador headless entre llamadas,
 * para evitar el costo de arrancar Chromium en cada descarga
 * (importante en el plan gratuito de Render, con recursos limitados).
 */
function obtenerBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }
  return browserPromise;
}

/**
 * Genera el PDF del libro a partir de los capítulos y configuración.
 * @param {{ capitulos: Array, config: object }} datos
 * @returns {Promise<Buffer>}
 */
export async function generarPdfLibro({ capitulos, config }) {
  const html = generarHtmlLibro({ capitulos, config });

  const browser = await obtenerBrowser();
  const page = await browser.newPage();

  try {
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
    });

    return pdfBuffer;
  } finally {
    await page.close();
  }
}
