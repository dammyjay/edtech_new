require("dotenv").config();
const pool = require("./models/db");
const bcrypt = require("bcrypt");
const axios = require("axios");
const ExcelJS = require("exceljs");

const BASE = "http://localhost:3098";
const ids = {};

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERTION FAILED: " + msg);
  console.log("OK:", msg);
}

async function login(email, password) {
  const res = await axios.post(
    `${BASE}/admin/login`,
    new URLSearchParams({ email, password }).toString(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" }, maxRedirects: 0, validateStatus: () => true }
  );
  const setCookie = res.headers["set-cookie"];
  return setCookie ? setCookie.map((c) => c.split(";")[0]).join("; ") : null;
}

(async () => {
  try {
    const pwdHash = await bcrypt.hash("Test1234!", 10);

    const adminIns = await pool.query(
      `INSERT INTO users2 (fullname, email, password, role) VALUES ('__Test EX SchoolAdmin__','__test_ex_schooladmin__@example.com',$1,'school_admin') RETURNING id`,
      [pwdHash]
    );
    ids.schoolAdminId = adminIns.rows[0].id;

    const schoolIns = await pool.query(
      `INSERT INTO schools (school_id, name, created_by) VALUES ('SCH-EX-TEST', '__Test EX School__', $1) RETURNING id`,
      [ids.schoolAdminId]
    );
    ids.schoolId = schoolIns.rows[0].id;

    const termIns = await pool.query(
      `INSERT INTO academic_terms (school_id, name, start_date, end_date, is_active) VALUES ($1,'__EX Term__','2025-01-01','2025-06-30',true) RETURNING id`,
      [ids.schoolId]
    );
    ids.termId = termIns.rows[0].id;

    const classroomIns = await pool.query(
      `INSERT INTO classrooms (school_id, name) VALUES ($1, '__EX Classroom__') RETURNING id`,
      [ids.schoolId]
    );
    ids.classroomId = classroomIns.rows[0].id;

    const studentIns = await pool.query(
      `INSERT INTO users2 (fullname, email, password, role, gender) VALUES ('__EX Student One__','__test_ex_student_one__@example.com',$1,'student','Female') RETURNING id`,
      [pwdHash]
    );
    ids.studentId = studentIns.rows[0].id;
    await pool.query(
      `INSERT INTO user_school (user_id, school_id, classroom_id, role_in_school, approved, is_active) VALUES ($1,$2,$3,'student',true,true)`,
      [ids.studentId, ids.schoolId, ids.classroomId]
    );
    await pool.query(
      `INSERT INTO student_term_enrollments (student_id, school_id, term_id, classroom_id) VALUES ($1,$2,$3,$4)`,
      [ids.studentId, ids.schoolId, ids.termId, ids.classroomId]
    );

    console.log("SETUP_OK", JSON.stringify(ids));

    const cookie = await login("__test_ex_schooladmin__@example.com", "Test1234!");
    assert(cookie, "school admin login ok");

    // 1. Spinner wiring — the loadSection() function shown to the browser
    // must inject the spinner markup before fetching a section.
    const dashRes = await axios.get(`${BASE}/school-admin/dashboard`, { headers: { Cookie: cookie } });
    assert(dashRes.status === 200, "dashboard loaded");
    assert(dashRes.data.includes("sa-section-loading"), "loadSection() page includes the sa-section-loading spinner container");
    assert(dashRes.data.includes("sa-spinner"), "loadSection() page includes the sa-spinner element");
    assert(/loadSection\(section\)\s*{\s*currentSection = section;\s*document\.getElementById\("dashboard-content"\)\.innerHTML =\s*\n?\s*'<div class="sa-section-loading">/.test(dashRes.data), "loadSection() sets the spinner markup BEFORE the fetch call");

    // 2. Excel export — download, parse with ExcelJS, check branding/content.
    const exportRes = await axios.get(`${BASE}/school-admin/terms/${ids.termId}/export`, {
      headers: { Cookie: cookie },
      responseType: "arraybuffer",
      validateStatus: () => true,
    });
    assert(exportRes.status === 200, "excel export responded 200");
    assert(
      exportRes.headers["content-type"].includes("spreadsheetml"),
      "excel export has correct content-type"
    );
    assert(exportRes.data.length > 3000, "excel export is a real, non-trivial file (" + exportRes.data.length + " bytes)");

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exportRes.data);
    const sheet = workbook.getWorksheet("Students");
    assert(!!sheet, "workbook has a 'Students' sheet");

    const titleCell = sheet.getCell("B2");
    assert(titleCell.value.includes("__Test EX School__"), "title row includes the school name");
    assert(titleCell.value.includes("Student Term Report"), "title row includes 'Student Term Report'");
    assert(titleCell.font.color.argb === "FFA17807", "title uses the brand gold color (#A17807)");

    const subtitleCell = sheet.getCell("B3");
    assert(subtitleCell.value.includes("__EX Term__"), "subtitle row includes the term name");
    assert(subtitleCell.value.includes("1 student"), "subtitle row includes the student count");

    const headerCell = sheet.getCell("A6");
    assert(headerCell.value === "Full Name", "header row (row 6) starts with 'Full Name'");
    assert(headerCell.font.color.argb === "FFA17807", "header text is gold");
    assert(headerCell.fill.fgColor.argb === "FF1A1A1A", "header fill is black, matching curriculum PDF styling");

    const dataCell = sheet.getCell("A7");
    assert(dataCell.value === "__EX Student One__", "first data row has the student's name");
    const emailCell = sheet.getCell("B7");
    assert(emailCell.value === "__test_ex_student_one__@example.com", "first data row has the student's email");
    const classroomCell = sheet.getCell("D7");
    assert(classroomCell.value === "__EX Classroom__", "first data row has the classroom name");

    assert(!!sheet.autoFilter, "sheet has an autofilter applied");

    console.log("\nALL EXPORT + SPINNER TESTS PASSED");
  } catch (err) {
    console.error("TEST FAILED:", err.message);
    if (err.response) {
      console.error("status:", err.response.status);
    }
    process.exitCode = 1;
  } finally {
    try {
      if (ids.studentId) await pool.query("DELETE FROM student_term_enrollments WHERE student_id=$1", [ids.studentId]);
      if (ids.studentId) await pool.query("DELETE FROM user_school WHERE user_id=$1", [ids.studentId]);
      if (ids.studentId) await pool.query("DELETE FROM users2 WHERE id=$1", [ids.studentId]);
      if (ids.classroomId) await pool.query("DELETE FROM classrooms WHERE id=$1", [ids.classroomId]);
      if (ids.termId) await pool.query("DELETE FROM academic_terms WHERE id=$1", [ids.termId]);
      if (ids.schoolId) await pool.query("DELETE FROM schools WHERE id=$1", [ids.schoolId]);
      if (ids.schoolAdminId) await pool.query("DELETE FROM users2 WHERE id=$1", [ids.schoolAdminId]);
      console.log("DB cleanup done.");
    } catch (cleanupErr) {
      console.error("Cleanup error:", cleanupErr.message);
    }
    await pool.end();
  }
})();
