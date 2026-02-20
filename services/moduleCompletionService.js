// services/moduleCompletionService.js

const pool = require("../models/db");

async function checkAndCompleteModule(studentId, moduleId) {
  // 1️⃣ Get all lessons in module
  const lessonsRes = await pool.query(
    `SELECT id FROM lessons WHERE module_id = $1`,
    [moduleId]
  );

  const lessonIds = lessonsRes.rows.map(l => l.id);
  if (lessonIds.length === 0) return { completed: false };

  // 2️⃣ Check all lessons completed
  const completedRes = await pool.query(
    `SELECT COUNT(DISTINCT lesson_id) AS count
     FROM user_lesson_progress
     WHERE user_id = $1
     AND lesson_id = ANY($2)`,
    [studentId, lessonIds]
  );

  const completedLessons = parseInt(completedRes.rows[0].count);

  if (completedLessons !== lessonIds.length) {
    return { completed: false };
  }

  // 3️⃣ Check if module has assignment
  const assignmentRes = await pool.query(
    `SELECT id FROM module_assignments WHERE module_id = $1 LIMIT 1`,
    [moduleId]
  );

  let assignmentCompleted = true;

  if (assignmentRes.rows.length > 0) {
    const assignmentId = assignmentRes.rows[0].id;

    const submissionRes = await pool.query(
      `SELECT 1 FROM assignment_submissions
       WHERE student_id = $1
       AND assignment_id = $2
       LIMIT 1`,
      [studentId, assignmentId]
    );

    assignmentCompleted = submissionRes.rows.length > 0;
  }

  if (!assignmentCompleted) {
    return { completed: false };
  }

  // 4️⃣ Award badge (prevent duplicates)
  const badgeInsert = await pool.query(
    `INSERT INTO user_badges (user_id, module_id, awarded_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id, module_id) DO NOTHING
     RETURNING *`,
    [studentId, moduleId]
  );

  const badgeAwarded = badgeInsert.rows.length > 0;

  return {
    completed: true,
    badgeAwarded
  };
}

module.exports = {
  checkAndCompleteModule
};