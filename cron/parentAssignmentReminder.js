const cron = require("node-cron");
const pool = require("../models/db");
const sendEmail = require("../utils/sendEmail");

cron.schedule("0 10 */3 * *", async () => {
  const result = await pool.query(`
    SELECT
      u.email,
      u.fullname,
      COUNT(*) pending_count
    FROM users2 u
    JOIN parent_children pc
      ON pc.parent_id = u.id
    JOIN unlocked_assignments ua
      ON ua.student_id = pc.child_id
    LEFT JOIN assignment_submissions s
      ON s.assignment_id = ua.assignment_id
      AND s.student_id = pc.child_id
    WHERE s.id IS NULL
    GROUP BY u.email,u.fullname
  `);

  for (const parent of result.rows) {
    await sendEmail(
      parent.email,
      "Pending Assignment Reminder",
      `
      Hello ${parent.fullname},

      Your child has ${parent.pending_count}
      pending assignment(s) awaiting submission.

      Please encourage completion.

      Thank you.
      `,
    );
  }
});
