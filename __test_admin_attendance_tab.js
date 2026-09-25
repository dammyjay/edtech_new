require("dotenv").config();
const pool = require("./models/db");
const bcrypt = require("bcrypt");
const axios = require("axios");

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
      `INSERT INTO users2 (fullname, email, password, role) VALUES ('__Test AT Admin__','__test_at_admin__@example.com',$1,'admin') RETURNING id`,
      [pwdHash]
    );
    ids.adminId = adminIns.rows[0].id;

    const schoolIns = await pool.query(
      `INSERT INTO schools (school_id, name, created_by) VALUES ('SCH-AT-TEST', '__Test AT School__', $1) RETURNING id`,
      [ids.adminId]
    );
    ids.schoolId = schoolIns.rows[0].id;

    const termIns = await pool.query(
      `INSERT INTO academic_terms (school_id, name, start_date, end_date, is_active) VALUES ($1,'__AT Term__','2025-01-01','2025-12-31',true) RETURNING id`,
      [ids.schoolId]
    );
    ids.termId = termIns.rows[0].id;

    const classroomIns = await pool.query(
      `INSERT INTO classrooms (school_id, name) VALUES ($1, '__AT Classroom__') RETURNING id`,
      [ids.schoolId]
    );
    ids.classroomId = classroomIns.rows[0].id;

    const studentIns = await pool.query(
      `INSERT INTO users2 (fullname, email, password, role) VALUES ('__AT Student__','__test_at_student__@example.com',$1,'student') RETURNING id`,
      [pwdHash]
    );
    ids.studentId = studentIns.rows[0].id;
    await pool.query(
      `INSERT INTO user_school (user_id, school_id, classroom_id, role_in_school, approved, is_active) VALUES ($1,$2,$3,'student',true,true)`,
      [ids.studentId, ids.schoolId, ids.classroomId]
    );

    // An actual attendance session + record, so history has something real to return
    const sessionIns = await pool.query(
      `INSERT INTO attendance_sessions (school_id, term_id, classroom_id, taken_by, session_status, date, week_number)
       VALUES ($1,$2,$3,$4,'held','2025-03-01',9) RETURNING id`,
      [ids.schoolId, ids.termId, ids.classroomId, ids.adminId]
    );
    ids.sessionId = sessionIns.rows[0].id;
    await pool.query(
      `INSERT INTO attendance_records (session_id, student_id, status) VALUES ($1,$2,'present')`,
      [ids.sessionId, ids.studentId]
    );

    console.log("SETUP_OK", JSON.stringify(ids));

    const cookie = await login("__test_at_admin__@example.com", "Test1234!");
    assert(cookie, "admin login ok");

    // 1. Load the school-details page, inspect the raw Attendance tab markup
    const pageRes = await axios.get(`${BASE}/admin/schools/${ids.schoolId}`, { headers: { Cookie: cookie }, validateStatus: () => true });
    assert(pageRes.status === 200, "school-details page loaded (status " + pageRes.status + ")");
    const html = pageRes.data;

    assert(html.includes('id="attendance-section"'), "page includes the attendance-section div");
    assert(html.includes('id="attendanceFilterTerm"'), "page includes the term filter select");
    assert(html.includes('cdn.jsdelivr.net/npm/chart.js'), "page now includes the Chart.js script tag");
    assert(html.includes('function refreshAttendanceTab()'), "page includes the new refreshAttendanceTab() helper");
    assert(html.includes('attendanceTabLoaded'), "page auto-loads the Attendance tab the first time it's opened");
    assert(html.includes('onclick="refreshAttendanceTab()"'), "View History / Filter buttons call refreshAttendanceTab()");

    const termOptMatch = html.match(/<select id="attendanceFilterTerm">([\s\S]*?)<\/select>/);
    assert(!!termOptMatch, "term filter select block found");
    console.log("--- attendanceFilterTerm options ---\n" + (termOptMatch ? termOptMatch[1].trim() : "(none)") + "\n---");
    assert(termOptMatch[1].includes(String(ids.termId)), "term filter select includes our test term's id");

    const classroomOptMatch = html.match(/<select id="attendanceFilterClassroom">([\s\S]*?)<\/select>/);
    console.log("--- attendanceFilterClassroom options ---\n" + (classroomOptMatch ? classroomOptMatch[1].trim() : "(none)") + "\n---");

    // 2. Call the attendance history endpoint exactly as the client-side loadAttendanceHistory() does
    const historyRes = await axios.get(`${BASE}/admin/attendance/history?term_id=${ids.termId}&classroom_id=`, { headers: { Cookie: cookie }, validateStatus: () => true });
    console.log("history status:", historyRes.status, "content-type:", historyRes.headers["content-type"]);
    console.log("history body:", JSON.stringify(historyRes.data).slice(0, 500));
    assert(historyRes.status === 200, "attendance history endpoint returns 200");
    assert(Array.isArray(historyRes.data), "attendance history endpoint returns a JSON array");
    assert(historyRes.data.length === 1, "attendance history returns our test session");
    assert(historyRes.data[0].classroom === "__AT Classroom__", "history row has the right classroom name");
    assert(historyRes.data[0].student_count == 1, "history row has student_count of 1");

    // 3. Same call but WITH a classroom_id filter (the "Filter" button's other case)
    const historyRes2 = await axios.get(`${BASE}/admin/attendance/history?term_id=${ids.termId}&classroom_id=${ids.classroomId}`, { headers: { Cookie: cookie }, validateStatus: () => true });
    assert(historyRes2.status === 200, "attendance history with classroom filter returns 200");
    assert(historyRes2.data.length === 1, "attendance history with classroom filter returns our test session");

    // 4. THE ROOT-CAUSE BUG: a blank term_id (e.g. a school with zero terms,
    // whose <select> then has no options and reports value="") used to 500
    // with plain text, which the client's `await res.json()` then choked on
    // — an uncaught rejection that silently broke the whole tab. Must now
    // resolve gracefully as an empty JSON array.
    const historyResBlank = await axios.get(`${BASE}/admin/attendance/history?term_id=&classroom_id=`, { headers: { Cookie: cookie }, validateStatus: () => true });
    assert(historyResBlank.status === 200, "blank term_id: attendance history now returns 200 (was 500)");
    assert(Array.isArray(historyResBlank.data) && historyResBlank.data.length === 0, "blank term_id: attendance history returns an empty array");

    const statsResBlank = await axios.get(`${BASE}/admin/attendance/stats/weekly?term_id=`, { headers: { Cookie: cookie }, validateStatus: () => true });
    assert(statsResBlank.status === 200, "blank term_id: weekly stats now returns 200 (was 500)");
    assert(Array.isArray(statsResBlank.data) && statsResBlank.data.length === 0, "blank term_id: weekly stats returns an empty array");

    // 5. loadStudentsForAttendance()'s endpoint (Take Attendance modal)
    const studentsRes = await axios.get(`${BASE}/admin/attendance/students?term_id=${ids.termId}&classroom_id=${ids.classroomId}`, { headers: { Cookie: cookie }, validateStatus: () => true });
    console.log("attendance/students status:", studentsRes.status, "body:", JSON.stringify(studentsRes.data).slice(0, 500));

    // 6. weekly stats (chart) endpoint
    const statsRes = await axios.get(`${BASE}/admin/attendance/stats/weekly?term_id=${ids.termId}`, { headers: { Cookie: cookie }, validateStatus: () => true });
    assert(statsRes.status === 200, "weekly stats returns 200 for a real term");
    assert(statsRes.data.length === 1 && statsRes.data[0].week_number === 9, "weekly stats returns our test session's week");
    assert(Number(statsRes.data[0].attendance_percent) === 100, "weekly stats computes 100% attendance for our 1 present/1 total session");

    console.log("\nDONE INVESTIGATING");
  } catch (err) {
    console.error("TEST FAILED:", err.message);
    if (err.response) {
      console.error("status:", err.response.status);
      console.error("data:", typeof err.response.data === "string" ? err.response.data.slice(0, 1500) : err.response.data);
    }
    process.exitCode = 1;
  } finally {
    try {
      if (ids.sessionId) await pool.query("DELETE FROM attendance_records WHERE session_id=$1", [ids.sessionId]);
      if (ids.sessionId) await pool.query("DELETE FROM attendance_sessions WHERE id=$1", [ids.sessionId]);
      if (ids.studentId) await pool.query("DELETE FROM user_school WHERE user_id=$1", [ids.studentId]);
      if (ids.studentId) await pool.query("DELETE FROM users2 WHERE id=$1", [ids.studentId]);
      if (ids.classroomId) await pool.query("DELETE FROM classrooms WHERE id=$1", [ids.classroomId]);
      if (ids.termId) await pool.query("DELETE FROM quotes WHERE term_id=$1", [ids.termId]);
      if (ids.termId) await pool.query("DELETE FROM academic_terms WHERE id=$1", [ids.termId]);
      if (ids.schoolId) await pool.query("DELETE FROM schools WHERE id=$1", [ids.schoolId]);
      if (ids.adminId) await pool.query("DELETE FROM users2 WHERE id=$1", [ids.adminId]);
      console.log("DB cleanup done.");
    } catch (cleanupErr) {
      console.error("Cleanup error:", cleanupErr.message);
    }
    await pool.end();
  }
})();
