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
// New rows for this revision — NOTE: each run appends whatever's in
// these two arrays, so after a successful run, replace their contents
// with the NEXT revision's rows rather than accumulating old ones here
// (the previous batch is already persisted in the .xlsx itself).
// ---------------------------------------------------------------------

// [Area, Item, Status, Notes]
const NEW_KNOWN_ISSUES = [
  [
    "Admin — Act as School Admin",
    "A stale per-session term filter silently carried over between schools — a Platform Admin acting as School A's admin, then switching to School B, kept seeing School B's dashboard filtered by School A's leftover term selection, showing 0 students/0 teachers on a school with real ones",
    "Fixed",
    "Root cause: schoolAdminController.js's whole-panel term filter was a single flat req.session.selectedTermId — correct for a real school_admin (always exactly one school), but not for the new acting-as feature, where one session can now visit multiple schools' dashboards in a row. A term id picked for one school silently kept filtering a completely different school's queries once the admin switched, with no re-scoping on school change. Fixed by keying the stored term selection by school id (req.session.selectedTermIdBySchool[schoolId]) instead of one flat session value.",
  ],
  [
    "Student",
    "An account attached to a school/classroom via the admin's \"Add Existing Student\" tool (users2.role stays 'user', never changes to 'student') never actually appeared as school-linked on its own dashboard — no classroom, no classmates, no teacher, no classroom-assigned courses",
    "Fixed",
    "Root cause: studentController.js's main dashboard decided \"show classroom/classmates/teacher\" based on the session's static role==='student' check, not on whether a real user_school record actually exists — the exact role='user' vs role='student' landmine already flagged elsewhere in this register. A self-registered student always gets both together at signup, so this was invisible until an account could legitimately be attached to a school AFTER already existing as a plain 'user'. Replaced the check with a genuine user_school lookup (isSchoolLinked) in all 4 places the dashboard branched on it.",
  ],
  [
    "Admin — Add Existing Student",
    "Attaching an existing student with real course_enrollments to a fresh classroom made their in-progress courses disappear from their own dashboard, and the school showed \"no courses assigned\" even though the classroom had the right student in it",
    "Fixed",
    "Two-part gap, found immediately after fixing the role='user' dashboard issue above (fixing that one exposed this one): a newly-created classroom has zero classroom_courses by default, and the dashboard's school-linked branch only ever shows classroom-assigned courses, never a student's own course_enrollments — so an existing student's real progress would vanish the moment they were correctly recognized as school-linked. Separately, classroom_courses alone isn't sufficient for a course to count as \"offered by the school\" at all — school_courses, a distinct school-level authorization table, is what the admin's \"Courses Assigned to This School\" panel and the school-admin's own course picker read, and nothing populated that either. addExistingUserToSchool now mirrors a newly-attached student's course_enrollments into both classroom_courses and school_courses (term_id NULL = authorized regardless of term). Backfilled the same way in models/initTables.js for classrooms already created via this tool, scoped narrowly to the classroom-per-private-student pattern (exactly one approved student) so it never touches a group classroom or one an admin has already deliberately curated. Verified the backfill query against the live database (read-only) before shipping it.",
  ],
];

// [Role, As a user I want to..., So that..., Status]
const NEW_USER_STORIES = [];

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
