// Updates docs/jkthub-brd-status-checklist.xlsx in place. Unlike
// buildPlatformPRD.js (which rebuilds its .docx from scratch every run),
// this script has no prior generator to rebuild from — it READS the
// existing workbook, preserving every prior sheet/row/style untouched,
// appends NEW_KNOWN_ISSUES / NEW_USER_STORIES below for this revision,
// then recomputes the Summary sheet's counts from the live data so it
// never drifts out of sync with the sheets it's summarizing. Re-run
// after editing the NEW_* arrays below; do not hand-edit the .xlsx.

const path = require("path");
const ExcelJS = require("exceljs");

const FILE_PATH = path.join(__dirname, "jkthub-brd-status-checklist.xlsx");
const TODAY = "2026-11-02";

// ---------------------------------------------------------------------
// New rows for this revision
// ---------------------------------------------------------------------

// [Area, Item, Status, Notes]
const NEW_KNOWN_ISSUES = [
  [
    "Teacher",
    "Cross-school data leak: the dashboard's pending-assignments count, the grading queue, and the actual grade-submission authorization check all scoped a submission by \"does one of my classrooms have this catalog course assigned,\" not by whether the submitting student is actually in my classroom",
    "Fixed",
    "Reported directly by a client user: a teacher saw a student from a different school in their \"assignments waiting to be graded\" count. Root cause: controllers/teacherController.js joined assignment_submissions through the shared course catalog (module_assignments → modules → courses → classroom_courses → classroom_teachers), but classroom_courses maps one catalog course to classrooms across different schools, and none of the three call sites (getDashboardData's pending count, getGradingQueue, submitGrade's ownership check) verified the submitting student was enrolled in the teacher's own classroom. submitGrade's copy was the most serious — a teacher could actually submit a grade for a cross-school student, not just see them. Fixed by adding a user_school join tying the student to the teacher's own classroom_id, the same pattern already used correctly elsewhere in the file. Logged as a new Critical finding in the project's own security/buildSecurityTracker.js and security-audit-tracker.xlsx.",
  ],
  [
    "Teacher / Instructor",
    "The identical cross-school leak, independently, in External Project grading — found while building Instructor's own grading parity, not yet reported by a client",
    "Fixed",
    "controllers/externalProjectController.js's getExternalProjectGradingQueue/overrideExternalProjectGrade (the teacher-side External Project review queue) had the same gap — joined through classroom_courses/classroom_teachers with no check that the submitting student was in the teacher's own classroom. Fixed with the same user_school join. The new Instructor-side equivalents (next row) were built correctly from the start instead of copying the bug forward.",
  ],
  [
    "Instructor",
    "No Grading or External Projects section existed for Instructor at all — only Teacher had them, so an instructor could not review or grade submissions from their own students",
    "Fixed",
    "New instructorController.getGradingQueue/submitGrade (scoped via classroom_instructors, with the student-enrollment join above baked in from the start) and new externalProjectController.getExternalProjectGradingQueueForInstructor/overrideExternalProjectGradeForInstructor, dispatched from loadSection's existing section router. Two new sidebar tabs (Grading, External Projects) and two new views styled with the instructor dashboard's own jk- design system (Teacher's tc- component library isn't loaded there). An instructor can now review and override AI-graded assignment and external-project submissions from students they actually teach, exactly like a Teacher.",
  ],
  [
    "Teacher / Admin — reports & course pages",
    "Modules and lessons displayed in whatever order the database happened to return them (effectively id/insertion order) instead of their real curriculum order_number — in the teacher's per-student course report, the admin course-details page's Module/Lesson tabs (the \"All Modules\" lesson list also interleaved different modules' lessons instead of grouping each module's together), and the Portfolio/CV PDF's course summary",
    "Fixed",
    "Found via a client report of modules showing out of sequence on a teacher's \"view report\" page. Fixed missing/wrong ORDER BY clauses in teacherController.js's viewCourseReport, learningController.js's viewSingleCourse (the real page behind /admin/courses/:id and /instructor/courses/:id — modules now ORDER BY order_number, and the Lessons tab's \"All Modules\" list now ORDER BY m.order_number, l.order_number so every module's lessons stay grouped together), and userController.js's/adminController.js's downloadCourseSummary. Left the admin course list itself untouched — it was already correctly grouped by pathway/level/sort_order.",
  ],
  [
    "Teacher / Student reports",
    "An in-progress (incomplete) module showed a pass/fail-looking letter grade (e.g. \"Grade F\") instead of reflecting that it isn't finished yet",
    "Fixed",
    "Client feedback: a module at 25% complete showed \"Grade F,\" reading as a failing grade rather than work-in-progress. Fixed in the one shared template every role's report/PDF goes through (utils/reportTemplate.js) — a module under 100% now shows an \"In Progress\" chip instead of a letter grade, in both the multi-module course report and the standalone module report, applying automatically to every role's download (teacher, student, admin, instructor, parent/general). While in this file, removed ~210 lines of dead code in adminController.js — two old grade-calculation blocks that were computed but never actually passed to the real render call, which already computed its own grade from the shared template.",
  ],
  [
    "Teacher",
    "Student progress page (teacher's \"view student\") was a cramped, 3-level-deep nested table — hard to scan, columns cut off on narrower screens",
    "Fixed (redesigned)",
    "views/teacher/sections/student-progress.ejs rebuilt with a tabbed browser (Courses/Modules/Lessons/Quizzes/Assignments) modeled on the already-shipped, more polished Instructor version of the same page — collapsible course cards, progress bars, grade circles, flat scannable lists per tab — using data the controller already fetched, no backend changes needed. Also applies the \"In Progress vs grade\" fix above at the module level.",
  ],
  [
    "Admin",
    "No way to attach an already-existing platform account to a school/classroom — only brand-new accounts could be created, so an individual learner who already had an account would need a duplicate just to join a school (e.g. an online-only program)",
    "Fixed (new feature)",
    "New adminController.searchExistingUsersForSchool / addExistingUserToSchool, with an \"Add Existing Student\"/\"Add Existing Teacher\" search-and-attach modal on the school details page, alongside the existing \"Add Student\"/\"Add Teacher\" (create-new) buttons. Uses an upsert (ON CONFLICT on user_school's existing UNIQUE(user_id, school_id)) so re-attaching someone who already has a stray/unapproved row for the school updates it instead of erroring — confirmed live against the production schema that the constraint actually exists.",
  ],
  [
    "Admin",
    "The new \"Add Existing Student\" search only matched users2.role='student', silently missing independent learners who sign up without a School ID — exactly the population the feature was built for",
    "Fixed",
    "Client-reported: searching for a known existing user returned no results. Root cause: the public signup flow only sets role='student' when a School ID was provided at signup; anyone who signs up without one keeps the generic default role='user' instead — confirmed this is already the platform's own convention, since the admin's main \"All Students\" page (/admin/students) already queries role='user'. Search now matches role IN ('student','user') for a student search (teacher search stays role='teacher' only — no equivalent self-signup-without-a-school gap exists for teachers). Verified against the live database that the fix returns the previously-missing account.",
  ],
  [
    "Admin",
    "A Platform Admin could not manage a school as its own school_admin — no multi-role accounts, no dashboard switcher; the only workaround would have been a second account/login",
    "Fixed (new feature)",
    "New \"Manage as School Admin\" action on a school's detail page sets a session flag (no change to the admin's own users2.role) and drops the admin into the real /school-admin/dashboard with full functionality; a banner with a one-click \"Exit to Platform Admin\" returns them. middlewares/auth.js's requireSchoolAdmin (the single gate on every /school-admin/* route) recognizes the flag as a second valid way in. Found and fixed 13 separate functions in schoolAdminController.js that were bypassing that gate's already-resolved school id and re-querying schools WHERE created_by = req.session.user.id themselves — which would have 404'd for an admin account and silently broken half of school-admin (add student, bulk upload, classrooms, course assignment, quotes, payments, attendance history) the moment a real admin tried it. All 13 now read the gate's resolved value instead — a pure simplification with zero behavior change for real school_admins, and the actual fix that makes acting-as work correctly everywhere, not just the dashboard's front page.",
  ],
];

