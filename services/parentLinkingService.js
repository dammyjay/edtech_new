// services/parentLinkingService.js
//
// Self-service "link your parent" flow — distinct from the existing
// parent-initiated flow (userController.addChild -> parent_child_requests
// -> studentController.respondToParentRequest), which needs the CHILD to
// approve a request the PARENT started. Here it's the other direction: a
// student who has no parent linked at all supplies their parent's email,
// and we link it immediately (no approval step — the point is getting
// parents onto the platform, not adding another thing to wait on).
//
// Email "validation" is two layers, since no provider (Brevo included)
// offers an instant "is this mailbox real" check:
//   1. Format + MX record lookup — instant, free, catches typos and fake
//      domains before we create anything or send anything.
//   2. A delayed one-shot check against Brevo's own event report for the
//      message we actually sent — if it hard-bounced, we retract the
//      link (delete the parent_children row) so the student's dashboard
//      reminder reappears asking for a different email. This can't be
//      instant; real mailbox-doesn't-exist bounces take a little while to
//      arrive.
const dns = require("dns").promises;
const bcrypt = require("bcrypt");
const Brevo = require("@getbrevo/brevo");
const pool = require("../models/db");
const sendEmail = require("../utils/sendEmail");
const generateDefaultPassword = require("../utils/generateDefaultPassword");
const { getCompanyInfo } = require("../utils/companyInfo");

const LOGIN_URL = "https://acad.jkthub.com/admin/login"; // same URL every other role's welcome email uses (controllers/adminController.js's roleConfig)
const BOUNCE_CHECK_DELAY_MS = 45 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const transacApi = new Brevo.TransactionalEmailsApi();
transacApi.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY);

async function hasValidMx(email) {
  const domain = email.split("@")[1];
  if (!domain) return false;
  try {
    const records = await Promise.race([
      dns.resolveMx(domain),
      new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error("MX lookup timed out"), { code: "ETIMEOUT" })), 5000)),
    ]);
    return Array.isArray(records) && records.length > 0;
  } catch (err) {
    // ENOTFOUND/ENODATA = the domain genuinely doesn't exist or has no mail
    // server — a real "invalid" signal. Anything else (resolver down,
    // network hiccup, DNS server timeout) is OUR infrastructure having a
    // bad moment, not evidence the parent's email is wrong — fail open
    // rather than block a legitimate address; the delayed bounce check
    // (recordBounceCheck) is the real backstop either way.
    if (err.code === "ENOTFOUND" || err.code === "ENODATA") return false;
    console.error(`parentLinkingService: MX lookup for ${domain} failed (${err.code || err.message}) — allowing through`);
    return true;
  }
}

async function getPlatformAdmins() {
  const res = await pool.query(`SELECT email, fullname FROM users2 WHERE role = 'admin'`);
  return res.rows;
}

