// cron/weeklyLeaderboardCoins.js
//
// Awards coins to the top 3 of each classroom's weekly leaderboard —
// reuses the same "classrooms with an active term" enumeration as
// cron/parentAtRiskAlert.js and the same computeClassroomTermAnalytics
// call (confirmed cheap: ~8 batched queries per classroom, no N+1).
//
// In-app + push only (utils/notify.js), not email — this is a nice-to-have
// nudge, not worth the Brevo daily-quota cost the way an at-risk alert is.

const cron = require("node-cron");
const pool = require("../models/db");
const { computeClassroomTermAnalytics } = require("../services/classroomTermAnalyticsService");
const { awardCoins } = require("../services/coinService");
const { notifyUser } = require("../utils/notify");

const PLACEMENT_COINS = [50, 30, 15]; // 1st, 2nd, 3rd

async function runWeeklyLeaderboardCoinsJob() {
  try {
    const classroomsRes = await pool.query(
      `SELECT c.id AS classroom_id, c.school_id
       FROM classrooms c
       JOIN academic_terms t ON t.school_id = c.school_id AND t.is_active = true`
    );
    console.log(`Weekly leaderboard coins: scanning ${classroomsRes.rows.length} classroom(s) with an active term...`);

    let awardedCount = 0;
    for (const { classroom_id, school_id } of classroomsRes.rows) {
      try {
        const analytics = await computeClassroomTermAnalytics(school_id, classroom_id, null);
        if (!analytics || !analytics.leaderboard.length) continue;

        const topThree = analytics.leaderboard.slice(0, 3);
        for (let i = 0; i < topThree.length; i++) {
          const student = topThree[i];
          const coins = PLACEMENT_COINS[i];
          try {
            await awardCoins(student.id, coins, `Weekly leaderboard #${i + 1} — ${analytics.classroom.name}`);
            await notifyUser(student.id, {
              type: "leaderboard_coins",
              title: `🏆 #${i + 1} on the class leaderboard!`,
              message: `You earned ${coins} coins for this week's placement in ${analytics.classroom.name}.`,
              url: "/student/dashboard?section=leaderboard",
            });
            awardedCount++;
          } catch (err) {
            console.error(`Leaderboard coin award failed for student ${student.id}:`, err.message);
          }
        }
      } catch (err) {
        console.error(`Weekly leaderboard scan failed for classroom ${classroom_id}:`, err.message);
      }
    }

    console.log(`Weekly leaderboard coins: awarded ${awardedCount} placement(s).`);
  } catch (err) {
    console.error("Weekly leaderboard coins job failed:", err);
  }
}

// 20:00 every Sunday — after the week's activity is done, ahead of Monday.
cron.schedule("0 20 * * 0", runWeeklyLeaderboardCoinsJob);

module.exports = { runWeeklyLeaderboardCoinsJob };
