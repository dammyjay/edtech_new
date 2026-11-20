// services/lessonTaskReminderReplyService.js
//
// Lightweight reply tracking for cron/lessonTaskReminderJobs.js — one row
// per actual send (school admin, teacher, or parent), so an inbound
// reply (same webhook as services/adminReminderService.js — see
// controllers/webhookController.js) can be matched back to who it was
// sent to and what it was about. Deliberately simpler than
// adminReminderService's target/status state machine: a lesson task
// reminder isn't a negotiation with one school needing an
// understood/unclear verdict, it's a daily nag to three different
// recipient groups until the class happens, so a reply just needs to
// reach a human, not drive a workflow.
const pool = require("../models/db");
const { notifyUser } = require("../utils/notify");

function replyToEmailFor(sendId) {
  const domain = process.env.BREVO_INBOUND_DOMAIN;
  return domain ? `lt-reminder-${sendId}@${domain}` : undefined;
}

async function recordSend({ schoolId, recipientUserId, recipientRole, recipientEmail, recipientPhone, summary }) {
  const res = await pool.query(
    `INSERT INTO lesson_task_reminder_sends
       (school_id, recipient_user_id, recipient_role, recipient_email, recipient_phone, summary)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [schoolId, recipientUserId || null, recipientRole, recipientEmail || null, recipientPhone || null, summary]
  );
  return res.rows[0].id;
}

// Matches a reply by the SENDER's own email/phone against this
// person's most recent lesson-task-reminder send — same sender-based
// matching adminReminderService.findOpenTargetForSender already uses,
// rather than parsing the reply-to address.
async function findOpenSendForSender({ phone, email }) {
  if (!email && !phone) return null;

  const normalizedPhone = phone ? phone.replace(/\D/g, "").slice(-10) : null;
  const res = await pool.query(
    `SELECT lts.id, lts.school_id, lts.recipient_user_id, lts.recipient_role, lts.summary,
            s.name AS school_name
     FROM lesson_task_reminder_sends lts
     JOIN schools s ON s.id = lts.school_id
     WHERE ($1::text IS NOT NULL AND LOWER(lts.recipient_email) = LOWER($1))
        OR ($2::text IS NOT NULL AND lts.recipient_phone LIKE '%' || $2)
     ORDER BY lts.sent_at DESC
     LIMIT 1`,
    [email || null, normalizedPhone]
  );
  return res.rows[0] || null;
}

async function recordReply({ sendId, channel, text }) {
  const sendRes = await pool.query(
    `SELECT lts.*, s.name AS school_name FROM lesson_task_reminder_sends lts
     JOIN schools s ON s.id = lts.school_id WHERE lts.id = $1`,
    [sendId]
  );
  const send = sendRes.rows[0];
  if (!send) return null;

  const title = `Reply to a lesson task reminder — ${send.school_name}`;
  const message = `${send.recipient_role.replace("_", " ")} at ${send.school_name} replied via ${channel}: "${text}"${
    send.summary ? ` (re: ${send.summary})` : ""
  }`;
  const url = "/admin/schools/" + send.school_id;

  const admins = await pool.query(`SELECT id FROM users2 WHERE role = 'admin'`);
  for (const row of admins.rows) {
    await notifyUser(row.id, { type: "lesson_task_reminder_reply", title, message, url, email: true });
  }

  return { sendId, schoolId: send.school_id, recipientRole: send.recipient_role };
}

module.exports = { replyToEmailFor, recordSend, findOpenSendForSender, recordReply };
