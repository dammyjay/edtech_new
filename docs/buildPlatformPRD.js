// Generates docs/jkthub-platform-prd-brd-user-stories.docx
// A whole-platform Business Requirements Document, Product Requirements
// Document, and User Stories set — covering every role and every feature
// currently implemented in this codebase (not just one recent feature
// arc). Compiled from a direct audit of routes/controllers/views across
// the admin, instructor, teacher, school-admin, student, parent and
// public-facing surfaces. Re-run this script after editing to regenerate
// the document — do not hand-edit the .docx. Matches the pattern
// established in docs/buildExternalProjectGradingPlan.js.

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
function h2(text) {
  return heading(text, HeadingLevel.HEADING_2);
}
function h3(text) {
  return heading(text, HeadingLevel.HEADING_3);
}
function bodyPara(runsOrText, opts = {}) {
  const children = Array.isArray(runsOrText) ? runsOrText : [new TextRun({ text: runsOrText, size: 21 })];
  return new Paragraph({ children, spacing: { after: 160, line: 300 }, ...opts });
}
function bullet(text, level = 0) {
  return new Paragraph({ text, bullet: { level }, spacing: { after: 90 } });
}
function story(role, want, benefit) {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 130, line: 280 },
    children: [
      new TextRun({ text: `As ${role}, `, bold: true, size: 21 }),
      new TextRun({ text: `I want to ${want}, `, size: 21 }),
      new TextRun({ text: `so that ${benefit}.`, italics: true, size: 21, color: MUTED }),
    ],
  });
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

// Renders one "feature module" (PRD Part II §3): id/title/roles/intro,
// then one Heading3 + bullet list per capability group.
function featureModule(m) {
  const out = [h2(`${m.id} ${m.title}`)];
  if (m.roles) out.push(bodyPara([new TextRun({ text: `Primarily used by: `, bold: true, size: 20, color: MUTED }), new TextRun({ text: m.roles, size: 20, color: MUTED, italics: true })]));
  if (m.intro) out.push(bodyPara(m.intro));
  for (const g of m.groups) {
    out.push(h3(g.category));
    for (const item of g.items) out.push(bullet(item));
  }
  return out;
}

function roleStorySection(block) {
  const out = [h2(block.role)];
  if (block.note) out.push(bodyPara([new TextRun({ text: block.note, italics: true, size: 20, color: MUTED })]));
  for (const s of block.stories) out.push(story(block.subject, s.want, s.benefit));
  return out;
}

// ============================================================================
// DATA
// ============================================================================

const ROLE_TABLE_ROWS = [
  ["Platform Admin", "Entire platform, every school", "Superuser. Owns curriculum, all schools/terms, users of every role, payments, site content, moderation, and a direct database browser."],
  ["Instructor", "Own courses; assigned classrooms across one or more schools", "JKT's own staff. Only role besides Admin that authors curriculum (courses/lessons/quizzes/assignments), but scoped to courses they created. Placed into classrooms by Admin, not by a school."],
  ["Teacher", "Assigned classrooms within one school", "A school's own staff. Delivers and grades existing courses — no content authoring. Owns the assignment and external-project grading queues, classroom announcements."],
  ["School Admin", "One school, entirely", "Owns a school's account: approvals, classrooms, terms, attendance oversight, billing (quotes/payments). No grading, no content authoring, no chat."],
  ["Student", "Own account and (if school-linked) own classroom", "Learns: courses, labs, quizzes, assignments, external projects. Earns XP/coins, publishes to the gallery, chats with teacher/class, links to parents."],
  ["Parent", "Own account and linked children (by mutual consent)", "Views linked children's progress, funds wallets, pays to reactivate locked terms, is the only party who can switch on a child's public profile."],
  ["Public Visitor", "No account", "Browses the marketing site, course catalogue, a teaser of the project Showcase, submits feedback/FAQ questions, registers for events, signs up."],
];

