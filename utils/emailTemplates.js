function buildFeedbackThankYouEmail({ name, user_type, rating, message, company = {} }) {
  const starHTML = `
    <div style="margin: 10px 0;">
      ${"★".repeat(rating)}${"☆".repeat(5 - rating)}
    </div>
  `;

  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      @media only screen and (max-width: 600px) {
        .container {
          width: 100% !important;
          padding: 15px !important;
        }
      }
    </style>
  </head>
  <body style="background: #f5f7fb; padding: 20px; font-family: Arial, sans-serif;">
    <div class="container" style="
      max-width: 600px; 
      margin: auto; 
      background: white; 
      padding: 25px; 
      border-radius: 10px; 
      box-shadow: 0 4px 14px rgba(0,0,0,0.08);
    ">
      
      <div style="text-align: center;">
        <img src="${company.logo_url || ""}"
             width="100" style="margin-bottom: 15px;" />
        <h2 style="color: #333; margin-bottom: 5px;">Thank You for Your Feedback! ❤️</h2>
        <p style="color: #666; font-size: 14px; margin-top: 0;">
          We appreciate your time and contribution.
        </p>
      </div>

      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />

      <p style="font-size: 15px; color: #444;">
        Hello <strong>${name}</strong>,<br><br>
        Thank you for taking the time to share your experience as a 
        <strong style="text-transform: capitalize;">${user_type}</strong>.
        Your feedback helps us improve and serve you better.
      </p>

      <h3 style="margin-top: 20px; color: #333;">Your Rating</h3>
      ${starHTML}

      <h3 style="margin-top: 20px; color: #333;">Your Message</h3>
      <p style="background: #fafafa; padding: 15px; border-radius: 8px; color: #555;">
        "${message}"
      </p>

      <br>

      <div style="text-align: center; margin-top: 25px;">
        <a href="https://acad.jkthub.com" 
          style="
            background: #4a76fd; 
            color: white; 
            padding: 12px 25px; 
            border-radius: 6px; 
            text-decoration: none; 
            font-size: 14px;
          ">
          Visit Our Website
        </a>
      </div>

      <br><br>

      <p style="font-size: 12px; color: #999; text-align: center;">
        © ${new Date().getFullYear()} ${company.company_name || ""} — Empowering the Future with Technology.
      </p>

    </div>
  </body>
  </html>
  `;
}

function buildChildStatBlock(child) {
  const { stats } = child;

  if (
    stats.xpThisWeek === 0 &&
    stats.lessonsCompleted === 0 &&
    stats.quizzes.count === 0 &&
    stats.assignments.count === 0 &&
    stats.newBadges.length === 0
  ) {
    return `
      <div style="background:#fafafa; border-radius:8px; padding:15px 18px; margin:14px 0;">
        <h3 style="margin:0 0 6px; color:#333;">${child.fullname}</h3>
        <p style="margin:0; color:#666; font-size:14px;">
          No activity this week — a great time to jump back in and keep the streak going! 💪
        </p>
      </div>
    `;
  }

  const badgesHTML = stats.newBadges.length
    ? `
      <p style="margin:10px 0 4px; color:#444; font-size:14px;"><strong>New badges earned:</strong></p>
      <div style="display:flex; flex-wrap:wrap; gap:8px;">
        ${stats.newBadges
          .map(
            (b) => `
          <div style="text-align:center; width:64px;">
            ${
              b.badge_image
                ? `<img src="${b.badge_image}" width="40" height="40" style="border-radius:50%;" alt="${b.badge_name}" />`
                : "🏅"
            }
            <div style="font-size:10px; color:#666; margin-top:2px;">${b.badge_name}</div>
          </div>
        `
          )
          .join("")}
      </div>
    `
    : "";

  return `
    <div style="background:#f1f5ff; border-radius:8px; padding:15px 18px; margin:14px 0;">
      <h3 style="margin:0 0 10px; color:#333;">${child.fullname}</h3>
      <table style="width:100%; border-collapse:collapse; font-size:14px; color:#444;">
        <tr>
          <td style="padding:4px 0;">🔥 Current streak</td>
          <td style="padding:4px 0; text-align:right; font-weight:bold;">${stats.streak.currentStreak} day${stats.streak.currentStreak === 1 ? "" : "s"}</td>
        </tr>
        <tr>
          <td style="padding:4px 0;">⭐ XP earned this week</td>
          <td style="padding:4px 0; text-align:right; font-weight:bold;">${stats.xpThisWeek} (Level ${stats.levelInfo.level} — ${stats.levelInfo.name})</td>
        </tr>
        <tr>
          <td style="padding:4px 0;">📚 Lessons completed</td>
          <td style="padding:4px 0; text-align:right; font-weight:bold;">${stats.lessonsCompleted}</td>
        </tr>
        ${
          stats.quizzes.count
            ? `<tr><td style="padding:4px 0;">📝 Quizzes taken</td><td style="padding:4px 0; text-align:right; font-weight:bold;">${stats.quizzes.count} (avg ${stats.quizzes.avgScore}%)</td></tr>`
            : ""
        }
        ${
          stats.assignments.count
            ? `<tr><td style="padding:4px 0;">✅ Assignments graded</td><td style="padding:4px 0; text-align:right; font-weight:bold;">${stats.assignments.count} (avg ${stats.assignments.avgScore}%)</td></tr>`
            : ""
        }
      </table>
      ${badgesHTML}
    </div>
  `;
}

function buildWeeklyDigestEmail({ parentName, children, company = {}, unsubscribeUrl }) {
  const childBlocks = children.map(buildChildStatBlock).join("");

  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      @media only screen and (max-width: 600px) {
        .container {
          width: 100% !important;
          padding: 15px !important;
        }
      }
    </style>
  </head>
  <body style="background: #f5f7fb; padding: 20px; font-family: Arial, sans-serif;">
    <div class="container" style="
      max-width: 600px;
      margin: auto;
      background: white;
      padding: 25px;
      border-radius: 10px;
      box-shadow: 0 4px 14px rgba(0,0,0,0.08);
    ">

      <div style="text-align: center;">
        <img src="${company.logo_url || ""}"
             width="100" style="margin-bottom: 15px;" />
        <h2 style="color: #333; margin-bottom: 5px;">Your Weekly Learning Update 🎉</h2>
        <p style="color: #666; font-size: 14px; margin-top: 0;">
          Here's what happened this week.
        </p>
      </div>

      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />

      <p style="font-size: 15px; color: #444;">
        Hi <strong>${parentName}</strong>,<br><br>
        Here's a quick look at how things went this week:
      </p>

      ${childBlocks}

      <div style="text-align: center; margin-top: 25px;">
        <a href="https://acad.jkthub.com/parent/dashboard"
          style="
            background: #4a76fd;
            color: white;
            padding: 12px 25px;
            border-radius: 6px;
            text-decoration: none;
            font-size: 14px;
          ">
          View Full Dashboard
        </a>
      </div>

      <br><br>

      <p style="font-size: 12px; color: #999; text-align: center;">
        © ${new Date().getFullYear()} ${company.company_name || ""} — Empowering the Future with Technology.
        <br />
        <a href="${unsubscribeUrl}" style="color: #999;">Unsubscribe from this weekly email</a>
      </p>

    </div>
  </body>
  </html>
  `;
}

