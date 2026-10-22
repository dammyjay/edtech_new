// cron/lessonTaskReminderJobs.js
//
// Daily poller (not a per-weekday cron.schedule like parentAtRiskAlert.js
// or weeklyLeaderboardCoins.js) because each school's class day(s) are a
// runtime DB value, not a fixed cron expression — one job checks every
// school's own schedule instead of needing a dynamically (re-)registered
// schedule per school.
//
// Reminds the SCHOOL ADMIN (schools.created_by -> users2, the confirmed
// real linkage — user_school.role_in_school='school_admin' has no real
// rows) by email (always) and WhatsApp (only if a usable number exists —
// see utils/phoneFormat.js) exactly leadDays before the school's next
// class day, for every lesson task that isn't fully complete yet and
// hasn't already been reminded for that date.
const cron = require("node-cron");
const pool = require("../models/db");
const sendEmail = require("../utils/sendEmail");
const { sendWhatsAppTemplate } = require("../utils/sendWhatsApp");
const { toWhatsAppNumber } = require("../utils/phoneFormat");
const { isReminderDueToday } = require("../services/classDayService");
const { getPendingTasksForSchool, markTasksReminded } = require("../services/lessonTaskService");

const LEAD_DAYS = 2;

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function buildEmailHtml(school, upcomingClassDateStr, tasks) {
  const rows = tasks
    .map(
      (t) => `<li><strong>${t.title}</strong> — ${t.classroom_name}: ${t.completedStudents} of ${t.totalStudents} students done</li>`
    )
    .join("");
  return `
    <h2>Upcoming Class Reminder</h2>
    <p>Hello,</p>
    <p>${school.name}'s next class is on <strong>${upcomingClassDateStr}</strong>. The following lesson tasks still have students who haven't finished:</p>
    <ul>${rows}</ul>
    <p>Please follow up with the students who still have pending tasks before class.</p>
  `;
}

async function runLessonTaskReminderJob() {
  const today = new Date();
  const upcomingClassDate = new Date(today);
  upcomingClassDate.setDate(today.getDate() + LEAD_DAYS);
  const upcomingClassDateStr = formatDate(upcomingClassDate);

  const schoolsRes = await pool.query(
    `SELECT id, name, created_by, class_days FROM schools WHERE class_days IS NOT NULL`
  );

  for (const school of schoolsRes.rows) {
    if (!isReminderDueToday(school.class_days, today, LEAD_DAYS)) continue;

    const pendingTasks = await getPendingTasksForSchool(school.id, upcomingClassDateStr);
    if (pendingTasks.length === 0) continue;

    if (!school.created_by) {
      console.error(`Lesson task reminder: school ${school.id} (${school.name}) has no created_by admin to notify.`);
      continue;
    }
    const adminRes = await pool.query(
      `SELECT email, phone, fullname FROM users2 WHERE id = $1`,
      [school.created_by]
    );
    const admin = adminRes.rows[0];
    if (!admin) continue;

    const html = buildEmailHtml(school, upcomingClassDateStr, pendingTasks);

    if (admin.email) {
      try {
        await sendEmail(admin.email, `Upcoming class reminder for ${school.name}`, html);
      } catch (err) {
        console.error(`Lesson task reminder email failed for school ${school.id}:`, err.message);
      }
    }

    const whatsAppNumber = toWhatsAppNumber(admin.phone);
    if (whatsAppNumber) {
      try {
        await sendWhatsAppTemplate(whatsAppNumber, [school.name, String(pendingTasks.length), upcomingClassDateStr]);
      } catch (err) {
        console.error(`Lesson task reminder WhatsApp failed for school ${school.id}:`, err.message);
      }
    }

    await markTasksReminded(pendingTasks.map((t) => t.id), upcomingClassDateStr);
  }
}

cron.schedule("0 18 * * *", () => {
  console.log("Checking lesson task reminders...");
  runLessonTaskReminderJob().catch((err) => console.error("Lesson task reminder job failed:", err.message));
});

module.exports = { runLessonTaskReminderJob };