const FEATURE_MODULES = [
  {
    id: "3.1",
    title: "Curriculum Authoring",
    roles: "Admin (all courses), Instructor (own courses only)",
    intro: "The platform's content pipeline: career pathways group courses, courses contain modules, modules contain lessons, and lessons carry quizzes, hands-on lab tasks, and/or external-project tasks.",
    groups: [
      { category: "Career Pathways & Courses", items: [
        "Create, edit and delete career pathways with a thumbnail image, and create courses directly inside a pathway.",
        "Create/edit a course with a thumbnail, an attached curriculum document, and a certificate template; auto-regenerate the thumbnail in one click.",
        "View or download a course's curriculum document, and preview how its completion certificate will render.",
        "Delete a course (Admin only).",
      ]},
      { category: "Modules & Lessons", items: [
        "Create/edit/delete modules within a course, each with a thumbnail and a completion badge image (auto-regenerable).",
        "Create/edit/delete lessons, including uploading slide decks (10MB max per file).",
      ]},
      { category: "Quizzes", items: [
        "Author quiz questions manually per lesson.",
        "Import a whole quiz from a JSON file.",
        "Generate a quiz from the lesson's own content using AI, preview it, then save.",
      ]},
      { category: "Lab Tasks & Assignments", items: [
        "Attach a hands-on coding task (Web, Blockly or Python) to a lesson, with instructions and a point value.",
        "Create/edit/delete module-level assignments (the legacy free-text-graded system — see §3.8).",
        "Create/edit/delete a capstone course project.",
        "Define External Projects — deliverable checklists and rubrics for real-world work submitted outside any in-app lab (see §3.7); Admin only, at lesson/module/course scope.",
      ]},
      { category: "Guides", items: [
        "Write/edit/delete platform guide documents, organized by guide type.",
      ]},
    ],
  },
  {
    id: "3.2",
    title: "School, Classroom, Term & Attendance Management",
    roles: "Admin (cross-school), School Admin (own school), Teacher/Instructor (assigned classrooms, attendance only)",
    intro: "Every school-linked student belongs to a classroom, and every classroom's access to courses is scoped to an academic term.",
    groups: [
      { category: "Schools (Admin)", items: [
        "View, edit and export (Excel/PDF) the full list of registered schools.",
        "Open a school's detail page: students, teachers, classrooms, terms, attendance, assigned courses and analytics tabs.",
        "Assign which courses a school gets, per term or with no term restriction.",
      ]},
      { category: "Classrooms", items: [
        "Create/edit/delete classrooms; assign students and one or more teachers to each (School Admin); Admin can additionally place Instructors into classrooms across schools.",
        "Assign, change or remove which courses a classroom gets, limited to courses the platform has authorised for that school's current term (School Admin).",
      ]},
      { category: "Terms", items: [
        "Create/edit/delete academic terms; creating a term auto-generates a billing quote (School Admin/Admin).",
        "Enroll or remove students from a term via an eligibility-filtered picker; export term rosters to Excel.",
        "Close ('end') a term — auto-generates a report for every class and every enrolled student in the background (Admin).",
        "Reactivate an individual student's access after their term ends, for free (Admin) or via payment (Student/Parent — see §3.13).",
      ]},
      { category: "Student Status", items: [
        "Mark a school-linked student active or inactive (e.g. graduated/withdrawn); inactive students drop out of assignment pickers and login-card exports while their history is preserved (Admin).",
        "School Admin sees active/inactive status read-only.",
      ]},
      { category: "Attendance", items: [
        "Record attendance per session (present/absent/late per student; session marked held/cancelled/holiday/no-class) — Admin, School Admin, Teacher and Instructor, each scoped to their own classrooms.",
        "Edit or delete a session or an individual record; view history and weekly statistics.",
        "Export a session as PDF or a whole term as Excel.",
      ]},
      { category: "Login Cards", items: [
        "Download printable, branded student login-card PDFs for a school, optionally filtered to one term (Admin).",
        "Generate a cartoon avatar per student (or a whole school) and toggle picture-and-PIN login on/off, powering a simplified classroom login flow for young learners.",
      ]},
    ],
  },
  {
    id: "3.3",
    title: "User & Account Management",
    roles: "Admin",
    intro: "Central account administration across every role.",
    groups: [
      { category: "Creating & Editing Users", items: [
        "Create a user of any role (student, parent, teacher, instructor, school admin, admin, general user) directly.",
        "Add, edit or remove students/teachers within a school, including profile photos and password resets.",
        "Bulk-import students into a school via CSV upload (5MB max), logged to the activity trail.",
        "Edit any user's name, email, phone, gender, role or wallet balance; delete a user.",
      ]},
      { category: "Approvals & Linking", items: [
        "Approve or reject teachers/school-admins/students who self-registered against a School ID (School Admin, for their own school).",
        "Link a child's account to a parent; view a parent's linked children; search users and parents (Admin).",
      ]},
      { category: "Records", items: [
        "View any student's full progress, performance, quiz and assignment history.",
        "Own admin account sign-in with forgot/reset-password and a dedicated profile page.",
      ]},
    ],
  },
  {
    id: "3.4",
    title: "Learning Experience — Courses & Lessons",
    roles: "Student",
    intro: "The core learning loop. Two student types exist: school-linked students (courses come from their classroom) and independent students (self-enrolled, some courses paid).",
    groups: [
      { category: "Course & Module Navigation", items: [
        "Browse enrolled courses as a module grid showing progress and lock state.",
        "Strict sequential unlocking: a lesson unlocks only once the previous lesson's quiz (and lab task, if any) is complete; a module unlocks once every lesson, its final quiz, and its assignment are done.",
        "School-linked students additionally require the instructor to release a lesson to the class before it's available (the first lesson of every course is always open).",
        "Independent students can self-enroll in a course, with paid courses charged to their wallet.",
      ]},
      { category: "Lesson Content", items: [
        "Each lesson can carry a video, notes, a slide deck, a quiz, a lab task, and attached external projects.",
        "Full-screen mode, Focus Mode (distraction-free), click-to-enlarge images, adjustable font size and dark mode on slides, and text-to-speech on quiz questions/options.",
        "Lesson time-on-task is tracked automatically for analytics.",
      ]},
      { category: "Quizzes", items: [
        "Take a quiz, get an immediate score plus a question-by-question review with an AI explanation on every answer.",
        "Retake freely, but XP (and a pass bonus) is only awarded on the first attempt; one answer-check per question per attempt.",
        "Correct-answer streak bonuses (3 or 5 in a row); an optional 'Boss Battle' game-style replay of a past quiz.",
        "Post-quiz reflection prompt ('what clicked / what's still fuzzy') that feeds the AI Tutor's context for that student.",
        "Quiz history list with reopenable detailed reviews.",
      ]},
      { category: "AI Tutor", items: [
        "A chat assistant grounded in the current lesson's content and the student's own past reflections — 5 free questions/day, then 3 coins each.",
        "The same tutor is embedded in every coding lab, answering questions about the student's own code.",
      ]},
      { category: "Other", items: [
        "Past-course view-only access after leaving a classroom, for review without new progress.",
        "A linked parent is notified automatically of quiz and assignment results.",
      ]},
    ],
  },
  {
    id: "3.5",
    title: "Coding Labs — Web, Blockly, Arduino & Python",
    roles: "Student",
    intro: "Four in-browser coding environments with a shared security posture: nothing a student writes ever executes on the server. Web/Blockly/Python run entirely client-side; Arduino sketches are only compiled server-side (rate-limited to 10/min) and then simulated client-side.",
    groups: [
      { category: "Web Lab", items: [
        "Multi-page HTML/CSS/JS editor sharing one stylesheet and script across pages, with per-panel show/hide.",
        "Live preview at desktop/tablet/mobile widths, plus a console panel for JS logs and errors.",
        "Run, Save, Reset and full-screen controls.",
      ]},
      { category: "Blockly Lab", items: [
        "Drag-and-drop block coding (motion, looks, sound, pen, events, control, sensors, variables, console) driving sprites on a stage.",
        "Admin-curated sprite/background library; programs can prompt the user for input.",
        "Run/Stop, plus screenshot and video recording of the stage.",
      ]},
      { category: "Python Lab", items: [
        "Real Python executing instantly in-browser (never server-side) via a Web Worker; runaway code is force-stopped after 15 seconds.",
        "Output console for prints/errors.",
      ]},
      { category: "Arduino Lab", items: [
        "Circuit designer: admin-curated parts palette, snap-to-grid breadboard, multi-colour/style wiring, flip/rotate/duplicate/delete, undo/redo, pan/zoom.",
        "Example sketches, a Serial Monitor, and adjustable simulated sensor readings while testing.",
        "Export code as .ino, and the circuit as a file or image (PNG/JPG/SVG/PDF).",
        "No Submit or Publish button — this lab is a design/simulation sandbox only, not a gradeable-submission surface.",
      ]},
      { category: "Shared Across Labs", items: [
        "Auto-save with offline queueing (saves sent once the connection returns).",
        "'Back to Lesson' link when opened from lesson context; coin-metered AI Tutor in every lab.",
        "Lesson-attached lab tasks (Web/Blockly/Python only): AI grades on submit (score + feedback), up to 3 attempts, first submission pays XP and can unlock the next lesson.",
        "Free-play projects (not tied to a lesson) pay a one-time +15 XP/+10 coins on first submission.",
      ]},
    ],
  },
  {
    id: "3.6",
    title: "Lab Gallery, Publishing & Peer Review",
    roles: "Student (publish/browse/review), Admin (moderation)",
    intro: "A logged-in-only gallery of student-published free-play lab projects, plus a same-classroom peer-review flow with real output previews.",
    groups: [
      { category: "Publishing & Browsing", items: [
        "Publish a submitted free-play project (Web or Blockly) to the gallery, or unpublish it; lesson-task work can never be published; unfriendly project names are blocked.",
        "Browse the gallery filtered by lab type, sorted Newest/Popular, with incremental loading.",
        "Like other students' projects (not your own); remix a published project into your own free-play slot (with an overwrite warning), tracked with a remix count.",
        "Report an inappropriate project for admin review.",
        "A separate 'Featured External Projects' section shows real-world projects admins have chosen to highlight.",
      ]},
      { category: "Peer Review (same classroom only)", items: [
        "Review classmates' submitted lab projects with a real, type-appropriate preview: Web runs live in a sandboxed iframe, Python actually executes in-browser, Blockly shows generated code read-only.",
        "Leave a 1-5 star rating and a profanity-filtered comment, editable later; the project owner is notified and can see reviews received.",
      ]},
      { category: "Moderation (Admin)", items: [
        "Browse all published gallery projects, filter/search, and toggle a 'Flagged only' view.",
        "Unpublish any project, immediately removing it from the gallery.",
      ]},
    ],
  },
  {
    id: "3.7",
    title: "External Project Submissions & Grading",
    roles: "Admin (author), Student (submit), Teacher (grade/override), Admin (feature)",
    intro: "A course-agnostic way to submit real-world work built outside any in-app lab (a real server, a Docker deployment, a robotics build) as files or links, without the platform ever executing what's submitted.",
    groups: [
      { category: "Task Definition (Admin)", items: [
        "Attach an External Project to a lesson, module, or whole course, with a deliverables checklist (file/link, per-item accepted formats, required/optional) and a weighted rubric.",
        "Toggle AI grading on or off per task: graded tasks are scored automatically; ungraded tasks are simply stored for manual teacher review (e.g. a build-log photo).",
      ]},
      { category: "Submission (Student)", items: [
        "Task page shows the rubric, deliverables checklist, and a submission guide/example.",
        "Submit each deliverable as a file (incl. zip/PDF, 25MB max) or a link (GitHub links recognised), plus optional notes.",
        "Graded tasks: immediate confirmation, AI grading runs in the background (reads files/zips/repos as text only, never executes), score/feedback/per-criterion breakdown delivered via notification; falls back to teacher review if AI grading fails.",
        "View all past submissions with status, score and feedback.",
      ]},
      { category: "Grading & Featuring", items: [
        "Teacher reviews AI-graded submissions per rubric criterion and can override the score and add feedback, notifying the student.",
        "Admin can feature a graded submission in the logged-in Gallery and the public Showcase — gated by the same parental consent (§3.10) that governs Lab Gallery visibility.",
      ]},
    ],
  },
  {
    id: "3.8",
    title: "Assignments (Legacy System)",
    roles: "Instructor/Admin (author), Student (submit), Teacher (grade)",
    intro: "An older, module-scoped submission system that predates External Projects. Kept and documented as-is; not the recommended path for new project-style work (see Known Issues, §5).",
    groups: [
      { category: "How It Works", items: [
        "Each module can carry assignments, unlocked once the module's final-lesson quiz has been attempted.",
        "Student submits a text answer plus an optional single file; AI grades synchronously against a free-text rubric embedded in the instructions.",
        "Submitting every assignment in a course is required before its completion certificate is issued.",
        "Teacher can override the AI's grade in a dedicated grading queue (filterable by ungraded/AI-graded/all).",
        "Submission history is viewable by the student, with grade and feedback per attempt.",
      ]},
      { category: "How It Differs From External Projects", items: [
        "Assignments: module-scoped only, one file + text, graded synchronously against unstructured rubric text, gates module progression.",
        "External Projects: attach at lesson/module/course level, multiple structured deliverables including links, graded asynchronously against a real weighted rubric, can be storage-only, and can be publicly featured.",
      ]},
    ],
  },
  {
    id: "3.9",
    title: "Gamification & Virtual Economy",
    roles: "Student",
    intro: "Three currencies with distinct rules: XP (never decreases, drives level), coins (spendable, cannot convert to real money), and wallet (real money, via Paystack).",
    groups: [
      { category: "XP, Levels & Redeemable Points", items: [
        "XP from quizzes, lab tasks and projects drives eight named levels (Explorer → Grandmaster).",
        "A separate redeemable-points pool can be exchanged 1:1 for coins or at 1 point = ₦5 into the wallet, without ever lowering the student's level.",
      ]},
      { category: "Coins", items: [
        "Earned via: daily streak bonus (grows with streak length), quiz correct-answer streaks, first-attempt quiz passes, first lab/project submissions.",
        "Spent in the Shop (banners, title tags, XP Boost), on avatar frames, quiz lifelines (hint/fifty-fifty), streak freezes, and Arcade games.",
        "Wallet money can buy coins at ₦5/coin (one-way only).",
      ]},
      { category: "Shop & Cosmetics", items: [
        "Profile banners (20-120 coins), title tags shown under the student's name (25-90 coins), avatar frames (15-150 coins) — equip/unequip anytime.",
        "XP Boost: 40 coins for double XP on the next 3 awards.",
      ]},
      { category: "Quiz Aids & Streak Protection", items: [
        "AI hint (10 coins) and 50/50 (20 coins) during a quiz attempt.",
        "Streak freeze (10 coins) protects the daily streak on a day the student can't study.",
      ]},
      { category: "Arcade", items: [
        "15 mini-games (Snake, 2048, Memory Match, etc.), 3-5 coins per play; a school can disable the Arcade for a classroom.",
      ]},
      { category: "Badges", items: [
        "Awarded on module completion and when a referred student completes their first lesson.",
      ]},
    ],
  },
  {
    id: "3.10",
    title: "Public Showcase & Achievement Sharing",
    roles: "Student (subject), Parent (sole consent authority), Public Visitor (viewer)",
    intro: "A deliberate two-tier visibility model: the in-app Gallery only needs login; the public Showcase additionally requires parental consent, since it exposes a minor's work to the open internet.",
    groups: [
      { category: "Consent Model", items: [
        "A student's project only appears on the public /showcase if a parent (or Admin) has explicitly enabled the child's public profile — the student cannot self-enable this.",
        "Teasers show the first 9 items to anonymous visitors; the rest require login (a marketing hook, not a real access boundary).",
      ]},
      { category: "What's Shown", items: [
        "Public Showcase: published Web/Blockly gallery projects plus admin-featured External Projects, shortened to 'First L.' names, with like counts and star ratings.",
        "Public achievement page (/achievements/:slug, unguessable link): level, streak, badges, certificates under a cartoon avatar and shortened name.",
        "Individual badge/certificate share cards, redacted so a real full name is never exposed even though the underlying certificate image carries it.",
      ]},
    ],
  },
  {
    id: "3.11",
    title: "Communication & Notifications",
    roles: "All roles",
    groups: [
      { category: "Direct & Class Chat", items: [
        "One-to-one chat (Student ↔ Teacher/Instructor) with read/delivered status and a profanity filter.",
        "Classroom group chat with moderation: mute/unmute a student, lock/unlock the room, delete messages (Teacher/Instructor).",
        "Classroom announcements pinned above class chat (Teacher only).",
      ]},
      { category: "Notifications", items: [
        "Shared notifier delivers every event as an in-app notification plus a browser push; important types (link requests, at-risk alerts, wallet receipts) also send email.",
        "Notification centre with unread count and mark-as-read/mark-all-read; dead push subscriptions are cleaned up automatically.",
      ]},
      { category: "Scheduled Nudges", items: [
        "Daily lesson reminders, periodic assignment reminders, spaced-review nudges, weekly leaderboard coin awards, weekly parent digest and at-risk alerts, monthly/yearly analytics reports, and a minute-by-minute newsletter send queue.",
      ]},
    ],
  },
  {
    id: "3.12",
    title: "Parent Portal",
    roles: "Parent",
    intro: "Parents link to children by mutual consent (parent requests, child approves) and get a read/fund-focused view — no direct control over a child's learning.",
    groups: [
      { category: "Linking", items: [
        "Send a link request by the child's email; the child approves or declines from their own dashboard; track pending/approved/declined requests, with re-sends allowed.",
        "A personal referral link rewards both families with a badge and bonus coins once a referred child finishes their first lesson.",
      ]},
      { category: "Dashboard", items: [
        "Per-child summary: level/XP, streak, badge count, courses completed, most recent badge.",
        "Inactivity flags (5+ days idle) and new-badge celebrations (last 7 days); locked-term payment warnings.",
        "With 2+ children: a family leaderboard and a week-over-week Weekly Family Challenge.",
        "Open a child's detailed quiz or assignment result page; download a course progress report.",
      ]},
      { category: "Payments (see also §3.13)", items: [
        "Fund a child's wallet by card (Paystack); pay to reopen a child's locked term; view a combined spending history across all linked children (last 50 entries).",
      ]},
      { category: "Consent Authority", items: [
        "Sole (with Admin) authority to switch a child's public profile on/off — governs both the achievement page and public Showcase eligibility (§3.10).",
      ]},
      { category: "Automatic Emails", items: [
        "Weekly digest (XP, lessons, quiz/assignment scores, badges, projects, streaks) with one-click unsubscribe.",
        "At-risk alert (course completion <40% or quiz average <50%) sent every Wednesday.",
      ]},
    ],
  },
  {
    id: "3.13",
    title: "Payments & Billing",
    roles: "Admin, School Admin, Parent, Student",
    intro: "Paystack is the sole payment provider, in Naira. All charges are verified server-side; amounts are never trusted from the browser, and repeat submissions are not double-charged.",
    groups: [
      { category: "School Billing (School Admin / Admin)", items: [
        "One quote per term (price/student × student count, amount paid, balance, status); download as PDF; record partial payments and generate receipts.",
        "Manual quote creation as a fallback; a financial-analytics panel shows payment trends.",
      ]},
      { category: "Parent Training Invoices (Admin)", items: [
        "Create invoices with amount, discount, due date and grace period; record partial payments; download as PDF; view payment history.",
      ]},
      { category: "Wallet & Personal Payments (Student / Parent)", items: [
        "Top up a wallet via Paystack; wallet funds pay for paid-course enrolment, term reactivation, and buying coins (₦5/coin).",
        "Parent can fund a child's wallet directly or pay to reactivate a child's locked term (server recalculates price; can be free).",
      ]},
      { category: "Event Payments", items: [
        "Public visitors register for events and pay via Paystack, with support for early-bird discounts and split payments.",
      ]},
    ],
  },
  {
    id: "3.14",
    title: "Reports, Analytics & Certificates",
    roles: "Admin, Instructor, Teacher, School Admin, Student, Parent",
    groups: [
      { category: "Platform-Wide Analytics (Admin)", items: [
        "Main dashboard: revenue/growth KPIs, learning analytics (top courses, top/at-risk students), schools overview, finance breakdown by source, engagement history, user-growth chart, per-course and per-student drill-downs.",
        "Analytics summary page (users, active/new users, course/quiz stats, revenue trend, top courses) exportable as PDF, with drill-downs into users/courses/progress/quizzes/finance/feedback/activity/events.",
        "On-demand platform reports (all-time/yearly/monthly, multiple formats, AI-written commentary), emailable on demand, plus automatic monthly/yearly emails.",
        "Auto-generated pitch decks (schools/grants/investors/partners) and AI-drafted, editable partnership proposals with theme selection.",
      ]},
      { category: "School & Classroom Analytics", items: [
        "Class/student term reports, school progress summaries, per-term growth analytics, and a detailed classroom dashboard (Admin/School Admin/Teacher/Instructor, each scoped to their access).",
      ]},
      { category: "Downloadable Reports", items: [
        "Student can download their own quiz/module/course report PDFs; Instructor can download the same for any of their students (Teacher is view-only, downloads blocked).",
        "Parent can download a linked child's course progress report.",
      ]},
      { category: "Certificates", items: [
        "Auto-issued on 100% course completion plus all assignments submitted; unique certificate code; rendered via a Puppeteer HTML-to-image pipeline and stored on Cloudinary.",
        "Admin sets the certificate background, signature image, signee name/title per course, and can preview certificates before they're issued.",
      ]},
    ],
  },
  {
    id: "3.15",
    title: "Content Moderation",
    roles: "Admin",
    groups: [
      { category: "", items: [
        "Browse, filter and search all published Lab Gallery projects; toggle a 'Flagged only' view; unpublish inappropriate projects instantly.",
        "Review teacher-graded External Project submissions and choose which to feature in the Gallery/Showcase, or remove a feature (grading itself stays with Teachers — this is a visibility decision only).",
        "Review, approve/publish or delete visitor-submitted testimonials and feedback.",
      ]},
    ],
  },
  {
    id: "3.16",
    title: "Public Website & Marketing",
    roles: "Public Visitor",
    groups: [
      { category: "Pages (no login)", items: [
        "Homepage: branding, daily-rotating carousel, featured pathways, up to 10 courses and 5 upcoming events, platform stats, benefits, FAQs, randomised testimonials, announcements.",
        "Course catalogue grouped by pathway; individual course/pathway detail pages with downloadable curriculum.",
        "Public Showcase and achievement pages (§3.10); About/Gallery/FAQ company pages, with visitor-submitted questions.",
        "Testimonial and feedback submission forms (feedback triggers a thank-you email to the sender and a notification to Admin).",
        "Event pages: view, register (name/email/phone/group size) and pay via Paystack.",
        "Sign-up flows for parents, independent students and school admins (email-code confirmed) and teachers (School-ID + Admin approval); referral codes captured at sign-up.",
      ]},
      { category: "Security on Public Endpoints", items: [
        "Login and password-reset limited to 10 attempts per 15 minutes; general rate limit of 600 requests/5 minutes platform-wide.",
      ]},
    ],
  },
  {
    id: "3.17",
    title: "Platform Administration & Site Configuration",
    roles: "Admin",
    groups: [
      { category: "Site Content", items: [
        "Company details: logo, hero image, certificate background/signature.",
        "About Us page sections, benefits list, photo gallery (with categories), articles/blog (creation only — see §5), homepage announcements with view/click/dismiss tracking.",
      ]},
      { category: "Communications Tooling", items: [
        "Newsletters: compose with images, target by role/school/classroom/course/individual users, preview recipients, send now or schedule, edit/duplicate/cancel scheduled sends.",
        "Announcements: type, priority, placement (homepage/dashboard), styling, scheduling window, dismiss/close behaviour, engagement tracking.",
      ]},
      { category: "Lab Configuration", items: [
        "Upload/organize Blockly sprites and backgrounds into categories (single or bulk, up to 20 at once).",
        "Curate the Arduino component library (categories, enable/disable, edit/delete) from a fixed supported-parts list; the UI flags parts that render but don't yet react to running code.",
      ]},
      { category: "Advanced / Internal", items: [
        "Direct database browser (view/add/edit/delete rows across an approved table allowlist) — a powerful internal tool, not an end-user feature.",
        "One-off maintenance jobs (e.g. backfilling default student login settings).",
      ]},
    ],
  },
  {
    id: "3.18",
    title: "AI Features",
    roles: "Student, Teacher, Admin, Instructor",
    intro: "All AI features run on OpenAI gpt-4o-mini via a single utils/ai.js askTutor() entry point.",
    groups: [
      { category: "Student-Facing", items: [
        "AI Tutor chat (lesson-aware and code-aware), quiz hints and post-answer explanations, mastery-path suggestions.",
      ]},
      { category: "Grading", items: [
        "AI grades assignment submissions, capstone course projects, lab tasks, and External Project submissions — always a first pass, always human-overridable by a Teacher.",
      ]},
      { category: "Authoring & Reporting Tools", items: [
        "AI-generated quizzes from lesson content (Admin/Instructor); AI-written narrative commentary in platform/school reports and pitch decks/proposals (Admin).",
        "Long lesson text is automatically summarised before being sent to the AI to control cost/context size.",
      ]},
    ],
  },
];

