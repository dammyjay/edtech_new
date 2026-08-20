const cron = require("node-cron");
const pool = require("../models/db");
const webpush = require("../utils/webpushConfig");

// Daily nudge for students who've gone quiet — the one real gap the
// engagement audit found: push infrastructure existed (push_subscriptions)
// but was only ever used for broadcast article alerts, and even that had
// a bug (queried a different, empty table — see controllers/articleController.js).
// Only reaches subscriptions with a user_id (i.e. captured while the
// student was logged in — see routes/userRoutes.js POST /subscribe);
// anonymous subscriptions are skipped since there's no student to check
// activity for.
cron.schedule("0 9 * * *", async () => {
  console.log("Checking for students to send a come-back-and-learn reminder to...");

  let result;
  try {
    result = await pool.query(`
      SELECT ps.id AS subscription_id, ps.endpoint, ps.keys, u.fullname
      FROM push_subscriptions ps
      JOIN users2 u ON u.id = ps.user_id
      WHERE ps.user_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM user_lesson_progress ulp
          WHERE ulp.user_id = ps.user_id
            AND ulp.completed_at >= NOW() - INTERVAL '3 days'
        )
    `);
  } catch (err) {
    console.error("Lesson reminder job: failed to query subscriptions:", err.message);
    return;
  }

  const payload = JSON.stringify({
    title: "We miss you! 👋",
    message: "You haven't practiced in a few days — come keep your streak going!",
    url: "/student/dashboard",
  });

  for (const sub of result.rows) {
    let keys;
    try {
      keys = typeof sub.keys === "string" ? JSON.parse(sub.keys) : sub.keys;
    } catch (err) {
      continue; // malformed subscription, skip it
    }

    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys }, payload);
    } catch (err) {
      console.error(`Lesson reminder: failed to notify subscription ${sub.subscription_id}:`, err.message);
    }
  }

  console.log(`Lesson reminder job: sent to ${result.rows.length} subscription(s).`);
});
