// cron/parentWeeklyDigest.js
//
// Email to every parent summarizing what their linked child(ren) did in the
// past 7 days — streaks, XP, lessons, quiz/assignment scores, new badges.
// Shaped like cron/analyticsReportCron.js: named exported handler (so it
// can be triggered on-demand for testing, not just waiting for the real
// schedule) and a per-recipient try/catch so one failed send doesn't kill
// the whole run.
//
// Brevo's plan caps at 200 emails/day — shared across EVERY email this app
// sends (OTP, assignment reminders, newsletters, feedback, AI-grading
// notices, this digest). At current scale (single digits of parents) a
// once-a-week Monday blast is harmless, but it doesn't scale: once the
// parent base grows, "everyone on Monday" would eventually compete with —
// and could starve — same-day OTP/signup emails, which are far more
// time-sensitive. So instead of one weekly Monday run, this fires DAILY and
// each parent is deterministically assigned one day of the week (by
// `parent.id % 7`), spreading the same weekly volume evenly across 7 days
// instead of concentrating it into one. MAX_PER_RUN is a hard safety net so
// a single day's bucket can never consume the whole daily quota by itself.

const cron = require("node-cron");
const crypto = require("crypto");
const sendEmail = require("../utils/sendEmail");
const { getCompanyInfo } = require("../utils/companyInfo");
const { buildWeeklyDigestEmail } = require("../utils/emailTemplates");
const {
  getParentsForDigest,
  getChildrenForParent,
  getWeeklyStatsForChild,
} = require("../services/parentDigestService");

// Leaves headroom under Brevo's 200/day cap for every other email this app
// sends the same day. Revisit upward only alongside a higher Brevo plan.
const MAX_PER_RUN = 120;

function unsubscribeToken(userId) {
  return crypto.createHmac("sha256", process.env.SESSION_SECRET).update(String(userId)).digest("hex");
}

// dayOverride lets a manual/test invocation pick a specific bucket instead
// of always using today's real weekday — otherwise a parent whose id lands
// on, say, Thursday's bucket could never be exercised by an ad-hoc test run
// on any other day.
async function runWeeklyDigestJob({ dayOverride } = {}) {
  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const today = dayOverride ?? new Date().getDay(); // 0=Sunday..6=Saturday
    const company = await getCompanyInfo();
    const allParents = await getParentsForDigest();
    const parents = allParents.filter((p) => p.id % 7 === today).slice(0, MAX_PER_RUN);

    console.log(
      `Weekly parent digest: ${parents.length} of ${allParents.length} parent(s) in today's bucket (day ${today}).`
    );

    for (const parent of parents) {
      try {
        const kids = await getChildrenForParent(parent.id);
        if (!kids.length) continue;

        const children = await Promise.all(
          kids.map(async (k) => ({ ...k, stats: await getWeeklyStatsForChild(k.id, since) }))
        );

        const html = buildWeeklyDigestEmail({
          parentName: parent.fullname,
          children,
          company,
          unsubscribeUrl: `https://acad.jkthub.com/unsubscribe/weekly-digest/${parent.id}/${unsubscribeToken(parent.id)}`,
        });

        await sendEmail(parent.email, "Your child's weekly learning update", html);
      } catch (err) {
        console.error(`Weekly digest failed for parent ${parent.id}:`, err.message);
      }
    }

    console.log("Weekly parent digest run complete.");
  } catch (err) {
    console.error("Weekly parent digest job failed:", err);
  }
}

// 08:00 every day — each parent only actually receives an email on their
// assigned day (see dayOverride comment above), so this is a once-a-week
// email per parent despite the daily schedule.
cron.schedule("0 8 * * *", runWeeklyDigestJob);

module.exports = { runWeeklyDigestJob };