const NFR_ITEMS = [
  { cat: "Security", items: [
    "Sessions stored in Postgres (connect-pg-simple), 1-day expiry, httpOnly + SameSite=Lax cookies. The `secure` cookie flag is currently false — a gap to close before enforcing HTTPS-only cookies in production.",
    "Role-based guards for: logged-in user, parent, teacher, instructor/admin (shared check — see §5), admin, school admin, and 'may access this specific student'.",
    "CSRF protection (custom per-session token via header/form-field/URL) is being rolled out router-by-router — not every route is covered yet.",
    "Passwords hashed with bcrypt; sign-up confirmed via emailed one-time codes; uploads restricted by type/size (lesson files 10MB, external-project files 25MB).",
  ]},
  { cat: "Performance", items: [
    "The classroom-based student dashboard has a known, pre-existing ~38s response time under some conditions, driven by many sequential queries in getDashboard — flagged for separate investigation, not something recent feature work introduced or has yet fixed.",
    "Arduino compile requests are rate-limited to 10/minute per session to protect the compile service.",
  ]},
  { cat: "Email Deliverability", items: [
    "All transactional email routes through Brevo; the current plan caps at 200 emails/day, so the weekly parent digest is deliberately spread across the week and capped at 120 sends per run to stay under it.",
    "The `resend` package is installed but unused — dead dependency, not a second email path.",
  ]},
  { cat: "Payments", items: [
    "Paystack only, Naira-denominated. All amounts are recalculated and verified server-side on webhook/callback — never trusted from client input — and payments are idempotent (no double-charge/double-credit on retry).",
  ]},
  { cat: "Deployment", items: [
    "Deployed on Railway (Nixpacks build) from branch fix/branding-header-audit. package.json pins Node >=22.3.0 — required by pdf-parse's bundled pdfjs-dist, which calls a Node API only available from 22.3+ (root-caused after a production boot crash; see the September 2026 incident record).",
  ]},
];