// [Role, As a user I want to..., So that..., Status]
const NEW_USER_STORIES = [
  [
    "Instructor",
    "review and grade a queue of assignment submissions from students I teach, seeing the AI's suggested grade first",
    "grading is faster while I still make the final call",
    "Implemented this session",
  ],
  [
    "Instructor",
    "review External Project submissions against their rubric and deliverables, and override the AI's score",
    "real-world project work gets a fair, human-checked grade",
    "Implemented this session",
  ],
  [
    "Platform Admin",
    "attach an existing platform account to a school and classroom instead of creating a duplicate one",
    "a student or teacher who already has an account doesn't end up with two just to join a school",
    "Implemented this session",
  ],
  [
    "Platform Admin",
    "temporarily manage a school exactly as its own school admin, from my own account",
    "I can set up or troubleshoot any school — including an online-only program I run myself — without a second login",
    "Implemented this session",
  ],
];

// ---------------------------------------------------------------------
// Styling — matches the existing sheets' own conventions exactly
// ---------------------------------------------------------------------

const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2E4057" } };
const HEADER_FONT = { bold: true, color: { argb: "FFFFFFFF" } };
const DATA_FONT = { name: "Calibri", family: 2, scheme: "minor", size: 11, color: { theme: 1 } };
const DATA_ALIGN = { vertical: "top", wrapText: true };

