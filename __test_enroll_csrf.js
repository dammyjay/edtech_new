require("dotenv").config();
const pool = require("./models/db");
const bcrypt = require("bcrypt");
const axios = require("axios");

const BASE = "http://127.0.0.1:3098";
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

    const studentIns = await pool.query(
      `INSERT INTO users2 (fullname, email, password, role, wallet_balance2) VALUES ('__Test EC Student__','__test_ec_student__@example.com',$1,'student',0) RETURNING id`,
      [pwdHash]
    );
    ids.studentId = studentIns.rows[0].id;

    const courseIns = await pool.query(
      `INSERT INTO courses (title, level, amount) VALUES ('__EC Test Course__','Beginner',0) RETURNING id`
    );
    ids.courseId = courseIns.rows[0].id;

    console.log("SETUP_OK", JSON.stringify(ids));

    const cookie = await login("__test_ec_student__@example.com", "Test1234!");
    assert(cookie, "student login ok");

    // 1. Load the PUBLIC course details page (as the "Enroll" button's page) —
    // this is the exact page the student sees and clicks Enroll from.
    const pageRes = await axios.get(`${BASE}/courses/${ids.courseId}`, { headers: { Cookie: cookie }, validateStatus: () => true });
    assert(pageRes.status === 200, "course details page loaded");

    const metaMatch = pageRes.data.match(/<meta name="csrf-token" content="([^"]*)">/);
    assert(!!metaMatch, "csrf-token meta tag found on the course details page");
    const tokenOnPage = metaMatch[1];
    console.log("csrf-token rendered on /courses/:id page ->", JSON.stringify(tokenOnPage));

    assert(pageRes.data.includes(`/student/courses/enroll/${ids.courseId}`), "page includes the Enroll form action");

    assert(tokenOnPage && tokenOnPage.length > 10, "csrf-token meta tag now carries a real (non-blank) token");

    // 2. Submit the enroll form EXACTLY as the browser would: a plain
    // application/x-www-form-urlencoded POST with _csrf set to whatever
    // token was actually embedded in the page (simulating public/js/csrf.js's
    // auto-injected hidden field).
    const enrollRes = await axios.post(
      `${BASE}/student/courses/enroll/${ids.courseId}`,
      new URLSearchParams({ _csrf: tokenOnPage }).toString(),
      { headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" }, maxRedirects: 0, validateStatus: () => true }
    );
    console.log("enroll (page token) status:", enrollRes.status, "location:", enrollRes.headers.location, "body:", typeof enrollRes.data === "string" ? enrollRes.data.slice(0, 200) : enrollRes.data);

    assert(enrollRes.status === 302, "enroll form submit succeeds (302 redirect, not 403)");
    assert(decodeURIComponent(enrollRes.headers.location).includes("Enrollment successful"), "redirect carries the success message");

    const enrollCheck = await pool.query("SELECT * FROM course_enrollments WHERE user_id=$1 AND course_id=$2", [ids.studentId, ids.courseId]);
    assert(enrollCheck.rows.length === 1, "course_enrollments row was actually created");

    // 3. /student/dashboard for a school-linked "student" role only shows
    // classroom-assigned courses (classroom_courses), not standalone
    // course_enrollments ones — that's a SEPARATE branch entirely (see
    // studentController.js's role==="student" vs role==="user"/
    // "individual_student" split). So a plain "student" role account's
    // dashboard is NOT expected to show this. Just confirm it still loads
    // without error post-enroll.
    const dashRes = await axios.get(`${BASE}/student/dashboard`, { headers: { Cookie: cookie }, validateStatus: () => true, timeout: 30000 });
    assert(dashRes.status === 200, "student dashboard loads after enrolling (no crash)");

    // 4. Confirm it shows up on /student/courses ("My Courses") — this page
    // is role-agnostic (always queries course_enrollments directly), and is
    // exactly where the enroll redirect sends the user.
    const coursesRes = await axios.get(`${BASE}/student/courses`, { headers: { Cookie: cookie }, validateStatus: () => true, timeout: 30000 });
    assert(coursesRes.status === 200, "/student/courses loads after enrolling");
    assert(coursesRes.data.includes("__EC Test Course__"), "newly-enrolled course also appears on /student/courses");

    // 5. Re-visit the course page — should now show "Already Enrolled"
    // instead of the Enroll form.
    const revisitRes = await axios.get(`${BASE}/courses/${ids.courseId}`, { headers: { Cookie: cookie }, validateStatus: () => true });
    assert(revisitRes.data.includes("Already Enrolled"), "course details page now shows 'Already Enrolled'");

    console.log("\nALL ENROLL FLOW TESTS PASSED");
  } catch (err) {
    console.error("TEST FAILED:", err.message);
    if (err.response) {
      console.error("status:", err.response.status);
      console.error("data:", typeof err.response.data === "string" ? err.response.data.slice(0, 1000) : err.response.data);
    }
    process.exitCode = 1;
  } finally {
    try {
      if (ids.studentId) await pool.query("DELETE FROM course_enrollments WHERE user_id=$1", [ids.studentId]);
      if (ids.studentId) await pool.query("DELETE FROM wallet_transactions WHERE user_id=$1", [ids.studentId]);
      if (ids.studentId) await pool.query("DELETE FROM users2 WHERE id=$1", [ids.studentId]);
      if (ids.courseId) await pool.query("DELETE FROM courses WHERE id=$1", [ids.courseId]);
      console.log("DB cleanup done.");
    } catch (cleanupErr) {
      console.error("Cleanup error:", cleanupErr.message);
    }
    await pool.end();
  }
})();