const KNOWN_ISSUES = [
  ["Admin", "Instructor/Admin share one access check (ensureInstructorOrAdmin)", "Was previously a real auth bug (since fixed); the shared check still means instructor-scoped pages rely entirely on query-level scoping, not the route guard, to keep instructors out of other instructors' data."],
  ["Admin", "Several admin pages point at view templates that don't exist", "Student Details, Student Enrollments, Edit Benefit and Edit Article all 404/error — their controller logic exists but has no page to render."],
  ["Admin", "Broken menu links", "'Progress & Performance' / 'Enrollments' under Students, and 'Modules'/'Lessons' shortcuts, point at routes that don't exist."],
  ["Admin", "Assorted dead code", "A bulk avatar-login route registered at a typo'd path (/schooxls/... instead of /schools/...); a duplicate, unreachable article-search route; an unmounted ministry page; PDF student-export left commented out; two redundant course-edit endpoints."],
  ["Admin", "/admin lands on Newsletters, not the dashboard", "The real dashboard lives at /admin/dashboard — a navigation surprise, not a bug, but worth fixing for first-open UX."],
  ["Student", "App Inventor Lab and AI Lab", "Both appear as cards on the Labs home page but link to pages that don't exist yet."],
  ["Student", "Final Course Project (the third, oldest submission system)", "Its submit handler is non-functional. Superseded by External Projects (§3.7); recommend removing the UI entry point rather than fixing dead code."],
  ["Student", "/student/analytics", "Loads the dashboard template without the data it expects — a dead route left over from an earlier iteration."],
  ["Student", "Badge awarding is client-triggered", "The browser calls /student/award-badge to tell the server to award a badge, rather than the server deciding independently — a trust-boundary weakness worth revisiting."],
  ["Student", "Inconsistent auth gating", "Several /student routes don't require ensureAuthenticated even though the router has no blanket auth gate of its own — a pre-existing inconsistency, not something introduced recently."],
  ["Parent", "Quiz/assignment result pages have no ownership check", "Anyone with the link can open a result page — should be scoped to the owning parent/student."],
  ["Parent", "No parent-teacher messaging surface", "A general direct-message API exists platform-wide, but nothing on the parent dashboard exposes it for contacting a teacher."],
  ["Public", "Footer newsletter sign-up is wired to the wrong endpoint", "It posts to /subscribe, which is actually the browser-push opt-in — there is no real email-list sign-up handler behind it."],
  ["Cross-cutting", "CSRF coverage is partial", "Being added router-by-router (per the project's own established pattern); some older routes remain unprotected."],
  ["Cross-cutting", "Session cookie `secure` flag is false", "Should be enabled once the production domain is confirmed fully HTTPS end-to-end."],
];

