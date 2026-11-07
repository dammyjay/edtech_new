// cron/weeklyArcadeChampion.js
//
// Platform-wide (not per-classroom — a deliberate choice, unlike
// cron/weeklyLeaderboardCoins.js's per-classroom placements) weekly
// Arcade champion: whichever student earned the most arcade XP in the
// past 7 days gets a coin prize. "Most XP earned" rather than "single
// highest score" so it rewards actually playing a lot, not one lucky
// round in an easy game (see controllers/studentController.js's
// reportArcadeScore for how XP is awarded per play).
const cron = require("node-cron");
const pool = require("../models/db");
const { awardCoins } = require("../services/coinService");
const { notifyUser } = require("../utils/notify");

const CHAMPION_COINS = 100;

async function runWeeklyArcadeChampionJob() {
  try {
    // Postgres date_trunc('week', ...) starts on Monday — matches the
    // Sunday 20:xx cron time being "the week that's just ending".
    const weekStartRes = await pool.query(`SELECT date_trunc('week', CURRENT_DATE)::date AS week_start`);
    const weekStart = weekStartRes.rows[0].week_start;

    const alreadyAwarded = await pool.query(`SELECT id FROM arcade_weekly_champions WHERE week_start = $1`, [weekStart]);
    if (alreadyAwarded.rows.length) {
      console.log("Weekly arcade champion: already awarded for this week, skipping.");
      return;
    }

    const topRes = await pool.query(
      `SELECT student_id, SUM(xp_awarded) AS total_xp
       FROM arcade_plays
       WHERE played_at >= NOW() - INTERVAL '7 days'
       GROUP BY student_id
       ORDER BY total_xp DESC
       LIMIT 1`
    );
    const top = topRes.rows[0];
    if (!top || Number(top.total_xp) <= 0) {
      console.log("Weekly arcade champion: no arcade activity this week, skipping.");
      return;
    }

    await pool.query(
      `INSERT INTO arcade_weekly_champions (week_start, student_id, total_xp) VALUES ($1, $2, $3)
       ON CONFLICT (week_start) DO NOTHING`,
      [weekStart, top.student_id, top.total_xp]
    );
    await awardCoins(top.student_id, CHAMPION_COINS, "Weekly Arcade Champion");
    await notifyUser(top.student_id, {
      type: "arcade_champion",
      title: "🏆 You're this week's Arcade Champion!",
      message: `You earned the most Arcade XP of anyone on the platform this week and won ${CHAMPION_COINS} coins.`,
      url: "/student/arcade",
    });

    console.log(`Weekly arcade champion: awarded student ${top.student_id} (${top.total_xp} XP).`);
  } catch (err) {
    console.error("Weekly arcade champion job failed:", err.message);
  }
}

// Sunday 20:05 — a few minutes after cron/weeklyLeaderboardCoins.js's
// 20:00 run, just to avoid both jobs hitting the DB in the same instant.
cron.schedule("5 20 * * 0", runWeeklyArcadeChampionJob);

module.exports = { runWeeklyArcadeChampionJob };
