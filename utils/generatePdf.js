  const puppeteer = require("puppeteer");

  async function generatePdf(html) {
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
      });

      await page.close();

      return pdf;
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
