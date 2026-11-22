// controllers/webhookController.js
//
// Inbound endpoints hit by external services, not by logged-in users —
// mounted in routes/webhookRoutes.js outside every auth/CSRF-gated
// router (a webhook call carries no session or CSRF token).
const adminReminderService = require("../services/adminReminderService");
const lessonTaskReminderReplyService = require("../services/lessonTaskReminderReplyService");
const pool = require("../models/db");

// Tries the general school-reminder system first (its matching already
// scopes to currently-pending targets), then falls back to lesson task
// reminder sends if nothing matched there — same sender-email/phone
// matching approach, just a different, simpler table (see
// services/lessonTaskReminderReplyService.js for why it's separate).
async function routeReminderReply({ phone, email, channel, text }) {
  const adminReminderMatch = await adminReminderService.recordInboundReply({ phone, email, channel, text });
  if (adminReminderMatch) return adminReminderMatch;

  const lessonTaskSend = await lessonTaskReminderReplyService.findOpenSendForSender({ phone, email });
  if (lessonTaskSend) {
    return lessonTaskReminderReplyService.recordReply({ sendId: lessonTaskSend.id, channel, text });
  }
  return null;
}

// Meta's one-time handshake when you register the webhook URL in the
// Meta app dashboard (WhatsApp > Configuration > Webhook).
exports.verifyWhatsApp = (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
};

// Meta POSTs here for every inbound WhatsApp event (messages, statuses,
// etc). Always ack 200 quickly — Meta retries/disables the webhook on
// repeated non-200s, and we don't want a slow AI call or a DB hiccup to
// trigger that.
exports.receiveWhatsApp = async (req, res) => {
  res.sendStatus(200);

  try {
    const entries = req.body?.entry || [];
    for (const entry of entries) {
      for (const change of entry.changes || []) {
        const messages = change.value?.messages || [];
        for (const msg of messages) {
          if (msg.type !== "text" || !msg.text?.body) continue;
          const fromPhone = msg.from; // digits, no leading '+' — same shape toWhatsAppNumber produces
          await routeReminderReply({
            phone: fromPhone,
            channel: "whatsapp",
            text: msg.text.body,
          });
        }
      }
    }
  } catch (err) {
    console.error("receiveWhatsApp error:", err.message);
  }
};

// Brevo's Inbound Parsing webhook (Brevo dashboard > Transactional >
// Inbound Parsing) — requires BREVO_INBOUND_DOMAIN's MX record to point
// at Brevo first; see README.txt. Reminder emails set Reply-To to
// reminder-<targetId>@BREVO_INBOUND_DOMAIN so the reply is routed back
// here with the target id recoverable from the recipient address.
exports.receiveEmailReply = async (req, res) => {
  res.sendStatus(200);

  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [req.body];
    for (const item of items) {
      if (!item) continue;
      const fromAddress = item.From?.Address || item.from;
      const text = item.RawTextBody || item.text || item.TextBody || "";
      if (!fromAddress || !text.trim()) continue;
      await routeReminderReply({
        email: fromAddress,
        channel: "email",
        text: text.trim(),
      });
    }
  } catch (err) {
    console.error("receiveEmailReply error:", err.message);
  }
};

// "Happy path" progression — a later event in this list never regresses
// status back to an earlier one if Brevo's events arrive out of order
// (e.g. a slightly-delayed "delivered" webhook landing after "opened"
// already did). Anything NOT in this map (bounces, blocks, spam
// complaints, invalid, unsubscribed, deferred...) always overwrites
// status outright — those are important signals regardless of when
// they arrive, and none of them is a "step backward" from any other.
const EMAIL_STATUS_RANK = { sent: 0, delivered: 1, opened: 2, click: 3 };
const normalizeEvent = (rawEvent) =>
  rawEvent === "open" ? "opened" : rawEvent === "clicked" ? "click" : rawEvent === "request" ? "sent" : rawEvent;

// Brevo's Transactional webhook (Brevo dashboard > Transactional >
// Settings > Webhooks — add this route's full URL and tick at least
// Delivered/Opens/Hard bounces/Soft bounces/Blocked/Invalid/Deferred/
// Unsubscribed). Fires once per recipient per event, carrying
// "message-id" + "email" together — exactly the pair utils/emailLogger.js
// stored at send time, however many recipients shared one send call.
// Powers /admin/email-log without ever needing Brevo's own dashboard.
exports.receiveBrevoEmailEvent = async (req, res) => {
  res.sendStatus(200);

  try {
    const events = Array.isArray(req.body) ? req.body : [req.body];
    for (const evt of events) {
      if (!evt) continue;
      const rawEvent = evt.event;
      const email = evt.email;
      const messageId = evt["message-id"] || evt.messageId || evt.message_id || null;
      if (!rawEvent || !email) continue;

      const normalized = normalizeEvent(rawEvent);
      const eventTime = evt.date ? new Date(evt.date) : new Date();

      // Match back to the row utils/emailLogger.js created at send time.
      // Falls back to email+subject (no message-id) only in case some
      // Brevo event type ever omits it — keeps this resilient rather
      // than silently dropping the event.
      const existing = messageId
        ? await pool.query(
            `SELECT id, status FROM email_log WHERE recipient_email = $1 AND message_id = $2 ORDER BY sent_at DESC LIMIT 1`,
            [email, messageId]
          )
        : await pool.query(
            `SELECT id, status FROM email_log WHERE recipient_email = $1 AND subject = $2 ORDER BY sent_at DESC LIMIT 1`,
            [email, evt.subject || null]
          );
      if (!existing.rows.length) continue; // a send we never logged — nothing to update

      const row = existing.rows[0];
      const currentRank = EMAIL_STATUS_RANK[row.status];
      const newRank = EMAIL_STATUS_RANK[normalized];
      // Advance status unless this is a "happy path" event arriving
      // behind one we've already recorded further along.
      const shouldAdvanceStatus = newRank === undefined || currentRank === undefined || newRank >= currentRank;

      const setParts = ["last_event = $1", "last_event_at = $2"];
      const params = [rawEvent, eventTime];
      if (shouldAdvanceStatus) {
        setParts.push(`status = $${params.length + 1}`);
        params.push(normalized);
      }
      if (normalized === "delivered") {
        setParts.push(`delivered_at = COALESCE(delivered_at, $${params.length + 1})`);
        params.push(eventTime);
      }
      if (normalized === "opened") {
        setParts.push(`opened_at = COALESCE(opened_at, $${params.length + 1})`);
        params.push(eventTime);
      }
      if (evt.reason) {
        setParts.push(`error_message = $${params.length + 1}`);
        params.push(evt.reason);
      }
      params.push(row.id);
      await pool.query(`UPDATE email_log SET ${setParts.join(", ")} WHERE id = $${params.length}`, params);
    }
  } catch (err) {
    console.error("receiveBrevoEmailEvent error:", err.message);
  }
};