const USER_STORY_BLOCKS = [
  {
    role: "Platform Administration", subject: "a Platform Admin",
    stories: [
      { want: "create and edit career pathways, courses, modules, lessons, quizzes and lab tasks", benefit: "the full curriculum stays organized and current without needing a developer" },
      { want: "define an External Project's deliverables checklist and rubric, and toggle whether it's AI-graded", benefit: "teachers can offer real-world project work that fits how much grading effort a task actually needs" },
      { want: "onboard a new school, its terms, classrooms and courses", benefit: "a partner school can get its students learning with the right content and structure from day one" },
      { want: "create user accounts of any role and bulk-import students via CSV", benefit: "large school rosters can be set up quickly instead of one account at a time" },
      { want: "mark a student inactive when they graduate or leave", benefit: "old students stop cluttering classroom/term pickers and login-card exports while their history is preserved" },
      { want: "view revenue, engagement, learning and school-level analytics dashboards", benefit: "I can make informed decisions about where the platform needs investment or attention" },
      { want: "generate an on-demand or automatic monthly/yearly platform report with AI-written commentary", benefit: "stakeholders get a clear, readable summary without me writing it by hand" },
      { want: "generate a pitch deck or AI-drafted partnership proposal for a prospective school, grant, investor or partner", benefit: "business development has ready, on-brand material without a separate design effort" },
      { want: "record a school's term quote, partial payments and receipts", benefit: "school billing is tracked accurately alongside the academic terms it pays for" },
      { want: "browse the Lab Gallery, filter/search, and unpublish inappropriate projects", benefit: "the public-facing gallery stays safe and appropriate" },
      { want: "feature a teacher-graded External Project submission in the Gallery and public Showcase", benefit: "standout real-world student work gets the visibility it deserves, on top of teacher grading" },
      { want: "configure the Blockly sprite/background library and the Arduino component catalog", benefit: "students always have an age-appropriate, curated set of building blocks in the labs" },
      { want: "set the certificate template (background, signature) per course", benefit: "every student's completion certificate looks professional and on-brand" },
      { want: "compose and send targeted newsletters and manage homepage announcements", benefit: "the right message reaches the right audience (a school, a classroom, or everyone) without manual list-building" },
      { want: "review and publish visitor-submitted testimonials and feedback", benefit: "the public site only shows content that's been checked first" },
    ],
  },
  {
    role: "Instructor", subject: "an Instructor",
    stories: [
      { want: "create and edit my own courses, modules, lessons, quizzes and assignments", benefit: "I can deliver curriculum I've personally designed to the classrooms I teach" },
      { want: "switch between the schools I'm assigned classrooms in", benefit: "I can manage all my classes from one place even though I work across multiple schools" },
      { want: "release a lesson to a classroom on my own schedule", benefit: "I can pace a class's progress to match how the live sessions are going, on top of each student's own unlocking rules" },
      { want: "award bonus points or coins to a student for a category of achievement", benefit: "I can recognize effort in the moment, within fair daily limits" },
      { want: "download PDF reports for a student, quiz, module or course", benefit: "I can share progress with a school or take records offline" },
      { want: "write a narrative class report for a classroom each term", benefit: "the school admin gets qualitative context, not just numbers, on how the class is doing" },
      { want: "chat one-to-one with my students and moderate my classroom's group chat", benefit: "I can answer questions and keep the classroom conversation on-topic and respectful" },
      { want: "take and export attendance for my classrooms", benefit: "attendance records exist even though I'm not a school's own staff member" },
    ],
  },
  {
    role: "Teacher", subject: "a Teacher",
    stories: [
      { want: "see a dashboard of my classes' lesson completion, quiz and assignment averages, filterable by classroom and term", benefit: "I can spot how my classes are doing at a glance" },
      { want: "see which students are at risk or need encouragement, and who's leading each classroom", benefit: "I can target my attention where it's needed most" },
      { want: "review and grade a queue of assignment submissions, seeing the AI's suggested grade first", benefit: "grading is faster while I still make the final call" },
      { want: "review External Project submissions against their rubric and deliverables, and override the AI's score", benefit: "real-world project work gets a fair, human-checked grade" },
      { want: "post announcements to my classroom", benefit: "important updates reach every student in the class in one place" },
      { want: "moderate my classroom's group chat (mute, lock, delete messages)", benefit: "I can keep the classroom chat safe and on-topic" },
      { want: "take attendance and export a session or term summary", benefit: "attendance records are accurate and easy to share with the school" },
      { want: "view (though not download) a student's detailed report", benefit: "I can discuss progress with a student or parent without needing offline copies" },
    ],
  },
  {
    role: "School Administration", subject: "a School Admin",
    stories: [
      { want: "approve or reject teachers and students who registered against my school's ID", benefit: "only legitimate members of my school get access" },
      { want: "add students individually or import many via CSV", benefit: "onboarding a new class or term's worth of students doesn't take all day" },
      { want: "create classrooms and assign teachers and students to them", benefit: "my school's structure in the platform matches how it's actually organized" },
      { want: "choose which courses a classroom gets, limited to what's authorised for our current term", benefit: "classes only see content we've agreed to and paid for" },
      { want: "create academic terms and manage which students are enrolled in each", benefit: "our academic calendar and student access line up correctly" },
      { want: "view my school's term quote, record payments, and download a receipt", benefit: "billing for my school is transparent and I can reconcile it myself" },
      { want: "view the end-of-term report cards the platform generated for my classes", benefit: "I get insight into student outcomes without generating reports myself" },
      { want: "take and export attendance for any classroom in my school", benefit: "I have oversight across teachers, not just what one teacher records" },
      { want: "see a read-only 'Inactive' badge on graduated or withdrawn students", benefit: "I know who's current without being able to (or needing to) change that status myself" },
    ],
  },
  {
    role: "Student — Learning", subject: "a Student",
    stories: [
      { want: "see my XP, level, streak and coin balance at a glance", benefit: "I stay motivated and know where I stand" },
      { want: "move through a course's modules and lessons in a guided sequence", benefit: "I build skills in the right order without getting lost or overwhelmed" },
      { want: "take a quiz, see my score, and get an AI explanation on every answer", benefit: "I understand not just what I got wrong but why" },
      { want: "retake a quiz as many times as I want", benefit: "I can keep practicing until I've really mastered it, even though only my first attempt earns XP" },
      { want: "ask an AI Tutor questions grounded in my current lesson or my own code", benefit: "I get help exactly when I'm stuck, without waiting for a teacher" },
      { want: "see 'Recommended for you' suggestions when I score low on something", benefit: "I know exactly what to review next instead of guessing" },
      { want: "reflect on what clicked and what's still fuzzy after a quiz", benefit: "the AI Tutor has better context to help me later" },
    ],
  },
  {
    role: "Student — Labs & Projects", subject: "a Student",
    stories: [
      { want: "build a website in the Web Lab with a live preview across screen sizes", benefit: "I can see exactly how my site will look while I build it" },
      { want: "program a sprite with drag-and-drop blocks in the Blockly Lab", benefit: "I can learn programming logic without fighting text-syntax errors" },
      { want: "write and run real Python instantly in my browser", benefit: "I get immediate feedback without needing anything installed" },
      { want: "design a circuit and simulate an Arduino sketch without owning real hardware", benefit: "I can learn embedded electronics safely and for free" },
      { want: "submit a lab task attached to a lesson and get AI feedback", benefit: "I know if my work meets the lesson's goal before moving on" },
      { want: "publish a free-play project to the Gallery, and take it down again later", benefit: "I can share my best work with other students on my own terms" },
      { want: "like and remix other students' published projects", benefit: "I can learn from and build on what my peers made" },
      { want: "review a classmate's submitted lab project with a real working preview", benefit: "I can give meaningful feedback, not just guess from a project name" },
      { want: "submit a real-world project (a file, a zip, or a GitHub link) for a task that goes beyond what any lab can run", benefit: "my more ambitious work still gets graded fairly" },
    ],
  },
  {
    role: "Student — Economy, Social & Account", subject: "a Student",
    stories: [
      { want: "spend coins in the Shop on banners, title tags and an XP boost", benefit: "I can personalize my profile and reward myself for progress" },
      { want: "play Arcade mini-games using coins", benefit: "I get a fun break that still costs something I earned by learning" },
      { want: "chat with my teacher and classmates, and see classroom announcements", benefit: "I stay connected to my class the way I would in person" },
      { want: "approve or decline a parent's request to link to my account", benefit: "I control who gets visibility into my progress" },
      { want: "download my own quiz, module and course reports", benefit: "I can keep a personal record of my achievements" },
      { want: "pay from my wallet (or have a parent pay) to reactivate a locked term", benefit: "I don't permanently lose access just because a term ended" },
      { want: "view and share my certificates and badges", benefit: "I can show off what I've accomplished" },
    ],
  },
  {
    role: "Parent", subject: "a Parent",
    stories: [
      { want: "send a link request to my child using their email", benefit: "I can connect my account to theirs with their knowledge and consent" },
      { want: "see each linked child's level, streak, badges and course completion on one dashboard", benefit: "I can stay involved in their learning without digging through separate screens" },
      { want: "get an alert when a child has been inactive for several days or is falling behind", benefit: "I can step in and encourage them before it becomes a bigger problem" },
      { want: "open a child's detailed quiz or assignment result", benefit: "I can understand exactly where they're struggling or excelling" },
      { want: "fund my child's wallet or pay to reactivate a locked term", benefit: "I can remove a payment barrier to their learning directly" },
      { want: "be the one who decides whether my child's profile and projects are public", benefit: "I control my child's privacy and public exposure, not the school or the student alone" },
      { want: "receive a weekly digest email summarizing all my children's activity", benefit: "I stay informed without having to log in constantly" },
      { want: "compare my children's progress on a family leaderboard", benefit: "learning feels like a shared, friendly family activity" },
    ],
  },
  {
    role: "Public Visitor", subject: "a prospective family or visitor",
    stories: [
      { want: "browse the course catalogue and see what each course covers", benefit: "I can decide if the platform is right for my child before signing up" },
      { want: "see a teaser of real student projects in the public Showcase", benefit: "I can judge the quality of what students actually build here" },
      { want: "read testimonials and submit my own feedback or FAQ question", benefit: "I can learn from other families' experience and get my own questions answered" },
      { want: "register and pay for an event", benefit: "I can join a workshop or session without needing an account first" },
      { want: "sign up as a parent, independent student, or school admin", benefit: "I can get started on the platform in the role that fits me" },
      { want: "sign up as a teacher using my school's School ID", benefit: "I can join my school's existing account once the school admin approves me" },
    ],
  },
];

