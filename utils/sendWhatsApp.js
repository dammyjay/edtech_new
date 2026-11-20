// utils/sendWhatsApp.js
//
// Brevo's WhatsApp API — same provider/API key already used for email
// (utils/sendEmail.js's BREVO_API_KEY), instead of a separate direct
// Meta Cloud API integration (the previous version of this file) that
// was never actually usable: it required its own Meta Business/WhatsApp
// Business account and WHATSAPP_ACCESS_TOKEN/WHATSAPP_PHONE_NUMBER_ID,
// neither of which were ever set up, so every call here has always
// thrown "not configured" — silently caught and logged by every caller
// (the reminder cron jobs), never actually delivering a single message.
//
// WhatsApp Business Platform still requires a pre-approved message
// template for any business-initiated message (a scheduled reminder is
// business-initiated, not a reply inside a 24h customer-service window)
// — that's a WhatsApp/Meta policy, true regardless of which provider
// (BSP) sends through it, not something Brevo or this code can skip.
// Before this can actually send anything, three things need doing in
// the Brevo dashboard (Transactional > WhatsApp), none of which this
// code can do on its own behalf:
//   1. Activate WhatsApp for the account and register/verify a WhatsApp
//      Business sender number.
//   2. Create a message template with FOUR placeholders, in order:
//      recipient's name, a summary of what's due, a due date, and a
//      link — named however the dashboard asks (Brevo's own params
//      object below uses whatever key names you give each placeholder
//      there), then submit it for Meta's approval (can take a while).
//   3. Set BREVO_WHATSAPP_SENDER_NUMBER (the verified sender number,
//      digits only, country code, no "+") and BREVO_WHATSAPP_TEMPLATE_ID
//      (the numeric id Brevo shows once the template is approved) env
//      vars — BREVO_API_KEY is already set, reused as-is.
const Brevo = require("@getbrevo/brevo");

const whatsappApi = new Brevo.TransactionalWhatsAppApi();
whatsappApi.setApiKey(Brevo.TransactionalWhatsAppApiApiKeys.apiKey, process.env.BREVO_API_KEY);

/**
 * @param {string} to - digits only, country code, no leading '+' (see
 *   utils/phoneFormat.js's toWhatsAppNumber — same format Brevo expects).
 * @param {string[]} params - positional [name, summary, dueDateStr, link],
 *   same 4-slot shape every reminder caller already builds — mapped here
 *   onto the named keys the Brevo template's placeholders actually use.
 */
async function sendWhatsAppTemplate(to, params = []) {
  const senderNumber = process.env.BREVO_WHATSAPP_SENDER_NUMBER;
  const templateId = process.env.BREVO_WHATSAPP_TEMPLATE_ID;

  if (!senderNumber || !templateId) {
    throw new Error("WhatsApp is not configured yet (missing BREVO_WHATSAPP_SENDER_NUMBER/BREVO_WHATSAPP_TEMPLATE_ID).");
  }

  const [name, summary, dueDate, link] = params;

  try {
    const { body } = await whatsappApi.sendWhatsappMessage({
      senderNumber,
      contactNumbers: [to],
      templateId: Number(templateId),
      params: { name, summary, due_date: dueDate, link },
    });
    console.log("✅ WhatsApp sent:", body?.messageId || body);
    return body;
  } catch (error) {
    console.error("❌ WhatsApp sending failed:", error.response?.body || error.message);
    throw error;
  }
}

module.exports = { sendWhatsAppTemplate };
