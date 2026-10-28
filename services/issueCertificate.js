const pool = require("../models/db");
const fs = require("fs");
const generateCertificate = require("../utils/generateCertificate");
const cloudinary = require("../utils/cloudinary");

// Which template a render uses: the active row in certificate_templates
// (controllers/companyController.js's admin-managed template library) when
// one exists, otherwise company_info's single legacy certificate_* columns
// — so nothing changes for a platform that never touches the library.
async function getActiveCertificateTemplate() {
  const activeRes = await pool.query(
    `SELECT background_url AS certificate_background_url, signature_url AS certificate_signature_url,
            signee_name AS certificate_signee_name, title AS certificate_title
     FROM certificate_templates WHERE is_active = true LIMIT 1`
  );
  if (activeRes.rows.length) return activeRes.rows[0];

  const infoRes = await pool.query(
    "SELECT certificate_background_url, certificate_signature_url, certificate_signee_name, certificate_title FROM company_info ORDER BY id DESC LIMIT 1"
  );
  return infoRes.rows[0] || {};
}

// Renders a fresh certificate image (current template — see
// getActiveCertificateTemplate above) and uploads it to Cloudinary.
// Shared by first-time issuing and by an admin's later "Regenerate"
// action — both need the exact same render+upload step, just a different
// DB write after it.
async function renderAndUploadCertificate({ studentName, courseTitle }) {
  const info = await getActiveCertificateTemplate();

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

// Exposed so routes/publicRoutes.js can render a second, privacy-safe copy
// of a student's real certificate (same template, a redacted "First L."
// name instead of the real one) for the public certificate-share page —
// same render+upload step as issuing/regenerating, just never written to
// user_certificates.certificate_url/certificate_code (those stay the
// REAL, name-bearing certificate).
module.exports.renderAndUploadCertificate = renderAndUploadCertificate;

// Exposed so controllers/adminController.js's previewCertificate can show
// the actual active template (library or legacy company_info) instead of
// only ever reading company_info directly.
module.exports.getActiveCertificateTemplate = getActiveCertificateTemplate;

// Admin bulk action: re-render EVERY issued certificate against whatever
// the active template looks like right now — e.g. right after uploading/
// activating a new one, so historical certificates aren't left looking
// like the old design. A real Puppeteer render takes ~20-30s each.
// Defaults to serial (concurrency: 1) — running 2+ renders at once
// (even after fixing the profile-directory crash this used to cause, see
// utils/generateCertificate.js) still reliably hit "Navigation timeout"
// failures from plain resource contention on a modest machine running
// several full headless Chromium instances at once. This is a background
// job nobody watches in real time, so trading speed for reliability is
// the right default; ~30 certificates takes 10-15 minutes this way, which
// is fine since callers (see controllers/companyController.js) fire this
// in the background and never await the full job on a live admin request.
//
// Also clears each certificate's public_certificate_url (the redacted
// copy shown on the public share page — routes/publicRoutes.js) rather
// than re-rendering it here too: that one is cheap to regenerate lazily
// (already-built pre-warm-on-view logic), so doubling the Puppeteer work
// in this already-slow bulk job isn't worth it.
module.exports.regenerateAllCertificates = async ({ concurrency = 1, onProgress } = {}) => {
  const certsRes = await pool.query(
    `SELECT uc.id, uc.user_id, uc.course_id, u.fullname AS student_name, c.title AS course_title
     FROM user_certificates uc
     JOIN users2 u ON u.id = uc.user_id
     JOIN courses c ON c.id = uc.course_id
     ORDER BY uc.id`
  );
  const certs = certsRes.rows;
  let done = 0;
  let failed = 0;

  async function worker(queue) {
    while (queue.length) {
      const cert = queue.shift();
      try {
        const { certCode, url } = await renderAndUploadCertificate({
          studentName: cert.student_name,
          courseTitle: cert.course_title,
        });
        await pool.query(
          `UPDATE user_certificates SET certificate_code = $1, certificate_url = $2, public_certificate_url = NULL WHERE id = $3`,
          [certCode, url, cert.id]
        );
      } catch (err) {
        failed++;
        console.error(`regenerateAllCertificates: failed for certificate ${cert.id}:`, err.message);
      }
      done++;
      if (onProgress) onProgress({ done, total: certs.length, failed });
    }
  }

  const queue = certs.slice();
  await Promise.all(Array.from({ length: Math.min(concurrency, certs.length) }, () => worker(queue)));

  return { total: certs.length, failed };
};
