// services/classTermReportStore.js
//
// Persistence for platform-admin-generated class/student term report
// cards (services/reportGeneratorService.js) so a school admin can view
// the same PDF later without regenerating it. One row per
// school+classroom+term (+student, null for a whole-class report) —
// generating again for the same combination updates that row rather than
// accumulating duplicates, per the "regenerate = update the stored copy"
// behavior requested for this feature.

const pool = require("../models/db");

// studentId: null/undefined for a whole-class report.
async function findExistingReport({ schoolId, classroomId, termId, studentId }) {
  const result = await pool.query(
    `SELECT id, filename, generated_at
     FROM class_term_reports
     WHERE school_id = $1 AND classroom_id = $2 AND term_id = $3
       AND COALESCE(student_id, 0) = COALESCE($4, 0)`,
    [schoolId, classroomId, termId, studentId || null],
  );
  return result.rows[0] || null;
}

// pdfBuffer: the actual PDF bytes (read from the file services/reportGeneratorService.js writes to disk).
async function saveReport({ schoolId, classroomId, termId, studentId, pdfBuffer, filename, generatedByUserId }) {
  const result = await pool.query(
    `INSERT INTO class_term_reports
       (school_id, classroom_id, term_id, student_id, pdf, filename, generated_by, generated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (school_id, classroom_id, term_id, COALESCE(student_id, 0))
     DO UPDATE SET
       pdf = EXCLUDED.pdf,
       filename = EXCLUDED.filename,
       generated_by = EXCLUDED.generated_by,
       generated_at = NOW()
     RETURNING id, generated_at`,
    [schoolId, classroomId, termId, studentId || null, pdfBuffer, filename, generatedByUserId || null],
  );
  return result.rows[0];
}

async function getReportById(id) {
  const result = await pool.query(
    `SELECT id, school_id, classroom_id, term_id, student_id, pdf, filename, generated_at
     FROM class_term_reports WHERE id = $1`,
    [id],
  );
  return result.rows[0] || null;
}

// Everything stored for one school — for the school admin's "Generated
// Reports" list. Excludes the pdf bytes themselves (listing doesn't need
// the payload, only getReportById does when actually downloading one).
async function listReportsForSchool(schoolId) {
  const result = await pool.query(
    `SELECT
       ctr.id, ctr.classroom_id, ctr.term_id, ctr.student_id, ctr.filename, ctr.generated_at,
       c.name AS classroom_name,
       t.name AS term_name,
       u.fullname AS student_name
     FROM class_term_reports ctr
     JOIN classrooms c ON c.id = ctr.classroom_id
     JOIN academic_terms t ON t.id = ctr.term_id
     LEFT JOIN users2 u ON u.id = ctr.student_id
     WHERE ctr.school_id = $1
     ORDER BY ctr.generated_at DESC`,
    [schoolId],
  );
  return result.rows;
}

module.exports = {
  findExistingReport,
  saveReport,
  getReportById,
  listReportsForSchool,
};
