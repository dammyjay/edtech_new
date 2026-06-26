const Brevo = require("@getbrevo/brevo");

const apiInstance = new Brevo.TransactionalEmailsApi();

apiInstance.setApiKey(
  Brevo.TransactionalEmailsApiApiKeys.apiKey,
  process.env.BREVO_API_KEY,
);

async function sendEmailWithAttachment(
  to,
  subject,
  htmlContent,
  filename,
  pdfBuffer,
) {
  try {
    const sendSmtpEmail = {
      sender: {
        email: process.env.BREVO_FROM,
        name: "JKT Hub",
      },

      to: [{ email: to }],

      subject,

      htmlContent,

      attachment: [
        {
          name: filename,
          content: pdfBuffer.toString("base64"),
        },
      ],
    };

    const data = await apiInstance.sendTransacEmail(sendSmtpEmail);

    console.log("✅ Invoice email sent.");

    return data;
  } catch (err) {
    console.error("❌ Email Error:", err.response?.body || err.message);

    throw err;
  }
}

module.exports = sendEmailWithAttachment;
