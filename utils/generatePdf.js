  const puppeteer = require("puppeteer");

  // options.margin: optional {top, bottom, left, right} (CSS length strings,
  // e.g. "0.6in") passed straight to Puppeteer's page.pdf(). Defaults to no
  // margin — the existing ~14 callers (receipts, certificates, invoices)
  // were designed around edge-to-edge letterhead banners, so this stays
  // opt-in per caller rather than changing everyone's output.
  async function generatePdf(html, options = {}) {
    let browser;

    try {
      browser = await puppeteer.launch({
        headless: true,

        executablePath:
          process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath(),

        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--disable-gpu",
          "--window-size=1920x1080",
          "--no-zygote",
        ],

        timeout: 0,
      });

      const page = await browser.newPage();

      await page.setViewport({
        width: 1920,
        height: 1080,
      });

      await page.setContent(html, {
        waitUntil: "networkidle0",
        timeout: 0,
      });

      const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
        preferCSSPageSize: true,
        margin: options.margin || undefined,
      });

      await page.close();

      // Puppeteer returns a plain Uint8Array, not a Node Buffer — calling
      // .toString('base64') on a raw Uint8Array silently falls back to
      // Array.prototype.toString() (a comma-joined list of decimal byte
      // values) instead of throwing, corrupting anything that later
      // base64-encodes it. Wrapping here fixes it for every caller at the
      // source rather than requiring each one to remember to do it.
      return Buffer.from(pdf);
    } catch (error) {
      console.error("Generate PDF Error:", error);
      throw error;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  module.exports = generatePdf;
