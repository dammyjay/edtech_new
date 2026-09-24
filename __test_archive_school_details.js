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
      `INSERT INTO users2 (fullname, email, password, role) VALUES ('__Test SD Admin__','__test_sd_admin__@example.com',$1,'admin') RETURNING id`,
      [pwdHash]
    );
    ids.adminId = adminIns.rows[0].id;

    const schoolIns = await pool.query(
      `INSERT INTO schools (school_id, name, created_by) VALUES ('SCH-SD-TEST', '__Test Anatole School__', $1) RETURNING id`,
      [ids.adminId]
    );
    ids.schoolId = schoolIns.rows[0].id;

    const studentIns = await pool.query(
      `INSERT INTO users2 (fullname, email, password, role) VALUES ('__Test SD Student__','__test_sd_student__@example.com',$1,'user') RETURNING id`,
      [pwdHash]
    );
    ids.studentId = studentIns.rows[0].id;
    await pool.query(
      `INSERT INTO user_school (user_id, school_id, role_in_school, approved, is_active) VALUES ($1,$2,'student',true,true)`,
      [ids.studentId, ids.schoolId]
    );

    const teacherIns = await pool.query(
      `INSERT INTO users2 (fullname, email, password, role) VALUES ('__Test SD Teacher__','__test_sd_teacher__@example.com',$1,'teacher') RETURNING id`,
      [pwdHash]
    );
    ids.teacherId = teacherIns.rows[0].id;
    await pool.query(
      `INSERT INTO user_school (user_id, school_id, role_in_school, approved, is_active) VALUES ($1,$2,'teacher',true,true)`,
      [ids.teacherId, ids.schoolId]
    );

    console.log("SETUP_OK", JSON.stringify(ids));

    const cookie = await login("__test_sd_admin__@example.com", "Test1234!");
    assert(cookie, "admin login ok");

    // BEFORE archiving: both show on the school-details page
    let page = await axios.get(`${BASE}/admin/schools/${ids.schoolId}`, { headers: { Cookie: cookie } });
    assert(page.data.includes("__Test SD Student__"), "student shows on school-details BEFORE archiving");
    assert(page.data.includes("__Test SD Teacher__"), "teacher shows on school-details BEFORE archiving");

    // Archive both directly (the archive HTTP flow itself was already tested in __test_archive_feature.js)
    await pool.query("UPDATE users2 SET archived_at = NOW() WHERE id = ANY($1)", [[ids.studentId, ids.teacherId]]);

    // AFTER archiving: the exact bug reported — must NOT show anymore
    page = await axios.get(`${BASE}/admin/schools/${ids.schoolId}`, { headers: { Cookie: cookie } });
    assert(!page.data.includes("__Test SD Student__"), "student NO LONGER shows on school-details after archiving (THE REPORTED BUG)");
    assert(!page.data.includes("__Test SD Teacher__"), "teacher NO LONGER shows on school-details after archiving");

    // Spot-check a couple of the other newly-fixed surfaces
    const excelRes = await axios.get(`${BASE}/admin/schools/${ids.schoolId}/export-students-excel`, {
      headers: { Cookie: cookie },
      responseType: "arraybuffer",
      validateStatus: () => true,
    });
    assert(excelRes.status === 200, "students Excel export still loads after archiving (can't easily assert content, just no crash)");

    console.log("\nALL SCHOOL-DETAILS REGRESSION TESTS PASSED");
  } catch (err) {
    console.error("TEST FAILURE:", err.message);
    if (err.response) console.error("status:", err.response.status);
    process.exitCode = 1;
  } finally {
    try {
      await pool.query("DELETE FROM user_school WHERE user_id = ANY($1)", [[ids.studentId, ids.teacherId].filter(Boolean)]);
      await pool.query("DELETE FROM users2 WHERE id = ANY($1)", [[ids.adminId, ids.studentId, ids.teacherId].filter(Boolean)]);
      await pool.query("DELETE FROM schools WHERE id = $1", [ids.schoolId]).catch(() => {});
      console.log("Cleanup done.");
    } catch (cleanupErr) {
      console.error("Cleanup error:", cleanupErr.message);
    }
    await pool.end();
  }
})();
