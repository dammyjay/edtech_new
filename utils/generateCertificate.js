// const fs = require("fs");
// const path = require("path");
// const puppeteer = require("puppeteer");
// const { v4: uuidv4 } = require("uuid");

// module.exports = async ({ studentName, courseTitle }) => {
//   const certCode = uuidv4().slice(0, 12).toUpperCase();

//   const templatePath = path.join(__dirname, "../views/partials/certificate.html");
//   let html = fs.readFileSync(templatePath, "utf8");

//   html = html
//     .replace("{{STUDENT_NAME}}", studentName)
//     .replace("{{COURSE_TITLE}}", courseTitle)
//     .replace("{{DATE}}", new Date().toDateString())
//     .replace("{{CERT_CODE}}", certCode);

//  const browser = await puppeteer.launch({
//   headless: true,
//   args: ["--no-sandbox", "--disable-setuid-sandbox"],
// });

//   const page = await browser.newPage();

//   await page.setContent(html, { waitUntil: "networkidle0" });

//   const outputPath = path.join(__dirname, `../tmp/${certCode}.png`);

//   html = html
//   .replace(/{{\s*STUDENT_NAME\s*}}/g, studentName)
//   .replace(/{{\s*COURSE_TITLE\s*}}/g, courseTitle)
//   .replace(/{{\s*DATE\s*}}/g, new Date().toDateString())
//   .replace(/{{\s*CERT_CODE\s*}}/g, certCode);

//   // Set the viewport to match A4 landscape size at high DPI
//   await page.setViewport({
//     width: 3504,   // A4 landscape width at 300 DPI
//     height: 2480,  // A4 landscape height at 300 DPI
//     deviceScaleFactor: 2, // Higher scale = sharper image
//   });

//   await page.screenshot({
//     path: outputPath,
//     fullPage: true,
//   });

//   await browser.close();

//   return { outputPath, certCode };
// };



const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const { v4: uuidv4 } = require("uuid");

module.exports = async ({ studentName, courseTitle }) => {

  const certCode = uuidv4().slice(0, 12).toUpperCase();

  const templatePath = path.join(
    __dirname,
    "../views/partials/certificate.html"
  );

  let html = fs.readFileSync(templatePath, "utf8");

  // Replace template variables
  html = html
    .replace(/{{\s*STUDENT_NAME\s*}}/g, studentName)
    .replace(/{{\s*COURSE_TITLE\s*}}/g, courseTitle)
    .replace(/{{\s*DATE\s*}}/g, new Date().toDateString())
    .replace(/{{\s*CERT_CODE\s*}}/g, certCode);

  // Add export mode for Puppeteer rendering
  html = html.replace("<body>", '<body class="export">');

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();

  // High resolution viewport (A4 Landscape)
  await page.setViewport({
    width: 3508,
    height: 2480,
    deviceScaleFactor: 2,
  });

  await page.setContent(html, { waitUntil: "networkidle0" });

  // Ensure certificate background loads
  await page.waitForSelector(".certificate");
  await page.waitForNetworkIdle();

  const outputPath = path.join(__dirname, `../tmp/${certCode}.png`);

  // Take screenshot
  await page.screenshot({
    path: outputPath,
    fullPage: true,
  });

  await browser.close();

  return { outputPath, certCode };
};