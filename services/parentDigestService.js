const pool = require("../models/db");
const { getStudentStreak } = require("./streakService");
const { getLevelForXp } = require("../utils/xpLevels");

// Every parent linked to at least one child, minus anyone who's opted out
// via the unsubscribe link in the digest email footer.
async function getParentsForDigest() {
  const result = await pool.query(
    `SELECT DISTINCT p.id, p.fullname, p.email
     FROM users2 p
     JOIN parent_children pc ON pc.parent_id = p.id
     WHERE p.role = 'parent' AND COALESCE(p.weekly_digest_opt_out, false) = false`
  );
  return result.rows;
}

// Same shape as the child list controllers/userController.js's
// getParentDashboard already builds (lines 611-618).
async function getChildrenForParent(parentId) {
  const result = await pool.query(
    `SELECT u.id, u.fullname, u.profile_picture
     FROM parent_children pc
     JOIN users2 u ON pc.child_id = u.id
     WHERE pc.parent_id = $1
     ORDER BY u.fullname`,
    [parentId]
  );
  return result.rows;
}

// "This week" = a rolling 7-day window (sinceDate), not a calendar-week
// boundary — matches the existing "went quiet" check in
// cron/lessonReminderJob.js rather than inventing a new convention.
async function getWeeklyStatsForChild(childId, sinceDate) {
  const [xpRes, xpTotalRes, lessonsRes, quizRes, assignmentsRes, badgesRes, streak] = await Promise.all([
    pool.query(`SELECT COALESCE(SUM(xp), 0) AS total FROM xp_history WHERE user_id = $1 AND earned_at >= $2`, [childId, sinceDate]),
    pool.query(`SELECT COALESCE(SUM(xp), 0) AS total FROM xp_history WHERE user_id = $1`, [childId]),
    pool.query(`SELECT COUNT(*) AS count FROM user_lesson_progress WHERE user_id = $1 AND completed_at >= $2`, [childId, sinceDate]),
    pool.query(`SELECT COUNT(*) AS count, AVG(score) AS avg_score FROM quiz_submissions WHERE student_id = $1 AND created_at >= $2`, [
      childId,
      sinceDate,
    ]),
    pool.query(
      `SELECT COUNT(*) AS count, AVG(score) AS avg_score
       FROM assignment_submissions
       WHERE student_id = $1 AND grade IS NOT NULL AND COALESCE(manually_graded_at, created_at) >= $2`,
      [childId, sinceDate]
    ),
    pool.query(
      `SELECT badge_name, badge_image, awarded_at FROM user_badges WHERE user_id = $1 AND awarded_at >= $2 ORDER BY awarded_at DESC`,
      [childId, sinceDate]
    ),
    getStudentStreak(childId),
  ]);

  return {
    xpThisWeek: parseInt(xpRes.rows[0].total, 10) || 0,
    levelInfo: getLevelForXp(xpTotalRes.rows[0].total),
    lessonsCompleted: parseInt(lessonsRes.rows[0].count, 10) || 0,
    quizzes: {
      count: parseInt(quizRes.rows[0].count, 10) || 0,
      avgScore: quizRes.rows[0].avg_score !== null ? Math.round(quizRes.rows[0].avg_score) : null,
    },
    assignments: {
      count: parseInt(assignmentsRes.rows[0].count, 10) || 0,
      avgScore: assignmentsRes.rows[0].avg_score !== null ? Math.round(assignmentsRes.rows[0].avg_score) : null,
    },
    newBadges: badgesRes.rows,
    streak,
  };
}

function hasActivity(stats) {
  return (
    stats.xpThisWeek > 0 ||
    stats.lessonsCompleted > 0 ||
    stats.quizzes.count > 0 ||
    stats.assignments.count > 0 ||
    stats.newBadges.length > 0
  );
}

module.exports = { getParentsForDigest, getChildrenForParent, getWeeklyStatsForChild, hasActivity };
