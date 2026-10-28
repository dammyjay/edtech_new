const fs = require("fs");
const os = require("os");
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

  // A dedicated, unique profile directory per render — without this,
  // Puppeteer defaults to ONE shared OS-temp profile directory for every
  // launch from this process, so two certificates rendering at the same
  // time (the public achievement page can pre-warm several at once, and
  // services/issueCertificate.js's admin bulk-regenerate action renders
  // many) collide on that shared directory's lock files. Confirmed live:
  // concurrent renders without this crashed the whole server with
  // "The browser is already running for ...puppeteer_dev_chrome_profile"
  // and an unrelated EBUSY file-lock error, not just a single failed
  // render. Cleaned up after the render either way.
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cert-render-"));

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
    userDataDir,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  // try/finally so a mid-render failure (a bad background URL, a page
  // crash, etc.) can never leak the browser process or its temp profile
  // dir — a leaked instance under concurrent renders is exactly what
  // compounds into the resource exhaustion that caused cascading
  // "Navigation timeout" failures across unrelated renders.
  let outputPath;
  try {
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

    outputPath = path.join(__dirname, `../tmp/${certCode}.png`);

    // Screenshot just the certificate element, not the whole page — body's
    // flex-centering can leave blank margin around it that fullPage would
    // otherwise include, and this guarantees the saved image is exactly the
    // certificate artwork at full size, not a small box inside a bigger
    // mostly-blank canvas (the bug this fixes: certificates saved so small
    // you had to zoom in to read them).
    const certificateEl = await page.$(".certificate");
    await certificateEl.screenshot({ path: outputPath });
  } finally {
    await browser.close().catch((err) => console.error("generateCertificate: browser.close failed:", err.message));
    // Best-effort — a locked/in-use file here (seen on Windows under
    // concurrent renders before the unique-per-render directory above was
    // added) should never fail certificate generation; the OS temp dir
    // gets reclaimed eventually regardless.
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch (err) {
      console.error("generateCertificate: failed to clean up temp profile dir:", err.message);
    }
  }

  return { outputPath, certCode };
};
