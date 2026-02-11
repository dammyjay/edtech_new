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

  const outputPath = path.join(__dirname, `../tmp/${certCode}.pdf`);
  await page.pdf({ 
    path: outputPath, 
    format: "A4",
    lanscape: true,
    printBackground: true,    
});

  await browser.close();

  return { outputPath, certCode };
};
