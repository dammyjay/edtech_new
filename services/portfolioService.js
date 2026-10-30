const pool = require("../models/db");
const ejs = require("ejs");
const path = require("path");
const { askTutor } = require("../utils/ai");
const generatePdf = require("../utils/generatePdf");
const { getLevelForXp } = require("../utils/xpLevels");
const { getStudentStreak } = require("./streakService");
const { getCompanyInfo } = require("../utils/companyInfo");

const LAB_TYPE_SKILLS = {
  web: "Web Development (HTML/CSS/JavaScript)",
  blockly: "Visual/Block-Based Programming",
  python: "Python Programming",
  arduino: "Arduino & Electronics",
};

// Every entry gets a resolved course_id (or null) so the caller can filter
// to one course's own portfolio without a second round of queries.
async function getCourseOptions(studentId) {
  const res = await pool.query(
    `SELECT c.id, c.title
     FROM course_enrollments e
     JOIN courses c ON c.id = e.course_id
     WHERE e.user_id = $1
     ORDER BY c.title`,
    [studentId]
  );
  return res.rows;
}

async function getCourses(studentId) {
  const res = await pool.query(
    `SELECT c.id, c.title, c.level, p.title AS pathway_name, e.progress,
            ROUND(AVG(qs.score)) AS quiz_avg
     FROM course_enrollments e
     JOIN courses c ON c.id = e.course_id
     LEFT JOIN career_pathways p ON c.career_pathway_id = p.id
     LEFT JOIN modules m ON m.course_id = c.id
     LEFT JOIN lessons l ON l.module_id = m.id
     LEFT JOIN quizzes qz ON qz.lesson_id = l.id
     LEFT JOIN quiz_submissions qs ON qs.quiz_id = qz.id AND qs.student_id = e.user_id
     WHERE e.user_id = $1
     GROUP BY c.id, c.title, c.level, p.title, e.progress
     ORDER BY e.progress DESC, c.title`,
    [studentId]
  );
  return res.rows.map((r) => ({ ...r, quiz_avg: r.quiz_avg === null ? null : parseInt(r.quiz_avg, 10) }));
}

async function getCertificates(studentId, courseId) {
  const res = await pool.query(
    `SELECT uc.id, uc.issued_at, uc.course_id, c.title AS course_title
     FROM user_certificates uc
     JOIN courses c ON c.id = uc.course_id
     WHERE uc.user_id = $1 ${courseId ? "AND uc.course_id = $2" : ""}
     ORDER BY uc.issued_at DESC`,
    courseId ? [studentId, courseId] : [studentId]
  );
  return res.rows;
}

async function getBadges(studentId, courseId) {
  const res = await pool.query(
    `SELECT ub.id, ub.badge_name, ub.awarded_at, ub.badge_image, m.title AS module_title, c.id AS course_id, c.title AS course_title
     FROM user_badges ub
     JOIN modules m ON ub.module_id = m.id
     JOIN courses c ON m.course_id = c.id
     WHERE ub.user_id = $1 ${courseId ? "AND c.id = $2" : ""}
     ORDER BY ub.awarded_at DESC`,
    courseId ? [studentId, courseId] : [studentId]
  );
  return res.rows;
}

