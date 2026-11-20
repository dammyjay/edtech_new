// services/adminReminderService.js
//
// General admin-to-school reminders — distinct from the per-task lesson
// reminders in cron/lessonTaskReminderJobs.js. An admin writes a one-off
// message (not tied to a lesson task) and picks which school(s) get it.
// Each (reminder, school) pair is an admin_reminder_targets row, which is
// the unit everything below actually operates on:
//
//   pending --(resend every resend_interval_days)--> still pending
//      |
//      `--(any reply arrives)--> 'understood' (AI judged it) or 'unclear'
//
//   'understood' targets get exactly one follow-up check-in the day
//   before due_date (cron/adminReminderJobs.js), then move to
//   'followup_sent'. 'unclear' targets wait for an admin to look —
//   see markUnderstoodManually.
const pool = require("../models/db");
const sendEmail = require("../utils/sendEmail");
const { sendWhatsAppTemplate } = require("../utils/sendWhatsApp");
const { toWhatsAppNumber } = require("../utils/phoneFormat");
const { classifyReminderReply } = require("../utils/ai");
const { notifyUser } = require("../utils/notify");

const BASE_URL = "https://acad.jkthub.com";

function dashboardLinkFor(role) {
  return role === "teacher" ? `${BASE_URL}/teacher/dashboard` : `${BASE_URL}/school-admin/dashboard`;
}

function replyToEmailFor(targetId) {
  const domain = process.env.BREVO_INBOUND_DOMAIN;
  return domain ? `reminder-${targetId}@${domain}` : undefined;
}

function formatDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}

const ALL_ROLES = ["school_admin", "teacher", "parent"];

// School admin (schools.created_by — the confirmed real linkage, same as
// cron/lessonTaskReminderJobs.js) + every teacher assigned to one of the
// school's classrooms + every parent of one of the school's students —
// filtered down to whichever of those three the reminder's creator
// actually picked (targetRoles).
async function getSchoolRecipients(schoolId, targetRoles = ALL_ROLES) {
  const recipients = [];
  const roles = Array.isArray(targetRoles) && targetRoles.length ? targetRoles : ALL_ROLES;

  const schoolRes = await pool.query(`SELECT created_by FROM schools WHERE id = $1`, [schoolId]);
  const createdBy = schoolRes.rows[0]?.created_by;
  if (roles.includes("school_admin") && createdBy) {
    const adminRes = await pool.query(`SELECT id, fullname, email, phone FROM users2 WHERE id = $1`, [createdBy]);
    if (adminRes.rows[0]) recipients.push({ ...adminRes.rows[0], role: "school_admin" });
  }

  if (roles.includes("teacher")) {
    const teacherRes = await pool.query(
      `SELECT DISTINCT u.id, u.fullname, u.email, u.phone
       FROM classroom_teachers ct
       JOIN classrooms c ON c.id = ct.classroom_id
       JOIN users2 u ON u.id = ct.teacher_id
       WHERE c.school_id = $1`,
      [schoolId]
    );
    for (const row of teacherRes.rows) {
      if (row.id !== createdBy) recipients.push({ ...row, role: "teacher" });
    }
  }

  if (roles.includes("parent")) {
    const parentRes = await pool.query(
      `SELECT DISTINCT u.id, u.fullname, u.email, u.phone
       FROM parent_children pc
       JOIN user_school us ON us.user_id = pc.child_id AND us.role_in_school = 'student'
       JOIN users2 u ON u.id = pc.parent_id
       WHERE us.school_id = $1`,
      [schoolId]
    );
    for (const row of parentRes.rows) {
      recipients.push({ ...row, role: "parent" });
    }
  }

  return recipients;
}

