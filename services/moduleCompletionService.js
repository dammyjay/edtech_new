// // services/moduleCompletionService.js

// const pool = require("../models/db");

// async function checkAndCompleteModule(studentId, moduleId) {

//   // 1️⃣ Get only lessons that have quizzes
//   const lessonsRes = await pool.query(
//     `SELECT l.id 
//      FROM lessons l
//      JOIN quizzes q ON q.lesson_id = l.id
//      WHERE l.module_id = $1`,
//     [moduleId]
//   );

//   const lessonIds = lessonsRes.rows.map(l => l.id);
//   if (lessonIds.length === 0) return { completed: false };

//   // 2️⃣ Check completed lessons
//   const completedRes = await pool.query(
//     `SELECT COUNT(DISTINCT lesson_id) AS count
//      FROM user_lesson_progress
//      WHERE user_id = $1
//      AND lesson_id = ANY($2)`,
//     [studentId, lessonIds]
//   );

//   const completedLessons = parseInt(completedRes.rows[0].count);

//   if (completedLessons !== lessonIds.length) {
//     return { completed: false };
//   }

//   // 3️⃣ Check assignment
//   const assignmentRes = await pool.query(
//     `SELECT id FROM module_assignments WHERE module_id = $1 LIMIT 1`,
//     [moduleId]
//   );

//   let assignmentCompleted = true;

//   if (assignmentRes.rows.length > 0) {
//     const assignmentId = assignmentRes.rows[0].id;

//     const submissionRes = await pool.query(
//       `SELECT 1 FROM assignment_submissions
//        WHERE student_id = $1
//        AND assignment_id = $2
//        LIMIT 1`,
//       [studentId, assignmentId]
//     );

//     assignmentCompleted = submissionRes.rows.length > 0;
//   }

//   if (!assignmentCompleted) {
//     return { completed: false };
//   }

//   // 4️⃣ Award badge
//   const badgeInsert = await pool.query(
//     `INSERT INTO user_badges (user_id, module_id, awarded_at)
//      VALUES ($1, $2, NOW())
//      ON CONFLICT (user_id, module_id) DO NOTHING
//      RETURNING *`,
//     [studentId, moduleId]
//   );

//   const badgeAwarded = badgeInsert.rows.length > 0;

//   return {
//     completed: true,
//     badgeAwarded
//   };
// }

// module.exports = {
//   checkAndCompleteModule
// };

// services/moduleCompletionService.js

const pool = require("../models/db");

async function checkAndCompleteModule(studentId, moduleId) {
  try {
    // 1️⃣ Get lessons that have quizzes
    const lessonsRes = await pool.query(
      `SELECT l.id 
       FROM lessons l
       JOIN quizzes q ON q.lesson_id = l.id
       WHERE l.module_id = $1`,
      [moduleId]
    );

    const lessonIds = lessonsRes.rows.map(l => l.id);

    if (lessonIds.length === 0) {
      return { completed: false, badgeAwarded: false };
    }

    // 2️⃣ Count completed lessons
    const completedRes = await pool.query(
      `SELECT COUNT(DISTINCT lesson_id) AS count
       FROM user_lesson_progress
       WHERE user_id = $1
       AND lesson_id = ANY($2)`,
      [studentId, lessonIds]
    );

    const completedLessons = parseInt(completedRes.rows[0].count);

    if (completedLessons !== lessonIds.length) {
      return { completed: false, badgeAwarded: false };
    }

    // 3️⃣ Check assignment
    const assignmentRes = await pool.query(
      `SELECT id FROM module_assignments WHERE module_id = $1 LIMIT 1`,
      [moduleId]
    );

    if (assignmentRes.rows.length > 0) {
      const assignmentId = assignmentRes.rows[0].id;

      const submissionRes = await pool.query(
        `SELECT 1 FROM assignment_submissions
         WHERE student_id = $1
         AND assignment_id = $2
         LIMIT 1`,
        [studentId, assignmentId]
      );

      if (submissionRes.rows.length === 0) {
        return { completed: false, badgeAwarded: false };
      }
    }

    // 4️⃣ Check if badge already exists
    const existingBadge = await pool.query(
      `SELECT 1 FROM user_badges 
       WHERE user_id = $1 AND module_id = $2`,
      [studentId, moduleId]
    );

    if (existingBadge.rows.length > 0) {
      return { completed: true, badgeAwarded: false };
    }

    // 5️⃣ Get module info (optional but recommended)
    const moduleRes = await pool.query(
      `SELECT title, badge_image FROM modules WHERE id = $1`,
      [moduleId]
    );

    const badgeName = moduleRes.rows[0]?.title || "Module Completed";
    const badgeImage = moduleRes.rows[0]?.badge_image || null;

    // 6️⃣ Insert badge
    await pool.query(
      `INSERT INTO user_badges 
       (user_id, module_id, badge_name, badge_image, awarded_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [studentId, moduleId, badgeName, badgeImage]
    );

    return {
      completed: true,
      badgeAwarded: true,
      badgeName,
      badgeImage
    };

  } catch (err) {
    console.error("Module completion error:", err.message);
    return { completed: false, badgeAwarded: false };
  }
}

module.exports = {
  checkAndCompleteModule
};

