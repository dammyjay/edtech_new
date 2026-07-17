const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

async function generatePDF(html, filename) {
  const browser = await puppeteer.launch({
    headless: true,
  });

  const page = await browser.newPage();

  page.on("requestfailed", (request) => {
    console.log("FAILED:", request.url(), request.failure()?.errorText);
  });

  page.on("response", (response) => {
    if (response.status() >= 400) {
      console.log("ERROR:", response.status(), response.url());
    }
  });

  // await page.setContent(html, {
  //   waitUntil: "networkidle0",
  // });

  // await page.setContent(html, {
  //   waitUntil: "domcontentloaded",
  //   timeout: 120000,
  // });

  await page.setContent(html, {
    waitUntil: "load",
    timeout: 120000,
  });

  await page.evaluate(async () => {
    const images = Array.from(document.images);

    await Promise.all(
      images.map((img) => {
        if (img.complete && img.naturalWidth !== 0) {
          return Promise.resolve();
        }

        return new Promise((resolve) => {
          img.onload = resolve;
          img.onerror = resolve;
        });
      }),
    );
  });

  await new Promise((resolve) => setTimeout(resolve, 2000));

  await page.screenshot({
    path: "debug.png",
    fullPage: true,
  });

  const reportsDir = path.join(__dirname, "../reports");

  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir);
  }

  const filePath = path.join(reportsDir, filename);

  await page.pdf({
    path: filePath,
    format: "A4",
    printBackground: true,
    margin: {
      top: "20px",
      bottom: "20px",
      left: "20px",
      right: "20px",
    },
  });

  await browser.close();

  return filePath;
}

module.exports = {
  generatePDF,
};