function welcomeEmailHtml({ company, parentFullname, studentFullname, email, defaultPassword }) {
  return `
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <div style="background:#f4f4f4; padding:40px; font-family:Calibri,Arial,sans-serif;">
      <div style="max-width:720px; width:100%; margin:auto; background:#fff; border-radius:10px; overflow:hidden; box-shadow:0 5px 20px rgba(0,0,0,.08);">
        <div style="background:#b89b5e; padding:25px; text-align:center; color:white;">
          <img src="${company.logo_url || ""}" width="80">
          <h2 style="margin:15px 0 5px;">${company.company_name || ""}</h2>
          <p style="margin:0;">Parent Account</p>
        </div>
        <div style="padding:25px;">
          <h2 style="margin-top:0; color:#333;">Hello ${parentFullname},</h2>
          <p>${studentFullname} added you as their parent/guardian on ${company.company_name || "our platform"}. We've created a parent account for you so you can keep up with their progress.</p>
          <p>You can now access your Parent Dashboard to monitor ${studentFullname}'s learning progress, their portfolio of badges/certificates/projects, and receive our newsletters, event invites, and announcements.</p>
          <table style="width:100%; border-collapse:collapse; margin:25px 0;">
            <tr>
              <td style="padding:12px; border-bottom:1px solid #eee;"><b>Login Email</b></td>
              <td style="border-bottom:1px solid #eee; word-break:break-all; overflow-wrap:anywhere;">${email}</td>
            </tr>
            <tr>
              <td style="padding:12px; border-bottom:1px solid #eee;"><b>Temporary Password</b></td>
              <td style="border-bottom:1px solid #eee;">${defaultPassword}</td>
            </tr>
            <tr>
              <td style="padding:12px;"><b>Role</b></td>
              <td>Parent</td>
            </tr>
          </table>
          <div style="background:#faf8f1; padding:20px; border-left:5px solid #b89b5e; margin:25px 0;">
            <b>How to Login</b>
            <ol style="line-height:28px; padding-left:20px;">
              <li>Login using your email.</li>
              <li>View ${studentFullname}'s progress, badges, certificates and portfolio.</li>
              <li>Get newsletters, event invites and announcements from us.</li>
              <li>Change your password from your Profile page.</li>
            </ol>
          </div>
          <div style="text-align:center; margin:35px 0;">
            <a href="${LOGIN_URL}" style="background:#b89b5e; color:white; text-decoration:none; padding:14px 30px; border-radius:6px; display:inline-block; font-weight:bold;">Login Now</a>
          </div>
          <p><b>Important:</b><br>For your security, we strongly recommend changing your password immediately after your first login. You can do this anytime from your <b>Profile</b> page.</p>
          <p>If you experience any difficulty accessing your account, please contact our support team.</p>
          <br>
          Kind regards,
          <br><br>
          <b>${company.company_name || ""}</b>
        </div>
      </div>
    </div>
  `;
}

function linkedExistingEmailHtml({ company, parentFullname, studentFullname }) {
  return `
    <div style="background:#f4f4f4; padding:40px; font-family:Calibri,Arial,sans-serif;">
      <div style="max-width:620px; margin:auto; background:#fff; border-radius:10px; padding:25px;">
        <h2 style="color:#333;">Hello ${parentFullname},</h2>
        <p>${studentFullname} just linked their account on ${company.company_name || "our platform"} to your existing parent account (${company.company_name || "our platform"} account email on file). You can view their progress, portfolio and badges from your Parent Dashboard any time.</p>
        <div style="text-align:center; margin:30px 0;">
          <a href="${LOGIN_URL}" style="background:#b89b5e; color:white; text-decoration:none; padding:14px 30px; border-radius:6px; display:inline-block; font-weight:bold;">Go to Dashboard</a>
        </div>
      </div>
    </div>
  `;
}

