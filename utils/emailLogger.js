// Thin, best-effort logging layer shared by every outgoing-email helper
// (sendEmail.js, sendEmailWithAttachment.js) so every Brevo send is
// visible on /admin/email-log without touching the ~20 call sites that
// actually send mail — instrumenting the two shared utilities is enough.
// Never throws — a logging failure must never break a real email send.
const pool = require("../models/db");

// Brevo's transactional send returns messageId (single recipient) or
// messageIds (multiple), depending on how many "to" addresses were sent
// in one call — either way, every recipient of that one call shares the
// SAME message-id in Brevo's own system (this app never uses Brevo's
// batch "messageVersions" personalization, the only case where each
// recipient gets its own distinct id). The later event webhook
// (controllers/webhookController.js's receiveBrevoEmailEvent) matches
// back on (message_id, recipient_email) together, which works correctly
// either way.
function extractMessageId(brevoResponse) {
  if (!brevoResponse) return null;
  if (brevoResponse.messageId) return brevoResponse.messageId;
  if (Array.isArray(brevoResponse.messageIds) && brevoResponse.messageIds.length) {
    return brevoResponse.messageIds[0];
  }
  return null;
}

async function logEmailSent({ brevoResponse, subject, to = [], cc = [], bcc = [] }) {
  try {
    const messageId = extractMessageId(brevoResponse);
    const recipients = [
      ...to.map((email) => ({ email, type: "to" })),
      ...cc.map((email) => ({ email, type: "cc" })),
      ...bcc.map((email) => ({ email, type: "bcc" })),
    ].filter((r) => r.email);
    if (!recipients.length) return;

    await Promise.all(
      recipients.map((r) =>
        pool.query(
          `INSERT INTO email_log (message_id, recipient_email, recipient_type, subject, status, last_event, last_event_at)
           VALUES ($1, $2, $3, $4, 'sent', 'request', NOW())`,
          [messageId, r.email, r.type, subject || null]
        )
      )
    );
  } catch (err) {
    console.error("logEmailSent error (non-fatal):", err.message);
  }
}

module.exports = { logEmailSent };
