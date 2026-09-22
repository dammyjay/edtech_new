// Generates docs/external-project-grading-plan.docx
// Re-run this script after editing to regenerate the document — do not
// hand-edit the .docx. Matches the pattern established in
// security/buildSecurityTracker.js and docs/buildPythonLabPlan.js.

const fs = require("fs");
const path = require("path");
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  ShadingType,
  BorderStyle,
  VerticalAlign,
  LevelFormat,
  PageBreak,
} = require("docx");

const BRAND = "A17807";
const BRAND_DARK = "4C3802";
const LIGHT = "F4F1EA";
const WHITE = "FFFFFF";
const DARK_TEXT = "2B2B2B";
const MUTED = "666666";
const GREEN = "1F9D55";
const RED = "D64545";

const FULL_WIDTH = 9350;

function heading(text, level = HeadingLevel.HEADING_1) {
  return new Paragraph({ text, heading: level, spacing: { before: 320, after: 160 } });
}
function bodyPara(runsOrText, opts = {}) {
  const children = Array.isArray(runsOrText) ? runsOrText : [new TextRun({ text: runsOrText, size: 21 })];
  return new Paragraph({ children, spacing: { after: 160, line: 300 }, ...opts });
}
function bullet(text, level = 0) {
  return new Paragraph({ text, bullet: { level }, spacing: { after: 90 } });
}
function code(text) {
  return new TextRun({ text, font: "Consolas", size: 19, color: BRAND_DARK });
}
function cellShaded(text, { header = false, width, bold = false, color, shade } = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    shading: shade
      ? { type: ShadingType.CLEAR, color: "auto", fill: shade }
      : header
      ? { type: ShadingType.CLEAR, color: "auto", fill: BRAND }
      : undefined,
    margins: { top: 80, bottom: 80, left: 100, right: 100 },
    children: [
      new Paragraph({
        children: [new TextRun({ text, bold: bold || header, color: header ? WHITE : color || DARK_TEXT, size: 19 })],
      }),
    ],
  });
}
function dataTable(headers, rows, widths) {
  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h, i) => cellShaded(h, { header: true, width: widths[i] })),
  });
  const bodyRows = rows.map(
    (r, ri) =>
      new TableRow({ children: r.map((c, i) => cellShaded(c, { width: widths[i], shade: ri % 2 === 1 ? LIGHT : undefined })) })
  );
  return new Table({ width: { size: FULL_WIDTH, type: WidthType.DXA }, columnWidths: widths, rows: [headerRow, ...bodyRows] });
}
function spacer(h = 160) {
  return new Paragraph({ spacing: { after: h }, children: [] });
}
function calloutBox(title, lines, { color = BRAND, fill = LIGHT } = {}) {
  return new Table({
    width: { size: FULL_WIDTH, type: WidthType.DXA },
    columnWidths: [FULL_WIDTH],
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color },
      bottom: { style: BorderStyle.SINGLE, size: 4, color },
      left: { style: BorderStyle.SINGLE, size: 24, color },
      right: { style: BorderStyle.SINGLE, size: 4, color },
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: FULL_WIDTH, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, color: "auto", fill },
            margins: { top: 140, bottom: 140, left: 220, right: 220 },
            children: [
              new Paragraph({ children: [new TextRun({ text: title, bold: true, size: 21, color: BRAND_DARK })], spacing: { after: 100 } }),
              ...lines.map((l) => new Paragraph({ children: [new TextRun({ text: l, size: 20, color: DARK_TEXT })], spacing: { after: 60 } })),
            ],
          }),
        ],
      }),
    ],
  });
}

// ---------------------------------------------------------------------------

