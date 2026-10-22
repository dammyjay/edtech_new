// utils/sendWhatsApp.js
//
// Meta Cloud API (WhatsApp Business Platform), direct — no middleman.
// Mirrors utils/sendEmail.js's shape (async function, throws on
// failure, caller catches). The Cloud API requires a pre-approved
// message template for any business-initiated message (a scheduled
// reminder is business-initiated, not a reply inside a 24h customer
// window) — this cannot send free text, only a named template with
// positional {{1}}/{{2}}/... params.
//
// WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_TEMPLATE_NAME
// are not set yet — the user hasn't created a Meta Business/WhatsApp
// Business account. Calls will fail until they are; callers (the
// reminder cron) catch and log rather than let this block email.
const axios = require("axios");

const API_VERSION = process.env.WHATSAPP_API_VERSION || "v21.0";

/**
 * @param {string} to - E.164-style digits, no leading '+' (see utils/phoneFormat.js)
 * @param {string[]} params - positional template parameters, in order
 */
async function sendWhatsAppTemplate(to, params = []) {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME;

  if (!accessToken || !phoneNumberId || !templateName) {
    throw new Error("WhatsApp is not configured yet (missing WHATSAPP_ACCESS_TOKEN/WHATSAPP_PHONE_NUMBER_ID/WHATSAPP_TEMPLATE_NAME).");
  }

  try {
    const { data } = await axios.post(
      `https://graph.facebook.com/${API_VERSION}/${phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: "en" },
          components: [
            {
              type: "body",
              parameters: params.map((text) => ({ type: "text", text: String(text) })),
            },
          ],
        },
      },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    console.log("✅ WhatsApp sent:", data.messages?.[0]?.id || data);
    return data;
  } catch (error) {
    console.error("❌ WhatsApp sending failed:", error.response?.data || error.message);
    throw error;
  }
}

module.exports = { sendWhatsAppTemplate };
