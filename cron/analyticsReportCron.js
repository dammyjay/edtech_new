// cron/analyticsReportCron.js
//
// Scheduled monthly/yearly platform analytics reports, emailed to all
// admins. Shaped like the other cron/*.js files (cron.schedule at load
// time, try/catch, non-crashing on error), but with named exported
// handlers so they can also be triggered on-demand from the admin
// dashboard's "send now" button for testing — the real cron timer only
// fires on the 1st of the month/year, which makes that path hard to
// verify otherwise.

const cron = require("node-cron");
const pool = require("../models/db");
const { generatePlatformReport } = require("../services/reportOrchestratorService");
const sendEmailWithAttachment = require("../utils/sendEmailWithAttachment");
const { sendEmailWithAttachments } = sendEmailWithAttachment;

async function getAdminRecipients() {
  const result = await pool.query(`SELECT id, fullname, email FROM users2 WHERE role='admin'`);
  return result.rows;
}

async function emailReportToAdmins(result, subjectLabel) {
  const admins = await getAdminRecipients();

  for (const admin of admins) {
    try {
      await sendEmailWithAttachments(
        admin.email,
        `Platform Analytics Report — ${subjectLabel}`,
        `<p>Hi ${admin.fullname || "Admin"},</p><p>Attached is the platform analytics report for <strong>${subjectLabel}</strong>.</p>`,
        result.files.map((f) => ({ filename: f.filename, buffer: f.buffer })),
        ["jaykirchtechhub@gmail.com"]
      );
    } catch (err) {
      console.error(`Failed to email report to admin ${admin.email}:`, err.message);
    }
  }
}

async function runMonthlyReportJob() {
  try {
    const now = new Date();
    // Report on the month that just completed (this job fires on the 1st).
    const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const year = prevMonthDate.getFullYear();
    const month = prevMonthDate.getMonth() + 1;

    console.log(`Running scheduled monthly analytics report for ${month}/${year}...`);

    const result = await generatePlatformReport({
      scope: "month",
      year,
      month,
      formats: ["pdf", "excel", "pptx"],
      triggeredBy: "cron",
    });

    await emailReportToAdmins(result, result.periodLabel);
    console.log(`Monthly analytics report for ${result.periodLabel} emailed to admins.`);
  } catch (err) {
    console.error("Monthly analytics report job failed:", err);
  }
}

async function runYearlyReportJob() {
  try {
    const now = new Date();
    const year = now.getFullYear() - 1;

    console.log(`Running scheduled yearly analytics report for ${year}...`);

    const result = await generatePlatformReport({
      scope: "year",
      year,
      formats: ["pdf", "excel", "pptx"],
      triggeredBy: "cron",
    });

    await emailReportToAdmins(result, result.periodLabel);
    console.log(`Yearly analytics report for ${result.periodLabel} emailed to admins.`);
  } catch (err) {
    console.error("Yearly analytics report job failed:", err);
  }
}

// 06:00 on the 1st of every month
cron.schedule("0 6 1 * *", runMonthlyReportJob);

// 06:00 on January 1st
cron.schedule("0 6 1 1 *", runYearlyReportJob);

module.exports = { runMonthlyReportJob, runYearlyReportJob };
