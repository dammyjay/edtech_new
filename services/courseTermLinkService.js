const pool = require("../models/db");

// Upserts a confirmed "this course was worked on, in this classroom,
// during this term" record. Called both by the historical backfill and
// by live lesson/quiz completion (see recordActivityForLesson below).
async function recordCourseTermActivity(schoolId, classroomId, courseId, termId, activityAt, source = "live") {
  if (!schoolId || !classroomId || !courseId || !termId || !activityAt) return;
  await pool.query(
    `INSERT INTO course_term_links
       (school_id, classroom_id, course_id, term_id, first_activity_at, last_activity_at, source)
     VALUES ($1,$2,$3,$4,$5,$5,$6)
     ON CONFLICT (classroom_id, course_id, term_id)
     DO UPDATE SET
       first_activity_at = LEAST(course_term_links.first_activity_at, EXCLUDED.first_activity_at),
       last_activity_at = GREATEST(course_term_links.last_activity_at, EXCLUDED.last_activity_at)`,
    [schoolId, classroomId, courseId, termId, activityAt, source]
  );
}

// Which of a school's terms does this timestamp fall inside (date-only
// comparison, matching the date-windowing convention used elsewhere)?
async function findTermForDate(schoolId, activityAt) {
  const r = await pool.query(
    `SELECT id FROM academic_terms
     WHERE school_id = $1 AND $2::date BETWEEN start_date AND end_date
     ORDER BY start_date DESC LIMIT 1`,
    [schoolId, activityAt]
  );
  return r.rows[0]?.id || null;
}

// Called right after a student completes a lesson or submits a quiz.
// Silently no-ops for individual/self-paced students (no classroom) or
// activity outside any known term — this is a best-effort side record,
// never something that should block the real completion flow.
async function recordActivityForLesson(studentId, lessonId, activityAt = new Date()) {
  try {
    const studentRes = await pool.query(
      `SELECT classroom_id FROM user_school
       WHERE user_id = $1 AND role_in_school = 'student' AND approved = true
       LIMIT 1`,
      [studentId]
    );
    const classroomId = studentRes.rows[0]?.classroom_id;
    if (!classroomId) return;

    const classroomRes = await pool.query("SELECT school_id FROM classrooms WHERE id = $1", [classroomId]);
    const schoolId = classroomRes.rows[0]?.school_id;
    if (!schoolId) return;

    const courseRes = await pool.query(
      `SELECT m.course_id FROM lessons l JOIN modules m ON m.id = l.module_id WHERE l.id = $1`,
      [lessonId]
    );
    const courseId = courseRes.rows[0]?.course_id;
    if (!courseId) return;

    const termId = await findTermForDate(schoolId, activityAt);
    if (!termId) return;

    await recordCourseTermActivity(schoolId, classroomId, courseId, termId, activityAt, "live");
  } catch (err) {
    console.error("recordActivityForLesson error (non-fatal):", err.message);
  }
}

// One-time (safely re-runnable — upserts) historical backfill: for
// every term this school has ever had, for every classroom, for every
// course assigned to that classroom, look for real lesson/quiz activity
// evidence inside that term's date range (scoped to students plausibly
// in that classroom at the time — either via student_term_enrollments,
// or, when a school never used that feature for an old term, whoever is
// currently recorded in that classroom) and persist a link.
async function backfillSchool(schoolId) {
  const terms = await pool.query(
    "SELECT id, start_date, end_date FROM academic_terms WHERE school_id = $1",
    [schoolId]
  );
  const classrooms = await pool.query("SELECT id FROM classrooms WHERE school_id = $1", [schoolId]);

  let linksCreated = 0;
  for (const term of terms.rows) {
    for (const classroom of classrooms.rows) {
      const courses = await pool.query(
        "SELECT course_id FROM classroom_courses WHERE classroom_id = $1",
        [classroom.id]
      );
      for (const { course_id: courseId } of courses.rows) {
        const evidence = await pool.query(
          `WITH relevant_students AS (
             SELECT student_id FROM student_term_enrollments WHERE term_id = $4 AND classroom_id = $5
             UNION
             SELECT user_id AS student_id FROM user_school
             WHERE classroom_id = $5 AND role_in_school = 'student' AND approved = true
           )
           SELECT MIN(t) AS first_at, MAX(t) AS last_at FROM (
             SELECT ulp.completed_at AS t
             FROM user_lesson_progress ulp
             JOIN lessons l ON l.id = ulp.lesson_id
             JOIN modules m ON m.id = l.module_id
             WHERE m.course_id = $1
               AND ulp.completed_at IS NOT NULL
               AND ulp.completed_at::date BETWEEN $2 AND $3
               AND ulp.user_id IN (SELECT student_id FROM relevant_students)
             UNION ALL
             SELECT qs.created_at AS t
             FROM quiz_submissions qs
             JOIN quizzes q ON q.id = qs.quiz_id
             JOIN lessons l ON l.id = q.lesson_id
             JOIN modules m ON m.id = l.module_id
             WHERE m.course_id = $1
               AND qs.created_at::date BETWEEN $2 AND $3
               AND qs.student_id IN (SELECT student_id FROM relevant_students)
           ) combined`,
          [courseId, term.start_date, term.end_date, term.id, classroom.id]
        );
        const { first_at, last_at } = evidence.rows[0];
        if (first_at) {
          await recordCourseTermActivity(schoolId, classroom.id, courseId, term.id, first_at, "backfill");
          if (last_at && last_at.getTime() !== first_at.getTime()) {
            await recordCourseTermActivity(schoolId, classroom.id, courseId, term.id, last_at, "backfill");
          }
          linksCreated++;
        }
      }
    }
  }
  return linksCreated;
}

async function backfillAllSchools() {
  const schools = await pool.query("SELECT id FROM schools");
  let total = 0;
  const perSchool = [];
  for (const s of schools.rows) {
    const count = await backfillSchool(s.id);
    total += count;
    if (count) perSchool.push({ schoolId: s.id, linksCreated: count });
  }
  return { total, perSchool };
}

module.exports = {
  recordCourseTermActivity,
  findTermForDate,
  recordActivityForLesson,
  backfillSchool,
  backfillAllSchools,
};
