// cron/adminReminderJobs.js
//
// Drives services/adminReminderService.js's two time-based transitions:
// resending a still-pending reminder every resend_interval_days, and
// sending the single day-before-due-date follow-up once a reply has
// been AI-judged as understood. Runs hourly (rather than once daily like
// cron/lessonTaskReminderJobs.js) since resend_interval_days and the
// due-date follow-up are both admin-chosen, arbitrary dates/times, not
// tied to a fixed daily school schedule.
const cron = require("node-cron");
const { processDueResends, processDueFollowups } = require("../services/adminReminderService");

async function runAdminReminderJob() {
  await processDueResends();
  await processDueFollowups();
}

cron.schedule("0 * * * *", () => {
  console.log("Checking admin reminders (resends/follow-ups)...");
  runAdminReminderJob().catch((err) => console.error("Admin reminder job failed:", err.message));
});

module.exports = { runAdminReminderJob };
