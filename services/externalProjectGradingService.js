// services/externalProjectGradingService.js
//
// Grades an external_project_submissions row: reads whatever the student
// attached (a file, a zip, a GitHub link) as TEXT, never runs/imports/
// executes any of it, then asks the AI to score it against the task's real,
// instructor-authored rubric. Mirrors controllers/labController.js's
// gradeLessonLabSubmission contract (simple JSON, clamped/validated in
// code) rather than the older, free-text-rubric assignment grader —
// see docs/external-project-grading-plan.docx for the full design and why.
//
// Every "read" here is a plain HTTP GET (to Cloudinary or GitHub's public
// API) or an in-memory archive/PDF text extraction — the same category of
// action this app already takes calling third-party APIs elsewhere. Nothing
// submitted is ever executed, matching the posture held everywhere else in
// this app (Web/Blockly/Python Labs run only in the student's own browser;
// Arduino only compiles, never executes, server-side).

const axios = require("axios");
const AdmZip = require("adm-zip");
// pdf-parse 2.x bundles a modern pdfjs-dist that calls
// process.getBuiltinModule() (a Node API added in 22.3+) — crashed the
// entire app on boot in production, where the deployed Node runtime was
// older than that. The classic 1.x line avoids that specific call but
// turned out to choke on pdfkit-generated PDFs ("bad XRef entry" — its
// bundled PDF.js is genuinely too old/buggy for some modern PDF
// structures, confirmed directly, not assumed). Fixed the real root
// cause instead of downgrading further: package.json now pins Node
// >=22.3.0 (see the "engines" field) so Railway/Nixpacks provisions a
// Node version that actually has process.getBuiltinModule, matching
// local dev where this exact v2.4.5 + class-based API was already
// verified working end to end (real PDF round-trip, real submission
// grading) before this ever shipped.
const { PDFParse } = require("pdf-parse");
const { askTutor } = require("../utils/ai");

const MAX_CONTENT_CHARS = 20000; // per attachment, before it goes into the AI prompt
const MAX_ZIP_KEY_FILES = 6;
const MAX_FETCH_BYTES = 30 * 1024 * 1024;

const TEXT_EXTENSIONS = new Set([
  "py", "js", "jsx", "ts", "tsx", "md", "txt", "json", "html", "css", "scss",
  "yml", "yaml", "java", "c", "cpp", "h", "cs", "go", "rb", "php", "sql", "sh",
]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]);
const KEY_ZIP_FILENAMES = new Set([
  "readme.md", "readme.txt", "readme",
  "requirements.txt", "package.json", "pipfile", "dockerfile", "docker-compose.yml",
  "app.py", "main.py", "server.py", "index.js", "app.js",
]);

function truncate(text, max = MAX_CONTENT_CHARS) {
  const s = String(text || "");
  return s.length > max ? s.slice(0, max) + "\n...[truncated]" : s;
}

function extensionFromUrl(url) {
  try {
    const clean = String(url).split("?")[0].split("#")[0];
    const last = clean.split("/").pop() || "";
    const ext = last.includes(".") ? last.split(".").pop().toLowerCase() : "";
    return ext;
  } catch {
    return "";
  }
}

async function fetchBuffer(url) {
  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 15000,
    maxContentLength: MAX_FETCH_BYTES,
    headers: { "User-Agent": "jkthub-project-grader" },
  });
  return Buffer.from(res.data);
}

function readZipBuffer(buffer) {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  const fileList = entries.map((e) => e.entryName).join("\n") || "(empty archive)";

  const keyEntries = entries
    .filter((e) => KEY_ZIP_FILENAMES.has(e.entryName.split("/").pop().toLowerCase()))
    .slice(0, MAX_ZIP_KEY_FILES);

  let content = `File list (${entries.length} files):\n${fileList}\n`;
  for (const entry of keyEntries) {
    try {
      content += `\n--- ${entry.entryName} ---\n${truncate(zip.readAsText(entry), 4000)}\n`;
    } catch {
      // unreadable as text (binary content under a key filename) — skip silently, the file list already shows it exists
    }
  }
  return truncate(content);
}

async function readPdfBuffer(buffer) {
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  return truncate(result.text);
}

// A single uploaded "file" deliverable — text/code read directly, zip
// extracted, PDF text-extracted, image/unrecognized noted (not silently
// ignored, unlike the existing assignment grader's file_url).
async function readFileDeliverable(url) {
  const ext = extensionFromUrl(url);
  try {
    const buffer = await fetchBuffer(url);
    if (ext === "zip") return { content: readZipBuffer(buffer) };
    if (ext === "pdf") return { content: await readPdfBuffer(buffer) };
    if (TEXT_EXTENSIONS.has(ext)) return { content: truncate(buffer.toString("utf8")) };
    if (IMAGE_EXTENSIONS.has(ext)) {
      return { content: null, note: "An image was attached — its visual content is not analyzed by this grader (text-only)." };
    }
    return { content: null, note: `Attached file has an unrecognized type (.${ext || "unknown"}) — content not read.` };
  } catch (err) {
    return { content: null, note: `Could not fetch/read this file: ${err.message}` };
  }
}

