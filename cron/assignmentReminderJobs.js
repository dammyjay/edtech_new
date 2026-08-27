// cron/assignmentReminderJobs.js
//
// This file used to have a near-exact duplicate in cron/parentAssignmentReminder.js
// (same query, same "0 10 */3 * *" schedule) — parents were getting this
// reminder twice, from two separate cron jobs, every 3 days. That file has
// been removed; this is now the single source of truth for both the
// parent-facing email and the student-facing in-app reminder.
const cron = require("node-cron");
const pool = require("../models/db");
const sendEmail = require("../utils/sendEmail");
const { notifyUser } = require("../utils/notify");

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

    try {
      await sendEmail(parent.email, "Pending Assignment Reminder", message);
      console.log(`Reminder sent to ${parent.email}`);
    } catch (err) {
      console.error(`Assignment reminder failed for ${parent.email}:`, err.message);
    }
  }
});

// Same "any pending, unsubmitted assignment" check, for the student
// themselves — this previously called an undefined createNotification()
// (never imported anywhere in this file), so it silently never sent
// anything. Now wired to the real notification system.
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
    try {
      await notifyUser(student.id, {
        type: "assignment_reminder",
        title: "Assignment Reminder",
        message: "You have pending assignments waiting for submission.",
        url: "/student/dashboard",
      });
    } catch (err) {
      console.error(`Student assignment reminder failed for user ${student.id}:`, err.message);
    }
  }
});
