// cron/spacedReviewNudge.js
//
// Spaced-repetition nudge: brings a student back to a lesson they finished
// exactly 5 days ago, while it's still fresh enough to be worth reviewing.
// Distinct from cron/lessonReminderJob.js's "3 days of no activity at all"
// push — that's a general disengagement signal, this is "revisit specific
// material," and both can legitimately fire for the same active student.
//
// No dedup table: running daily and matching on an EXACT date
// (completed_at::date = today - 5 days) means each lesson can only ever
// match on one single day, since completed_at is set once and never
// updated — free, stateless dedup.

const cron = require("node-cron");
const pool = require("../models/db");
const { notifyUser } = require("../utils/notify");

async function runSpacedReviewNudgeJob() {
  try {
    const rows = (
      await pool.query(
        `SELECT ulp.user_id, l.id AS lesson_id, l.title AS lesson_title, m.course_id, c.title AS course_title
         FROM user_lesson_progress ulp
         JOIN lessons l ON l.id = ulp.lesson_id
         JOIN modules m ON m.id = l.module_id
         JOIN courses c ON c.id = m.course_id
         WHERE ulp.completed_at::date = (CURRENT_DATE - INTERVAL '5 days')::date`
      )
    ).rows;

    const byUser = new Map();
    for (const row of rows) {
      if (!byUser.has(row.user_id)) byUser.set(row.user_id, []);
      byUser.get(row.user_id).push(row);
    }
    console.log(`Spaced review nudges: ${byUser.size} student(s) with lessons completed 5 days ago.`);

    for (const [userId, lessons] of byUser) {
      try {
        const first = lessons[0];
        const title =
          lessons.length === 1
            ? `🔁 Time to review: ${first.lesson_title}`
            : `🔁 Time to review ${lessons.length} lessons from last week`;
        const message =
          lessons.length === 1
            ? `You completed this in ${first.course_title} 5 days ago — a quick refresh helps it stick.`
            : `From ${first.course_title}${lessons.length > 1 ? " and more" : ""} — a quick refresh helps it stick.`;

        await notifyUser(userId, {
          type: "spaced_review",
          title,
          message,
          url: `/student/dashboard?section=module&courseId=${first.course_id}`,
        });
      } catch (err) {
        console.error(`Spaced review nudge failed for user ${userId}:`, err.message);
      }
    }

    console.log("Spaced review nudge run complete.");
  } catch (err) {
    console.error("Spaced review nudge job failed:", err);
  }
}

// 10:00 every day
cron.schedule("0 10 * * *", runSpacedReviewNudgeJob);

module.exports = { runSpacedReviewNudgeJob };
