// Generates docs/python-lab-implementation-plan.docx
// Re-run this script after editing to regenerate the document — do not
// hand-edit the .docx. Matches the pattern established in
// security/buildSecurityTracker.js (generator script + committed output).

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

const FULL_WIDTH = 9350; // DXA, fits US Letter with 1" margins

function heading(text, level = HeadingLevel.HEADING_1) {
  return new Paragraph({
    text,
    heading: level,
    spacing: { before: 320, after: 160 },
  });
}

function para(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({ text, ...opts })],
    spacing: { after: 160 },
    ...opts.paraOpts,
  });
}

function bodyPara(runsOrText, opts = {}) {
  const children = Array.isArray(runsOrText)
    ? runsOrText
    : [new TextRun({ text: runsOrText, size: 21 })];
  return new Paragraph({
    children,
    spacing: { after: 160, line: 300 },
    ...opts,
  });
}

function bullet(text, level = 0) {
  return new Paragraph({
    text,
    bullet: { level },
    spacing: { after: 90 },
  });
}

function label(text) {
  return new TextRun({ text, bold: true, size: 21 });
}
function code(text) {
  return new TextRun({ text, font: "Consolas", size: 19, color: BRAND_DARK });
}
function plain(text) {
  return new TextRun({ text, size: 21 });
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
        children: [
          new TextRun({
            text,
            bold: bold || header,
            color: header ? WHITE : color || DARK_TEXT,
            size: header ? 19 : 19,
          }),
        ],
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
      new TableRow({
        children: r.map((c, i) =>
          cellShaded(c, { width: widths[i], shade: ri % 2 === 1 ? LIGHT : undefined })
        ),
      })
  );
  return new Table({
    width: { size: FULL_WIDTH, type: WidthType.DXA },
    columnWidths: widths,
    rows: [headerRow, ...bodyRows],
  });
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
              new Paragraph({
                children: [new TextRun({ text: title, bold: true, size: 21, color: BRAND_DARK })],
                spacing: { after: 100 },
              }),
              ...lines.map(
                (l) =>
                  new Paragraph({
                    children: [new TextRun({ text: l, size: 20, color: DARK_TEXT })],
                    spacing: { after: 60 },
                  })
              ),
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
    default: {
      document: { run: { font: "Calibri", size: 22, color: DARK_TEXT } },
    },
    paragraphStyles: [
      {
        id: "Heading1",
        name: "Heading 1",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { bold: true, size: 30, color: BRAND_DARK, font: "Calibri" },
        paragraph: {
          spacing: { before: 400, after: 200 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: BRAND } },
        },
      },
      {
        id: "Heading2",
        name: "Heading 2",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { bold: true, size: 25, color: BRAND, font: "Calibri" },
        paragraph: { spacing: { before: 280, after: 140 } },
      },
      {
        id: "Heading3",
        name: "Heading 3",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { bold: true, size: 22, color: BRAND_DARK, font: "Calibri", italics: true },
        paragraph: { spacing: { before: 200, after: 100 } },
      },
    ],
  },
  numbering: {
    config: [
      {
        reference: "default-bullets",
        levels: [
          { level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT },
          { level: 1, format: LevelFormat.BULLET, text: "◦", alignment: AlignmentType.LEFT },
        ],
      },
    ],
  },
  sections: [
    {
      properties: {
        page: {
          size: { width: 12240, height: 15840 }, // US Letter
          margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 },
        },
      },
      children: [
        // ---------------- COVER ----------------
        new Paragraph({ spacing: { before: 1200 }, children: [] }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: "JK Technology · JKT Hub", size: 22, color: MUTED })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 200, after: 120 },
          children: [
            new TextRun({ text: "Python Teaching Lab", bold: true, size: 56, color: BRAND_DARK }),
          ],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 600 },
          children: [
            new TextRun({
              text: "Implementation Plan — a Pyodide-based, client-side Python sandbox integrated into the existing Labs system",
              size: 24,
              color: BRAND,
              italics: true,
            }),
          ],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: "Prepared: September 22, 2026", size: 20, color: MUTED })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 800 },
          children: [
            new TextRun({ text: "Repository: edtech_new · Branch: fix/branding-header-audit", size: 20, color: MUTED }),
          ],
        }),
        calloutBox("Status", [
          "This is a planning document only. No code has been written yet — this maps out exactly what building a Python Lab requires, grounded in a full read of the existing Labs codebase, and recommends a scope and sequence.",
        ]),
        new Paragraph({ children: [new PageBreak()] }),

        // ---------------- 1. EXECUTIVE SUMMARY ----------------
        heading("1. Executive Summary"),
        bodyPara(
          "This plan adds a Python Lab as a new lab type alongside the existing Web Lab, Blockly Lab, and Arduino Lab. Students write Python in an in-browser editor and run it instantly with no server round-trip, using Pyodide — a full CPython interpreter compiled to WebAssembly that executes entirely inside the student's browser."
        ),
        bodyPara(
          "The recommendation is Pyodide over any server-side Python execution (e.g. a Docker sandbox, a subprocess runner) because it carries zero server code-execution risk — the exact same reasoning that shaped this session's security-hardening pass. It also fits an execution pattern this codebase already uses for Web Lab and Blockly Lab (both run 100% client-side)."
        ),
        bodyPara(
          "The Labs system's data model and most of its plumbing (save, submit, grading hook, peer review, offline sync, AI tutor) are already lab-type-agnostic — they work for a new type with no changes. The real work is: (1) a new client-side execution engine (Pyodide running inside a Web Worker, since nothing like this exists yet in the app), and (2) about 14 small, mechanical edit-points where a lab type is currently hard-coded to just web/blockly."
        ),
        new Table({
          width: { size: FULL_WIDTH, type: WidthType.DXA },
          columnWidths: [3120, 3120, 3110],
          rows: [
            new TableRow({
              children: [
                cellShaded("Recommended v1 scope", { header: true, width: 3120 }),
                cellShaded("Est. effort", { header: true, width: 3120 }),
                cellShaded("Ships", { header: true, width: 3110 }),
              ],
            }),
            new TableRow({
              children: [
                cellShaded("Code editor + run/save/submit (no gallery publish)", { width: 3120 }),
                cellShaded("3–5 working days", { width: 3120 }),
                cellShaded("Phase 1", { width: 3110 }),
              ],
            }),
            new TableRow({
              children: [
                cellShaded("+ Gallery publish/remix + public showcase", { width: 3120, shade: LIGHT }),
                cellShaded("+1–2 days", { width: 3120, shade: LIGHT }),
                cellShaded("Phase 1.5 (optional)", { width: 3110, shade: LIGHT }),
              ],
            }),
            new TableRow({
              children: [
                cellShaded("+ matplotlib inline output, batch stdin box", { width: 3120 }),
                cellShaded("+1 day", { width: 3120 }),
                cellShaded("Phase 1.5 (optional)", { width: 3110 }),
              ],
            }),
            new TableRow({
              children: [
                cellShaded("Jupyter-notebook-style cell UI", { width: 3120, shade: LIGHT }),
                cellShaded("1.5–2.5 weeks", { width: 3120, shade: LIGHT }),
                cellShaded("Phase 2 (defer)", { width: 3110, shade: LIGHT }),
              ],
            }),
          ],
        }),
        spacer(200),
        bodyPara(
          "Detailed reasoning for each of these is in the sections below. Section 9 has the full effort table; Section 10 lists the handful of decisions worth making before implementation starts."
        ),

        // ---------------- 2. WHY PYODIDE ----------------
        heading("2. Architecture Decision: Why Pyodide"),
        heading("2.1 The two execution patterns already in this codebase", HeadingLevel.HEADING_2),
        bodyPara(
          "The Labs system already has two established patterns for running student code safely, and a Python Lab should extend one of them rather than invent a third:"
        ),
        bullet(
          "Client-only execution (Web Lab, Blockly Lab) — the code never leaves the browser. Web Lab runs the student's HTML/CSS/JS inside a sandboxed <iframe> with sandbox=\"allow-scripts allow-modals allow-forms\" and deliberately no allow-same-origin, so the frame is an opaque origin that cannot touch the parent page's cookies or DOM. Blockly Lab runs generated JavaScript against an in-page sprite/stage engine with no iframe at all. The server's only job is init/save/submit — it never executes anything."
        ),
        bullet(
          "Server-compile, client-execute (Arduino Lab) — the C++ sketch is compiled server-side via a real arduino-cli invocation (services/arduinoCompileService.js), using execFile with an argument array (never a shell string, to avoid injection), a 15-second timeout, and a 20,000-character input cap — then the resulting .hex file is executed client-side by avr8js, a JavaScript AVR emulator. The server step exists only because avr8js cannot compile C++; it never runs untrusted code either, it only compiles it into a inert data artifact."
        ),
        bodyPara(
          "Python has no equivalent problem: Pyodide is a complete CPython build, so there is no compile step to push to the server. A Python Lab belongs firmly in the first camp — 100% client-side execution, zero server CPU cost per run, and zero server attack surface for arbitrary code execution."
        ),
        heading("2.2 What Pyodide is", HeadingLevel.HEADING_2),
        bodyPara(
          "Pyodide is CPython compiled to WebAssembly via Emscripten, distributed as a JS loader plus a set of .wasm/.whl assets. It runs inside the browser's own JS engine — no server, no container, no native process. It ships with a curated set of prebuilt scientific-Python wheels (numpy, pandas, matplotlib, scipy, etc.) that install with pyodide.loadPackage(), and can pull additional pure-Python packages from PyPI at runtime via micropip. Packages requiring native C extensions that haven't been built for WASM are not available — this covers the vast majority of what an intro-to-Python curriculum needs, but is worth flagging as a hard limit, not a v1-only gap."
        ),
        heading("2.3 Trade-offs to accept", HeadingLevel.HEADING_2),
        bullet("First-load size: the Pyodide core runtime is roughly 6–10 MB (gzipped) to download and initialize on first use; every package loaded on top adds more. This is a one-time cost per browser session (cacheable), not a per-run cost."),
        bullet("Cold-start latency: measured at 8–11 seconds to initialize the interpreter the first time a student opens the lab in a session (Phase 0 spike, Section 5.7) — higher than a first guess of 2–5s. Subsequent runs in the same worker are near-instant; a respawned worker after a timeout-kill reloads from browser cache in 2–5s."),
        bullet(
          "No true blocking input(): a real synchronous, blocking stdin read requires SharedArrayBuffer, which in turn requires Cross-Origin-Opener-Policy / Cross-Origin-Embedder-Policy response headers. This app sets neither today (confirmed — no CSP/helmet middleware exists anywhere in the server), so student code that calls input() would hang forever with the plain async Pyodide path. Section 5 below covers the recommended workaround."
        ),
        bullet(
          "No native-extension packages — anything requiring compiled C/C++/Fortran that hasn't been prebuilt for WASM (a small minority of PyPI, but it exists) simply cannot be imported."
        ),
        heading("2.4 Why not a server-side sandbox instead", HeadingLevel.HEADING_2),
        bodyPara(
          "A Docker-per-run or subprocess-based Python execution service was considered and rejected for this app specifically: it would be the first genuine \"run arbitrary student-submitted code on our server\" surface in the entire codebase, directly cutting against the posture just established in this session's security-hardening pass (least-privilege execFile usage, no shell interpolation, rate limiting, everywhere else avoiding server-side execution of user input). Pyodide avoids that category of risk entirely, at the cost of the trade-offs above — a worthwhile trade for a teaching product."
        ),

        // ---------------- 3. HOW THIS FITS ----------------
        heading("3. How This Fits the Existing Labs System"),
        bodyPara(
          "This section is grounded in a full read of routes/labRoutes.js, controllers/labController.js, controllers/lessonLabController.js, the relevant tables in models/initTables.js, the Web/Blockly/Arduino editor views and their client-side JS, and the gallery/showcase code. File and line references below point at the current state of those files."
        ),
        heading("3.1 The task vs. project relationship (unchanged by this feature)", HeadingLevel.HEADING_2),
        bullet("lesson_labs — the instructor-authored task definition attached to a lesson (title, instructions, lab_type, points). One row per lesson."),
        bullet("lab_projects — the student's actual work. lab_id IS NULL means a freeform playground project (one per student per lab_type, publishable to the gallery, flat 15 XP / 10 coins, never AI-graded). lab_id = <lesson_labs.id> means a lesson-task submission (not publishable, pays lesson_labs.points XP, AI-graded, capped at 3 submissions, gates lesson completion)."),
        bullet("lab_submissions — one row per AI grading pass, holding score + feedback."),
        bodyPara("A Python Lab produces both flavors automatically, for free, because this split is entirely lab-type-agnostic in the existing code."),
        heading("3.2 What is reused verbatim — no changes needed", HeadingLevel.HEADING_2),
        bullet("POST /labs/project/init, GET /labs/project/:labType, GET /labs/project/lesson/:labId, POST /labs/project/save, POST /labs/project/submit — every one of these branches only on the labType string, and project_data is a schema-free JSONB column."),
        bullet("Peer review (getReviewableProjects, submitReview) — entirely lab-type agnostic."),
        bullet("Lesson-completion gating (services/lessonCompletionService.js maybeUnlockNextLesson) — already lab-type agnostic."),
        bullet("Mastery signal generation (services/masteryPathService.js) — agnostic."),
        bullet("Client-side offline save queue (public/labs/js/offlineSync.js, window.OfflineSync.saveOrQueue) — used as-is by Web, Blockly, and Arduino labs already; a Python Lab calls the same function with the same payload shape."),
        bullet("The in-lab AI tutor widget (public/labs/js/labAiTutor.js) — a lab gets it for free by defining window.getLabAIContext() and window.LAB_AI_TUTOR_TITLE and including two existing <script> tags. No new tutor code needed."),
        bullet("The generic per-lab-type asset catalog (lab_asset_categories / lab_assets tables) — available if a starter-snippet or example-gallery palette is ever wanted; not required for v1."),
        heading("3.3 What is genuinely new", HeadingLevel.HEADING_2),
        bullet("The execution engine itself — nothing like \"run this code and stream stdout back\" exists yet for a text-based language; Web Lab's iframe-preview approach and Blockly's in-page engine do not transfer. This is the one real engineering unknown in the whole plan (see Section 5)."),
        bullet("A new editor view, stylesheet, and client script (mirroring, not copying, Web Lab's structure)."),
        bullet("About 14 small hard-coded allowlist / ternary / template edits scattered across the codebase wherever \"web\" and \"blockly\" are currently the only two recognized lab types (full list in Section 4)."),

        // ---------------- 4. CHANGE-POINT CHECKLIST ----------------
        heading("4. Full Change-Point Checklist"),
        bodyPara(
          "Every place in the current codebase that hard-codes the set of known lab types. Anything not listed here (schema, save/submit endpoints, offline sync, AI tutor, peer review) needs zero changes."
        ),
        dataTable(
          ["#", "File : line", "Today", "Change needed"],
          [
            ["1", "controllers/labController.js:14-49", "LAB_TEMPLATES has 5 keys (web, blockly, arduino, appinventor, ai)", "Add a python: {title, starter} entry"],
            ["2", "routes/labRoutes.js", "One router.get per lab type", "Add router.get(\"/python\", labController.getPythonLab)"],
            ["3", "controllers/labController.js (new fn)", "getWebLab / getBlocklyLab / getArduinoLab exist", "Add getPythonLab, mirroring getWebLab's shape (loads lessonLab via getLessonLabContext, renders labs/python/editor)"],
            ["4", "views/labs/python/editor.ejs (new)", "Does not exist", "New view — editor + toolbar + output console, mirroring web/editor.ejs"],
            ["5", "public/labs/css/python.css (new)", "Does not exist", "New stylesheet, reusing the shared toolbar/toast/token language documented in blockly.css's header comment"],
            ["6", "public/labs/js/pythonLab.js (new)", "Does not exist", "New client script — editor init, run, save/submit/publish wiring, mirrors webLab.js structure"],
            ["7", "public/labs/js/pythonWorker.js (new)", "Does not exist", "New Web Worker — loads Pyodide, executes code, captures stdout/stderr, enforces a timeout (Section 5)"],
            ["8", "controllers/labController.js:553 gradeLessonLabSubmission", "if (lab_type===\"blockly\") ... else <assumes Web shape>", "Add an explicit python branch so AI grading receives the student's actual code, not a garbled web-shaped string"],
            ["9", "controllers/lessonLabController.js:11", "ALLOWED_LAB_TYPES = [\"web\",\"blockly\"]", "Add \"python\" so instructors can attach a Python lab task to a lesson"],
            ["10", "views/partials/lessons.ejs:222-223", "Lab-type <select> offers only Web / Blockly", "Add <option value=\"python\">Python Lab</option>, update the helper text at line 213"],
            ["11", "views/student/dashboard.ejs:4736, 5100", "Binary ternary: blockly ? /labs/blockly : /labs/web", "Replace with a small type→path map so a 3rd type resolves correctly"],
            ["12", "views/labs/dashboard.ejs:39-80", "labs[] array drives the dashboard cards", "Add a Python Lab card"],
            ["13", "public/sw.js (precache + nav lists)", "Lists only web/blockly assets", "Add /labs/python, /labs/css/python.css, /labs/js/pythonLab.js, /labs/js/pythonWorker.js"],
            ["14", "public/sw.js RUNTIME_CACHE_HOSTS", "[\"cdnjs.cloudflare.com\",\"unpkg.com\"]", "Add \"cdn.jsdelivr.net\" if Pyodide is loaded from jsDelivr (matches how avr8js is already loaded from there)"],
          ],
          [430, 2900, 3300, 2720]
        ),
        spacer(200),
        bodyPara(
          "Items 15–18 below are only needed if gallery/publish support ships (recommended as Phase 1.5, not Phase 1 — see Section 8.1):"
        ),
        dataTable(
          ["#", "File : line", "Today", "Change needed"],
          [
            ["15", "labController.js:867, adminController.js:11623, routes/publicRoutes.js:163", "[\"web\",\"blockly\"] allowlist, 3 places", "Add \"python\" to each"],
            ["16", "views/labs/gallery.ejs:40-41", "Two filter buttons (Web/Blockly)", "Add a Python filter button"],
            ["17", "public/labs/js/labGallery.js:40-43, 185-200", "labMeta map + preview-render branch", "Add a python entry; render as read-only syntax-highlighted code, not a live re-execution (Section 8.2)"],
            ["18", "views/public/showcase.ejs, showcaseProject.ejs", "Binary ternaries at several lines", "Add python branches, same read-only rendering as the gallery"],
          ],
          [430, 2900, 3300, 2720]
        ),

        // ---------------- 5. EXECUTION ENGINE ----------------
        new Paragraph({ children: [new PageBreak()] }),
        heading("5. Execution Engine Design"),
        bodyPara(
          "This is the one part of the feature with no existing analog in the codebase to copy — everything else in this plan is mechanical extension of an established pattern. Design below."
        ),
        heading("5.1 Run Pyodide inside a Web Worker, not the main thread", HeadingLevel.HEADING_2),
        bodyPara(
          "Web Lab's iframe/srcdoc pattern doesn't transfer to Python: an iframe sandbox isolates DOM/cookie access, but Python code executing on the main JS thread would still freeze the whole tab's UI for the duration of the run (an infinite loop, a slow computation, or a large printed output would all hang the page). The fix is to load and run Pyodide inside a dedicated Web Worker: the worker has its own global scope, cannot touch the DOM or the parent page's cookies, and communicates only via postMessage — so it keeps the client-only, zero-server-execution security property while keeping the editor UI responsive."
        ),
        bodyPara(
          "Loading pattern: mirror the exact lazy, memoized dynamic-import approach already used for avr8js in public/labs/js/arduinoLab.js (lines 4233-4238) — a loader promise cached after first use, awaited on first Run, e.g. importScripts(\"https://cdn.jsdelivr.net/pyodide/v0.2x.x/full/pyodide.js\") pinned to an exact version (never @latest, matching how avr8js is pinned to @0.21.1)."
        ),
        heading("5.2 stdout / stderr capture", HeadingLevel.HEADING_2),
        bodyPara(
          "Pyodide exposes setStdout / setStderr callback hooks. Point both at postMessage calls back to the main thread, which appends lines to the same kind of #consoleOutput panel Web Lab already renders (Web Lab writes console entries via line.textContent = ..., not innerHTML — the same XSS-safe approach applies here, since student-printed output must never be interpreted as HTML)."
        ),
        heading("5.3 input() and stdin — implemented and shipped", HeadingLevel.HEADING_2),
        bodyPara(
          "Confirmed directly (not assumed): Pyodide's pyodide.setStdin({ stdin }) callback must return synchronously. A version returning a Promise — to genuinely pause a script mid-run and wait for a student to type an answer, then resume exactly where it left off — was tested against Pyodide 0.26.4 and does not work; Pyodide does not await it, and raises the same OSError [Errno 29] immediately. True one-prompt-at-a-time interactive input is only achievable by enabling SharedArrayBuffer via COOP/COEP response headers, which was evaluated and deliberately not pursued for v1: those headers require every cross-origin resource the page loads (Monaco from cdnjs, Pyodide from jsdelivr, Font Awesome) to explicitly cooperate or be blocked, an app-wide risk needing careful, separate testing before it could be trusted on a production page."
        ),
        bodyPara(
          "Shipped instead: an \"Input\" textarea above the console panel where a student pre-types the lines their program will read, one per input() call, in order. The worker feeds those lines synchronously via the callback above; a call past the last provided line raises a real EOFError — the exact same error a `python script.py < input.txt` gets from running out of input, not an invented message. This covers every input()-using program, including loops with a variable number of prompts, since the student decides how many lines to provide. Persisted as part of project_data alongside code, so it survives save/reload."
        ),
        heading("5.4 Runaway-code protection", HeadingLevel.HEADING_2),
        bodyPara(
          "A worker cannot be synchronously interrupted mid-execution without SharedArrayBuffer, so an infinite loop cannot be gracefully stopped from outside — it can only be killed. Recommended approach, mirroring the existing 15-second COMPILE_TIMEOUT_MS precedent in services/arduinoCompileService.js: start a wall-clock timer when Run begins (e.g. 10–15 seconds); if the worker hasn't responded by then, call worker.terminate() and spin up a fresh worker for the next run, surfacing a \"Your code took too long to run\" message. This costs nothing server-side — it is pure client-side resource management."
        ),
        heading("5.5 Rich output (matplotlib) — Phase 1.5", HeadingLevel.HEADING_2),
        bodyPara(
          "Pyodide supports matplotlib with a non-interactive Agg backend that can render a figure to a base64 PNG string, postMessage'd back and displayed inline below the console panel. Not required for a first ship; a natural, self-contained add-on once the base editor works, since it touches only the worker script and the output-rendering code, nothing else in this plan."
        ),
        heading("5.6 Persistent worker vs. respawn-per-run — shipped as always-fresh", HeadingLevel.HEADING_2),
        bodyPara(
          "Shipped as: a fresh worker after every single Run, not just after a timeout-kill. This was tightened from an earlier \"reused until it errors\" draft after a real bug surfaced in testing: Pyodide can leave internal state behind between separate runPythonAsync() calls in the same worker — specifically, an un-flushed partial stdout line (e.g. an input() prompt printed with no trailing newline, right before the run then errors) stayed buffered and bled into the next run's output as duplicated, concatenated text. Respawning fresh every time sidesteps this whole bug class outright. Cost: each Run now waits for a worker respawn afterward (fast, warm-cache reload, usually hidden behind the student's natural look-at-output pause) before the next Run is clickable — the button is visibly disabled during that window, never silently unresponsive."
        ),
        bodyPara(
          "A notebook-style UI (Phase 2) is different: it needs one long-lived worker with a persistent Python namespace across cell executions, which is meaningfully more state to manage — this is one of the reasons Phase 2 is estimated far higher than Phase 1 (Section 9)."
        ),
        heading("5.7 Package loading — a correction from the Phase 0 spike", HeadingLevel.HEADING_2),
        bodyPara(
          "Original assumption going into the spike: pyodide.runPythonAsync() auto-loads whatever packages a script imports. It does not. Calling it directly on code containing \"import numpy\" raises ModuleNotFoundError, even though numpy ships in the Pyodide distribution — Pyodide only reports that it's available and tells you how to load it. The correct call sequence, confirmed working in the spike, is pyodide.loadPackagesFromImports(code) (scans the source for import statements and fetches whichever of Pyodide's prebuilt wheels are needed) immediately before runPythonAsync(code). First load of a package like numpy took about 5 seconds in testing; already-loaded packages are instant on subsequent runs in the same worker."
        ),

        // ---------------- SPIKE RESULTS ----------------
        calloutBox(
          "Phase 0 spike — completed and verified (2026-09-22)",
          [
            "Built as a standalone page (not wired into the real app) at spike/python-lab-poc/: index.html + worker.js + a zero-dependency static server. Driven with a real headless browser, not just read for correctness.",
            "Confirmed working: Pyodide loads and runs entirely inside a Web Worker; stdout is captured in the exact order printed and streamed back to the main thread as plain text (no innerHTML); Python tracebacks surface cleanly on error; a 10-second wall-clock timeout kills a genuine infinite loop and a freshly spawned worker is immediately usable again afterward.",
            "Two corrections this made to the plan, both folded into the sections above: cold-start latency is 8-11s (Section 2.3), not the original 2-5s guess; and package imports need an explicit loadPackagesFromImports() call (Section 5.7), they are not automatic.",
            "Conclusion: the core execution mechanism this whole plan depends on works as designed. No blockers found for proceeding to Phase 1.",
          ],
          { color: GREEN }
        ),

        // ---------------- 6. UI PLAN ----------------
        heading("6. Editor UI Plan"),
        heading("6.1 Phase 1 — plain IDE (recommended starting point)", HeadingLevel.HEADING_2),
        bodyPara(
          "A single Monaco editor instance with language: \"python\" — Monaco already ships a Python tokenizer/language mode out of the box, and Monaco 0.52.2 is already loaded from cdnjs by both Web Lab and Arduino Lab, so this adds no new client-side dependency. The sharedOptions block already used for all three Web Lab editors (webLab.js:438-468 — dark theme, 16px font, word wrap, bracket/quote auto-closing, suggestions on) transfers essentially unchanged."
        ),
        bodyPara("Toolbar, mirroring Web Lab's: Run, Save, Reset, Submit, and (if Phase 1.5 gallery support ships) Publish — same conditional omission of Publish when the project is lesson-attached (lessonLab truthy), matching web/editor.ejs line 88."),
        bodyPara("Output panel replaces the iframe preview: a console-style panel showing interleaved stdout/stderr, plus a small status line for \"running…\" / \"finished in Nms\" / \"timed out.\" An optional Stdin box sits above it if the pre-typed-input approach (5.3) is adopted."),
        heading("6.2 Phase 2 — notebook-style UI (defer)", HeadingLevel.HEADING_2),
        bodyPara("A cell-based UI is a materially larger feature, not a variant of Phase 1:"),
        bullet("Per-cell state and execution order — a cell's output depends on what ran before it, and can be re-run out of order; this requires the persistent-worker model from 5.6 instead of respawn-per-run."),
        bullet("A different project_data shape ({ cells: [...] } instead of { code }) — meaning existing Phase-1 projects would need an explicit, deliberate migration path if a student's project is ever converted between modes, or the two modes stay permanently separate lab types."),
        bullet("New UI surface: add/delete/reorder cells, per-cell run buttons, markdown cells, cell-level output caching and display."),
        bullet("Real teaching value at the intro level is limited relative to the added complexity — a plain IDE with instant run/save/submit already covers the vast majority of an intro-to-Python curriculum."),
        bodyPara(
          "Recommendation: ship Phase 1, see how instructors and students actually use it, and revisit Phase 2 only if there's a concrete curriculum need for notebook-style, cell-by-cell teaching (e.g. a data-analysis unit that benefits from incremental, inspectable steps)."
        ),

        // ---------------- 7. DATA MODEL ----------------
        heading("7. Data Model"),
        bodyPara(
          "No schema changes are required. lesson_labs.lab_type and lab_projects.lab_type are both unconstrained VARCHAR(50) — validation is enforced entirely in application code (LAB_TEMPLATES, ALLOWED_LAB_TYPES), not the database. lab_projects.project_data is a schema-free JSONB column already storing entirely different shapes per lab type (Web Lab: {pages, css, js, activePage}; Blockly: {workspace, generatedCode, ...}; Arduino: {code, circuit})."
        ),
        bodyPara("Proposed project_data shape for Phase 1:"),
        bodyPara([code('{ "code": "<the student\'s Python source>" }')]),
        bodyPara("If the batch-stdin option (5.3) is adopted:"),
        bodyPara([code('{ "code": "...", "stdin": "line1\\nline2\\n..." }')]),
        bodyPara("Proposed shape for a future Phase 2 notebook mode (not needed for Phase 1):"),
        bodyPara([
          code('{ "cells": [ { "type": "code"|"markdown", "source": "...", "output": null } ] }'),
        ]),

        // ---------------- 8. SECURITY ----------------
        new Paragraph({ children: [new PageBreak()] }),
        heading("8. Security Considerations"),
        bullet("Zero server execution surface — the server never runs, imports, or evaluates any part of a student's Python. It only stores project_data as opaque JSON, exactly as it already does for the other three lab types."),
        bullet("Worker isolation — Pyodide executes inside a dedicated Web Worker with its own global scope; it cannot reach the DOM, cookies, or localStorage of the page that spawned it, and the only communication channel is the explicit postMessage protocol this feature defines."),
        bullet("Pin the Pyodide CDN version exactly (never @latest) — matches the existing avr8js@0.21.1 precedent — and add a Subresource Integrity hash if the CDN provides one, so a compromised CDN asset can't silently swap in different code."),
        bullet("Wall-clock execution timeout with worker.terminate() (Section 5.4) — prevents a runaway or accidentally-infinite student program from hanging a browser tab indefinitely."),
        bullet("No new server-side rate limiting is needed for execution itself (there is no server CPU cost per run, unlike Arduino's compile step) — the existing global rate limiting already covers the save/submit/publish endpoints this feature reuses."),
        heading("8.1 Recommendation: skip gallery/publish in v1", HeadingLevel.HEADING_2),
        bodyPara(
          "Arduino Lab today has no Submit or Publish button at all — it's save-only. Recommending the same for Python Lab's first ship, for two independent reasons: it removes roughly a third of the change-point checklist (items 15-18) from the critical path, and it sidesteps a real design question — a published gallery/showcase page is publicly viewable, including by logged-out visitors on /showcase, and rendering another student's arbitrary Python as anything other than static, read-only, syntax-highlighted text on such a page deserves its own deliberate decision rather than inheriting Web Lab's live-iframe-preview pattern by default."
        ),
        heading("8.2 If gallery support does ship later", HeadingLevel.HEADING_2),
        bodyPara(
          "The recommended approach mirrors how Blockly Lab's gallery preview already works today (labGallery.js:185-200 renders Blockly's generatedCode as an escaped <pre> block, not a live re-run) — render a published Python project's code as static, syntax-highlighted, non-executing text. Auto-executing a stored student submission the moment any visitor opens a public page is avoidable risk for no real benefit here; a \"View in Lab\" link that opens the project in the authenticated, worker-sandboxed editor is the safer way to let someone actually run it."
        ),

        // ---------------- 9. EFFORT ESTIMATE ----------------
        heading("9. Effort Estimate"),
        dataTable(
          ["Phase", "Scope", "Est. effort", "Depends on"],
          [
            ["0 — Spike (DONE)", "Load Pyodide in a Worker; round-trip a print() through stdout capture back to the main thread. Proves the core mechanism before committing to the rest.", "~3 hrs actual", "—"],
            ["1 — IDE Lab", "All 14 core change-points (Section 4) + editor UI (6.1) + execution engine (Section 5, items 5.1–5.4) + data model (Section 7). Save/submit/AI-grading/lesson-gating, no gallery.", "3–5 days", "Phase 0"],
            ["1.5a — Rich output", "matplotlib inline PNG rendering (5.5), batch-stdin box (5.3) if deferred from Phase 1.", "~1 day", "Phase 1"],
            ["1.5b — Gallery", "Items 15–18 (gallery/showcase eligibility, filters, read-only preview rendering per 8.2).", "1–2 days", "Phase 1"],
            ["2 — Notebook UI", "Cell-based editor, persistent-namespace worker (5.6), new project_data shape + mode-migration decision, per-cell output caching, reorder/add/delete UI.", "1.5–2.5 weeks", "Phase 1, real usage data"],
          ],
          [1500, 4550, 1500, 1800]
        ),
        spacer(200),
        bodyPara(
          "These are engineering-time estimates for one developer familiar with this codebase, and assume Pyodide behaves as documented (Phase 0 exists specifically to de-risk that assumption cheaply before Phase 1 is scoped in full)."
        ),

        // ---------------- 10. OPEN DECISIONS ----------------
        heading("10. Open Decisions"),
        bodyPara("Flagged here for a decision before implementation starts — not assumed or acted on in this document."),
        bullet("Gallery/publish in v1 or later — recommendation is later (Section 8.1); confirm before scoping Phase 1's exact boundary."),
        bullet("stdin handling — DECIDED and shipped: pre-typed batch textarea (5.3). Real interactive one-prompt-at-a-time input would need SharedArrayBuffer/COOP/COEP, evaluated and deliberately not pursued for v1 (5.3)."),
        bullet("Default package preload — ship with just core Pyodide (~6-8 MB) and lazy-load numpy/pandas/matplotlib only when a student's code imports them, vs. preloading the common ones up front at the cost of a larger first load. Lazy-load is the lighter default; worth confirming against the intended curriculum (a pure intro-to-Python course may never need them at all)."),
        bullet("Execution timeout length — 10-15 seconds suggested, matching Arduino's 15-second compile timeout precedent; may want to differ since Python programs can legitimately run longer for compute-heavy examples."),

        spacer(300),
        calloutBox(
          "Next step",
          [
            "If this scope looks right: start with the Phase 0 spike (Section 9) to prove the Pyodide-in-a-Worker mechanism against this app's actual toolchain before committing to the full Phase 1 build.",
          ],
          { color: GREEN }
        ),
      ],
    },
  ],
});

const outPath = path.join(__dirname, "python-lab-implementation-plan.docx");
Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(outPath, buffer);
  console.log("Wrote " + outPath);
});