const doc = new Document({
  styles: {
    default: { document: { run: { font: "Calibri", size: 22, color: DARK_TEXT } } },
    paragraphStyles: [
      {
        id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { bold: true, size: 30, color: BRAND_DARK, font: "Calibri" },
        paragraph: { spacing: { before: 400, after: 200 }, border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: BRAND } } },
      },
      {
        id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { bold: true, size: 25, color: BRAND, font: "Calibri" },
        paragraph: { spacing: { before: 280, after: 140 } },
      },
      {
        id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { bold: true, size: 22, color: BRAND_DARK, font: "Calibri", italics: true },
        paragraph: { spacing: { before: 200, after: 100 } },
      },
    ],
  },
  numbering: {
    config: [
      { reference: "default-bullets", levels: [
        { level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT },
        { level: 1, format: LevelFormat.BULLET, text: "\u25E6", alignment: AlignmentType.LEFT },
      ]},
    ],
  },
  sections: [
    {
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 },
        },
      },
      children: [
        // ---------------- COVER ----------------
        new Paragraph({ spacing: { before: 1200 }, children: [] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "JK Technology · JKT Hub", size: 22, color: MUTED })] }),
        new Paragraph({
          alignment: AlignmentType.CENTER, spacing: { before: 200, after: 120 },
          children: [new TextRun({ text: "External Project Submissions", bold: true, size: 52, color: BRAND_DARK })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER, spacing: { after: 600 },
          children: [new TextRun({ text: "A course-agnostic way for students to submit work built outside any in-app lab, and get it AI-graded", size: 24, color: BRAND, italics: true })],
        }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Prepared: September 22, 2026", size: 20, color: MUTED })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 800 }, children: [new TextRun({ text: "Repository: edtech_new · Branch: fix/branding-header-audit", size: 20, color: MUTED })] }),
        calloutBox("Status", [
          "Planning document only — grounded in a full audit of this codebase's existing assignment/project submission code (below), not a fresh design in a vacuum. No feature code written yet.",
        ]),
        new Paragraph({ children: [new PageBreak()] }),

        // ---------------- 1. WHY THIS EXISTS ----------------
        heading("1. Why This Exists"),
        bodyPara(
          "Course content sometimes reaches beyond what any in-browser lab can safely run — a real Flask API listening on a socket, a Dockerized deployment, an automation script touching a student's own filesystem. None of that can execute inside a browser sandbox (see the Python Lab curriculum-feasibility discussion this document follows on from). Students doing that work need a way to submit it — as a file or a link to real work — and have it graded, without this app ever executing what they submit."
        ),
        bodyPara(
          "This is deliberately designed to work for ANY course on the platform, not just Python — a robotics build log, a written report, a Scratch/Blockly export, a Flask project, a Docker Compose file, all submit through the same flow."
        ),

        // ---------------- 2. WHAT ALREADY EXISTS ----------------
        heading("2. What Already Exists In This Codebase"),
        bodyPara(
          "Before designing anything new, this codebase was audited for existing submission/grading code, since duplicating a working system is wasted effort and worse, confusing. Three relevant systems were found — one genuinely works, two are broken."
        ),
        heading("2.1 The live pattern: module_assignments → assignment_submissions", HeadingLevel.HEADING_2),
        bodyPara(
          "An instructor attaches an assignment (title + free-text instructions) to a MODULE. A student submits a text description plus an optional file upload (POST /student/assignments/:id/submit, controllers/studentController.js). The server inserts a row, then synchronously calls the AI (askTutor, utils/ai.js) with a prompt that asks it to find an \"Evaluation Criteria\" section inside the free-text instructions, invent a rubric from it, and return {criteria, total, grade, feedback} as JSON. A teacher can later override the grade (controllers/teacherController.js's submitGrade)."
        ),
        bodyPara("This genuinely works end to end — but has real, load-bearing problems worth not inheriting:"),
        bullet("The uploaded file is stored (file_url) but never read by the AI grader — only the typed description text is graded. For a code/project submission, that's the whole point of the file, ungraded."),
        bullet("The rubric isn't a real field anywhere — the AI is asked to reverse-engineer \"criteria\" out of unstructured instructions text, which is fragile and inconsistent grading run to run."),
        bullet("score and total are always set to the identical value (a copy-paste artifact in the UPDATE statement) — a modeling bug, not a real two-number design."),
        bullet("The AI call is capped at 700 output tokens — tight for a multi-criterion rubric plus real feedback; a truncated response silently degrades to a grade with no useful feedback."),
        bullet("Every downstream consumer — the teacher grading queue, parent notification emails, admin/analytics reports, module-completion gating — hard-joins assignment_submissions.assignment_id straight to module_assignments.id at 7+ call sites. There is no lesson-level or course-level submission path today; everything is module-scoped, and nothing enforces that join with a real foreign key."),
        heading("2.2 The broken pattern: course_projects → project_submissions", HeadingLevel.HEADING_2),
        bodyPara(
          "A separate, course-level \"project\" concept (admin sets a title/description on a course; student uploads a file once). This path is non-functional today — its submit handler references a database handle that doesn't exist in that file, queries a table name that was since renamed, and its INSERT references columns and a unique constraint the actual table doesn't have. Already flagged as broken in this session's own security tracker. Not a foundation to build on."
        ),
        heading("2.3 The pattern actually worth following: lab_submissions", HeadingLevel.HEADING_2),
        bodyPara(
          "The Labs system's AI grading (controllers/labController.js's gradeLessonLabSubmission, extended for Python Lab earlier this session) is the cleaner, newer version of the same idea: a simple {score, feedback} JSON contract, score clamped to 0-100 in code (not trusted blindly from the AI), one submission row per grading attempt (a real history, not an overwrite), and it feeds a shared mastery-signal service. This design copies that shape, not the 2020-era assignment one."
        ),

        // ---------------- 3. DESIGN ----------------
        heading("3. Design: A New, Parallel System"),
        bodyPara(
          "Recommendation: new tables, not a retrofit of either existing system. Retrofitting module_assignments would inherit its module-only scoping and its 7+ hard-coded joins (silently break teacher/parent/report consumers unless every one of them is also touched); retrofitting course_projects means fixing three separate bugs in already-dead code with no working reference to model the fix on. A clean, parallel system is both safer and less work than either repair job, and can be built to work at lesson, module, OR course level from day one."
        ),

        // ---------------- 4. DATA MODEL ----------------
        heading("4. Data Model"),
        bodyPara(
          "Revised from the first draft after a real gap was raised: a task often needs more than one thing submitted (code + a screenshot + a demo video link), and different pieces need different file types — forcing everything through one generic \"file or link\" field, or forcing a zip when a single .py file would do, doesn't hold up. The fix is a per-task CHECKLIST of deliverables, each with its own accepted format, instead of one generic submission slot."
        ),
        heading("4.1 external_projects — the assignment definition", HeadingLevel.HEADING_2),
        bodyPara("Authored by an instructor/admin. Attaches to exactly one of a lesson, module, or course — same \"one nullable FK set, the rest null\" convention this codebase already uses elsewhere."),
        bodyPara([code(
          "CREATE TABLE external_projects (\n" +
          "  id SERIAL PRIMARY KEY,\n" +
          "  lesson_id INTEGER REFERENCES lessons(id) ON DELETE CASCADE,\n" +
          "  module_id INTEGER REFERENCES modules(id) ON DELETE CASCADE,\n" +
          "  course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,\n" +
          "  title VARCHAR(255) NOT NULL,\n" +
          "  instructions TEXT,\n" +
          "  deliverables JSONB NOT NULL,\n" +
          "  -- [{ \"label\": \"Source code\", \"type\": \"file_or_link\",\n" +
          "  --    \"accepted_formats\": [\"zip\",\"single_file\",\"github_link\"], \"required\": true },\n" +
          "  --  { \"label\": \"Screenshot\", \"type\": \"file\",\n" +
          "  --    \"accepted_formats\": [\"png\",\"jpg\"], \"required\": true },\n" +
          "  --  { \"label\": \"Demo video\", \"type\": \"link\",\n" +
          "  --    \"accepted_formats\": [\"youtube\",\"drive\",\"loom\"], \"required\": false }]\n" +
          "  rubric JSONB NOT NULL, -- [{ \"criterion\": \"...\", \"weight\": 30 }, ...] — weights sum to 100\n" +
          "  points INTEGER DEFAULT 10,\n" +
          "  created_by INTEGER REFERENCES users2(id),\n" +
          "  created_at TIMESTAMP DEFAULT NOW()\n" +
          ");"
        )]),
        bodyPara(
          "rubric is a real, structured field the instructor fills in when creating the assignment — not text the AI has to guess at parsing out of a paragraph, which is the single biggest quality problem with the existing assignment_submissions grader (Section 2.1). deliverables is the checklist the student sees and submits against — a code-only task lists just one item; a fuller project can list several, each accepting only what actually makes sense for it (no forced zip for a single file, no forced file upload for a video that should just be a link)."
        ),
        heading("4.2 external_project_submissions — one row per submission", HeadingLevel.HEADING_2),
        bodyPara([code(
          "CREATE TABLE external_project_submissions (\n" +
          "  id SERIAL PRIMARY KEY,\n" +
          "  external_project_id INTEGER REFERENCES external_projects(id) ON DELETE CASCADE,\n" +
          "  student_id INTEGER REFERENCES users2(id) ON DELETE CASCADE,\n" +
          "  attachments JSONB NOT NULL,\n" +
          "  -- [{ \"label\": \"Source code\", \"type\": \"github_link\", \"url\": \"https://github.com/...\" },\n" +
          "  --  { \"label\": \"Screenshot\", \"type\": \"file\", \"url\": \"https://res.cloudinary.com/...\" }]\n" +
          "  -- one entry per deliverable the student actually provided, matched\n" +
          "  -- by label back to external_projects.deliverables\n" +
          "  notes TEXT, -- student's own write-up, optional\n" +
          "  status VARCHAR(20) NOT NULL DEFAULT 'grading', -- 'grading' | 'graded' | 'grading_failed'\n" +
          "  score INTEGER,\n" +
          "  feedback TEXT,\n" +
          "  criteria_breakdown JSONB, -- [{ criterion, weight, score, comment }, ...]\n" +
          "  graded_by INTEGER REFERENCES users2(id), -- set only on a human override\n" +
          "  teacher_feedback TEXT,\n" +
          "  submitted_at TIMESTAMP DEFAULT NOW(),\n" +
          "  graded_at TIMESTAMP\n" +
          ");"
        )]),
        bodyPara(
          "One row per attempt (matches lab_submissions, not the overwrite-in-place assignment_submissions pattern) — a student's grading history is never lost, and a resubmission is just a new row. score/feedback/criteria_breakdown are populated by the AI grader; graded_by/teacher_feedback are populated only if a teacher manually overrides, mirroring the existing teacher-override columns already proven out on assignment_submissions."
        ),

        // ---------------- 5. SUBMISSION FLOW ----------------
        heading("5. Submission Flow"),
        bullet("Student opens the task (wherever it's attached — a lesson tab, a module page, or a course page) and sees the title, instructions, the rubric criteria, AND the deliverables checklist — exactly what's expected, item by item, before they submit anything."),
        bullet("The page shows one upload/link box per deliverable, each only accepting what that item's accepted_formats allows — a code box takes a zip, a single file, or a GitHub link; a screenshot box only takes an image; a video item is a link field only (video files are too large to sensibly upload directly, and a link to YouTube/Drive/Loom is the realistic way students already share video)."),
        bullet("File uploads reuse the exact existing Cloudinary/multer pattern already used for assignment file uploads and lesson slide uploads elsewhere in this app — no new upload infrastructure needed, just one upload field per deliverable instead of one generic field."),
        bullet("Optional notes field — the student's own explanation of what they built, same as today's assignment flow, just optional here since the actual artifacts are what's graded."),
        bullet("Required deliverables are enforced before submit is even allowed; optional ones (like that demo video) can be left out without blocking submission."),
        bullet("On submit: insert a row (status='grading'), respond immediately to the student (\"Submitted — grading now\"), then grade asynchronously and update the row — unlike the current assignment flow, which blocks the HTTP request on a synchronous AI call. Avoids a slow/failed AI call turning into a failed submission from the student's point of view."),

        // ---------------- 6. GATHERING CONTENT TO GRADE ----------------
        new Paragraph({ children: [new PageBreak()] }),
        heading("6. Gathering Submission Content For Grading"),
        bodyPara(
          "The biggest real gap in the existing system (Section 2.1): a file gets uploaded and then never looked at. Fixing that is the actual new engineering work here — everything else is assembling patterns already proven elsewhere in this codebase."
        ),
        bodyPara(
          "Each deliverable in the checklist (Section 4.1) is gathered by its own type — a code submission is read very differently from a screenshot. The grading step goes through every attachment on the submission and builds up whatever content it can, then hands the AI everything it managed to gather plus an honest note about anything it couldn't read."
        ),
        heading("6.1 Code — file, zip, or GitHub link", HeadingLevel.HEADING_2),
        bodyPara(
          "A single uploaded file already lives at a Cloudinary URL the instant multer/CloudinaryStorage finishes the upload — same as today. The server fetches that URL's bytes (a plain HTTP GET the server makes to Cloudinary, not executing anything) and reads it as text if it's a recognizable code/text extension (.py, .js, .md, .txt, .json, .html, .css), capped at a size limit (e.g. 20,000 characters) before it goes into the AI prompt."
        ),
        bullet("A .zip (the realistic case for a small multi-file project — a Flask app, a Dockerized service): extract the file list plus the content of a few conventionally-important files if present — README.md, requirements.txt/package.json, app.py/main.py/server.py — capped the same way. Extraction only (reading bytes), never running anything inside the archive."),
        bullet("A GitHub link: GitHub's REST API is read-only-safe to call server-side (a GET request for metadata/file contents — never a code execution risk, the same category of action this app already takes calling third-party APIs elsewhere) — fetch the repo's file tree, then the README and the same conventionally-important files, capped the same way. No auth token needed for public repos (v1 scope); a private-repo submission needs a separate decision (Section 10)."),
        heading("6.2 Screenshots and reports", HeadingLevel.HEADING_2),
        bodyPara(
          "A PDF or Word doc (e.g. a written report deliverable) has its text extracted server-side the same safe way — reading, never executing — and capped the same way as code."
        ),
        bodyPara(
          "An image (e.g. a required \"screenshot showing it running\") can only be genuinely graded if the AI model in use can actually see images, not just read text — worth confirming which model/plan this account has access to before promising this works (flagged in Section 10). If it can't, the image is still accepted and stored, just noted to the AI as \"a screenshot was attached but its visual content isn't analyzed\" rather than silently ignored the way an uploaded file is ignored in the existing assignment grader today."
        ),
        heading("6.3 Video", HeadingLevel.HEADING_2),
        bodyPara(
          "A video link (YouTube/Drive/Loom) isn't something a text-based AI grader can meaningfully watch. Realistic v1 scope: video deliverables are accepted and shown to a teacher during review (Section 9), but aren't scored automatically as part of the AI's rubric pass — the AI grades what it can actually read, and the submission's status/UI makes clear that item is \"awaiting teacher review\" rather than silently scoring it as if it had been evaluated."
        ),
        heading("6.4 What this deliberately does NOT do", HeadingLevel.HEADING_2),
        bodyPara(
          "It never runs, imports, installs, or executes anything the student submitted — consistent with the posture held everywhere else in this app all session (Web/Blockly/Python Labs run only in the student's own browser; Arduino only compiles, never executes, server-side). Grading here is entirely a text-reading exercise: the AI reads code the same way a human reviewer would skim a pull request, it never runs it. This is exactly why option 3 from the earlier discussion (a real sandboxed execution service, actually running the Flask app / Docker build) is a materially bigger, separate decision — this design deliberately stays inside the same safe, established pattern instead."
        ),

        // ---------------- 7. GRADING PROMPT ----------------
        heading("7. AI Grading Design"),
        bodyPara(
          "Modeled on labController.js's gradeLessonLabSubmission (Section 2.3), not the older assignment prompt — simple, strict JSON contract, validated and clamped in code rather than trusted blindly."
        ),
        bodyPara("Prompt shape (real rubric supplied, not guessed):"),
        bodyPara([code(
          "You are grading a student's project submission for: \"${project.title}\"\n\n" +
          "--- INSTRUCTIONS ---\n${project.instructions}\n\n" +
          "--- RUBRIC (grade EACH criterion against its own weight; weights sum to 100) ---\n${rubric.map(r => `- ${r.criterion} (${r.weight} pts)`).join(\"\\n\")}\n\n" +
          "--- STUDENT'S NOTES ---\n${notes || \"(none provided)\"}\n\n" +
          "--- SUBMITTED CONTENT ---\n${gatheredContent}\n\n" +
          "Return ONLY this JSON shape:\n" +
          "{ \"criteria\": [{ \"criterion\": \"...\", \"score\": <0-weight>, \"comment\": \"...\" }], \"total\": <0-100>, \"feedback\": \"<3-5 sentences>\" }"
        )]),
        bodyPara("Response handling, mirroring the Labs grader's discipline rather than the older assignment grader's:"),
        bullet("Regex-extract the JSON object, parse it in a try/catch — a parse failure sets status='grading_failed' with a clear message, never silently leaves a submission stuck looking like it's still grading forever."),
        bullet("total is clamped to 0-100 in code (Math.max(0, Math.min(100, ...))) — never trusted as-is from the model, matching the existing Labs grader's own discipline."),
        bullet("criteria_breakdown is stored as returned (already-structured JSON, no reverse-engineering needed since the rubric was real input, not something the AI had to invent)."),
        bullet("A higher output-token budget than the old assignment prompt's 700 (which the audit flagged as tight enough to silently truncate) — a per-criterion breakdown plus real feedback needs more room."),

        // ---------------- 8. AUTHORING SIDE ----------------
        heading("8. Authoring Side (Instructor/Admin)"),
        bodyPara(
          "A \"Manage External Project\" modal, structurally the same shape as the existing Lab Task modal (views/partials/lessons.ejs) and Assignment modal (views/partials/courseAssignment.ejs) this codebase already has two working examples of: title, instructions, a repeatable rubric-row UI (criterion text + weight number, add/remove rows, client-side validated to sum to 100), points, and which LEVEL it attaches to (lesson / module / course) — mirroring how lesson_labs already scopes to exactly one lesson today."
        ),
        bodyPara(
          "New beyond either existing modal: a second repeatable row UI for the deliverables checklist itself — each row is a label (\"Source code\"), a type (file / link / file-or-link), which formats it accepts, and a required/optional toggle. This is what actually drives the student's submission page (Section 5) and what each deliverable is matched against during grading (Section 6)."
        ),
        heading("8.1 Sandbox tasks and submit-your-own-work tasks sit side by side", HeadingLevel.HEADING_2),
        bodyPara(
          "This isn't something the platform needs to detect at runtime — it's an authoring decision, made once per lesson/module/course. A lesson can have a Lab Task (lesson_labs — opens the in-browser Web/Blockly/Python editor, clearly labeled e.g. \"🧪 Work in the Sandbox\") and/or an External Project task (external_projects — clearly labeled e.g. \"📤 Submit Your Project — build this outside the lab\"), and a student only ever sees whichever one(s) the instructor actually attached. For anything on the can't-run-in-a-browser list (a real web server, Docker, OS-level automation — see the earlier Python-curriculum feasibility discussion), the instructor simply doesn't attach a Lab Task at all for that lesson, only an External Project — so there's nothing ambiguous for the student to choose between."
        ),
        heading("8.2 Guiding students on how to prepare and submit", HeadingLevel.HEADING_2),
        bodyPara(
          "Reuses an existing feature rather than inventing a new one: this codebase already has a learning_guides table (guide_type, title, description, video_url, sample_question, sample_submission) used today to show students a help video + worked example for a task type. A new guide_type='external_project' row — written once by an admin — gives every external-project submission page the same reusable \"how to zip your project,\" \"how to push to GitHub and share the link,\" \"how to get a shareable video link\" walkthrough, plus a sample_submission showing what a genuinely good submission looks like. Instructors authoring an individual task don't have to re-explain this every time; they only write the task-specific instructions and rubric."
        ),

        // ---------------- 9. TEACHER OVERRIDE ----------------
        heading("9. Teacher Review & Override"),
        bodyPara(
          "Reuses the proven pattern already live for assignment_submissions (controllers/teacherController.js's submitGrade + its grading-queue view) rather than building a second, parallel review UI: a teacher can see the AI's score/feedback/criteria breakdown and override with their own score + written feedback, recorded in graded_by/teacher_feedback — the override is additive, the AI's original grade is never destroyed."
        ),

        // ---------------- 10. OPEN DECISIONS ----------------
        new Paragraph({ children: [new PageBreak()] }),
        heading("10. Open Decisions"),
        bullet("Private GitHub repos — v1 scope is public repos only (no auth needed to read them). Supporting private repos needs the student to either make the repo temporarily public, add a bot account as a collaborator, or go through GitHub OAuth — a real added-scope decision, not solved in this design."),
        bullet("Async grading delivery — how does the student find out a grade landed after they've left the page? Reuse the existing notifyUser() in-app notification pattern (already proven for lab and assignment grading) is the obvious default; confirm before building."),
        bullet("Zip/PDF extraction depth and size limits — exact caps (max files inspected, max characters per file, max total size) need to be picked deliberately, balancing grading quality against AI prompt size/cost."),
        bullet("Image grading capability — whether the AI model/plan this account has access to can actually see and assess an uploaded screenshot, or only read text. Confirm before promising screenshot deliverables are graded rather than just stored (Section 6.2)."),
        bullet("Video review workflow — since video deliverables aren't AI-scored (Section 6.3), confirm how a teacher is meant to be prompted to actually watch and score one — a queue item, a manual flag, or folded into the existing grading-queue view (Section 9)."),
        bullet("Where this shows up per course — does every course get an \"External Projects\" tab by default, or is it opt-in per course/module the way Lab Tasks and Assignments already are? Recommend opt-in, matching the existing pattern."),
        bullet("Module completion gating — should a graded (or merely submitted) external project gate module/course completion the way assignment_submissions currently does? A real product decision, not a technical one."),

        spacer(300),
        calloutBox("Next step", [
          "If this design looks right: the data model (Section 4) and the file/GitHub content-gathering logic (Section 6) are the two pieces worth prototyping first — everything else in this plan is assembling patterns already proven working elsewhere in this codebase (upload handling, AI grading contracts, teacher override, authoring modals).",
        ], { color: GREEN }),
      ],
    },
  ],
});

const outPath = path.join(__dirname, "external-project-grading-plan.docx");
Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(outPath, buffer);
  console.log("Wrote " + outPath);
});