async function createReminder({ title, message, dueDate, resendIntervalDays, createdBy, schoolIds, targetRoles }) {
  const reminderRes = await pool.query(
    `INSERT INTO admin_reminders (title, message, due_date, resend_interval_days, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [title, message, dueDate, resendIntervalDays, createdBy]
  );
  const reminder = reminderRes.rows[0];

  for (const schoolId of schoolIds) {
    const targetRes = await pool.query(
      `INSERT INTO admin_reminder_targets (reminder_id, school_id) VALUES ($1, $2)
       ON CONFLICT (reminder_id, school_id) DO NOTHING RETURNING *`,
      [reminder.id, schoolId]
    );
    const target = targetRes.rows[0];
    if (!target) continue;

    const recipients = await getSchoolRecipients(schoolId, targetRoles);
    for (const r of recipients) {
      await pool.query(
        `INSERT INTO admin_reminder_recipients (target_id, user_id, role) VALUES ($1, $2, $3)
         ON CONFLICT (target_id, user_id) DO NOTHING`,
        [target.id, r.id, r.role]
      );
    }

    await sendToTarget(target, reminder, "reminder");
    const nextSendAt = new Date(Date.now() + resendIntervalDays * 24 * 60 * 60 * 1000);
    await pool.query(
      `UPDATE admin_reminder_targets SET last_sent_at = NOW(), next_send_at = $2 WHERE id = $1`,
      [target.id, nextSendAt]
    );
  }

  return reminder;
}

async function getPlatformAdminEmails() {
  const res = await pool.query(`SELECT email FROM users2 WHERE role = 'admin'`);
  return res.rows.map((r) => r.email).filter(Boolean);
}

async function sendToTarget(target, reminder, kind) {
  const recipRes = await pool.query(
    `SELECT arr.user_id, arr.role, u.fullname, u.email, u.phone
     FROM admin_reminder_recipients arr JOIN users2 u ON u.id = arr.user_id
     WHERE arr.target_id = $1`,
    [target.id]
  );
  const dueDateStr = formatDate(reminder.due_date);
  const bodyText =
    kind === "followup"
      ? `Following up on "${reminder.title}": ${reminder.message} (due ${dueDateStr}). Please confirm you're still on track.`
      : reminder.message;
  const adminCc = await getPlatformAdminEmails();

  for (const r of recipRes.rows) {
    if (r.email) {
      try {
        await sendEmail(
          r.email,
          kind === "followup" ? `Checking in: ${reminder.title}` : reminder.title,
          `<p>Hello ${r.fullname || ""},</p><p>${bodyText}</p>`,
          { replyTo: replyToEmailFor(target.id), cc: adminCc }
        );
      } catch (err) {
        console.error(`Admin reminder email failed (target ${target.id}, user ${r.user_id}):`, err.message);
      }
    }
    const number = toWhatsAppNumber(r.phone);
    if (number) {
      try {
        await sendWhatsAppTemplate(number, [r.fullname || "there", bodyText, dueDateStr, dashboardLinkFor(r.role)]);
      } catch (err) {
        console.error(`Admin reminder WhatsApp failed (target ${target.id}, user ${r.user_id}):`, err.message);
      }
    }
  }
}

async function processDueResends() {
  const res = await pool.query(
    `SELECT t.*, r.title, r.message, r.due_date, r.resend_interval_days
     FROM admin_reminder_targets t JOIN admin_reminders r ON r.id = t.reminder_id
     WHERE t.status = 'pending' AND r.status = 'active' AND t.next_send_at <= NOW()`
  );
  for (const target of res.rows) {
    await sendToTarget(target, target, "reminder");
    const nextSendAt = new Date(Date.now() + target.resend_interval_days * 24 * 60 * 60 * 1000);
    await pool.query(`UPDATE admin_reminder_targets SET last_sent_at = NOW(), next_send_at = $2 WHERE id = $1`, [
      target.id,
      nextSendAt,
    ]);
  }
}

async function processDueFollowups() {
  const res = await pool.query(
    `SELECT t.*, r.title, r.message, r.due_date
     FROM admin_reminder_targets t JOIN admin_reminders r ON r.id = t.reminder_id
     WHERE t.status = 'understood' AND t.followup_sent_at IS NULL
       AND r.status = 'active' AND r.due_date - INTERVAL '1 day' <= CURRENT_DATE`
  );
  for (const target of res.rows) {
    await sendToTarget(target, target, "followup");
    await pool.query(
      `UPDATE admin_reminder_targets SET followup_sent_at = NOW(), status = 'followup_sent' WHERE id = $1`,
      [target.id]
    );
  }
}

// Scoped to recipients of currently-pending targets on active reminders —
// a reply from someone no longer "owed" a reminder is simply not matched.
async function findOpenTargetForSender({ phone, email }) {
  const res = await pool.query(
    `SELECT arr.target_id, arr.user_id, u.phone, u.email, u.fullname, t.reminder_id, t.school_id,
            r.title, r.message, r.created_by,
            s.name AS school_name
     FROM admin_reminder_recipients arr
     JOIN admin_reminder_targets t ON t.id = arr.target_id
     JOIN admin_reminders r ON r.id = t.reminder_id
     JOIN users2 u ON u.id = arr.user_id
     JOIN schools s ON s.id = t.school_id
     WHERE t.status = 'pending' AND r.status = 'active'
     ORDER BY t.id DESC`
  );

  if (email) {
    const match = res.rows.find((row) => row.email && row.email.toLowerCase() === email.toLowerCase());
    if (match) return match;
  }
  if (phone) {
    const normalizedPhone = toWhatsAppNumber(phone);
    if (normalizedPhone) {
      const match = res.rows.find((row) => toWhatsAppNumber(row.phone) === normalizedPhone);
      if (match) return match;
    }
  }
  return null;
}

async function recordInboundReply({ phone, email, channel, text }) {
  const match = await findOpenTargetForSender({ phone, email });
  if (!match) return null;

  const classification = await classifyReminderReply({
    reminderTitle: match.title,
    reminderMessage: match.message,
    replyText: text,
  });

  await pool.query(
    `INSERT INTO admin_reminder_replies (target_id, user_id, channel, raw_text, ai_understood, ai_summary)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [match.target_id, match.user_id, channel, text, classification.understood, classification.summary]
  );

  const newStatus = classification.understood ? "understood" : "unclear";
  await pool.query(
    `UPDATE admin_reminder_targets SET status = $2, understood_at = CASE WHEN $2 = 'understood' THEN NOW() ELSE understood_at END
     WHERE id = $1 AND status = 'pending'`,
    [match.target_id, newStatus]
  );

  // Platform admins always get told a reply came in (same "admin sees
  // everything" principle as the email CC in sendToTarget above) — plus
  // whoever actually created this reminder, so an instructor who sent it
  // finds out too, not just whichever admin happens to check the
  // dashboard.
  notifyReplyRecipients(match, text, classification).catch((err) =>
    console.error("adminReminderService: reply notification failed:", err.message)
  );

  return { targetId: match.target_id, ...classification };
}

async function notifyReplyRecipients(match, replyText, classification) {
  const title = `Reply to "${match.title}" from ${match.school_name}`;
  const message = `${match.fullname || "Someone"} (${match.school_name}) replied: "${replyText}"${
    classification.summary ? ` — AI summary: ${classification.summary}` : ""
  }`;
  const url = "/admin/reminders";

  const admins = await pool.query(`SELECT id FROM users2 WHERE role = 'admin'`);
  const notifiedIds = new Set();
  for (const row of admins.rows) {
    notifiedIds.add(row.id);
    await notifyUser(row.id, { type: "reminder_reply", title, message, url, email: true });
  }
  if (match.created_by && !notifiedIds.has(match.created_by)) {
    await notifyUser(match.created_by, { type: "reminder_reply", title, message, url, email: true });
  }
}

async function markUnderstoodManually(targetId) {
  await pool.query(
    `UPDATE admin_reminder_targets SET status = 'understood', understood_at = NOW() WHERE id = $1`,
    [targetId]
  );
}

async function closeReminder(reminderId) {
  await pool.query(`UPDATE admin_reminders SET status = 'closed' WHERE id = $1`, [reminderId]);
}

// createdBy scopes this to one sender's own reminders — used by the
// instructor-facing reminders section so an instructor only ever sees
// what they personally sent, never the full platform list admin gets.
async function listReminders(createdBy) {
  const res = await pool.query(
    `SELECT r.*,
       (SELECT COUNT(*) FROM admin_reminder_targets t WHERE t.reminder_id = r.id) AS total_schools,
       (SELECT COUNT(*) FROM admin_reminder_targets t WHERE t.reminder_id = r.id AND t.status IN ('understood','followup_sent')) AS understood_schools
     FROM admin_reminders r
     WHERE $1::int IS NULL OR r.created_by = $1
     ORDER BY r.created_at DESC`,
    [createdBy || null]
  );
  return res.rows;
}

async function getReminderDetail(reminderId) {
  const reminderRes = await pool.query(`SELECT * FROM admin_reminders WHERE id = $1`, [reminderId]);
  const reminder = reminderRes.rows[0];
  if (!reminder) return null;

  const targetsRes = await pool.query(
    `SELECT t.*, s.name AS school_name
     FROM admin_reminder_targets t JOIN schools s ON s.id = t.school_id
     WHERE t.reminder_id = $1 ORDER BY s.name ASC`,
    [reminderId]
  );

  const targets = [];
  for (const target of targetsRes.rows) {
    const repliesRes = await pool.query(
      `SELECT rep.*, u.fullname FROM admin_reminder_replies rep
       LEFT JOIN users2 u ON u.id = rep.user_id
       WHERE rep.target_id = $1 ORDER BY rep.received_at DESC`,
      [target.id]
    );
    targets.push({ ...target, replies: repliesRes.rows });
  }

  return { reminder, targets };
}

module.exports = {
  getSchoolRecipients,
  createReminder,
  sendToTarget,
  processDueResends,
  processDueFollowups,
  recordInboundReply,
  markUnderstoodManually,
  closeReminder,
  listReminders,
  getReminderDetail,
};
