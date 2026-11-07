// services/portfolioUpdateNotifier.js
//
// Fired exactly once per real portfolio-worthy event — a new badge
// (services/moduleCompletionService.js) or a new certificate
// (services/issueCertificate.js), both of which already guard against
// re-firing for something already awarded. Two things happen:
//
//   1. The student's aggregate ("full CV") AI overview is regenerated,
//      so it reflects the update immediately rather than waiting for the
//      student to notice and click "Regenerate" themselves — a
//      deliberate reversal of this feature's original "explicit,
//      student-triggered, bounded AI cost" design, per the client's
//      request; every badge and certificate now costs one extra
//      askTutor() call.
//   2. An email goes out to every linked parent, the school admin (if
//      the student belongs to a school), and every platform admin, each
//      with a link to their own role's read-only view of the student's
//      portfolio. Fired for BOTH badges and certificates, not just
//      certificates — also the client's explicit choice, aware this
//      means admins get an email for every single module badge
//      platform-wide, not just course completions.
//
// Always called fire-and-forget by its callers (never awaited) so a
// slow AI call or email send can never delay the student's own
// quiz-submit/dashboard-load response.
const pool = require("../models/db");
const sendEmail = require("../utils/sendEmail");
const { generateAndSaveSummary } = require("./portfolioService");

const BASE_URL = "https://acad.jkthub.com";

async function getRecipients(studentId) {
  const [parentsRes, schoolAdminRes, platformAdminsRes] = await Promise.all([
    pool.query(
      `SELECT u.email, u.fullname FROM parent_children pc JOIN users2 u ON u.id = pc.parent_id WHERE pc.child_id = $1`,
      [studentId]
    ),
    // schools.created_by is the confirmed real "school admin" linkage —
    // same pattern used throughout cron/lessonTaskReminderJobs.js.
    pool.query(
      `SELECT sa.email, sa.fullname
       FROM user_school us
       JOIN schools s ON s.id = us.school_id
       JOIN users2 sa ON sa.id = s.created_by
       WHERE us.user_id = $1 AND us.role_in_school = 'student' AND us.approved = true
       LIMIT 1`,
      [studentId]
    ),
    pool.query(`SELECT email, fullname FROM users2 WHERE role = 'admin'`),
  ]);

  return {
    parents: parentsRes.rows,
    schoolAdmin: schoolAdminRes.rows[0] || null,
    platformAdmins: platformAdminsRes.rows,
  };
}

function emailBody({ recipientName, studentName, kindLabel, title, portfolioUrl }) {
  return `
    <p>Hello ${recipientName || ""},</p>
    <p><strong>${studentName}</strong> just ${kindLabel}: <strong>${title}</strong> 🎉</p>
    <p><a href="${portfolioUrl}">View their portfolio</a></p>
  `;
}

async function notifyPortfolioUpdate(studentId, { kind, title }) {
  try {
    await generateAndSaveSummary(studentId);
  } catch (err) {
    console.error("notifyPortfolioUpdate: AI overview regen failed:", err.message);
  }

  try {
    const studentRes = await pool.query(`SELECT fullname FROM users2 WHERE id = $1`, [studentId]);
    const studentName = studentRes.rows[0]?.fullname || "A student";
    const kindLabel = kind === "certificate" ? "earned a certificate" : "earned a new badge";
    const subject = `🎉 ${studentName} just ${kindLabel}: ${title}`;

    const { parents, schoolAdmin, platformAdmins } = await getRecipients(studentId);

    for (const parent of parents) {
      if (!parent.email) continue;
      sendEmail(
        parent.email,
        subject,
        emailBody({
          recipientName: parent.fullname,
          studentName,
          kindLabel,
          title,
          portfolioUrl: `${BASE_URL}/parent/child/${studentId}/portfolio`,
        })
      ).catch((err) => console.error("notifyPortfolioUpdate: parent email failed:", err.message));
    }

    if (schoolAdmin?.email) {
      sendEmail(
        schoolAdmin.email,
        subject,
        emailBody({
          recipientName: schoolAdmin.fullname,
          studentName,
          kindLabel,
          title,
          portfolioUrl: `${BASE_URL}/school-admin/students/${studentId}/portfolio`,
        })
      ).catch((err) => console.error("notifyPortfolioUpdate: school admin email failed:", err.message));
    }

    for (const admin of platformAdmins) {
      if (!admin.email) continue;
      sendEmail(
        admin.email,
        subject,
        emailBody({
          recipientName: admin.fullname,
          studentName,
          kindLabel,
          title,
          portfolioUrl: `${BASE_URL}/admin/students/${studentId}/portfolio`,
        })
      ).catch((err) => console.error("notifyPortfolioUpdate: platform admin email failed:", err.message));
    }
  } catch (err) {
    console.error("notifyPortfolioUpdate failed:", err.message);
  }
}

module.exports = { notifyPortfolioUpdate };
