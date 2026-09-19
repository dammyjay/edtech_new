// A second, classroom-wide gate on top of the existing per-student
// unlocked_lessons/unlocked_modules progress: a student's own progress
// can unlock a lesson individually, but for classroom students it isn't
// actually reachable until the instructor also releases it via
// classroom_lesson_releases — lets an instructor keep a whole class on
// the same pace instead of everyone racing ahead independently.
// Independent (non-classroom) students are never affected by anything
// here — every function below treats a null/missing classroomId as
// "no gate, always available."
const pool = require("../models/db");

// Same "which classroom is this student in" lookup already duplicated
// several times in controllers/studentController.js, factored out here
// so this feature and its call sites share one implementation.
async function getStudentClassroomId(studentId) {
  const res = await pool.query(
    `SELECT c.id
     FROM classrooms c
     JOIN user_school us ON c.id = us.classroom_id
     WHERE us.user_id = $1
       AND us.role_in_school = 'student'
       AND us.approved = true
     LIMIT 1`,
    [studentId]
  );
  return res.rows[0]?.id || null;
}

// True when this lesson is the very first one in its course (lowest
// module order_number, then lowest lesson order_number within it) —
// always available, never needs a classroom_lesson_releases row, and can
// never be un-released.
async function isFirstLessonOfCourse(lessonId) {
  const res = await pool.query(
    `SELECT NOT EXISTS(
       SELECT 1
       FROM lessons l2
       JOIN modules m2 ON l2.module_id = m2.id
       JOIN lessons l1 ON l1.id = $1
       JOIN modules m1 ON l1.module_id = m1.id
       WHERE m2.course_id = m1.course_id
         AND (m2.order_number, l2.order_number) < (m1.order_number, l1.order_number)
     ) AS is_first`,
    [lessonId]
  );
  return !!res.rows[0]?.is_first;
}

// Batch version — the first lesson id for each course in courseIds, in
// one query, for annotating a whole module/lesson list at once instead
// of one isFirstLessonOfCourse call per lesson.
async function getFirstLessonIdsForCourses(courseIds) {
  if (!courseIds || !courseIds.length) return new Set();
  const res = await pool.query(
    `SELECT DISTINCT ON (m.course_id) l.id
     FROM lessons l
     JOIN modules m ON l.module_id = m.id
     WHERE m.course_id = ANY($1)
     ORDER BY m.course_id, m.order_number ASC, l.order_number ASC`,
    [courseIds]
  );
  return new Set(res.rows.map((r) => r.id));
}

// Batch version of "has this classroom released these lessons".
async function getReleasedLessonIds(classroomId, lessonIds) {
  if (!classroomId || !lessonIds || !lessonIds.length) return new Set();
  const res = await pool.query(
    `SELECT lesson_id FROM classroom_lesson_releases
     WHERE classroom_id = $1 AND lesson_id = ANY($2)`,
    [classroomId, lessonIds]
  );
  return new Set(res.rows.map((r) => r.lesson_id));
}

// The single authoritative check for one lesson — used by the
// content-serving endpoints (viewLesson, getLessonQuiz, submitLessonQuiz)
// where only one lesson is in play, so the per-lesson query cost is fine.
async function isLessonAvailableToClassroom(classroomId, lessonId) {
  if (!classroomId) return true;
  if (await isFirstLessonOfCourse(lessonId)) return true;
  const res = await pool.query(
    `SELECT 1 FROM classroom_lesson_releases WHERE classroom_id = $1 AND lesson_id = $2`,
    [classroomId, lessonId]
  );
  return res.rows.length > 0;
}

async function releaseLesson(classroomId, lessonId, instructorId) {
  await pool.query(
    `INSERT INTO classroom_lesson_releases (classroom_id, lesson_id, released_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (classroom_id, lesson_id) DO NOTHING`,
    [classroomId, lessonId, instructorId]
  );
}

// Refuses to unrelease the first lesson of its course — that one is
// always available and the instructor can't take it away.
async function unreleaseLesson(classroomId, lessonId) {
  if (await isFirstLessonOfCourse(lessonId)) {
    return {
      ok: false,
      reason: "This is the first lesson of the course — it's always available and can't be locked.",
    };
  }
  await pool.query(
    `DELETE FROM classroom_lesson_releases WHERE classroom_id = $1 AND lesson_id = $2`,
    [classroomId, lessonId]
  );
  return { ok: true };
}

module.exports = {
  getStudentClassroomId,
  isFirstLessonOfCourse,
  getFirstLessonIdsForCourses,
  getReleasedLessonIds,
  isLessonAvailableToClassroom,
  releaseLesson,
  unreleaseLesson,
};
