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

(async () => {
  try {
    const pwdHash = await bcrypt.hash("Test1234!", 10);

    const instructorIns = await pool.query(
      `INSERT INTO users2 (fullname, email, password, role) VALUES ('__Test LS Instructor__','__test_ls_instructor__@example.com',$1,'instructor') RETURNING id`,
      [pwdHash]
    );
    ids.instructorId = instructorIns.rows[0].id;

    const schoolIns = await pool.query(
      `INSERT INTO schools (school_id, name, created_by) VALUES ('SCH-LS-TEST', '__Test LS School__', $1) RETURNING id`,
      [ids.instructorId]
    );
    ids.schoolId = schoolIns.rows[0].id;

    const classroomIns = await pool.query(
      `INSERT INTO classrooms (school_id, name) VALUES ($1, '__Test LS Classroom__') RETURNING id`,
      [ids.schoolId]
    );
    ids.classroomId = classroomIns.rows[0].id;
    await pool.query(`INSERT INTO classroom_instructors (classroom_id, instructor_id) VALUES ($1,$2)`, [ids.classroomId, ids.instructorId]);

    const studentIns = await pool.query(
      `INSERT INTO users2 (fullname, email, password, role, pin, classroom_login_enabled)
       VALUES ('__Test LS Student__','__test_ls_student__@example.com',$1,'user','7777',true) RETURNING id`,
      [pwdHash]
    );
    ids.studentId = studentIns.rows[0].id;
    await pool.query(
      `INSERT INTO user_school (user_id, school_id, classroom_id, role_in_school, approved, is_active) VALUES ($1,$2,$3,'student',true,true)`,
      [ids.studentId, ids.schoolId, ids.classroomId]
    );

    console.log("SETUP_OK", JSON.stringify(ids));

    const loginRes = await axios.post(
      `${BASE}/admin/login`,
      new URLSearchParams({ email: "__test_ls_instructor__@example.com", password: "Test1234!" }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" }, maxRedirects: 0, validateStatus: () => true }
    );
    const setCookie = loginRes.headers["set-cookie"];
    const cookie = setCookie ? setCookie.map((c) => c.split(";")[0]).join("; ") : null;
    assert(cookie, "instructor login ok");

    await axios.get(`${BASE}/instructor/dashboard?school_id=${ids.schoolId}`, { headers: { Cookie: cookie }, validateStatus: () => true });

    // THE ACTUAL ROUTE THE SIDEBAR USES: loadSection via /instructor/section/:section
    const secRes = await axios.get(`${BASE}/instructor/section/students`, { headers: { Cookie: cookie }, validateStatus: () => true });
    console.log("loadSection status:", secRes.status);
    assert(secRes.status === 200, "loadSection students route loads");
    assert(secRes.data.includes("__Test LS Student__"), "student appears via loadSection");
    console.log("--- relevant HTML row ---");
    const rowMatch = secRes.data.match(/<tr>[\s\S]*?__Test LS Student__[\s\S]*?<\/tr>/);
    console.log(rowMatch ? rowMatch[0] : "(row not found in output)");
    assert(secRes.data.includes("7777"), "PIN 7777 visible via loadSection route (the sidebar's actual path)");

    console.log("\nALL LOADSECTION PIN TESTS PASSED");
  } catch (err) {
    console.error("TEST FAILURE:", err.message);
    if (err.response) console.error("status:", err.response.status);
    process.exitCode = 1;
  } finally {
    try {
      await pool.query("DELETE FROM classroom_instructors WHERE classroom_id = $1", [ids.classroomId]).catch(() => {});
      await pool.query("DELETE FROM user_school WHERE user_id = $1", [ids.studentId]).catch(() => {});
      await pool.query("DELETE FROM classrooms WHERE id = $1", [ids.classroomId]).catch(() => {});
      await pool.query("DELETE FROM users2 WHERE id = ANY($1)", [[ids.instructorId, ids.studentId].filter(Boolean)]);
      await pool.query("DELETE FROM schools WHERE id = $1", [ids.schoolId]).catch(() => {});
      console.log("Cleanup done.");
    } catch (cleanupErr) {
      console.error("Cleanup error:", cleanupErr.message);
    }
    await pool.end();
  }
})();
