const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

async function generatePDF(html, filename) {
  console.log("Launching browser...");

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });

  // const browser = await puppeteer.launch({
  //   headless: true,

  //   args: [
  //     "--no-sandbox",
  //     "--disable-setuid-sandbox",
  //     "--allow-file-access-from-files",
  //   ],
  // });

  console.log("Browser launched");

  const page = await browser.newPage();

  console.log("Page created");

  console.log("Setting content...");

  await page.setContent(html, {
    waitUntil: "load",
    timeout: 120000,
  });

  await page.waitForSelector("img");

  await page.evaluate(async () => {
    const imgs = Array.from(document.images);

    await Promise.all(
      imgs.map((img) => {
        if (img.complete) return;

        return new Promise((resolve) => {
          img.onload = resolve;
          img.onerror = resolve;
        });
      }),
    );
  });

  console.log("Content loaded");

  console.log("Taking screenshot...");

  await page.screenshot({
    path: "debug.png",
    fullPage: true,
  });

  console.log("Screenshot done");

  console.log("Generating PDF...");

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

  console.log("PDF done");

  await browser.close();

  return filePath;
}

module.exports = {
  generatePDF,
};
