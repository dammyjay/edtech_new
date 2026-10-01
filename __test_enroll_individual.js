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
      `INSERT INTO users2 (fullname, email, password, role, wallet_balance2) VALUES ('__Test EI Student__','__test_ei_student__@example.com',$1,'individual_student',0) RETURNING id`,
      [pwdHash]
    );
    ids.studentId = studentIns.rows[0].id;

    // No career_pathway_id — exercises the LEFT JOIN fix in getDashboard's
    // role==="user"/"individual_student" branch.
    const courseIns = await pool.query(
      `INSERT INTO courses (title, level, amount) VALUES ('__EI Test Course (no pathway)__','Beginner',0) RETURNING id`
    );
    ids.courseId = courseIns.rows[0].id;

    console.log("SETUP_OK", JSON.stringify(ids));

    const cookie = await login("__test_ei_student__@example.com", "Test1234!");
    assert(cookie, "individual_student login ok");

    const pageRes = await axios.get(`${BASE}/courses/${ids.courseId}`, { headers: { Cookie: cookie } });
    const tokenOnPage = pageRes.data.match(/<meta name="csrf-token" content="([^"]*)">/)[1];
    assert(tokenOnPage && tokenOnPage.length > 10, "real csrf token present");

    const enrollRes = await axios.post(
      `${BASE}/student/courses/enroll/${ids.courseId}`,
      new URLSearchParams({ _csrf: tokenOnPage }).toString(),
      { headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" }, maxRedirects: 0, validateStatus: () => true }
    );
    assert(enrollRes.status === 302, "enroll succeeds (302)");

    // For role==="user"/"individual_student", the MAIN dashboard itself is
    // the course_enrollments-based view — this is where the LEFT JOIN fix
    // (studentController.js line ~279) directly matters.
    const dashRes = await axios.get(`${BASE}/student/dashboard`, { headers: { Cookie: cookie }, validateStatus: () => true });
    assert(dashRes.status === 200, "dashboard loads");
    assert(dashRes.data.includes("__EI Test Course (no pathway)__"), "newly-enrolled course (no career pathway) appears on the individual_student's dashboard");

    console.log("\nALL INDIVIDUAL STUDENT ENROLL TESTS PASSED");
  } catch (err) {
    console.error("TEST FAILED:", err.message);
    if (err.response) console.error("status:", err.response.status);
    process.exitCode = 1;
  } finally {
    try {
      if (ids.studentId) await pool.query("DELETE FROM course_enrollments WHERE user_id=$1", [ids.studentId]);
      if (ids.studentId) await pool.query("DELETE FROM users2 WHERE id=$1", [ids.studentId]);
      if (ids.courseId) await pool.query("DELETE FROM courses WHERE id=$1", [ids.courseId]);
      console.log("DB cleanup done.");
    } catch (cleanupErr) {
      console.error("Cleanup error:", cleanupErr.message);
    }
    await pool.end();
  }
})();
