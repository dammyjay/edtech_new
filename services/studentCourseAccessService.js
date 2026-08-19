const pool = require("../models/db");

// For a school-linked student, works out which courses they can still
// actively work in (their live classroom's courses — via classroom_courses,
// exactly as today, unrestricted) vs which are "past" courses: reachable
// only through a classroom they used to be in (recorded via
// student_term_enrollments.classroom_id, a snapshot taken when the
// platform admin enrolled them into a term). Past courses stay visible
// in the catalog and whatever was already completed stays viewable, but
// no new lesson/quiz completions are allowed in them — enforced by
// isCourseLocked below, called from completeLesson/submitLessonQuiz.
//
// A course not tied to ANY of the student's classrooms at all (current
// or past) is left completely alone — that's the pre-existing, unrelated
// gap where individual/self-paced students (course_enrollments-based,
// no classroom concept) live, and isn't something this feature touches.
async function getStudentCourseAccess(studentId) {
  const classroomRes = await pool.query(
    `SELECT classroom_id FROM user_school
     WHERE user_id = $1 AND role_in_school = 'student' AND approved = true
     LIMIT 1`,
    [studentId]
  );
  const currentClassroomId = classroomRes.rows[0]?.classroom_id || null;

  const currentCourseIds = new Set();
  if (currentClassroomId) {
    const r = await pool.query(
      "SELECT course_id FROM classroom_courses WHERE classroom_id = $1",
      [currentClassroomId]
    );
    r.rows.forEach((row) => currentCourseIds.add(row.course_id));
  }

  const pastClassroomsRes = await pool.query(
    `SELECT DISTINCT classroom_id FROM student_term_enrollments
     WHERE student_id = $1 AND classroom_id IS NOT NULL
       AND classroom_id IS DISTINCT FROM $2`,
    [studentId, currentClassroomId]
  );
  const pastClassroomIds = pastClassroomsRes.rows.map((row) => row.classroom_id);

  const pastCourseIds = new Set();
  if (pastClassroomIds.length) {
    const r = await pool.query(
      "SELECT DISTINCT course_id FROM classroom_courses WHERE classroom_id = ANY($1)",
      [pastClassroomIds]
    );
    r.rows.forEach((row) => {
      if (!currentCourseIds.has(row.course_id)) pastCourseIds.add(row.course_id);
    });
  }

  return { currentClassroomId, currentCourseIds, pastCourseIds };
}

async function isCourseLocked(studentId, courseId) {
  if (!courseId) return false;
  const { currentCourseIds, pastCourseIds } = await getStudentCourseAccess(studentId);
  if (currentCourseIds.has(courseId)) return false;
  return pastCourseIds.has(courseId);
}

async function getCourseIdForLesson(lessonId) {
  const r = await pool.query(
    `SELECT m.course_id FROM lessons l JOIN modules m ON m.id = l.module_id WHERE l.id = $1`,
    [lessonId]
  );
  return r.rows[0]?.course_id || null;
}

module.exports = { getStudentCourseAccess, isCourseLocked, getCourseIdForLesson };
