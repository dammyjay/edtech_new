// Per-course/module/lesson progress breakdown for a student's own
// "My Progress" dashboard view. Mirrors the data adminController.
// viewStudentProgress computes for admin/parent/school_admin, but
// deliberately leaves out that page's clinical framing (risk flags,
// "Inactive student", platform/mastery scores) — this is the student-facing
// version and should only ever encourage, never flag them as a risk.
const pool = require("../models/db");

async function getStudentProgressDetail(studentId) {
  const coursesRes = await pool.query(
    `
    SELECT DISTINCT c.id, c.title AS course_title, c.thumbnail_url
    FROM courses c
    LEFT JOIN course_enrollments e ON e.course_id = c.id AND e.user_id = $1
    LEFT JOIN classroom_courses cc ON cc.course_id = c.id
    LEFT JOIN user_school us ON us.classroom_id = cc.classroom_id AND us.user_id = $1
    WHERE e.user_id IS NOT NULL OR us.user_id IS NOT NULL
    ORDER BY c.title
    `,
    [studentId]
  );

  if (!coursesRes.rows.length) {
    return { courses: [], quizAvg: null, assignmentAvg: null, passRate: null, totalQuizzesTaken: 0, totalAssignmentsSubmitted: 0 };
  }

  const courseIds = coursesRes.rows.map((c) => c.id);

  const modulesRes = await pool.query(
    `SELECT id, title, course_id FROM modules WHERE course_id = ANY($1) ORDER BY id`,
    [courseIds]
  );
  const moduleIds = modulesRes.rows.map((m) => m.id);

  const [lessonsRes, quizzesRes, assignmentsRes] = await Promise.all([
    moduleIds.length
      ? pool.query(
          `SELECT l.id, l.title AS lesson_title, l.module_id, ulp.completed_at
           FROM lessons l
           LEFT JOIN user_lesson_progress ulp ON ulp.lesson_id = l.id AND ulp.user_id = $1
           WHERE l.module_id = ANY($2)
           ORDER BY l.order_number ASC`,
          [studentId, moduleIds]
        )
      : { rows: [] },
    pool.query(
      `SELECT qs.id AS submission_id, l.id AS lesson_id, l.module_id, qs.score, qs.passed, qs.created_at AS taken_at
       FROM quiz_submissions qs
       JOIN quizzes q ON qs.quiz_id = q.id
       JOIN lessons l ON q.lesson_id = l.id
       WHERE qs.student_id = $1
       ORDER BY qs.created_at DESC`,
      [studentId]
    ),
    pool.query(
      `SELECT ma.id, ma.title, ma.module_id, s.total, s.grade, s.created_at AS submitted_at
       FROM assignment_submissions s
       JOIN module_assignments ma ON s.assignment_id = ma.id
       WHERE s.student_id = $1
       ORDER BY s.created_at DESC`,
      [studentId]
    ),
  ]);

  // A lesson can have multiple quiz attempts (retakes) — represent it by
  // its best attempt, so retrying and improving is what shows, not an
  // average dragged down by earlier tries.
  const bestQuizByLesson = new Map();
  quizzesRes.rows.forEach((q) => {
    const existing = bestQuizByLesson.get(q.lesson_id);
    if (!existing || q.score > existing.score) {
      bestQuizByLesson.set(q.lesson_id, q);
    }
  });

  const lessonsByModule = new Map();
  lessonsRes.rows.forEach((l) => {
    if (!lessonsByModule.has(l.module_id)) lessonsByModule.set(l.module_id, []);
    lessonsByModule.get(l.module_id).push(l);
  });

  const assignmentsByModule = new Map();
  assignmentsRes.rows.forEach((a) => {
    if (!assignmentsByModule.has(a.module_id)) assignmentsByModule.set(a.module_id, []);
    assignmentsByModule.get(a.module_id).push(a);
  });

  const modulesByCourse = new Map();
  modulesRes.rows.forEach((m) => {
    if (!modulesByCourse.has(m.course_id)) modulesByCourse.set(m.course_id, []);
    modulesByCourse.get(m.course_id).push(m);
  });

  const courses = coursesRes.rows.map((course) => {
    const modules = (modulesByCourse.get(course.id) || []).map((mod) => {
      const rawLessons = lessonsByModule.get(mod.id) || [];
      const assignments = assignmentsByModule.get(mod.id) || [];

      const lessons = rawLessons.map((l) => {
        const best = bestQuizByLesson.get(l.id) || null;
        return {
          id: l.id,
          title: l.lesson_title,
          completed: !!l.completed_at,
          quiz: best
            ? { submissionId: best.submission_id, score: best.score, passed: best.passed }
            : null,
        };
      });

      const lessonQuizScores = lessons.filter((l) => l.quiz).map((l) => l.quiz.score);

      const totalLessons = lessons.length;
      const completedLessons = lessons.filter((l) => l.completed).length;
      const percent = totalLessons ? Math.round((completedLessons / totalLessons) * 100) : 0;

      const quizAvg = lessonQuizScores.length
        ? Math.round(lessonQuizScores.reduce((a, b) => a + b, 0) / lessonQuizScores.length)
        : null;
      const assignmentAvg = assignments.length
        ? Math.round(assignments.reduce((a, b) => a + (b.total || 0), 0) / assignments.length)
        : null;

      return {
        id: mod.id,
        title: mod.title,
        lessons,
        totalLessons,
        completedLessons,
        percent,
        quizAvg,
        assignmentAvg,
      };
    });

    const totalLessons = modules.reduce((a, b) => a + b.totalLessons, 0);
    const completedLessons = modules.reduce((a, b) => a + b.completedLessons, 0);
    const percent = totalLessons ? Math.round((completedLessons / totalLessons) * 100) : 0;
    const modulesComplete = modules.filter((m) => m.totalLessons > 0 && m.percent === 100).length;

    return {
      id: course.id,
      title: course.course_title,
      thumbnail_url: course.thumbnail_url,
      modules,
      totalLessons,
      completedLessons,
      percent,
      modulesComplete,
      totalModules: modules.length,
    };
  });

  const allBestQuizzes = Array.from(bestQuizByLesson.values());
  const allAssignments = assignmentsRes.rows;

  const quizAvg = allBestQuizzes.length
    ? Math.round(allBestQuizzes.reduce((a, b) => a + b.score, 0) / allBestQuizzes.length)
    : null;
  const assignmentAvg = allAssignments.length
    ? Math.round(allAssignments.reduce((a, b) => a + (b.total || 0), 0) / allAssignments.length)
    : null;
  const passRate = allBestQuizzes.length
    ? Math.round((allBestQuizzes.filter((q) => q.passed).length / allBestQuizzes.length) * 100)
    : null;

  return {
    courses,
    quizAvg,
    assignmentAvg,
    passRate,
    totalQuizzesTaken: allBestQuizzes.length,
    totalAssignmentsSubmitted: allAssignments.length,
  };
}

module.exports = { getStudentProgressDetail };
