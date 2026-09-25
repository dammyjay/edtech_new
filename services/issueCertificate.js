const pool = require("../models/db");
const fs = require("fs");
const generateCertificate = require("../utils/generateCertificate");
const cloudinary = require("../utils/cloudinary");

// Renders a fresh certificate image (current template + current
// admin-configured background/signature/signee/title from company_info,
// views/admin/company.ejs's "Certificate Template" section) and uploads
// it to Cloudinary. Shared by first-time issuing and by an admin's later
// "Regenerate" action — both need the exact same render+upload step, just
// a different DB write after it.
async function renderAndUploadCertificate({ studentName, courseTitle }) {
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

  try {
    const upload = await cloudinary.uploader.upload(outputPath, {
      folder: "certificates",
      resource_type: "image",
    });
    return { certCode, url: upload.secure_url };
  } finally {
    fs.unlinkSync(outputPath);
  }
}

module.exports = async ({ userId, courseId, studentName, courseTitle }) => {
  // Prevent duplicates — first-time issuing only. Regeneration (below) is
  // the deliberate, explicit way to re-render an existing certificate.
  const existing = await pool.query(
    `SELECT 1 FROM user_certificates WHERE user_id = $1 AND course_id = $2`,
    [userId, courseId]
  );
  if (existing.rows.length) return;

  const { certCode, url } = await renderAndUploadCertificate({ studentName, courseTitle });

  await pool.query(
    `INSERT INTO user_certificates
     (user_id, course_id, certificate_code, certificate_url)
     VALUES ($1,$2,$3,$4)`,
    [userId, courseId, certCode, url]
  );
};

// Admin action: re-render a student's certificate for a course against
// whatever the certificate template/company settings look like RIGHT
// NOW (e.g. after fixing the template, or after an admin changes the
// signature/signee), and overwrite the stored record with the fresh
// image — same certificate_id, new certificate_code/certificate_url.
// issued_at is deliberately left untouched: it's the student's real
// completion date, not a "last rendered" timestamp. If the student has
// no certificate row yet for this course, this issues one (an admin
// regenerating a certificate that was never actually granted would be a
// confusing silent no-op otherwise).
module.exports.regenerateCertificate = async ({ userId, courseId, studentName, courseTitle }) => {
  const { certCode, url } = await renderAndUploadCertificate({ studentName, courseTitle });

  const updated = await pool.query(
    `UPDATE user_certificates
     SET certificate_code = $1, certificate_url = $2
     WHERE user_id = $3 AND course_id = $4
     RETURNING id`,
    [certCode, url, userId, courseId]
  );

  if (updated.rows.length) {
    return { certificateId: updated.rows[0].id, url, created: false };
  }

  const inserted = await pool.query(
    `INSERT INTO user_certificates (user_id, course_id, certificate_code, certificate_url)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [userId, courseId, certCode, url]
  );
  return { certificateId: inserted.rows[0].id, url, created: true };
};
