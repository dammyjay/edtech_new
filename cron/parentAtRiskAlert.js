// cron/parentAtRiskAlert.js
//
// Turns the already-existing at-risk detection in
// services/classroomTermAnalyticsService.js (completion<40% or quiz<50%,
// only ever surfaced today via a teacher/school-admin dashboard view) into
// a proactive parent alert. In-app + push only (utils/notify.js), not
// email — sidesteps the Brevo daily-quota constraint entirely and better
// fits something meant to be seen promptly rather than batched weekly.
//
// No "already alerted" dedup, matching every other reminder-style cron in
// this codebase (cron/lessonReminderJob.js, the assignment reminders) — a
// student who stays at-risk gets a fresh alert each run. Deliberate scoping
// choice, not an oversight.

const cron = require("node-cron");
const pool = require("../models/db");
const { computeClassroomTermAnalytics } = require("../services/classroomTermAnalyticsService");
const { notifyUser } = require("../utils/notify");

async function runAtRiskAlertJob() {
  try {
    const classroomsRes = await pool.query(
      `SELECT c.id AS classroom_id, c.school_id
       FROM classrooms c
       JOIN academic_terms t ON t.school_id = c.school_id AND t.is_active = true`
    );
    console.log(`At-risk parent alerts: scanning ${classroomsRes.rows.length} classroom(s) with an active term...`);

    let alertCount = 0;
    for (const { classroom_id, school_id } of classroomsRes.rows) {
      try {
        const analytics = await computeClassroomTermAnalytics(school_id, classroom_id, null);
        if (!analytics || !analytics.atRiskStudents.length) continue;

        for (const student of analytics.atRiskStudents) {
          try {
            const parentsRes = await pool.query(
              `SELECT parent_id FROM parent_children WHERE child_id = $1`,
              [student.id]
            );
            for (const { parent_id } of parentsRes.rows) {
              await notifyUser(parent_id, {
                type: "at_risk_alert",
                title: `${student.fullname} may need some extra support`,
                message: `${analytics.selectedTerm.name}: ${student.completionPercent}% of lessons complete, ${student.quizAvg}% quiz average.`,
                url: "/parent/dashboard",
              });
              alertCount++;
            }
          } catch (err) {
            console.error(`At-risk alert failed for student ${student.id}:`, err.message);
          }
        }
      } catch (err) {
        console.error(`At-risk scan failed for classroom ${classroom_id}:`, err.message);
      }
    }

    console.log(`At-risk parent alerts: sent ${alertCount} alert(s).`);
  } catch (err) {
    console.error("At-risk parent alert job failed:", err);
  }
}

// 09:00 every Wednesday — mid-week, clear of the digest's Monday-heavy load.
cron.schedule("0 9 * * 3", runAtRiskAlertJob);

module.exports = { runAtRiskAlertJob };