async function ghGet(url) {
  return axios.get(url, {
    timeout: 15000,
    headers: {
      "User-Agent": "jkthub-project-grader",
      Accept: "application/vnd.github+json",
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
  });
}

// A GitHub repo link — public repos only (Section 10 of the design doc
// flags private-repo support as a separate, unsolved decision). Reads the
// file tree + README + a handful of conventionally-important files via
// GitHub's read-only REST API. No auth token required; GITHUB_TOKEN is used
// automatically if set (raises the otherwise-tight 60/hr unauthenticated
// rate limit), never required.
async function readGithubDeliverable(url) {
  const match = String(url).match(/github\.com\/([^/]+)\/([^/?#]+)/i);
  if (!match) return { content: null, note: "Could not parse a GitHub repository from this link." };
  const owner = match[1];
  const repo = match[2].replace(/\.git$/, "");

  try {
    const repoInfo = await ghGet(`https://api.github.com/repos/${owner}/${repo}`);
    const defaultBranch = repoInfo.data.default_branch;

    const treeRes = await ghGet(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`
    );
    const allPaths = (treeRes.data.tree || []).filter((t) => t.type === "blob").map((t) => t.path);
    const fileList = allPaths.slice(0, 300).join("\n") || "(empty repository)";

    const keyPaths = allPaths
      .filter((p) => KEY_ZIP_FILENAMES.has(p.split("/").pop().toLowerCase()))
      .slice(0, MAX_ZIP_KEY_FILES);

    let content = `Repository: ${owner}/${repo} (default branch: ${defaultBranch})\nFile list (${allPaths.length} files):\n${fileList}\n`;
    for (const path of keyPaths) {
      try {
        const fileRes = await ghGet(
          `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${defaultBranch}`
        );
        const text = Buffer.from(fileRes.data.content || "", fileRes.data.encoding || "base64").toString("utf8");
        content += `\n--- ${path} ---\n${truncate(text, 4000)}\n`;
      } catch {
        // one file failing to fetch shouldn't drop the rest of the gathered content
      }
    }
    return { content: truncate(content) };
  } catch (err) {
    const status = err.response && err.response.status;
    if (status === 404) return { content: null, note: "GitHub repository not found or not public." };
    if (status === 403) return { content: null, note: "GitHub API rate limit reached while reading this repository — try again shortly." };
    return { content: null, note: `Could not read this GitHub repository: ${err.message}` };
  }
}

// Gathers readable content for every attachment on a submission. Never
// throws — a single unreadable attachment degrades to a note for the AI,
// it never blocks grading the rest of the submission.
async function gatherSubmissionContent(attachments) {
  const sections = [];
  for (const item of attachments || []) {
    const label = item.label || "Attachment";
    let result;
    if (item.type === "github_link") {
      result = await readGithubDeliverable(item.url);
    } else {
      result = await readFileDeliverable(item.url);
    }
    sections.push(
      result.content
        ? `=== ${label} ===\n${result.content}`
        : `=== ${label} ===\n(${result.note || "Could not read this attachment."})`
    );
  }
  return sections.join("\n\n") || "(No attachments were submitted.)";
}

function buildGradingPrompt(project, notes, gatheredContent) {
  const rubricLines = (project.rubric || [])
    .map((r) => `- ${r.criterion} (${r.weight} pts)`)
    .join("\n");

  return `You are grading a student's project submission for: "${project.title}"

--- INSTRUCTIONS ---
${project.instructions || "(none provided)"}

--- RUBRIC (grade EACH criterion against its own weight; weights sum to 100) ---
${rubricLines || "(no rubric criteria were defined for this task)"}

--- STUDENT'S NOTES ---
${notes || "(none provided)"}

--- SUBMITTED CONTENT ---
${gatheredContent}

Be encouraging and fair — give credit for genuine effort and partial progress. If an attachment's content could not be read, grade based on what IS readable plus the student's notes; do not penalize the student for a note that says content could not be read.

Return ONLY this JSON shape, no other text:
{
  "criteria": [{ "criterion": "<exact criterion text from the rubric>", "score": <0 to that criterion's weight>, "comment": "<1-2 sentences>" }],
  "total": <0-100>,
  "feedback": "<3-5 sentences overall feedback>"
}`;
}

// Grades one submission: gathers content, asks the AI, validates/clamps the
// response. Returns { status, score, feedback, criteriaBreakdown } — never
// throws; a failure is returned as status:'grading_failed' with a message
// in feedback, so the caller can always persist a definite outcome instead
// of leaving a submission stuck looking like it's still grading forever.
async function gradeSubmission(project, submission) {
  try {
    const gatheredContent = await gatherSubmissionContent(submission.attachments);
    const prompt = buildGradingPrompt(project, submission.notes, gatheredContent);

    const raw = await askTutor({ question: prompt, maxTokens: 1200 });
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { status: "grading_failed", score: null, feedback: "The AI grader's response couldn't be understood. Please ask a teacher to review this submission.", criteriaBreakdown: null };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const total = Math.max(0, Math.min(100, Number(parsed.total) || 0));
    const criteria = Array.isArray(parsed.criteria) ? parsed.criteria : null;
    const feedback = typeof parsed.feedback === "string" ? parsed.feedback : "";

    return { status: "graded", score: total, feedback, criteriaBreakdown: criteria };
  } catch (err) {
    console.error("gradeSubmission error:", err.message);
    return { status: "grading_failed", score: null, feedback: "Grading failed due to a server error. Please ask a teacher to review this submission.", criteriaBreakdown: null };
  }
}

module.exports = { gradeSubmission, gatherSubmissionContent };