// Whether the dashboard should prompt this student for a parent email, and
// what copy to show (plain ask vs. "that one bounced, try again").
async function getPromptState(studentId) {
  const linked = await pool.query(`SELECT 1 FROM parent_children WHERE child_id = $1 LIMIT 1`, [studentId]);
  if (linked.rows.length) return { needed: false };

  const lastInvite = await pool.query(
    `SELECT email, status FROM parent_email_invites WHERE student_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [studentId]
  );
  const last = lastInvite.rows[0];
  return {
    needed: true,
    bouncedEmail: last && last.status === "bounced" ? last.email : null,
  };
}

async function recordBounceCheck(inviteId) {
  try {
    const inviteRes = await pool.query(`SELECT * FROM parent_email_invites WHERE id = $1`, [inviteId]);
    const invite = inviteRes.rows[0];
    if (!invite || invite.status !== "sent") return;

    // Filtered by the parent's exact address (not messageId) — a single
    // send with a cc'd admin can return a per-recipient messageIds array
    // rather than one messageId, so email is the unambiguous key. A fresh
    // parent account has no prior Brevo traffic under this address, so
    // "any hard bounce for this email in the last day" is an accurate
    // enough proxy for "the message we just sent, specifically."
    const result = await transacApi.getEmailEventReport(
      undefined, undefined, undefined, undefined, 1, invite.email,
      "hardBounces", undefined, undefined, undefined, undefined
    );
    const bounced = (result.body?.events || []).length > 0;
    if (!bounced) return;

    await pool.query(`UPDATE parent_email_invites SET status = 'bounced' WHERE id = $1`, [inviteId]);
    if (invite.parent_id) {
      await pool.query(
        `DELETE FROM parent_children WHERE child_id = $1 AND parent_id = $2`,
        [invite.student_id, invite.parent_id]
      );
    }
  } catch (err) {
    console.error("parentLinkingService.recordBounceCheck failed:", err.message);
  }
}

async function linkParentByEmail(studentId, rawEmail) {
  const email = (rawEmail || "").trim().toLowerCase();

  if (!EMAIL_RE.test(email)) {
    return { success: false, message: "That doesn't look like a valid email address — please check it and try again." };
  }
  if (!(await hasValidMx(email))) {
    return { success: false, message: "We couldn't find a mail server for that email's domain — please double-check it and try again." };
  }

  const studentRes = await pool.query(`SELECT fullname FROM users2 WHERE id = $1`, [studentId]);
  const studentFullname = studentRes.rows[0]?.fullname || "Your child";

  const existing = await pool.query(`SELECT id, fullname, role FROM users2 WHERE LOWER(email) = $1`, [email]);
  const company = await getCompanyInfo();
  const admins = await getPlatformAdmins();
  const adminEmails = admins.map((a) => a.email).filter(Boolean);

  if (existing.rows.length) {
    const existingUser = existing.rows[0];
    if (existingUser.role !== "parent") {
      return {
        success: false,
        message: "That email already belongs to another account on our platform — please use a different email for your parent/guardian.",
      };
    }

    await pool.query(
      `INSERT INTO parent_children (parent_id, child_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [existingUser.id, studentId]
    );
    await pool.query(
      `INSERT INTO parent_email_invites (student_id, email, parent_id, status) VALUES ($1, $2, $3, 'linked_existing')`,
      [studentId, email, existingUser.id]
    );

    sendEmail(
      email,
      `${studentFullname} linked you as their parent`,
      linkedExistingEmailHtml({ company, parentFullname: existingUser.fullname, studentFullname }),
      { cc: adminEmails }
    ).catch((err) => console.error("parentLinkingService: existing-parent email failed:", err.message));

    return { success: true, message: `Linked! We emailed ${email} to let them know.` };
  }

  const defaultPassword = generateDefaultPassword();
  const hashedPassword = await bcrypt.hash(defaultPassword, 10);
  const parentFullname = `${studentFullname}'s Parent`;

  const insertRes = await pool.query(
    `INSERT INTO users2 (fullname, email, password, role) VALUES ($1, $2, $3, 'parent') RETURNING id`,
    [parentFullname, email, hashedPassword]
  );
  const parentId = insertRes.rows[0].id;

  let messageId = null;
  try {
    const sendResult = await sendEmail(
      email,
      "🎉 Parent Account Created",
      welcomeEmailHtml({ company, parentFullname, studentFullname, email, defaultPassword }),
      { cc: adminEmails }
    );
    const body = sendResult?.body || sendResult;
    messageId = body?.messageId || (Array.isArray(body?.messageIds) ? body.messageIds[0] : null) || null;
  } catch (err) {
    // The send itself failed outright (Brevo down, bad request, etc.) —
    // not a bounce, a hard failure with no delivery attempt at all. Undo
    // the account rather than leave a link no safety net will ever check,
    // so the student can just retry immediately.
    console.error("parentLinkingService: welcome email send failed:", err.message);
    await pool.query(`DELETE FROM users2 WHERE id = $1`, [parentId]);
    return { success: false, message: "Something went wrong sending that email — please try again." };
  }

  await pool.query(
    `INSERT INTO parent_children (parent_id, child_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [parentId, studentId]
  );
  const inviteRes = await pool.query(
    `INSERT INTO parent_email_invites (student_id, email, parent_id, message_id, status)
     VALUES ($1, $2, $3, $4, 'sent') RETURNING id`,
    [studentId, email, parentId, messageId]
  );

  const inviteId = inviteRes.rows[0].id;
  setTimeout(() => recordBounceCheck(inviteId), BOUNCE_CHECK_DELAY_MS);

  return { success: true, message: `We've emailed ${email} with their parent account login details!` };
}

module.exports = { getPromptState, linkParentByEmail, hasValidMx };
