const Brevo = require("@getbrevo/brevo");
const { getCompanyInfo } = require("./companyInfo");

const apiInstance = new Brevo.TransactionalEmailsApi();

apiInstance.setApiKey(
  Brevo.TransactionalEmailsApiApiKeys.apiKey,
  process.env.BREVO_API_KEY,
);
console.log("BREVO_API_KEY:", process.env.BREVO_API_KEY);
console.log("BREVO_FROM:", process.env.BREVO_FROM);

async function sendEmailWithAttachment(
  to,
  subject,
  htmlContent,
  filename,
  pdfBuffer,
  bcc = []
) {
  try {
    const company = await getCompanyInfo();
    const base64 = Buffer.from(pdfBuffer).toString("base64");
    const sendSmtpEmail = {
      sender: {
        email: process.env.BREVO_FROM,
        name: company.company_name || "",
      },

      to: [{ email: to }],

      bcc: bcc.map(email => ({ email })),

      subject,

      htmlContent,

      attachment: [
        {
          name: filename,
          content: base64,
        },
      ],
    };

    const data = await apiInstance.sendTransacEmail(sendSmtpEmail);

    console.log("✅ Invoice email sent.");

    return data;
  } catch (err) {
    console.error("========== BREVO ERROR ==========");

    console.error("Status:", err.response?.status);

    console.error(
      JSON.stringify(
        err.response?.data || err.response?.body || err.message,
        null,
        2
      )
    );

    throw err;
  }
}

// Multi-file variant — attaches an array of {filename, buffer} instead of
// a single file. Additive: existing single-file callers are untouched.
async function sendEmailWithAttachments(to, subject, htmlContent, attachments, bcc = []) {
  try {
    const company = await getCompanyInfo();
    const sendSmtpEmail = {
      sender: {
        email: process.env.BREVO_FROM,
        name: company.company_name || "",
      },

      to: [{ email: to }],

      bcc: bcc.map(email => ({ email })),

      subject,

      htmlContent,

      attachment: attachments.map((a) => ({
        name: a.filename,
        content: Buffer.from(a.buffer).toString("base64"),
      })),
    };

    const data = await apiInstance.sendTransacEmail(sendSmtpEmail);

    console.log("✅ Multi-attachment email sent.");

    return data;
  } catch (err) {
    console.error("========== BREVO ERROR ==========");

    console.error("Status:", err.response?.status);

    console.error(
      JSON.stringify(
        err.response?.data || err.response?.body || err.message,
        null,
        2
      )
    );

    throw err;
  }
}

sendEmailWithAttachment.sendEmailWithAttachments = sendEmailWithAttachments;

module.exports = sendEmailWithAttachment;
