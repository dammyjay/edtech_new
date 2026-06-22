const cron = require("node-cron");
const pool = require("../models/db");
const sendEmail = require("../utils/sendEmail");

cron.schedule("0 10 */3 * *", async () => {
  console.log("Checking parent assignment reminders...");

  const result = await pool.query(`
    SELECT
      u.email,
      u.fullname,
      COUNT(*) AS pending_count
    FROM users2 u
    JOIN parent_children pc
      ON pc.parent_id = u.id

    JOIN unlocked_assignments ua
      ON ua.student_id = pc.child_id

    LEFT JOIN assignment_submissions s
      ON s.assignment_id = ua.assignment_id
     AND s.student_id = pc.child_id

    WHERE s.id IS NULL

    GROUP BY u.email, u.fullname
  `);

  for (const parent of result.rows) {
    const message = `
      <h2>Assignment Reminder</h2>

      <p>Hello ${parent.fullname},</p>

      <p>
        Your child currently has
        <strong>${parent.pending_count}</strong>
        pending assignment(s).
      </p>

      <p>
        Please encourage them to complete the assignments.
      </p>
    `;

    await sendEmail(parent.email, "Pending Assignment Reminder", message);

    console.log(`Reminder sent to ${parent.email}`);
  }
});


cron.schedule("0 9 * * *", async () => {
  const result = await pool.query(`
    SELECT DISTINCT
      u.id,
      u.fullname
    FROM users2 u
    JOIN unlocked_assignments ua
      ON ua.student_id=u.id
    LEFT JOIN assignment_submissions s
      ON s.assignment_id=ua.assignment_id
     AND s.student_id=u.id
    WHERE s.id IS NULL
  `);

  for (const student of result.rows) {
    await createNotification({
      userId: student.id,
      title: "Assignment Reminder",
      message: "You have pending assignments waiting for submission.",
    });
  }
});