const STATUS_COLORS = {
  Fixed: { font: { bold: true, color: { argb: "FF006100" } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFC6EFCE" } } },
  Pending: { font: { bold: true, color: { argb: "FF9C0006" } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFC7CE" } } },
  "Out of scope": { font: { bold: true, color: { argb: "FF666666" } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9D9D9" } } },
};

function styleDataRow(row, { statusCol } = {}) {
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = DATA_FONT;
    cell.alignment = DATA_ALIGN;
  });
  if (statusCol) {
    const statusCell = row.getCell(statusCol);
    const special = STATUS_COLORS[statusCell.value];
    if (special) {
      statusCell.font = special.font;
      statusCell.fill = special.fill;
    }
  }
}

// "Done"-ish classification per sheet, for the Summary recount below —
// each sheet uses its own status vocabulary, so this is intentionally
// per-sheet rather than one shared regex.
function isDoneStatus(sheetName, status) {
  const s = String(status || "");
  if (sheetName === "Known Issues & Fixes") return /^fixed/i.test(s);
  if (sheetName === "Pending Initiatives") return s === "Done";
  if (sheetName === "User Stories by Role") return /^implemented/i.test(s);
  return false;
}

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE_PATH);

  const issuesWs = wb.getWorksheet("Known Issues & Fixes");
  NEW_KNOWN_ISSUES.forEach((r) => {
    const row = issuesWs.addRow(r);
    styleDataRow(row, { statusCol: 3 });
  });

  const storiesWs = wb.getWorksheet("User Stories by Role");
  NEW_USER_STORIES.forEach((r) => {
    const row = storiesWs.addRow(r);
    styleDataRow(row, { statusCol: 4 });
  });

  // ---------------- Recompute Summary from live sheet data ----------------
  const summaryWs = wb.getWorksheet("Summary");
  const sheetConfigs = [
    { label: "Known Issues & Fixes", ws: issuesWs, statusCol: 3 },
    { label: "Pending Initiatives", ws: wb.getWorksheet("Pending Initiatives"), statusCol: 3 },
    { label: "User Stories by Role", ws: storiesWs, statusCol: 4 },
  ];

  const counts = sheetConfigs.map(({ label, ws, statusCol }) => {
    let done = 0;
    let total = 0;
    for (let r = 2; r <= ws.rowCount; r++) {
      const status = ws.getCell(r, statusCol).value;
      if (status === null || status === undefined || status === "") continue;
      total++;
      if (isDoneStatus(label, status)) done++;
    }
    return { label, done, partial: total - done, total };
  });

  summaryWs.getCell("A2").value = `Generated ${TODAY}`;

  // Summary data rows are fixed at rows 5-7 (one per sheetConfigs entry,
  // same order), row 9 is the Overall total — matches the existing
  // layout exactly, just recomputed instead of hand-typed.
  counts.forEach((c, i) => {
    const r = 5 + i;
    summaryWs.getCell(r, 1).value = c.label;
    summaryWs.getCell(r, 2).value = c.done;
    summaryWs.getCell(r, 3).value = c.partial;
    summaryWs.getCell(r, 4).value = c.total;
  });

  const overall = counts.reduce(
    (acc, c) => ({ done: acc.done + c.done, partial: acc.partial + c.partial, total: acc.total + c.total }),
    { done: 0, partial: 0, total: 0 }
  );
  summaryWs.getCell("A9").value = "Overall";
  summaryWs.getCell("B9").value = overall.done;
  summaryWs.getCell("C9").value = overall.partial;
  summaryWs.getCell("D9").value = overall.total;

  await wb.xlsx.writeFile(FILE_PATH);
  console.log(
    "Wrote",
    FILE_PATH,
    `(+${NEW_KNOWN_ISSUES.length} known-issue rows, +${NEW_USER_STORIES.length} user-story rows; overall ${overall.done}/${overall.total} done)`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