// Generic email wrapper for anything sent through utils/notify.js's
// notifyUser({..., email: true}) — same visual shape as
// buildFeedbackThankYouEmail, just swapping the body for whatever
// title/message the notification already carries, plus a CTA to `url`.
function buildNotificationEmail({ title, message, url, company = {} }) {
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      @media only screen and (max-width: 600px) {
        .container {
          width: 100% !important;
          padding: 15px !important;
        }
      }
    </style>
  </head>
  <body style="background: #f5f7fb; padding: 20px; font-family: Arial, sans-serif;">
    <div class="container" style="
      max-width: 600px;
      margin: auto;
      background: white;
      padding: 25px;
      border-radius: 10px;
      box-shadow: 0 4px 14px rgba(0,0,0,0.08);
    ">

      <div style="text-align: center;">
        ${company.logo_url ? `<img src="${company.logo_url}" width="100" style="margin-bottom: 15px;" />` : ""}
        <h2 style="color: #333; margin-bottom: 5px;">${title}</h2>
      </div>

      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />

      <p style="font-size: 15px; color: #444; line-height: 1.5;">
        ${message || ""}
      </p>

      ${
        url
          ? `<div style="text-align: center; margin-top: 25px;">
        <a href="https://acad.jkthub.com${url}"
          style="
            background: #4a76fd;
            color: white;
            padding: 12px 25px;
            border-radius: 6px;
            text-decoration: none;
            font-size: 14px;
          ">
          View on ${(company.company_name || "JKT Hub").trim()}
        </a>
      </div>`
          : ""
      }

      <br><br>

      <p style="font-size: 12px; color: #999; text-align: center;">
        © ${new Date().getFullYear()} ${company.company_name || ""} — Empowering the Future with Technology.
      </p>

    </div>
  </body>
  </html>
  `;
}

module.exports = { buildFeedbackThankYouEmail, buildWeeklyDigestEmail, buildNotificationEmail };
