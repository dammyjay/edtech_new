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
  const { outputPath, certCode } = await generateCertificate({
    studentName,
    courseTitle,
  });

  // 3️⃣ Upload to Cloudinary
  const upload = await cloudinary.uploader.upload(outputPath, {
    folder: "certificates",
    resource_type: "raw",
  });

  // 4️⃣ Save record
  await pool.query(
    `INSERT INTO user_certificates
     (user_id, course_id, certificate_code, certificate_url)
     VALUES ($1,$2,$3,$4)`,
    [userId, courseId, certCode, upload.secure_url]
  );

  // 5️⃣ Cleanup
  fs.unlinkSync(outputPath);
};