// ============================================================================
// DOCUMENT
// ============================================================================

const children = [];

// ---------------- COVER ----------------
children.push(
  new Paragraph({ spacing: { before: 900 }, children: [] }),
  new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "JK Technology · JKT Hub", size: 22, color: MUTED })] }),
  new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { before: 200, after: 120 },
    children: [new TextRun({ text: "Platform PRD, BRD & User Stories", bold: true, size: 52, color: BRAND_DARK })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 400 },
    children: [new TextRun({ text: "A complete inventory of every feature, for every role, as currently implemented", size: 24, color: BRAND, italics: true })],
  }),
  new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Prepared: September 23, 2026", size: 20, color: MUTED })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 700 }, children: [new TextRun({ text: "Repository: edtech_new · Branch: fix/branding-header-audit · Live: acad.jkthub.com", size: 20, color: MUTED })] }),
  calloutBox("How This Document Was Built", [
    "Compiled directly from the codebase — routes, controllers and views across every role — not from memory or assumption. Where something appears broken, unfinished, or inconsistent, it is called out explicitly in §5 (Known Issues) rather than described as a working feature.",
    "Three parts: I) Business Requirements (why the platform exists, for whom, and how it makes money), II) Product Requirements (what every role can actually do today, organized by feature area), III) User Stories (the same functionality restated from each role's own point of view).",
  ]),
  new Paragraph({ children: [new PageBreak()] })
);

