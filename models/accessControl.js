// models/accessControl.js
const pool = require("./db");

// Three-way access check lifted verbatim (same joins, same three EXISTS
// branches) from controllers/studentController.js's getModuleFlashcards —
// classroom/school enrollment (user_school + classroom_courses), a past/
// ended-term classroom enrollment (student_term_enrollments), or an
// independent self-enrollment (course_enrollments). Kept here as the one
// shared place to extend/fix this check instead of re-deriving it inline
// again at a fourth call site.
async function studentHasCourseAccess(studentId, courseId) {
  const result = await pool.query(
    `SELECT EXISTS (
       SELECT 1 FROM classroom_courses cc
       JOIN user_school us ON us.classroom_id = cc.classroom_id
       WHERE cc.course_id = $1 AND us.user_id = $2
         AND us.role_in_school = 'student' AND us.approved = true
     ) OR EXISTS (
       SELECT 1 FROM student_term_enrollments ste
       JOIN classroom_courses cc2 ON cc2.classroom_id = ste.classroom_id
       WHERE cc2.course_id = $1 AND ste.student_id = $2
     ) OR EXISTS (
       SELECT 1 FROM course_enrollments ce WHERE ce.course_id = $1 AND ce.user_id = $2
     ) AS has_access`,
    [courseId, studentId]
  );
  return !!result.rows[0]?.has_access;
}

module.exports = { studentHasCourseAccess };
