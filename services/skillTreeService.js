// Skill-tree visualization data: every course, grouped by pathway then by
// level (Beginner/Intermediate/Advanced), annotated with this student's
// enrollment + progress state. There is no real prerequisite graph in the
// data model (any course in any pathway is independently enrollable) — this
// is purely a staged visual metaphor over existing enrollment/progress data,
// not a new gating system. See student/skillTree section for rendering.
const pool = require("../models/db");

const LEVEL_ORDER = { Beginner: 1, Intermediate: 2, Advanced: 3 };

async function getStudentSkillTreeData(studentId) {
  const coursesRes = await pool.query(
    `SELECT c.id, c.title, c.level, c.thumbnail_url, c.sort_order,
            p.id AS pathway_id, p.title AS pathway_title,
            e.progress AS enrollment_progress,
            (e.user_id IS NOT NULL OR us.user_id IS NOT NULL) AS enrolled
     FROM courses c
     LEFT JOIN career_pathways p ON p.id = c.career_pathway_id
     LEFT JOIN course_enrollments e ON e.course_id = c.id AND e.user_id = $1
     LEFT JOIN classroom_courses cc ON cc.course_id = c.id
     LEFT JOIN user_school us ON us.classroom_id = cc.classroom_id AND us.user_id = $1
     WHERE p.id IS NOT NULL
     GROUP BY c.id, p.id, e.progress, e.user_id, us.user_id
     ORDER BY p.title, c.sort_order, c.title`,
    [studentId]
  );

  const courseIds = coursesRes.rows.map((c) => c.id);
  const progressByCourseId = {};
  if (courseIds.length) {
    const progressRes = await pool.query(
      `SELECT m.course_id,
              COUNT(DISTINCT l.id) AS total_lessons,
              COUNT(DISTINCT ulp.lesson_id) AS completed_lessons
       FROM modules m
       JOIN lessons l ON l.module_id = m.id
       LEFT JOIN user_lesson_progress ulp ON ulp.lesson_id = l.id AND ulp.user_id = $2
       WHERE m.course_id = ANY($1)
       GROUP BY m.course_id`,
      [courseIds, studentId]
    );
    progressRes.rows.forEach((r) => {
      const total = Number(r.total_lessons);
      const completed = Number(r.completed_lessons);
      progressByCourseId[r.course_id] = total > 0 ? Math.round((completed / total) * 100) : 0;
    });
  }

  const pathways = {};
  coursesRes.rows.forEach((c) => {
    const progress = progressByCourseId[c.id] ?? 0;
    let state = "not-enrolled";
    if (c.enrolled) {
      state = progress >= 100 ? "completed" : progress > 0 ? "in-progress" : "not-started";
    }

    if (!pathways[c.pathway_title]) {
      pathways[c.pathway_title] = { Beginner: [], Intermediate: [], Advanced: [] };
    }
    const level = LEVEL_ORDER[c.level] ? c.level : "Beginner";
    pathways[c.pathway_title][level].push({
      id: c.id,
      title: c.title,
      thumbnail_url: c.thumbnail_url,
      progress,
      enrolled: c.enrolled,
      state,
    });
  });

  return pathways;
}

module.exports = { getStudentSkillTreeData };
