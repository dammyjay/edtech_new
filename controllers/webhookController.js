// controllers/webhookController.js
//
// Inbound endpoints hit by external services, not by logged-in users —
// mounted in routes/webhookRoutes.js outside every auth/CSRF-gated
// router (a webhook call carries no session or CSRF token).
const adminReminderService = require("../services/adminReminderService");

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
          await adminReminderService.recordInboundReply({
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
      await adminReminderService.recordInboundReply({
        email: fromAddress,
        channel: "email",
        text: text.trim(),
      });
    }
  } catch (err) {
    console.error("receiveEmailReply error:", err.message);
  }
};
