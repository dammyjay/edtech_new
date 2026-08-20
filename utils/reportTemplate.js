// Shared, gamified HTML template for every downloadable PDF report in the
// app — quiz report, module report, course report. Used by admin, parent,
// school_admin, teacher, instructor AND the student's own downloads, so
// there is exactly one design to keep beautiful instead of half a dozen
// near-duplicates drifting apart. Callers keep their own DB queries; they
// just hand the fetched data to the builder functions below.
//
// Score language is deliberately encouraging everywhere (medals/emoji, no
// letter grades or "Fail") since these reports are seen by students too.

function esc(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function scoreTier(score) {
  if (score === null || score === undefined) {
    return { emoji: "📋", className: "tier-neutral" };
  }
  if (score >= 80) return { emoji: "🌟", className: "tier-great" };
  if (score >= 60) return { emoji: "👍", className: "tier-good" };
  return { emoji: "💪", className: "tier-try" };
}

function scoreBadge(score, { size = "md" } = {}) {
  if (score === null || score === undefined) {
    return `<span class="rp-badge rp-badge-neutral rp-badge-${size}">Not yet taken</span>`;
  }
  const tier = scoreTier(score);
  return `<span class="rp-badge ${tier.className} rp-badge-${size}">${tier.emoji} ${score}%</span>`;
}

function letterGrade(score) {
  if (score === null || score === undefined) return null;
  if (score >= 80) return "A";
  if (score >= 70) return "B";
  if (score >= 60) return "C";
  if (score >= 50) return "D";
  return "F";
}

// A module/course "grade" is the average of lesson completion %, quiz
// average (if any quizzes exist), and assignment average (if any
// assignments exist) — same weighting the app has always used for this,
// just no longer hidden behind removed admin-only report code.
function smartScore(percent, quizAvg, assignmentAvg) {
  const parts = [percent];
  if (quizAvg !== null && quizAvg !== undefined) parts.push(quizAvg);
  if (assignmentAvg !== null && assignmentAvg !== undefined) parts.push(assignmentAvg);
  return Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
}

function gradeChip(score) {
  const grade = letterGrade(score);
  if (grade === null) return "";
  const tier = scoreTier(score);
  return `<span class="rp-badge ${tier.className} rp-badge-md">Grade ${grade}</span>`;
}

function gradeCircle(score, label = "Grade") {
  const grade = letterGrade(score);
  const tier = grade === null ? { className: "tier-neutral" } : scoreTier(score);
  return `
    <div class="rp-grade-badge ${tier.className}">
      <span class="rp-grade-letter">${grade || "—"}</span>
      <span class="rp-grade-label">${esc(label)}</span>
    </div>
  `;
}

function badgeImageHtml(badge, size = 40) {
  if (!badge) return "";
  return badge.badge_image
    ? `<img src="${esc(badge.badge_image)}" class="rp-badge-icon-img" style="width:${size}px;height:${size}px;" alt="${esc(badge.badge_name || "Badge")}" />`
    : `<span class="rp-badge-icon-fallback" style="font-size:${Math.round(size * 0.6)}px;">🏅</span>`;
}

function badgesSectionHtml(badges = []) {
  if (!badges.length) return "";
  return `
    <div class="rp-section">
      <h2>🏅 Badges Earned</h2>
      <div class="rp-badge-gallery">
        ${badges
          .map(
            (b) => `
          <div class="rp-badge-gallery-item">
            ${badgeImageHtml(b, 96)}
            <p class="rp-badge-gallery-name">${esc(b.badge_name)}</p>
            ${b.module_title ? `<p class="rp-badge-gallery-module">${esc(b.module_title)}</p>` : ""}
          </div>`
          )
          .join("")}
      </div>
    </div>`;
}

function certificateSectionHtml(certificate) {
  if (!certificate) return "";
  return `
    <div class="rp-section" style="text-align:center;">
      <h2>🎓 Certificate of Completion</h2>
      ${
        certificate.certificate_url
          ? `<img src="${esc(certificate.certificate_url)}" class="rp-certificate-img" alt="Certificate" />`
          : "<p>🏆 Certificate earned!</p>"
      }
      ${certificate.issued_at ? `<p style="color:#8a7841; font-size:12px; margin-top:10px;">Issued ${new Date(certificate.issued_at).toLocaleDateString()}</p>` : ""}
    </div>`;
}

function inProgressBannerHtml(percent) {
  if (percent >= 100) return "";
  return `<div class="rp-inprogress-banner">🚧 <strong>Still in progress</strong> — ${percent}% complete so far. Keep going!</div>`;
}

function progressBar(percent) {
  const pct = Math.max(0, Math.min(100, Number(percent) || 0));
  return `<div class="rp-bar"><div class="rp-bar-fill" style="width:${pct}%"></div></div>`;
}

function statCard(icon, label, value) {
  return `
    <div class="rp-stat-card">
      <div class="rp-stat-icon">${icon}</div>
      <div class="rp-stat-value">${esc(value)}</div>
      <div class="rp-stat-label">${esc(label)}</div>
    </div>
  `;
}

function statGrid(cards) {
  return `<div class="rp-stat-grid">${cards.join("")}</div>`;
}

const SHARED_STYLES = `
  * { box-sizing: border-box; }
  body {
    font-family: 'Segoe UI', Arial, sans-serif;
    margin: 0;
    padding: 36px;
    background: #FBF3DD;
    color: #2c2410;
  }
  .rp-watermark {
    position: fixed;
    top: 38%;
    left: 10%;
    width: 80%;
    font-size: 64px;
    font-weight: 800;
    color: rgba(161, 120, 7, 0.05);
    text-align: center;
    transform: rotate(-25deg);
    z-index: 0;
    pointer-events: none;
  }
  .rp-page { position: relative; z-index: 1; }
  .rp-header {
    display: flex;
    align-items: center;
    gap: 18px;
    background: linear-gradient(135deg, #D9A82C, #A17807);
    color: #fff;
    padding: 24px 28px;
    border-radius: 18px;
    margin-bottom: 22px;
    box-shadow: 0 6px 18px rgba(161,120,7,0.25);
  }
  .rp-logo {
    max-height: 56px;
    max-width: 90px;
    background: #fff;
    border-radius: 10px;
    padding: 4px;
  }
  .rp-header h1 { margin: 0; font-size: 22px; }
  .rp-subtitle { margin: 4px 0 0; font-size: 13px; opacity: 0.9; }

  .rp-student-card {
    display: flex;
    align-items: center;
    gap: 14px;
    background: #fff;
    border-radius: 14px;
    padding: 14px 18px;
    margin-bottom: 22px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.06);
  }
  .rp-student-avatar {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: linear-gradient(135deg, #D9A82C, #A17807);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 800;
    font-size: 18px;
    flex-shrink: 0;
  }
  .rp-student-name { margin: 0; font-weight: 700; font-size: 15px; color: #2c2410; }
  .rp-student-email { margin: 2px 0 0; font-size: 12.5px; color: #7a6a3f; }

  .rp-section {
    background: #fff;
    border-radius: 14px;
    padding: 20px 22px;
    margin-bottom: 18px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.06);
  }
  .rp-section h2 {
    margin: 0 0 14px;
    font-size: 16px;
    color: #4C3802;
    border-bottom: 2px solid #FBF3DD;
    padding-bottom: 8px;
  }
  .rp-section h3 {
    margin: 16px 0 8px;
    font-size: 13.5px;
    color: #4C3802;
  }

  .rp-stat-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 14px;
    margin-bottom: 4px;
  }
  .rp-stat-card {
    background: #FBF3DD;
    border-radius: 12px;
    padding: 14px 10px;
    text-align: center;
  }
  .rp-stat-icon { font-size: 20px; margin-bottom: 4px; }
  .rp-stat-value { font-size: 18px; font-weight: 800; color: #4C3802; }
  .rp-stat-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.04em; color: #8a7841; margin-top: 2px; }

  .rp-bar { height: 10px; background: #EFE4C4; border-radius: 999px; overflow: hidden; margin-top: 6px; }
  .rp-bar-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, #D9A82C, #A17807); }

  .rp-badge {
    display: inline-block;
    border-radius: 999px;
    font-weight: 800;
    white-space: nowrap;
  }
  .rp-badge-md { padding: 4px 12px; font-size: 12.5px; }
  .rp-badge-lg { padding: 8px 18px; font-size: 16px; }
  .rp-badge.tier-great { background: #EAF6EE; color: #1E6B34; }
  .rp-badge.tier-good { background: #FBF3DD; color: #4C3802; }
  .rp-badge.tier-try { background: #FFF1E6; color: #B5651D; }
  .rp-badge.rp-badge-neutral { background: #f0f0f0; color: #777; }

  .rp-module-card {
    border: 1px solid #EFE4C4;
    border-radius: 12px;
    padding: 14px 16px;
    margin-bottom: 14px;
    page-break-inside: avoid;
  }
  .rp-module-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 6px;
  }
  .rp-module-card-header h3 { margin: 0; font-size: 14px; color: #2c2410; }

  .rp-row-list { list-style: none; margin: 8px 0 0; padding: 0; }
  .rp-row-list li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 0;
    border-bottom: 1px dashed #EFE4C4;
    font-size: 12.5px;
  }
  .rp-row-list li:last-child { border-bottom: none; }
  .rp-row-list .rp-row-title { flex: 1; }

  .rp-quiz-review-card {
    border-radius: 10px;
    padding: 12px 14px;
    margin-bottom: 10px;
    background: #FBF3DD;
    border-left: 4px solid #EFE4C4;
    page-break-inside: avoid;
  }
  .rp-quiz-review-card.correct { border-left-color: #1E6B34; }
  .rp-quiz-review-card.wrong { border-left-color: #B5651D; }
  .rp-quiz-review-card p { margin: 4px 0; font-size: 12.5px; }
  .rp-quiz-review-status { font-weight: 700; }
  .rp-quiz-review-feedback {
    background: #fff;
    border-radius: 6px;
    padding: 8px 10px;
    margin-top: 6px;
    font-style: italic;
    font-size: 12px;
  }

  .rp-score-hero {
    display: flex;
    align-items: center;
    gap: 20px;
  }
  .rp-score-ring {
    width: 88px;
    height: 88px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 800;
    font-size: 20px;
    flex-shrink: 0;
  }
  .rp-score-ring.tier-great { background: #EAF6EE; color: #1E6B34; }
  .rp-score-ring.tier-good { background: #FBF3DD; color: #4C3802; }
  .rp-score-ring.tier-try { background: #FFF1E6; color: #B5651D; }
  .rp-score-hero-banner { margin: 8px 0 0; font-weight: 700; font-size: 14px; }

  .rp-grade-badge {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 64px;
    height: 64px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .rp-grade-badge.tier-great { background: #EAF6EE; color: #1E6B34; }
  .rp-grade-badge.tier-good { background: #FBF3DD; color: #4C3802; }
  .rp-grade-badge.tier-try { background: #FFF1E6; color: #B5651D; }
  .rp-grade-badge.tier-neutral { background: #f0f0f0; color: #888; }
  .rp-grade-letter { font-size: 24px; font-weight: 800; line-height: 1; }
  .rp-grade-label { font-size: 8px; text-transform: uppercase; letter-spacing: 0.04em; margin-top: 3px; }

  .rp-badge-icon-img { border-radius: 8px; object-fit: cover; vertical-align: middle; }
  .rp-badge-icon-fallback { display: inline-block; vertical-align: middle; }

  .rp-badge-gallery {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 18px;
  }
  .rp-badge-gallery-item {
    background: #FBF3DD;
    border-radius: 16px;
    padding: 18px 12px;
    text-align: center;
  }
  .rp-badge-gallery-item img,
  .rp-badge-gallery-item .rp-badge-icon-fallback { display: block; margin: 0 auto 10px; }
  .rp-badge-gallery-name { font-size: 14px; font-weight: 800; margin: 0; color: #2c2410; }
  .rp-badge-gallery-module { font-size: 11px; color: #8a7841; margin: 4px 0 0; }

  .rp-certificate-img { max-width: 100%; max-height: 320px; border-radius: 10px; box-shadow: 0 4px 12px rgba(0,0,0,0.12); }

  .rp-inprogress-banner {
    background: #FFF1E6;
    color: #B5651D;
    border-radius: 10px;
    padding: 10px 14px;
    margin-top: 12px;
    font-size: 12.5px;
    font-weight: 700;
  }

  .rp-footer {
    text-align: center;
    font-size: 11px;
    color: #8a7841;
    margin-top: 26px;
  }
`;

function reportShell({ title, subtitle, info, student, bodyHtml, badgeEmoji }) {
  const initial = (student?.fullname || "?").trim().charAt(0).toUpperCase() || "?";
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8" />
      <title>${esc(title)}</title>
      <style>${SHARED_STYLES}</style>
    </head>
    <body>
      <div class="rp-watermark">${esc(info?.company_name || "")}</div>
      <div class="rp-page">
        <div class="rp-header">
          ${info?.logo_url ? `<img src="${esc(info.logo_url)}" class="rp-logo" alt="Logo" />` : ""}
          <div>
            <h1>${badgeEmoji || "🎓"} ${esc(title)}</h1>
            ${subtitle ? `<p class="rp-subtitle">${esc(subtitle)}</p>` : ""}
          </div>
        </div>

        <div class="rp-student-card">
          <div class="rp-student-avatar">${esc(initial)}</div>
          <div>
            <p class="rp-student-name">${esc(student?.fullname)}</p>
            ${student?.email ? `<p class="rp-student-email">${esc(student.email)}</p>` : ""}
          </div>
        </div>

        ${bodyHtml}

        <div class="rp-footer">
          Generated on ${new Date().toLocaleString()} · ${esc(info?.company_name || "")}
        </div>
      </div>
    </body>
    </html>
  `;
}

// ---------------------------------------------------------------------
// QUIZ REPORT
// data: { info, student, courseTitle, moduleTitle, lessonTitle, quizTitle,
//         score, passed, takenAt, reviewData }
// ---------------------------------------------------------------------
function renderQuizReportHtml(data) {
  const { info, student, courseTitle, moduleTitle, lessonTitle, quizTitle, score, passed, takenAt, reviewData = [] } = data;
  const tier = scoreTier(score);
  const bannerText =
    score === null || score === undefined
      ? "This quiz hasn't been taken yet."
      : passed
      ? "Great job, this quiz was passed! 🎉"
      : "Nice try — a little more practice and you'll get it! 💪";

  const answered = reviewData.filter((r) => r.yourAnswer && String(r.yourAnswer).trim() !== "").length;
  const correct = reviewData.filter((r) => r.isCorrect).length;

  const body = `
    <div class="rp-section">
      <h2>📚 Where This Came From</h2>
      <div class="rp-stat-grid" style="grid-template-columns: repeat(3, 1fr);">
        ${statCard("📘", "Course", courseTitle || "—")}
        ${statCard("🧩", "Module", moduleTitle || "—")}
        ${statCard("📖", "Lesson", lessonTitle || "—")}
      </div>
    </div>

    <div class="rp-section">
      <h2>📊 Result — ${esc(quizTitle || "Quiz")}</h2>
      <div class="rp-score-hero">
        <div class="rp-score-ring ${tier.className}">${score !== null && score !== undefined ? score + "%" : "—"}</div>
        <div>
          <p class="rp-score-hero-banner">${tier.emoji} ${esc(bannerText)}</p>
          <p style="margin:2px 0 0; font-size:12px; color:#7a6a3f;">
            ${answered}/${reviewData.length} answered · ${correct}/${reviewData.length} correct
            ${takenAt ? ` · Taken ${new Date(takenAt).toLocaleDateString()}` : ""}
          </p>
        </div>
      </div>
    </div>

    ${
      reviewData.length
        ? `
      <div class="rp-section">
        <h2>📝 Question by Question</h2>
        ${reviewData
          .map(
            (q) => `
          <div class="rp-quiz-review-card ${q.isCorrect ? "correct" : "wrong"}">
            <p style="font-weight:700;">${esc(q.question)}</p>
            <p><strong>Your answer:</strong> ${esc(q.yourAnswer || "No answer")}</p>
            ${!q.isCorrect ? `<p><strong>Correct answer:</strong> ${esc(q.correctAnswer)}</p>` : ""}
            <p class="rp-quiz-review-status">${q.isCorrect ? "✅ Correct!" : "❌ Not quite"}</p>
            ${q.feedback ? `<div class="rp-quiz-review-feedback">🤖 ${esc(q.feedback)}</div>` : ""}
          </div>`
          )
          .join("")}
      </div>`
        : `<div class="rp-section"><p>No detailed answer breakdown available for this quiz.</p></div>`
    }
  `;

  return reportShell({
    title: "Quiz Report",
    subtitle: quizTitle,
    info,
    student,
    bodyHtml: body,
    badgeEmoji: "📝",
  });
}

// ---------------------------------------------------------------------
// MODULE REPORT
// data: { info, student, courseTitle, moduleTitle, lessons, quizzes,
//         assignments, badges (optional), timeSpent (optional) }
// lessons: [{ title, completed_at }]
// quizzes: [{ quiz_title|title, lesson_title, score, taken_at }]
// assignments: [{ title, total, grade, ai_feedback, submitted_at }]
// badges: [{ badge_name, badge_image, awarded_at }]
// ---------------------------------------------------------------------
function renderModuleReportHtml(data) {
  const { info, student, courseTitle, moduleTitle, lessons = [], quizzes = [], assignments = [], badges = [], timeSpent } = data;

  const totalLessons = lessons.length;
  const completedLessons = lessons.filter((l) => l.completed_at).length;
  const percent = totalLessons ? Math.round((completedLessons / totalLessons) * 100) : 0;

  const quizScores = quizzes.filter((q) => q.score !== null && q.score !== undefined);
  const quizAvg = quizScores.length ? Math.round(quizScores.reduce((a, b) => a + b.score, 0) / quizScores.length) : null;

  const assignmentScores = assignments.filter((a) => a.total !== null && a.total !== undefined);
  const assignmentAvg = assignmentScores.length
    ? Math.round(assignmentScores.reduce((a, b) => a + (b.total || 0), 0) / assignmentScores.length)
    : null;

  const grade = smartScore(percent, quizAvg, assignmentAvg);

  const statCards = [
    statCard(percent === 100 ? "🏆" : "📖", "Lessons Complete", `${completedLessons}/${totalLessons}`),
    statCard("🧠", "Quiz Average", quizAvg !== null ? `${quizAvg}%` : "—"),
    statCard("📝", "Assignment Average", assignmentAvg !== null ? `${assignmentAvg}%` : "—"),
  ];
  if (timeSpent) statCards.push(statCard("⏱️", "Time Spent", timeSpent));

  const body = `
    <div class="rp-section">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:16px;">
        <h2 style="border:none; padding:0; margin:0; flex:1;">
          ${badges.length ? badgeImageHtml(badges[0], 28) + " " : ""}🧩 ${esc(moduleTitle)}
          <span style="font-size:12px; font-weight:400; color:#8a7841;">— ${esc(courseTitle || "")}</span>
        </h2>
        ${gradeCircle(grade, "Grade")}
      </div>
      <div style="height:10px;"></div>
      ${progressBar(percent)}
      <div style="height:14px;"></div>
      ${statGrid(statCards)}
    </div>

    <div class="rp-section">
      <h2>📖 Lessons</h2>
      <ul class="rp-row-list">
        ${lessons
          .map(
            (l) => `
          <li>
            <span>${l.completed_at ? "✅" : "⭕"}</span>
            <span class="rp-row-title">${esc(l.title)}</span>
          </li>`
          )
          .join("") || "<li>No lessons in this module yet.</li>"}
      </ul>
    </div>

    <div class="rp-section">
      <h2>🧠 Quizzes</h2>
      <ul class="rp-row-list">
        ${quizzes
          .map(
            (q) => `
          <li>
            <span class="rp-row-title">${esc(q.quiz_title || q.title || q.lesson_title)}</span>
            ${scoreBadge(q.score)}
          </li>`
          )
          .join("") || "<li>No quizzes in this module yet.</li>"}
      </ul>
    </div>

    <div class="rp-section">
      <h2>📝 Assignments</h2>
      <ul class="rp-row-list">
        ${assignments
          .map(
            (a) => `
          <li>
            <span class="rp-row-title">${esc(a.title)}</span>
            ${scoreBadge(a.total)}
          </li>`
          )
          .join("") || "<li>No assignments in this module yet.</li>"}
      </ul>
    </div>

    ${badgesSectionHtml(badges)}
  `;

  return reportShell({
    title: "Module Report",
    subtitle: moduleTitle,
    info,
    student,
    bodyHtml: body,
    badgeEmoji: "🧩",
  });
}

// Builds one course's stat-grid + module cards (no outer page shell) — the
// shared building block for both a single-course report and the multi-course
// full student report below.
function buildCourseSectionHtml(courseTitle, modules = []) {
  const enriched = modules.map((mod) => {
    const lessons = mod.lessons || [];
    const quizzes = mod.quizzes || [];
    const assignments = mod.assignments || [];
    const badges = mod.badges || [];

    const totalLessons = lessons.length;
    const completedLessons = lessons.filter((l) => l.completed_at).length;
    const percent = totalLessons ? Math.round((completedLessons / totalLessons) * 100) : 0;

    const quizScores = quizzes.filter((q) => q.score !== null && q.score !== undefined);
    const quizAvg = quizScores.length ? Math.round(quizScores.reduce((a, b) => a + b.score, 0) / quizScores.length) : null;

    const assignmentScores = assignments.filter((a) => a.total !== null && a.total !== undefined);
    const assignmentAvg = assignmentScores.length
      ? Math.round(assignmentScores.reduce((a, b) => a + (b.total || 0), 0) / assignmentScores.length)
      : null;

    const grade = smartScore(percent, quizAvg, assignmentAvg);

    return { ...mod, lessons, quizzes, assignments, badges, totalLessons, completedLessons, percent, quizAvg, assignmentAvg, grade };
  });

  const totalLessons = enriched.reduce((a, m) => a + m.totalLessons, 0);
  const completedLessons = enriched.reduce((a, m) => a + m.completedLessons, 0);
  const coursePercent = totalLessons ? Math.round((completedLessons / totalLessons) * 100) : 0;

  const allQuizScores = enriched.flatMap((m) => m.quizzes.filter((q) => q.score !== null && q.score !== undefined));
  const courseQuizAvg = allQuizScores.length
    ? Math.round(allQuizScores.reduce((a, b) => a + b.score, 0) / allQuizScores.length)
    : null;

  const allAssignmentScores = enriched.flatMap((m) => m.assignments.filter((a) => a.total !== null && a.total !== undefined));
  const courseAssignmentAvg = allAssignmentScores.length
    ? Math.round(allAssignmentScores.reduce((a, b) => a + (b.total || 0), 0) / allAssignmentScores.length)
    : null;

  const courseGrade = smartScore(coursePercent, courseQuizAvg, courseAssignmentAvg);
  const modulesComplete = enriched.filter((m) => m.totalLessons > 0 && m.percent === 100).length;

  const statCards = [
    statCard("🧩", "Modules Mastered", `${modulesComplete}/${enriched.length}`),
    statCard(coursePercent === 100 ? "🏆" : "📖", "Lessons Complete", `${completedLessons}/${totalLessons}`),
    statCard("🧠", "Quiz Average", courseQuizAvg !== null ? `${courseQuizAvg}%` : "—"),
    statCard("📝", "Assignment Average", courseAssignmentAvg !== null ? `${courseAssignmentAvg}%` : "—"),
  ];

  return `
    <div class="rp-section">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:16px;">
        <h2 style="border:none; padding:0; margin:0; flex:1;">📘 ${esc(courseTitle)}</h2>
        ${gradeCircle(courseGrade, "Course Grade")}
      </div>
      <div style="height:10px;"></div>
      ${progressBar(coursePercent)}
      ${inProgressBannerHtml(coursePercent)}
      <div style="height:14px;"></div>
      ${statGrid(statCards)}
    </div>

    ${enriched
      .map(
        (mod) => `
      <div class="rp-module-card">
        <div class="rp-module-card-header">
          <h3>${mod.badges.length ? badgeImageHtml(mod.badges[0], 22) + " " : ""}${mod.percent === 100 ? "🏆" : mod.percent > 0 ? "📖" : "⭕"} ${esc(mod.title)}</h3>
          <div style="display:flex; align-items:center; gap:8px;">
            ${gradeChip(mod.grade)}
            <span style="font-weight:800; color:#4C3802; font-size:13px;">${mod.percent}%${mod.timeSpent ? ` · ⏱️ ${esc(mod.timeSpent)}` : ""}</span>
          </div>
        </div>
        ${progressBar(mod.percent)}

        <h3>📖 Lessons</h3>
        <ul class="rp-row-list">
          ${mod.lessons
            .map((l) => `<li><span>${l.completed_at ? "✅" : "⭕"}</span><span class="rp-row-title">${esc(l.title)}</span></li>`)
            .join("") || "<li>No lessons yet.</li>"}
        </ul>

        ${
          mod.quizzes.length
            ? `
        <h3>🧠 Quizzes</h3>
        <ul class="rp-row-list">
          ${mod.quizzes
            .map((q) => `<li><span class="rp-row-title">${esc(q.quiz_title || q.title || q.lesson_title)}</span>${scoreBadge(q.score)}</li>`)
            .join("")}
        </ul>`
            : ""
        }

        ${
          mod.assignments.length
            ? `
        <h3>📝 Assignments</h3>
        <ul class="rp-row-list">
          ${mod.assignments.map((a) => `<li><span class="rp-row-title">${esc(a.title)}</span>${scoreBadge(a.total)}</li>`).join("")}
        </ul>`
            : ""
        }
      </div>`
      )
      .join("")}
  `;
}

// ---------------------------------------------------------------------
// COURSE REPORT (single course)
// data: { info, student, courseTitle, modules, badges (optional), certificate (optional) }
// modules: [{ title, lessons: [...], quizzes: [...], assignments: [...], timeSpent (optional) }]
// badges: [{ badge_name, module_title, awarded_at }]
// certificate: { issued_at } (optional)
// ---------------------------------------------------------------------
function renderCourseReportHtml(data) {
  const { info, student, courseTitle, modules = [], badges = [], certificate } = data;

  const body = buildCourseSectionHtml(courseTitle, modules) + certificateSectionHtml(certificate) + badgesSectionHtml(badges);

  return reportShell({
    title: "Course Report",
    subtitle: courseTitle,
    info,
    student,
    bodyHtml: body,
    badgeEmoji: "📘",
  });
}

// ---------------------------------------------------------------------
// FULL STUDENT REPORT (every course a student is in, one PDF)
// data: { info, student, courses, xp (optional), level (optional) }
// courses: [{ title, modules, badges (optional), certificate (optional) }]
// ---------------------------------------------------------------------
function renderStudentFullReportHtml(data) {
  const { info, student, courses = [], xp, level } = data;

  const topStats = [];
  if (xp !== undefined && xp !== null) topStats.push(statCard("⚡", "Total XP", xp));
  if (level !== undefined && level !== null) topStats.push(statCard("🎮", "Level", level));

  const body = `
    ${topStats.length ? `<div class="rp-section">${statGrid(topStats)}</div>` : ""}
    ${courses
      .map(
        (course) =>
          buildCourseSectionHtml(course.title, course.modules || []) +
          certificateSectionHtml(course.certificate) +
          badgesSectionHtml(course.badges || [])
      )
      .join("")}
  `;

  return reportShell({
    title: "Student Progress Report",
    subtitle: `${courses.length} course${courses.length === 1 ? "" : "s"}`,
    info,
    student,
    bodyHtml: body,
    badgeEmoji: "📑",
  });
}

module.exports = {
  renderQuizReportHtml,
  renderModuleReportHtml,
  renderCourseReportHtml,
  renderStudentFullReportHtml,
  scoreBadge,
  progressBar,
  statCard,
  statGrid,
};
