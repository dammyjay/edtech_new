const pool = require("../models/db");
const { getStudentStreak } = require("./streakService");
const { getLevelForXp } = require("../utils/xpLevels");
const { getFrameByKey } = require("../utils/avatarFrames");
const { getEquippableByKey } = require("../utils/shopCatalog");

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
  const [
    xpRes,
    xpTotalRes,
    lessonsRes,
    quizRes,
    assignmentsRes,
    badgesRes,
    labProjectsRes,
    frameUnlocksRes,
    shopUnlocksRes,
    streak,
  ] = await Promise.all([
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
    // Web Lab / Blockly Lab projects (re)submitted this week — status
    // flips to 'submitted' and updated_at bumps on every submit, lesson-
    // linked or freeform playground alike (controllers/labController.js's
    // submitProject). Capped at 5 so a hyperactive kid doesn't blow up
    // the email; ordered newest-first so the cap keeps the latest work.
    pool.query(
      `SELECT project_name, lab_type, updated_at
       FROM lab_projects
       WHERE student_id = $1 AND status = 'submitted' AND updated_at >= $2
       ORDER BY updated_at DESC
       LIMIT 5`,
      [childId, sinceDate]
    ),
    // Avatar frames live in their own table (utils/avatarFrames.js) —
    // separate from the generic user_unlocks below by design (see
    // utils/shopCatalog.js's own comment on why it doesn't touch this).
    pool.query(
      `SELECT frame_key, unlocked_at FROM user_unlocked_frames WHERE user_id = $1 AND unlocked_at >= $2 ORDER BY unlocked_at DESC`,
      [childId, sinceDate]
    ),
    // Profile banners + title tags (utils/shopCatalog.js) — the generic
    // coin-shop ownership table every item type added after avatar frames
    // shares.
    pool.query(
      `SELECT item_type, item_key, unlocked_at FROM user_unlocks WHERE user_id = $1 AND unlocked_at >= $2 ORDER BY unlocked_at DESC`,
      [childId, sinceDate]
    ),
    getStudentStreak(childId),
  ]);

  const newCosmetics = [
    ...frameUnlocksRes.rows.map((r) => {
      const frame = getFrameByKey(r.frame_key);
      return { type: "Avatar Frame", name: frame ? frame.name : r.frame_key };
    }),
    ...shopUnlocksRes.rows.map((r) => {
      const item = getEquippableByKey(r.item_type, r.item_key);
      const typeLabel = r.item_type === "title_tag" ? "Title" : "Profile Banner";
      return { type: typeLabel, name: item ? item.name : r.item_key };
    }),
  ];

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
    labProjects: labProjectsRes.rows,
    newCosmetics,
    streak,
  };
}

function hasActivity(stats) {
  return (
    stats.xpThisWeek > 0 ||
    stats.lessonsCompleted > 0 ||
    stats.quizzes.count > 0 ||
    stats.assignments.count > 0 ||
    stats.newBadges.length > 0 ||
    stats.labProjects.length > 0 ||
    stats.newCosmetics.length > 0
  );
}

module.exports = { getParentsForDigest, getChildrenForParent, getWeeklyStatsForChild, hasActivity };
