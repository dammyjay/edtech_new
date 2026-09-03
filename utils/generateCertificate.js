const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const { v4: uuidv4 } = require("uuid");

// Built-in defaults — used whenever an admin hasn't customized the
// certificate template yet (views/admin/company.ejs's "Certificate
// Template" section, company_info.certificate_*). Keeping the same
// values that were previously hardcoded here so nothing changes for a
// school that never touches that settings page.
const DEFAULT_BACKGROUND_URL = "https://acad.jkthub.com/images/Certificate.png";
const DEFAULT_SIGNATURE_URL = "https://acad.jkthub.com/images/Signature.jpg";
const DEFAULT_SIGNEE_NAME = "Jimoh Damilola";
const DEFAULT_TITLE = "CERTIFICATE OF COMPLETION";

module.exports = async ({
  studentName,
  courseTitle,
  backgroundUrl,
  signatureUrl,
  signeeName,
  title,
}) => {
  const certCode = uuidv4().slice(0, 12).toUpperCase();

  const templatePath = path.join(__dirname, "../views/partials/certificate.html");
  let html = fs.readFileSync(templatePath, "utf8");

  html = html
    .replace(/{{\s*STUDENT_NAME\s*}}/g, studentName)
    .replace(/{{\s*COURSE_TITLE\s*}}/g, courseTitle)
    .replace(/{{\s*DATE\s*}}/g, new Date().toDateString())
    .replace(/{{\s*CERT_CODE\s*}}/g, certCode)
    .replace(/{{\s*BACKGROUND_URL\s*}}/g, backgroundUrl || DEFAULT_BACKGROUND_URL)
    .replace(/{{\s*SIGNATURE_URL\s*}}/g, signatureUrl || DEFAULT_SIGNATURE_URL)
    .replace(/{{\s*SIGNEE_NAME\s*}}/g, signeeName || DEFAULT_SIGNEE_NAME)
    .replace(/{{\s*TITLE\s*}}/g, title || DEFAULT_TITLE);

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();

  // Set the viewport BEFORE loading content, so the certificate's CSS
  // (width:100% + aspect-ratio, see views/partials/certificate.html)
  // lays out against the real A4-landscape-at-300dpi size from the start
  // rather than the default 800x600 viewport, then gets stretched.
  await page.setViewport({
    width: 3504,   // A4 landscape width at 300 DPI
    height: 2480,  // A4 landscape height at 300 DPI
    deviceScaleFactor: 2, // Higher scale = sharper image
  });

  await page.setContent(html, { waitUntil: "networkidle0" });

  const outputPath = path.join(__dirname, `../tmp/${certCode}.png`);

  // Screenshot just the certificate element, not the whole page — body's
  // flex-centering can leave blank margin around it that fullPage would
  // otherwise include, and this guarantees the saved image is exactly the
  // certificate artwork at full size, not a small box inside a bigger
  // mostly-blank canvas (the bug this fixes: certificates saved so small
  // you had to zoom in to read them).
  const certificateEl = await page.$(".certificate");
  await certificateEl.screenshot({ path: outputPath });

  await browser.close();

  return { outputPath, certCode };
};