// Combines all three real sources of student-produced work in this
// platform (see controllers/labController.js / externalProjectController.js):
// (a) freeform Lab Gallery projects the student chose to publish,
// (b) lesson-tied lab tasks (graded, lab_id set), (c) External Project
// submissions (file/zip/GitHub link, graded outside any lab). Each row
// gets a normalized {id, title, type, source, courseId, courseTitle,
// score, date, isPublished} shape so the view never has to branch on
// which table a project came from.
async function getProjects(studentId, courseId) {
  const [galleryRes, labTaskRes, externalRes] = await Promise.all([
    pool.query(
      `SELECT id, project_name AS title, lab_type, published_at AS date, is_published
       FROM lab_projects
       WHERE student_id = $1 AND is_published = true
       ORDER BY published_at DESC`,
      [studentId]
    ),
    pool.query(
      `SELECT lp.id, lp.project_name AS title, lp.lab_type, lp.updated_at AS date,
              c.id AS course_id, c.title AS course_title,
              (SELECT MAX(ls.score) FROM lab_submissions ls WHERE ls.project_id = lp.id) AS score
       FROM lab_projects lp
       JOIN lesson_labs ll ON ll.id = lp.lab_id
       JOIN lessons les ON les.id = ll.lesson_id
       JOIN modules m ON m.id = les.module_id
       JOIN courses c ON c.id = m.course_id
       WHERE lp.student_id = $1 AND lp.lab_id IS NOT NULL
       ORDER BY lp.updated_at DESC`,
      [studentId]
    ),
    pool.query(
      `SELECT eps.id, ep.title, eps.score, eps.status, eps.submitted_at AS date,
              ep.course_id AS direct_course_id, m.course_id AS module_course_id, m2.course_id AS lesson_course_id
       FROM external_project_submissions eps
       JOIN external_projects ep ON ep.id = eps.external_project_id
       LEFT JOIN modules m ON m.id = ep.module_id
       LEFT JOIN lessons les ON les.id = ep.lesson_id
       LEFT JOIN modules m2 ON m2.id = les.module_id
       WHERE eps.student_id = $1
       ORDER BY eps.submitted_at DESC`,
      [studentId]
    ),
  ]);

  const projects = [
    ...galleryRes.rows.map((r) => ({
      id: `gallery-${r.id}`,
      title: r.title,
      type: LAB_TYPE_SKILLS[r.lab_type] || r.lab_type,
      source: "gallery",
      courseId: null,
      courseTitle: null,
      score: null,
      date: r.date,
      isPublished: true,
    })),
    ...labTaskRes.rows
      .filter((r) => r.score !== null)
      .map((r) => ({
        id: `labtask-${r.id}`,
        title: r.title,
        type: LAB_TYPE_SKILLS[r.lab_type] || r.lab_type,
        source: "lab_task",
        courseId: r.course_id,
        courseTitle: r.course_title,
        score: r.score,
        date: r.date,
        isPublished: false,
      })),
    ...externalRes.rows
      .filter((r) => r.status !== "grading")
      .map((r) => ({
        id: `external-${r.id}`,
        title: r.title,
        type: "External Project",
        source: "external",
        courseId: r.direct_course_id || r.module_course_id || r.lesson_course_id || null,
        courseTitle: null,
        score: r.score,
        date: r.date,
        isPublished: false,
      })),
  ];

  if (!courseId) return projects;
  // Gallery projects have no course_id (freeform), so they only ever show
  // on the full/aggregate CV, never a single course's own portfolio.
  return projects.filter((p) => p.courseId === courseId);
}

async function getEntries(studentId) {
  const res = await pool.query(
    `SELECT * FROM portfolio_entries WHERE student_id = $1 ORDER BY sort_order, entry_year DESC NULLS LAST, created_at DESC`,
    [studentId]
  );
  return res.rows;
}

function buildSkills(courses, projects) {
  const skills = new Set();
  for (const c of courses) {
    if (c.progress >= 100) skills.add(c.title);
  }
  for (const p of projects) {
    if (p.type) skills.add(p.type);
  }
  return Array.from(skills);
}