// ---------------- PART I: BRD ----------------
children.push(
  new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 500 },
    children: [new TextRun({ text: "PART I — BUSINESS REQUIREMENTS DOCUMENT", bold: true, size: 34, color: BRAND })],
  }),

  heading("1. Executive Summary"),
  bodyPara(
    "JKT Hub is JK Technology's coding-education platform, serving partner schools, independent learners and their parents. It combines structured curriculum (courses, lessons, quizzes) with four hands-on coding environments (Web, Blockly, Python and Arduino labs), AI-assisted tutoring and grading, a game-like progression economy (XP, coins, badges, a shop), and the operational tooling a multi-school B2B education business needs — enrollment, terms, attendance, billing, reporting and content moderation."
  ),
  bodyPara(
    "The platform serves seven distinct roles (Platform Admin, Instructor, Teacher, School Admin, Student, Parent, and anonymous Public Visitors), each with a deliberately scoped set of permissions. This document inventories what has actually been built for each of them."
  ),

  heading("2. Business Objectives"),
  bullet("Deliver coding education to school-enrolled students at scale, through a B2B relationship with partner schools (quotes, terms, classrooms) alongside a direct-to-consumer path for independent students and their parents."),
  bullet("Keep grading and content-delivery costs low by using AI as the first pass for quizzes, lab tasks, assignments and External Projects, with a human (Teacher) always able to override."),
  bullet("Drive engagement and retention through a genuine gamification layer (XP, coins, streaks, badges, a shop, an arcade) rather than education content alone."),
  bullet("Build public-facing proof of outcomes — a Showcase of real student work and shareable achievement pages — as a trust and marketing asset, while protecting minors' privacy behind explicit parental consent."),
  bullet("Give partner schools and parents visibility into progress without giving up platform-side control over curriculum quality and safety (moderation, rubric-based grading, teacher override)."),

  heading("3. Stakeholders & User Roles"),
  bodyPara("Seven roles interact with the platform; their scopes and boundaries are deliberately distinct (fully detailed in Part II, §2):"),
  dataTable(["Role", "Scope", "Summary"], ROLE_TABLE_ROWS, [1800, 2600, 4950]),

  heading("4. Business Model"),
  bullet("School billing: partner schools are quoted and invoiced per term (price × enrolled students), paid in installments, tracked to a balance — the core B2B revenue line."),
  bullet("Direct payments: independent students and parents pay via Paystack (Naira) for paid-course enrollment, wallet top-ups, term reactivation after a lock, and event registration."),
  bullet("Parent training invoices: a separate, ad hoc billing line for parent-facing training/programs, tracked with discounts, due dates and grace periods."),
  bullet("All revenue and payment activity rolls up into the Admin finance dashboard, broken down by source (school payments, parent payments, event payments)."),

  heading("5. Scope"),
  bodyPara([new TextRun({ text: "In scope for this document: ", bold: true, size: 21 }), new TextRun({ text: "every feature currently implemented and reachable in the codebase, across all seven roles, as of the date above.", size: 21 })]),
  bodyPara([new TextRun({ text: "Out of scope: ", bold: true, size: 21 }), new TextRun({ text: "future/proposed features not yet built (e.g. App Inventor Lab, AI Lab — currently just placeholder cards, see §5 of Part II), and infrastructure-level detail (exact schema, line-level code) better suited to engineering design docs than a PRD/BRD.", size: 21 })]),

  heading("6. Key Business Rules"),
  bullet("A student's public visibility (Showcase, achievement page) requires explicit parent (or Admin) consent — never student self-service and never automatic on publish-to-gallery."),
  bullet("Coins can be bought with wallet money, but never converted back — a one-way economy that protects the real-money wallet from being drained by in-app currency manipulation."),
  bullet("AI grading is always a first pass; a Teacher can always override the score and feedback on assignments and External Projects."),
  bullet("A school's classroom only gets access to courses the platform has explicitly authorised for that school's current term — course access is never open-ended."),
  bullet("When a term ends, incomplete lesson access locks until reactivated (by payment, or free reactivation from Admin) — completed work remains viewable regardless."),
  bullet("Instructors are JKT's own staff and are the only role besides Admin permitted to author curriculum; Teachers (school staff) deliver and grade but never author content."),

  heading("7. Success Metrics"),
  bullet("School retention and term-over-term renewal rate (quote → payment → next term enrolled)."),
  bullet("Student engagement: daily streak participation, lesson completion rate, lab task submission rate."),
  bullet("Grading throughput and quality: AI-graded-vs-teacher-overridden ratio, time from submission to graded status."),
  bullet("Public Showcase conversion: anonymous-visitor-to-signup rate through the teaser-then-login pattern."),
  bullet("Revenue mix and growth across the three payment channels (school, parent/student, event)."),

  heading("8. Assumptions, Dependencies & Third-Party Services"),
  dataTable(
    ["Service", "Used For"],
    [
      ["Paystack", "All payments — wallet top-ups, course enrollment, term reactivation, event registration (Naira only)."],
      ["OpenAI (gpt-4o-mini)", "AI Tutor, grading (assignments/labs/External Projects), quiz generation, report narration."],
      ["Cloudinary", "File/image storage — uploads, certificates, profile pictures, Blockly assets."],
      ["Brevo", "All transactional email (200/day plan limit — see Part II §4)."],
      ["Puppeteer", "Server-side certificate image rendering and PDF report generation."],
      ["Railway (Nixpacks)", "Production hosting, deployed from branch fix/branding-header-audit."],
      ["PostgreSQL", "Primary data store, including session storage (connect-pg-simple)."],
    ],
    [3000, 6350]
  ),

  new Paragraph({ children: [new PageBreak()] })
);

