const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const { v4: uuidv4 } = require("uuid");

module.exports = async ({ studentName, courseTitle }) => {
  const certCode = uuidv4().slice(0, 12).toUpperCase();

  const templatePath = path.join(__dirname, "../views/partials/certificate.html");
  let html = fs.readFileSync(templatePath, "utf8");

  html = html
    .replace("{{STUDENT_NAME}}", studentName)
    .replace("{{COURSE_TITLE}}", courseTitle)
    .replace("{{DATE}}", new Date().toDateString())
    .replace("{{CERT_CODE}}", certCode);

 const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

  const page = await browser.newPage();

  await page.setContent(html, { waitUntil: "networkidle0" });

  // const outputPath = path.join(__dirname, `../tmp/${certCode}.pdf`);
  // await page.pdf({
  //   path: outputPath,
  //   format: "A4",
  //   landscape: true, // ✅ correct spelling
  //   printBackground: true,
  // });


  // ---------------------------------------------------------------------------------
  // const outputPath = path.join(__dirname, `../tmp/${certCode}.png`);

  // await page.setViewport({
  //   width: 1754,  // A4 landscape width in pixels (high quality)
  //   height: 1240, // A4 landscape height in pixels
  // });

  // await page.screenshot({
  //   path: outputPath,
  //   fullPage: true,
  // });

  // const outputPath = path.join(__dirname, `../tmp/${certCode}.pdf`);
  // await page.pdf({
  //   path: outputPath,
  //   format: "A4",
  //   landscape: true,
  //   printBackground: true,
  //   margin: { top: 0, right: 0, bottom: 0, left: 0 }
  // });

  const outputPath = path.join(__dirname, `../tmp/${certCode}.png`);

  // Set the viewport to match A4 landscape size at high DPI
  await page.setViewport({
    width: 2480,   // A4 landscape width at 300 DPI
    height: 1754,  // A4 landscape height at 300 DPI
    deviceScaleFactor: 2, // Higher scale = sharper image
  });

  await page.screenshot({
    path: outputPath,
    fullPage: true,
  });

  await browser.close();

  return { outputPath, certCode };
};