async function getPortfolioData(studentId, { courseId } = {}) {
  const normalizedCourseId = courseId ? parseInt(courseId, 10) : null;

  const [courseOptions, allCourses, certificates, badges, projects, entries] = await Promise.all([
    getCourseOptions(studentId),
    getCourses(studentId),
    getCertificates(studentId, normalizedCourseId),
    getBadges(studentId, normalizedCourseId),
    getProjects(studentId, normalizedCourseId),
    getEntries(studentId),
  ]);

  const courses = normalizedCourseId ? allCourses.filter((c) => c.id === normalizedCourseId) : allCourses;
  const skills = buildSkills(courses, projects);

  const summaryRes = await pool.query(
    normalizedCourseId
      ? `SELECT summary_text, generated_at FROM portfolio_summaries WHERE student_id = $1 AND course_id = $2`
      : `SELECT summary_text, generated_at FROM portfolio_summaries WHERE student_id = $1 AND course_id IS NULL`,
    normalizedCourseId ? [studentId, normalizedCourseId] : [studentId]
  );

  return {
    courseOptions,
    courses,
    certificates,
    badges,
    projects,
    entries,
    skills,
    summary: summaryRes.rows[0] || null,
    scopedCourseId: normalizedCourseId,
    scopedCourseTitle: normalizedCourseId ? (courseOptions.find((c) => c.id === normalizedCourseId) || {}).title : null,
  };
}

// Follows the same convention as every other AI feature in this codebase
// (services/externalProjectGradingService.js, services/masteryPathService.js):
// build a task-specific prompt, call the one shared askTutor() primitive
// (utils/ai.js) rather than a second OpenAI client. Deliberately asks for
// plain prose, not JSON — this is read as-is on the portfolio page.
function buildPortfolioPrompt(data, scopeLabel) {
  const lines = [];
  lines.push(
    `Write a CV/portfolio summary for a student on an educational platform, covering ${scopeLabel}. ` +
    `Write 2-3 short paragraphs, plain text only (no markdown headers or bullet lists), encouraging and clear — ` +
    `suitable for a learner anywhere from primary to secondary school age, not corporate jargon. ` +
    `Do NOT use the student's name anywhere — write descriptively (e.g. "Completed...", "Built...", "Has shown...") ` +
    `since this text may also be shown on a public page that never reveals the student's name. ` +
    `Only describe what is actually listed below — never invent achievements, scores, or projects that aren't given.`
  );
  lines.push("\nCOURSES:");
  if (data.courses.length) {
    for (const c of data.courses) {
      lines.push(
        `- ${c.title} (${c.level || "level n/a"}), progress ${c.progress}%` +
        (c.quiz_avg !== null ? `, quiz average ${c.quiz_avg}%` : "")
      );
    }
  } else {
    lines.push("- (none yet)");
  }

  lines.push("\nCERTIFICATES EARNED:");
  lines.push(data.certificates.length ? data.certificates.map((c) => `- ${c.course_title}`).join("\n") : "- (none yet)");

  lines.push("\nBADGES EARNED:");
  lines.push(data.badges.length ? data.badges.map((b) => `- ${b.badge_name} (${b.module_title})`).join("\n") : "- (none yet)");

  lines.push("\nPROJECTS:");
  if (data.projects.length) {
    for (const p of data.projects) {
      lines.push(`- ${p.title} [${p.type}]` + (p.score !== null && p.score !== undefined ? `, score ${p.score}` : ""));
    }
  } else {
    lines.push("- (none yet)");
  }

  lines.push("\nOTHER ACHIEVEMENTS / EXPERIENCE (added by the student):");
  if (data.entries.length) {
    for (const e of data.entries) {
      lines.push(`- [${e.entry_type}] ${e.title}${e.organization ? ` — ${e.organization}` : ""}${e.entry_year ? ` (${e.entry_year})` : ""}${e.description ? `: ${e.description}` : ""}`);
    }
  } else {
    lines.push("- (none)");
  }

  return lines.join("\n");
}