// ---------------- PART II: PRD ----------------
children.push(
  new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 500 },
    children: [new TextRun({ text: "PART II — PRODUCT REQUIREMENTS DOCUMENT", bold: true, size: 34, color: BRAND })],
  }),

  heading("1. Product Overview"),
  bodyPara(
    "JKT Hub is organized around a single core loop — a student progresses through a course's modules and lessons, demonstrating mastery via quizzes, hands-on lab tasks, assignments and (optionally) real-world External Projects — surrounded by the operational layers that make that loop work at scale for a multi-school business: enrollment, terms, grading queues, billing, communication, moderation and analytics."
  ),

  heading("2. Role & Access Model"),
  bodyPara("The three staff-facing roles are easy to conflate; their boundaries are summarized here and detailed fully in the corresponding user-story sections of Part III."),
  dataTable(["Role", "Scope", "Summary"], ROLE_TABLE_ROWS, [1800, 2600, 4950]),
  spacer(200),
  bodyPara([new TextRun({ text: "Key distinction: ", bold: true, size: 21 }), new TextRun({ text: "Instructor is not an admin-permission tier — it is a separate classroom-facing role for JKT's own delivery staff. The confusion arises because instructors share one access check with Admin (ensureInstructorOrAdmin) and sign in through the admin login page; in practice every instructor-facing query is further scoped to that instructor's own courses and assigned classrooms.", size: 21 })]),

  heading("3. Functional Requirements by Module"),
  ...FEATURE_MODULES.flatMap(featureModule),

  new Paragraph({ children: [new PageBreak()] }),
  heading("4. Non-Functional Requirements"),
  ...NFR_ITEMS.flatMap((n) => [h3(n.cat), ...n.items.map((i) => bullet(i))]),

  new Paragraph({ children: [new PageBreak()] }),
  heading("5. Known Issues & Technical Debt Register"),
  bodyPara(
    "Documented here in the interest of an honest PRD — these are gaps found while auditing the live codebase, not hypothetical risks. None of the features above are described as working if this register says otherwise."
  ),
  dataTable(["Area", "Issue", "Impact"], KNOWN_ISSUES, [1400, 3600, 4350]),

  new Paragraph({ children: [new PageBreak()] })
);

// ---------------- PART III: USER STORIES ----------------
children.push(
  new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 500 },
    children: [new TextRun({ text: "PART III — USER STORIES", bold: true, size: 34, color: BRAND })],
  }),
  bodyPara(
    "The same functionality from Part II, restated from each role's own point of view in \"As a ___, I want to ___, so that ___\" form, grouped by role in roughly the order features appear in Part II §3."
  ),
  spacer(200),
  ...USER_STORY_BLOCKS.flatMap((b, i) => {
    const out = roleStorySection(b);
    if (i < USER_STORY_BLOCKS.length - 1) out.push(spacer(200));
    return out;
  })
);

// ============================================================================

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
        { level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT },
        { level: 1, format: LevelFormat.BULLET, text: "◦", alignment: AlignmentType.LEFT },
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
      children,
    },
  ],
});

const outPath = path.join(__dirname, "jkthub-platform-prd-brd-user-stories.docx");
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(outPath, buf);
  console.log("Wrote", outPath, `(${(buf.length / 1024).toFixed(0)} KB)`);
});
