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
      `INSERT INTO users2 (fullname, email, password, role) VALUES ('__Test BS Admin__','__test_bs_admin__@example.com',$1,'admin') RETURNING id`,
      [pwdHash]
    );
    ids.adminId = adminIns.rows[0].id;

    const schoolIns = await pool.query(
      `INSERT INTO schools (school_id, name, created_by) VALUES ('SCH-BS-TEST', '__Test BS School__', $1) RETURNING id`,
      [ids.adminId]
    );
    ids.schoolId = schoolIns.rows[0].id;

    // Second, unrelated school + student — used to prove cross-school ids get rejected
    const otherSchoolIns = await pool.query(
      `INSERT INTO schools (school_id, name, created_by) VALUES ('SCH-BS-OTHER', '__Test BS Other School__', $1) RETURNING id`,
      [ids.adminId]
    );
    ids.otherSchoolId = otherSchoolIns.rows[0].id;

    const studentA = await pool.query(
      `INSERT INTO users2 (fullname, email, password, role) VALUES ('__Test BS Student A__','__test_bs_student_a__@example.com',$1,'user') RETURNING id`,
      [pwdHash]
    );
    ids.studentAId = studentA.rows[0].id;
    const studentB = await pool.query(
      `INSERT INTO users2 (fullname, email, password, role) VALUES ('__Test BS Student B__','__test_bs_student_b__@example.com',$1,'user') RETURNING id`,
      [pwdHash]
    );
    ids.studentBId = studentB.rows[0].id;
    const studentOther = await pool.query(
      `INSERT INTO users2 (fullname, email, password, role) VALUES ('__Test BS Student Other__','__test_bs_student_other__@example.com',$1,'user') RETURNING id`,
      [pwdHash]
    );
    ids.studentOtherId = studentOther.rows[0].id;

    await pool.query(
      `INSERT INTO user_school (user_id, school_id, role_in_school, approved, is_active) VALUES ($1,$2,'student',true,true), ($3,$2,'student',true,true)`,
      [ids.studentAId, ids.schoolId, ids.studentBId]
    );
    await pool.query(
      `INSERT INTO user_school (user_id, school_id, role_in_school, approved, is_active) VALUES ($1,$2,'student',true,true)`,
      [ids.studentOtherId, ids.otherSchoolId]
    );

    console.log("SETUP_OK", JSON.stringify(ids));

    const cookie = await login("__test_bs_admin__@example.com", "Test1234!");
    assert(cookie, "admin login ok");

    const dashRes = await axios.get(`${BASE}/admin/dashboard`, { headers: { Cookie: cookie } });
    const csrfToken = dashRes.data.match(/name="csrf-token" content="([^"]+)"/)[1];
    const authed = (extra = {}) => ({ headers: { Cookie: cookie, "X-CSRF-Token": csrfToken, "Content-Type": "application/json", ...extra }, validateStatus: () => true });

    // === Part 1: bulk-enable-avatar-login-selected — only affects the selected student (A), not B ===
    let r = await axios.post(
      `${BASE}/admin/schools/${ids.schoolId}/bulk-enable-avatar-login-selected`,
      { studentIds: [ids.studentAId] },
      authed()
    );
    console.log("bulk-enable-selected response:", r.status, JSON.stringify(r.data));
    assert(r.status === 200 && r.data.success, "bulk-enable-avatar-login-selected succeeded");
    assert(r.data.updated.length === 1 && r.data.updated[0] == ids.studentAId, "only student A was updated");

    let aRow = await pool.query("SELECT pin, classroom_login_enabled FROM users2 WHERE id=$1", [ids.studentAId]);
    let bRow = await pool.query("SELECT pin, classroom_login_enabled FROM users2 WHERE id=$1", [ids.studentBId]);
    assert(aRow.rows[0].classroom_login_enabled === true && !!aRow.rows[0].pin, "student A now has avatar login enabled with a PIN");
    assert(!bRow.rows[0].classroom_login_enabled, "student B untouched (was not selected)");

    // === Part 2: cross-school id is rejected (defense in depth) ===
    r = await axios.post(
      `${BASE}/admin/schools/${ids.schoolId}/bulk-enable-avatar-login-selected`,
      { studentIds: [ids.studentOtherId] },
      authed()
    );
    console.log("cross-school attempt response:", r.status, JSON.stringify(r.data));
    assert(r.status === 400 && r.data.success === false, "a student from a different school is rejected, not silently updated");
    let otherRow = await pool.query("SELECT classroom_login_enabled FROM users2 WHERE id=$1", [ids.studentOtherId]);
    assert(!otherRow.rows[0].classroom_login_enabled, "the other school's student was NOT modified");

    // === Part 3: bulk-generate-avatars-selected — only affects student B this time ===
    r = await axios.post(
      `${BASE}/admin/schools/${ids.schoolId}/generate-avatars-selected`,
      { studentIds: [ids.studentBId] },
      authed()
    );
    assert(r.status === 200 && r.data.success, "bulk-generate-avatars-selected succeeded");
    // avatar_url is only ever set by generateAvatarsForStudentIds (not by
    // enableAvatarLoginForStudentIds, which A already went through in Part
    // 1) — the right column to check that ONLY B was touched here.
    let bRowAfter = await pool.query("SELECT avatar_url FROM users2 WHERE id=$1", [ids.studentBId]);
    let aRowAfter = await pool.query("SELECT avatar_url FROM users2 WHERE id=$1", [ids.studentAId]);
    assert(!!bRowAfter.rows[0].avatar_url, "student B got an avatar_url");
    assert(!aRowAfter.rows[0].avatar_url, "student A (not selected this time) did NOT get an avatar_url");

    // === Part 4: the previously-broken whole-school route (typo fix) now works ===
    r = await axios.post(`${BASE}/admin/schools/${ids.schoolId}/bulk-enable-avatar-login`, undefined, {
      headers: { Cookie: cookie, "X-CSRF-Token": csrfToken },
      validateStatus: () => true,
    });
    console.log("whole-school bulk-enable response:", r.status, JSON.stringify(r.data));
    assert(r.status === 200 && r.data.success, "the whole-school bulk-enable-avatar-login route (typo fix) now works");

    // === Part 5: PIN visible on school-details page ===
    const sdPage = await axios.get(`${BASE}/admin/schools/${ids.schoolId}`, { headers: { Cookie: cookie } });
    const finalA = await pool.query("SELECT pin FROM users2 WHERE id=$1", [ids.studentAId]);
    assert(sdPage.data.includes(finalA.rows[0].pin), "school-details page shows student A's actual PIN value");

    console.log("\nALL BULK-SELECT TESTS PASSED");
  } catch (err) {
    console.error("TEST FAILURE:", err.message);
    if (err.response) console.error("status/data:", err.response.status, err.response.data);
    process.exitCode = 1;
  } finally {
    try {
      await pool.query("DELETE FROM user_school WHERE user_id = ANY($1)", [[ids.studentAId, ids.studentBId, ids.studentOtherId].filter(Boolean)]);
      await pool.query("DELETE FROM users2 WHERE id = ANY($1)", [[ids.adminId, ids.studentAId, ids.studentBId, ids.studentOtherId].filter(Boolean)]);
      await pool.query("DELETE FROM schools WHERE id = ANY($1)", [[ids.schoolId, ids.otherSchoolId].filter(Boolean)]);
      console.log("Cleanup done.");
    } catch (cleanupErr) {
      console.error("Cleanup error:", cleanupErr.message);
    }
    await pool.end();
  }
})();
