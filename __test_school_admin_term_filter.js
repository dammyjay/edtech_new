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

async function login(email, password, jar = "") {
  const res = await axios.post(
    `${BASE}/admin/login`,
    new URLSearchParams({ email, password }).toString(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: jar }, maxRedirects: 0, validateStatus: () => true }
  );
  const setCookie = res.headers["set-cookie"];
  return setCookie ? setCookie.map((c) => c.split(";")[0]).join("; ") : jar;
}

(async () => {
  try {
    const pwdHash = await bcrypt.hash("Test1234!", 10);

    const adminIns = await pool.query(
      `INSERT INTO users2 (fullname, email, password, role) VALUES ('__Test TF SchoolAdmin__','__test_tf_schooladmin__@example.com',$1,'school_admin') RETURNING id`,
      [pwdHash]
    );
    ids.schoolAdminId = adminIns.rows[0].id;

    const schoolIns = await pool.query(
      `INSERT INTO schools (school_id, name, created_by) VALUES ('SCH-TF-TEST', '__Test TF School__', $1) RETURNING id`,
      [ids.schoolAdminId]
    );
    ids.schoolId = schoolIns.rows[0].id;

    const term1Ins = await pool.query(
      `INSERT INTO academic_terms (school_id, name, start_date, end_date, is_active) VALUES ($1,'__TF Term 1 (Active)__','2025-01-01','2025-06-30',true) RETURNING id`,
      [ids.schoolId]
    );
    ids.term1Id = term1Ins.rows[0].id;

    const term2Ins = await pool.query(
      `INSERT INTO academic_terms (school_id, name, start_date, end_date, is_active) VALUES ($1,'__TF Term 2 (Past)__','2024-01-01','2024-06-30',false) RETURNING id`,
      [ids.schoolId]
    );
    ids.term2Id = term2Ins.rows[0].id;

    const classroomIns = await pool.query(
      `INSERT INTO classrooms (school_id, name) VALUES ($1, '__TF Classroom__') RETURNING id`,
      [ids.schoolId]
    );
    ids.classroomId = classroomIns.rows[0].id;

    // Student A — enrolled (live + term_enrollment) in Term 1 only
    const studentAIns = await pool.query(
      `INSERT INTO users2 (fullname, email, password, role) VALUES ('__TF Student A (Term1)__','__test_tf_student_a__@example.com',$1,'student') RETURNING id`,
      [pwdHash]
    );
    ids.studentAId = studentAIns.rows[0].id;
    await pool.query(
      `INSERT INTO user_school (user_id, school_id, classroom_id, role_in_school, approved, is_active) VALUES ($1,$2,$3,'student',true,true)`,
      [ids.studentAId, ids.schoolId, ids.classroomId]
    );
    await pool.query(
      `INSERT INTO student_term_enrollments (student_id, school_id, term_id, classroom_id) VALUES ($1,$2,$3,$4)`,
      [ids.studentAId, ids.schoolId, ids.term1Id, ids.classroomId]
    );

    // Student B — enrolled (term_enrollment only) in Term 2 only, NOT live-assigned to the classroom
    const studentBIns = await pool.query(
      `INSERT INTO users2 (fullname, email, password, role) VALUES ('__TF Student B (Term2)__','__test_tf_student_b__@example.com',$1,'student') RETURNING id`,
      [pwdHash]
    );
    ids.studentBId = studentBIns.rows[0].id;
    await pool.query(
      `INSERT INTO user_school (user_id, school_id, classroom_id, role_in_school, approved, is_active) VALUES ($1,$2,NULL,'student',true,true)`,
      [ids.studentBId, ids.schoolId]
    );
    await pool.query(
      `INSERT INTO student_term_enrollments (student_id, school_id, term_id, classroom_id) VALUES ($1,$2,$3,$4)`,
      [ids.studentBId, ids.schoolId, ids.term2Id, ids.classroomId]
    );

    // A classroom report tagged to Term 2
    const reportIns = await pool.query(
      `INSERT INTO classroom_reports (school_id, classroom_id, instructor_id, term_id, title, content, report_date) VALUES ($1,$2,$3,$4,'__TF Report Term2__','content','2024-05-01') RETURNING id`,
      [ids.schoolId, ids.classroomId, ids.schoolAdminId, ids.term2Id]
    );
    ids.reportId = reportIns.rows[0].id;

    console.log("SETUP_OK", JSON.stringify(ids));

    let cookie = await login("__test_tf_schooladmin__@example.com", "Test1234!");
    assert(cookie, "school admin login ok");

    // 1. Default load — no session state yet, should default to active term (Term 1)
    const dashRes = await axios.get(`${BASE}/school-admin/dashboard`, { headers: { Cookie: cookie } });
    assert(dashRes.status === 200, "dashboard loaded (status 200)");
    assert(dashRes.data.includes("__TF Term 1 (Active)__"), "term selector lists Term 1");
    assert(dashRes.data.includes("__TF Term 2 (Past)__"), "term selector lists Term 2");
    // Term 1 selected by default -> Student A should appear in initial overview render, Student B should not
    assert(dashRes.data.includes("__TF Student A (Term1)__"), "default (Term 1) overview shows Student A");
    assert(!dashRes.data.includes("__TF Student B (Term2)__"), "default (Term 1) overview does NOT show Student B");

    // 2. Students section, default term (Term 1)
    let studentsRes = await axios.get(`${BASE}/school-admin/section/students`, { headers: { Cookie: cookie } });
    assert(studentsRes.data.includes("__TF Student A (Term1)__"), "students section (Term 1) shows Student A");
    assert(!studentsRes.data.includes("__TF Student B (Term2)__"), "students section (Term 1) does NOT show Student B");

    // 3. Classrooms section, default term (Term 1) — should show Student A in roster, count 1.
    // Student B is deliberately still allowed to appear in the "Add Student"
    // picker (<option>) even under Term 1 — that picker is always LIVE-based,
    // by design (assigning a student is a current action, not historical) —
    // so we check the roster TABLE CELL (<td>) specifically, not the whole page.
    let classroomsRes = await axios.get(`${BASE}/school-admin/section/classrooms`, { headers: { Cookie: cookie } });
    assert(classroomsRes.data.includes("<td>__TF Student A (Term1)__</td>"), "classrooms section (Term 1) roster shows Student A");
    assert(!classroomsRes.data.includes("<td>__TF Student B (Term2)__</td>"), "classrooms section (Term 1) roster does NOT show Student B");
    assert(classroomsRes.data.includes("__TF Student B (Term2)__ (__test_tf_student_b__@example.com)"), "classrooms section (Term 1) 'Add Student' picker still lists Student B (live-based, by design)");
    assert(classroomsRes.data.includes("1 students"), "classrooms section (Term 1) shows count of 1 student");

    // 4. Class Reports, default term (Term 1) — Term-2-tagged report should NOT show
    let reportsRes = await axios.get(`${BASE}/school-admin/section/classroom-reports`, { headers: { Cookie: cookie } });
    assert(!reportsRes.data.includes("__TF Report Term2__"), "class reports (Term 1) does NOT show Term 2's report");

    // 5. Switch to Term 2 via select-term endpoint
    const selectRes = await axios.get(`${BASE}/school-admin/select-term?term_id=${ids.term2Id}`, { headers: { Cookie: cookie } });
    assert(selectRes.data.success === true, "select-term endpoint succeeded");
    assert(String(selectRes.data.selectedTermId) === String(ids.term2Id), "select-term returned Term 2's id");

    // 6. Students section, now Term 2 — Student B should show, Student A should not
    studentsRes = await axios.get(`${BASE}/school-admin/section/students`, { headers: { Cookie: cookie } });
    assert(studentsRes.data.includes("__TF Student B (Term2)__"), "students section (Term 2) shows Student B");
    assert(!studentsRes.data.includes("__TF Student A (Term1)__"), "students section (Term 2) does NOT show Student A");

    // 7. Classrooms section, now Term 2 — roster should show Student B (even though B isn't live-assigned)
    classroomsRes = await axios.get(`${BASE}/school-admin/section/classrooms`, { headers: { Cookie: cookie } });
    assert(classroomsRes.data.includes("<td>__TF Student B (Term2)__</td>"), "classrooms section (Term 2) roster shows Student B");
    assert(!classroomsRes.data.includes("<td>__TF Student A (Term1)__</td>"), "classrooms section (Term 2) roster does NOT show Student A");

    // 8. Class Reports, now Term 2 — should show the report
    reportsRes = await axios.get(`${BASE}/school-admin/section/classroom-reports`, { headers: { Cookie: cookie } });
    assert(reportsRes.data.includes("__TF Report Term2__"), "class reports (Term 2) shows Term 2's report");

    // 9. Attendance section should open pre-set to Term 2 (global filter)
    const attendanceRes = await axios.get(`${BASE}/school-admin/section/attendance`, { headers: { Cookie: cookie } });
    const term2OptRegex = new RegExp(`<option value="${ids.term2Id}" selected>`);
    assert(term2OptRegex.test(attendanceRes.data), "attendance section's term select is pre-set to Term 2");

    // 10. Switch to "All Terms" (empty term_id) — everything should revert to full/original behavior
    const allTermsRes = await axios.get(`${BASE}/school-admin/select-term?term_id=`, { headers: { Cookie: cookie } });
    assert(allTermsRes.data.selectedTermId === null, "select-term with empty value resolves to null (All Terms)");

    studentsRes = await axios.get(`${BASE}/school-admin/section/students`, { headers: { Cookie: cookie } });
    assert(studentsRes.data.includes("__TF Student A (Term1)__"), "students section (All Terms) shows Student A");
    assert(studentsRes.data.includes("__TF Student B (Term2)__"), "students section (All Terms) shows Student B");

    classroomsRes = await axios.get(`${BASE}/school-admin/section/classrooms`, { headers: { Cookie: cookie } });
    assert(classroomsRes.data.includes("1 students"), "classrooms section (All Terms) reverts to live count of 1 (only Student A is live-assigned)");

    reportsRes = await axios.get(`${BASE}/school-admin/section/classroom-reports`, { headers: { Cookie: cookie } });
    assert(reportsRes.data.includes("__TF Report Term2__"), "class reports (All Terms) shows all reports again");

    // 11. classroom-courses section still renders without error under both All Terms and a specific term
    let ccRes = await axios.get(`${BASE}/school-admin/section/classroom-courses`, { headers: { Cookie: cookie }, validateStatus: () => true });
    assert(ccRes.status === 200, "classroom-courses (All Terms, falls back to active term) renders 200");
    await axios.get(`${BASE}/school-admin/select-term?term_id=${ids.term1Id}`, { headers: { Cookie: cookie } });
    ccRes = await axios.get(`${BASE}/school-admin/section/classroom-courses`, { headers: { Cookie: cookie }, validateStatus: () => true });
    assert(ccRes.status === 200, "classroom-courses (Term 1 selected) renders 200");

    // 12. overview section renders 200 under a specific term too
    const overviewRes = await axios.get(`${BASE}/school-admin/section/overview`, { headers: { Cookie: cookie }, validateStatus: () => true });
    assert(overviewRes.status === 200, "overview section (Term 1 selected) renders 200");

    console.log("\nALL SCHOOL ADMIN TERM FILTER TESTS PASSED");
  } catch (err) {
    console.error("TEST FAILED:", err.message);
    if (err.response) {
      console.error("status:", err.response.status);
      console.error("data:", typeof err.response.data === "string" ? err.response.data.slice(0, 2000) : err.response.data);
    }
    process.exitCode = 1;
  } finally {
    try {
      if (ids.reportId) await pool.query("DELETE FROM classroom_reports WHERE id=$1", [ids.reportId]);
      if (ids.studentAId) await pool.query("DELETE FROM student_term_enrollments WHERE student_id=$1", [ids.studentAId]);
      if (ids.studentBId) await pool.query("DELETE FROM student_term_enrollments WHERE student_id=$1", [ids.studentBId]);
      if (ids.studentAId) await pool.query("DELETE FROM user_school WHERE user_id=$1", [ids.studentAId]);
      if (ids.studentBId) await pool.query("DELETE FROM user_school WHERE user_id=$1", [ids.studentBId]);
      if (ids.studentAId) await pool.query("DELETE FROM users2 WHERE id=$1", [ids.studentAId]);
      if (ids.studentBId) await pool.query("DELETE FROM users2 WHERE id=$1", [ids.studentBId]);
      if (ids.classroomId) await pool.query("DELETE FROM classrooms WHERE id=$1", [ids.classroomId]);
      if (ids.term1Id) await pool.query("DELETE FROM academic_terms WHERE id=$1", [ids.term1Id]);
      if (ids.term2Id) await pool.query("DELETE FROM academic_terms WHERE id=$1", [ids.term2Id]);
      if (ids.schoolId) await pool.query("DELETE FROM schools WHERE id=$1", [ids.schoolId]);
      if (ids.schoolAdminId) await pool.query("DELETE FROM users2 WHERE id=$1", [ids.schoolAdminId]);
      console.log("DB cleanup done.");
    } catch (cleanupErr) {
      console.error("Cleanup error:", cleanupErr.message);
    }
    await pool.end();
  }
})();
