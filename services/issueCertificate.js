const pool = require("../models/db");
const fs = require("fs");
const generateCertificate = require("../utils/generateCertificate");
const cloudinary = require("../utils/cloudinary");

module.exports = async ({ userId, courseId, studentName, courseTitle }) => {
  // 1️⃣ Prevent duplicates
  const existing = await pool.query(
    `SELECT 1 FROM user_certificates WHERE user_id = $1 AND course_id = $2`,
    [userId, courseId]
  );
  if (existing.rows.length) return;

  // 2️⃣ Generate PDF
  // Admin-configurable pieces (views/admin/company.ejs's "Certificate
  // Template" section) — generateCertificate falls back to its own
  // built-in defaults when any of these are unset.
  const infoRes = await pool.query(
    "SELECT certificate_background_url, certificate_signature_url, certificate_signee_name, certificate_title FROM company_info ORDER BY id DESC LIMIT 1"
  );
  const info = infoRes.rows[0] || {};

  const { outputPath, certCode } = await generateCertificate({
    studentName,
    courseTitle,
    backgroundUrl: info.certificate_background_url,
    signatureUrl: info.certificate_signature_url,
    signeeName: info.certificate_signee_name,
    title: info.certificate_title,
  });

  const upload = await cloudinary.uploader.upload(outputPath, {
    folder: "certificates",
    resource_type: "image",
  });


  // 4️⃣ Save record
  await pool.query(
    `INSERT INTO user_certificates
     (user_id, course_id, certificate_code, certificate_url)
     VALUES ($1,$2,$3,$4)`,
    [userId, courseId, certCode, upload.secure_url]
    // [userId, courseId, certCode, pdfUrl],
  );

  // 5️⃣ Cleanup
  fs.unlinkSync(outputPath);
};
