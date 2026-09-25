require("dotenv").config();
const pool = require("./models/db");
const bcrypt = require("bcrypt");
const axios = require("axios");
const puppeteer = require("puppeteer");

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
  return setCookie ? setCookie.map((c) => c.split(";")[0].split("=")).map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })) : [];
}

(async () => {
  let browser;
  try {
    const pwdHash = await bcrypt.hash("Test1234!", 10);

    const adminIns = await pool.query(
      `INSERT INTO users2 (fullname, email, password, role) VALUES ('__Test ATB Admin__','__test_atb_admin__@example.com',$1,'admin') RETURNING id`,
      [pwdHash]
    );
    ids.adminId = adminIns.rows[0].id;

    const schoolIns = await pool.query(
      `INSERT INTO schools (school_id, name, created_by) VALUES ('SCH-ATB-TEST', '__Test ATB School__', $1) RETURNING id`,
      [ids.adminId]
    );
    ids.schoolId = schoolIns.rows[0].id;

    const termIns = await pool.query(
      `INSERT INTO academic_terms (school_id, name, start_date, end_date, is_active) VALUES ($1,'__ATB Term__','2025-01-01','2025-12-31',true) RETURNING id`,
      [ids.schoolId]
    );
    ids.termId = termIns.rows[0].id;

    const classroomIns = await pool.query(
      `INSERT INTO classrooms (school_id, name) VALUES ($1, '__ATB Classroom__') RETURNING id`,
      [ids.schoolId]
    );
    ids.classroomId = classroomIns.rows[0].id;

    const studentIns = await pool.query(
      `INSERT INTO users2 (fullname, email, password, role) VALUES ('__ATB Student__','__test_atb_student__@example.com',$1,'student') RETURNING id`,
      [pwdHash]
    );
    ids.studentId = studentIns.rows[0].id;
    await pool.query(
      `INSERT INTO user_school (user_id, school_id, classroom_id, role_in_school, approved, is_active) VALUES ($1,$2,$3,'student',true,true)`,
      [ids.studentId, ids.schoolId, ids.classroomId]
    );

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

    const cookies = await login("__test_atb_admin__@example.com", "Test1234!");
    assert(cookies.length > 0, "admin login ok, got cookies");

    browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await page.setCookie(...cookies);

    const consoleErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push("pageerror: " + err.message));

    await page.goto(`${BASE}/admin/schools/${ids.schoolId}`, { waitUntil: "networkidle0", timeout: 20000 });

    // Click the Attendance tab (find the button by its text)
    const clicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll(".login-tab, .tab-btn"));
      const btn = btns.find((b) => b.textContent.includes("Attendance"));
      if (!btn) return false;
      btn.click();
      return true;
    });
    assert(clicked, "found and clicked the Attendance tab button");

    // Give the async fetches + Chart.js render a moment
    await new Promise((r) => setTimeout(r, 1500));

    const tbodyHtml = await page.$eval("#attendanceTableBody", (el) => el.innerHTML);
    console.log("attendanceTableBody HTML:\n" + tbodyHtml);
    assert(tbodyHtml.includes("__ATB Classroom__"), "attendance table body shows our test session's classroom");
    assert(!tbodyHtml.includes("No data yet"), "attendance table no longer stuck on the static 'No data yet' placeholder");

    const summaryHtml = await page.$eval("#attendanceSummary", (el) => el.innerHTML);
    console.log("attendanceSummary HTML:\n" + summaryHtml);
    assert(summaryHtml.includes("Average Attendance"), "attendance summary shows the average-attendance text");
    assert(summaryHtml.includes("100.0%"), "attendance summary computed 100% for our 1/1 present session");

    const canvasExists = await page.$eval("#attendanceChart", (el) => !!el);
    assert(canvasExists, "attendance chart canvas element exists");

    // Chart.js renders onto the canvas via its internal Chart registry —
    // check window.Chart is actually defined (would be undefined if the
    // CDN script failed to load) and that a chart instance was attached.
    const chartDefined = await page.evaluate(() => typeof window.Chart !== "undefined");
    assert(chartDefined, "window.Chart is defined (Chart.js script loaded successfully)");

    const hasChartInstance = await page.evaluate(() => {
      const canvas = document.getElementById("attendanceChart");
      return !!(window.Chart && window.Chart.getChart && window.Chart.getChart(canvas));
    });
    assert(hasChartInstance, "a Chart.js instance is bound to the canvas (chart actually rendered, not just present)");

    console.log("\nconsole/page errors captured:", JSON.stringify(consoleErrors, null, 2));
    assert(consoleErrors.length === 0, "no browser console/page errors during Attendance tab load (" + consoleErrors.length + " found)");

    console.log("\nALL BROWSER SMOKE TESTS PASSED");
  } catch (err) {
    console.error("TEST FAILED:", err.message);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
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
