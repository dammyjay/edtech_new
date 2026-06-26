const Brevo = require("@getbrevo/brevo");

const apiInstance = new Brevo.TransactionalEmailsApi();
apiInstance.setApiKey(
  Brevo.TransactionalEmailsApiApiKeys.apiKey,
  process.env.BREVO_API_KEY
);
console.log("BREVO_API_KEY:", process.env.BREVO_API_KEY);
console.log("BREVO_FROM:", process.env.BREVO_FROM);

async function sendEmail(to, subject, htmlContent) {
  try {
    const sendSmtpEmail = {
      to: [{ email: to }],
      sender: { email: process.env.BREVO_FROM, name: "JKT Hub" },
      subject,
      htmlContent,
    };

    const data = await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log("✅ Email sent:", data.messageId || data);
    return data;
  } catch (error) {
    console.error("❌ Email sending failed:", error.response?.data || error.message);
    throw error;
  }
}

module.exports = sendEmail;