async function generateAndSaveSummary(studentId, { courseId } = {}) {
  const normalizedCourseId = courseId ? parseInt(courseId, 10) : null;
  const data = await getPortfolioData(studentId, { courseId: normalizedCourseId });

  const scopeLabel = normalizedCourseId
    ? `this student's work in the course "${data.scopedCourseTitle || "this course"}"`
    : "this student's entire learning journey across every course";

  const prompt = buildPortfolioPrompt(data, scopeLabel);
  const summaryText = await askTutor({ question: prompt, maxTokens: 650 });

  const existing = await pool.query(
    normalizedCourseId
      ? `SELECT id FROM portfolio_summaries WHERE student_id = $1 AND course_id = $2`
      : `SELECT id FROM portfolio_summaries WHERE student_id = $1 AND course_id IS NULL`,
    normalizedCourseId ? [studentId, normalizedCourseId] : [studentId]
  );

  if (existing.rows.length) {
    await pool.query(
      `UPDATE portfolio_summaries SET summary_text = $1, generated_at = NOW() WHERE id = $2`,
      [summaryText, existing.rows[0].id]
    );
  } else {
    await pool.query(
      `INSERT INTO portfolio_summaries (student_id, course_id, summary_text) VALUES ($1, $2, $3)`,
      [studentId, normalizedCourseId, summaryText]
    );
  }

  return summaryText;
}

const ENTRY_TYPES = new Set(["project", "competition", "experience", "other"]);

async function addEntry(studentId, { entryType, title, organization, entryYear, description, linkUrl }) {
  const safeType = ENTRY_TYPES.has(entryType) ? entryType : "other";
  const res = await pool.query(
    `INSERT INTO portfolio_entries (student_id, entry_type, title, organization, entry_year, description, link_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [studentId, safeType, title, organization || null, entryYear || null, description || null, linkUrl || null]
  );
  return res.rows[0];
}

async function updateEntry(studentId, entryId, { entryType, title, organization, entryYear, description, linkUrl }) {
  const safeType = ENTRY_TYPES.has(entryType) ? entryType : "other";
  const res = await pool.query(
    `UPDATE portfolio_entries
     SET entry_type = $1, title = $2, organization = $3, entry_year = $4, description = $5, link_url = $6, updated_at = NOW()
     WHERE id = $7 AND student_id = $8 RETURNING *`,
    [safeType, title, organization || null, entryYear || null, description || null, linkUrl || null, entryId, studentId]
  );
  return res.rows[0] || null;
}

async function deleteEntry(studentId, entryId) {
  const res = await pool.query(
    `DELETE FROM portfolio_entries WHERE id = $1 AND student_id = $2 RETURNING id`,
    [entryId, studentId]
  );
  return res.rowCount > 0;
}

// Renders the same gamified portfolio content as the on-screen pages
// (views/student/dashboard.ejs's portfolio section, views/parent/
// childPortfolio.ejs) into a print-optimized PDF — same data, same
// "pf-*" visual language, just a dedicated layout tuned for A4 pagination
// (views/pdf/portfolio.ejs) instead of a scrolling web page. Shared by
// both the student's own download (controllers/studentController.js) and
// a parent's download of a linked child's portfolio
// (controllers/userController.js) — same render, different caller.
async function renderPortfolioPdf({ studentId, displayName, avatarUrl, courseId }) {
  const [portfolioData, xpRes, streak, company] = await Promise.all([
    getPortfolioData(studentId, { courseId }),
    pool.query("SELECT xp FROM users2 WHERE id = $1", [studentId]),
    getStudentStreak(studentId),
    getCompanyInfo(),
  ]);

  const levelInfo = getLevelForXp((xpRes.rows[0] || {}).xp || 0);

  const html = await ejs.renderFile(
    path.join(__dirname, "../views/pdf/portfolio.ejs"),
    { portfolioData, displayName, avatarUrl, levelInfo, streak, companyName: company.company_name }
  );

  return generatePdf(html, { margin: { top: "16px", bottom: "16px", left: "16px", right: "16px" } });
}

module.exports = {
  getPortfolioData,
  generateAndSaveSummary,
  addEntry,
  updateEntry,
  deleteEntry,
  renderPortfolioPdf,
  LAB_TYPE_SKILLS,
};
