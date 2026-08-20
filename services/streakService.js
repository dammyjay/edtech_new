const pool = require("../models/db");

// Daily streak, computed live off user_lesson_progress.completed_at —
// the existing single source of truth for "did this student do work
// today," so no new table is needed to track it. A "day" is compared
// using DATE(completed_at), in the DB's own timezone, matching how the
// rest of this codebase already treats timestamps.
async function getStudentStreak(studentId) {
  const result = await pool.query(
    `SELECT DISTINCT completed_at::date AS day
     FROM user_lesson_progress
     WHERE user_id = $1
     ORDER BY day DESC`,
    [studentId]
  );

  const days = result.rows.map((r) => new Date(r.day).getTime());
  if (!days.length) {
    return { currentStreak: 0, longestStreak: 0, lastActiveDate: null };
  }

  const oneDayMs = 24 * 60 * 60 * 1000;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();

  // Current streak: walk back from today (or yesterday, if nothing was
  // done yet today) counting consecutive days.
  let currentStreak = 0;
  const mostRecent = days[0];
  const gapFromToday = Math.round((todayMs - mostRecent) / oneDayMs);
  if (gapFromToday <= 1) {
    // Still "alive" — either did something today, or did something
    // yesterday and hasn't broken the streak yet today.
    currentStreak = 1;
    for (let i = 1; i < days.length; i++) {
      const gap = Math.round((days[i - 1] - days[i]) / oneDayMs);
      if (gap === 1) {
        currentStreak++;
      } else {
        break;
      }
    }
  }

  // Longest streak ever, for a "personal best" nudge even after a
  // streak breaks.
  let longestStreak = 1;
  let running = 1;
  for (let i = 1; i < days.length; i++) {
    const gap = Math.round((days[i - 1] - days[i]) / oneDayMs);
    if (gap === 1) {
      running++;
    } else {
      running = 1;
    }
    if (running > longestStreak) longestStreak = running;
  }

  return {
    currentStreak,
    longestStreak: Math.max(longestStreak, currentStreak),
    lastActiveDate: result.rows[0].day,
  };
}

module.exports = { getStudentStreak };
