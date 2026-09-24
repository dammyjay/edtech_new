require("dotenv").config();
const pool = require("./models/db");
const bcrypt = require("bcrypt");
const axios = require("axios");
const archiveService = require("./services/archiveService");
const { getAllSchoolsWithPaymentSummary } = require("./services/schoolsAdminListService");

const BASE = "http://localhost:3098";
const ids = {};
let cookie = "";

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERTION FAILED: " + msg);
  console.log("OK:", msg);
}

async function login(email, password) {
  const res = await axios.post(
    `${BASE}/admin/login`,
    new URLSearchParams({ email, password }).toString(),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      maxRedirects: 0,
      validateStatus: () => true,
    }
  );
  const setCookie = res.headers["set-cookie"];
  return { res, cookie: setCookie ? setCookie.map((c) => c.split(";")[0]).join("; ") : null };
}

(async () => {
  try {
    const pwdHash = await bcrypt.hash("Test1234!", 10);

    // --- Throwaway admin ---
    const adminIns = await pool.query(
      `INSERT INTO users2 (fullname, email, password, role) VALUES ('__Test Archive Admin__','__test_archive_admin__@example.com',$1,'admin') RETURNING id`,
      [pwdHash]
    );
    ids.adminId = adminIns.rows[0].id;

    // --- Throwaway school ---
    const schoolIns = await pool.query(
      `INSERT INTO schools (school_id, name, created_by) VALUES ('SCH-ARC-TEST', '__Test Archive School__', $1) RETURNING id`,
      [ids.adminId]
    );
    ids.schoolId = schoolIns.rows[0].id;

    // --- Throwaway student (school-linked) ---
    const studentIns = await pool.query(
      `INSERT INTO users2 (fullname, email, password, role) VALUES ('__Test Archive Student__','__test_archive_student__@example.com',$1,'user') RETURNING id`,
      [pwdHash]
    );
    ids.studentId = studentIns.rows[0].id;
    await pool.query(
      `INSERT INTO user_school (user_id, school_id, role_in_school, approved, is_active) VALUES ($1,$2,'student',true,true)`,
      [ids.studentId, ids.schoolId]
    );

    // --- Throwaway course/module/lesson ---
    const courseIns = await pool.query(
      `INSERT INTO courses (title, level) VALUES ('__Test Archive Course__','Beginner') RETURNING id`
    );
    ids.courseId = courseIns.rows[0].id;
    const moduleIns = await pool.query(
      `INSERT INTO modules (course_id, title, order_number) VALUES ($1,'__Test Archive Module__',1) RETURNING id`,
      [ids.courseId]
    );
    ids.moduleId = moduleIns.rows[0].id;
    const lessonIns = await pool.query(
      `INSERT INTO lessons (module_id, title, order_number) VALUES ($1,'__Test Archive Lesson__',1) RETURNING id`,
      [ids.moduleId]
    );
    ids.lessonId = lessonIns.rows[0].id;

    console.log("SETUP_OK", JSON.stringify(ids));

    // === PART 1: login as admin ===
    const { res: loginRes, cookie: sessCookie } = await login(
      "__test_archive_admin__@example.com",
      "Test1234!"
    );
    assert(sessCookie, "admin login returned a session cookie");
    cookie = sessCookie;
    console.log("Login redirect status:", loginRes.status, loginRes.headers.location);

    // CSRF: fetch a rendered admin page and pull the token out of the
    // <meta name="csrf-token"> tag (public/js/csrf.js does the same thing
    // client-side) — this app's POST/PUT/PATCH/DELETE routes below
    // ensureAdmin all require it.
    const dashRes = await axios.get(`${BASE}/admin/dashboard`, {
      headers: { Cookie: cookie },
      maxRedirects: 0,
      validateStatus: () => true,
    });
    const csrfMatch = typeof dashRes.data === "string" && dashRes.data.match(/name="csrf-token" content="([^"]+)"/);
    const csrfToken = csrfMatch ? csrfMatch[1] : null;
    assert(csrfToken, "extracted CSRF token from rendered admin page");

    const authed = (extraHeaders = {}) => ({
      headers: { Cookie: cookie, "X-CSRF-Token": csrfToken, ...extraHeaders },
      maxRedirects: 0,
      validateStatus: () => true,
    });

    // === PART 2: archive each entity via the real (now-converted) routes ===
    // Course
    let r = await axios.post(`${BASE}/admin/courses/delete/${ids.courseId}`, null, authed());
    console.log("archive course status:", r.status);
    let courseRow = await pool.query("SELECT archived_at FROM courses WHERE id=$1", [ids.courseId]);
    assert(courseRow.rows[0].archived_at !== null, "course.archived_at set after delete route");

    // Module
    r = await axios.post(`${BASE}/admin/modules/delete/${ids.moduleId}`, null, authed());
    console.log("archive module status:", r.status);
    let moduleRow = await pool.query("SELECT archived_at FROM modules WHERE id=$1", [ids.moduleId]);
    assert(moduleRow.rows[0].archived_at !== null, "module.archived_at set after delete route");

    // Lesson
    r = await axios.post(
      `${BASE}/admin/lessons/${ids.lessonId}/delete`,
      new URLSearchParams({ course_id: ids.courseId }).toString(),
      authed({ "Content-Type": "application/x-www-form-urlencoded" })
    );
    console.log("archive lesson status:", r.status);
    let lessonRow = await pool.query("SELECT archived_at FROM lessons WHERE id=$1", [ids.lessonId]);
    assert(lessonRow.rows[0].archived_at !== null, "lesson.archived_at set after delete route");

    // User (via /admin/users/delete/:id)
    r = await axios.post(`${BASE}/admin/users/delete/${ids.studentId}`, null, authed());
    console.log("archive user status:", r.status);
    let userRow = await pool.query("SELECT archived_at FROM users2 WHERE id=$1", [ids.studentId]);
    assert(userRow.rows[0].archived_at !== null, "user.archived_at set after delete route");

    // School (new route)
    r = await axios.post(`${BASE}/admin/schools/${ids.schoolId}/archive`, null, authed({ Accept: "application/json" }));
    console.log("archive school status:", r.status, JSON.stringify(r.data));
    let schoolRow = await pool.query("SELECT archived_at FROM schools WHERE id=$1", [ids.schoolId]);
    assert(schoolRow.rows[0].archived_at !== null, "school.archived_at set after archive route");

    // === PART 3: excluded from live listings ===
    const schoolsList = await getAllSchoolsWithPaymentSummary();
    assert(!schoolsList.some((s) => s.id === ids.schoolId), "archived school excluded from admin schools list");

    const publicCourses = await pool.query("SELECT id FROM courses WHERE archived_at IS NULL AND id=$1", [ids.courseId]);
    assert(publicCourses.rows.length === 0, "archived course excluded from archived_at IS NULL query");

    // === PART 4: login rejected for archived user ===
    const { res: blockedLoginRes } = await login(
      "__test_archive_student__@example.com",
      "Test1234!"
    );
    const bodyText = typeof blockedLoginRes.data === "string" ? blockedLoginRes.data : "";
    assert(
      blockedLoginRes.status === 200 && /deactivated/i.test(bodyText),
      "archived user's login attempt shows the deactivated message"
    );

    // === PART 5: Archive screen lists everything ===
    const archivePage = await axios.get(`${BASE}/admin/archive`, authed());
    assert(archivePage.status === 200, "GET /admin/archive returns 200 for admin");
    assert(archivePage.data.includes("__Test Archive School__"), "archive page shows the archived school");
    assert(archivePage.data.includes("__Test Archive Course__"), "archive page shows the archived course");
    assert(archivePage.data.includes("__Test Archive Module__"), "archive page shows the archived module");
    assert(archivePage.data.includes("__Test Archive Lesson__"), "archive page shows the archived lesson");
    assert(archivePage.data.includes("__Test Archive Student__"), "archive page shows the archived user");

    // === PART 6: restore ===
    r = await axios.post(`${BASE}/admin/archive/user/${ids.studentId}/restore`, null, authed());
    assert(r.status === 200 && r.data.success, "restore user succeeded");
    userRow = await pool.query("SELECT archived_at FROM users2 WHERE id=$1", [ids.studentId]);
    assert(userRow.rows[0].archived_at === null, "user.archived_at cleared after restore");

    const { res: restoredLoginRes } = await login(
      "__test_archive_student__@example.com",
      "Test1234!"
    );
    assert(restoredLoginRes.status === 302, "restored user can log in again (redirect on success)");

    // === PART 7: impact + permanent delete (on the course, which still has a module+lesson attached) ===
    const impactRes = await axios.get(`${BASE}/admin/archive/course/${ids.courseId}/impact`, authed());
    console.log("Impact counts for course:", JSON.stringify(impactRes.data));
    assert(impactRes.data.success && Number(impactRes.data.counts.modules) >= 1, "impact endpoint reports at least 1 dependent module");

    r = await axios.post(`${BASE}/admin/archive/course/${ids.courseId}/delete-permanent`, null, authed());
    assert(r.status === 200 && r.data.success, "permanent delete of course succeeded");
    const goneCourse = await pool.query("SELECT id FROM courses WHERE id=$1", [ids.courseId]);
    assert(goneCourse.rows.length === 0, "course row truly gone after permanent delete");
    const goneModule = await pool.query("SELECT id FROM modules WHERE id=$1", [ids.moduleId]);
    assert(goneModule.rows.length === 0, "module row cascaded away with the course");
    const goneLesson = await pool.query("SELECT id FROM lessons WHERE id=$1", [ids.lessonId]);
    assert(goneLesson.rows.length === 0, "lesson row cascaded away with the course");

    console.log("\nALL ARCHIVE TESTS PASSED");
  } catch (err) {
    console.error("TEST FAILURE:", err.message);
    if (err.response) console.error("Response data:", err.response.data);
    process.exitCode = 1;
  } finally {
    // Cleanup
    try {
      await pool.query("DELETE FROM user_school WHERE user_id = ANY($1)", [[ids.studentId].filter(Boolean)]);
      await pool.query("DELETE FROM users2 WHERE id = ANY($1)", [[ids.adminId, ids.studentId].filter(Boolean)]);
      await pool.query("DELETE FROM schools WHERE id = $1", [ids.schoolId]).catch(() => {});
      // Normally the course (and its cascaded module/lesson) is already
      // gone via the test's own permanent-delete step — this is a
      // defensive backstop for when the test fails before reaching it.
      if (ids.courseId) await pool.query("DELETE FROM courses WHERE id = $1", [ids.courseId]).catch(() => {});
      if (ids.moduleId) await pool.query("DELETE FROM modules WHERE id = $1", [ids.moduleId]).catch(() => {});
      if (ids.lessonId) await pool.query("DELETE FROM lessons WHERE id = $1", [ids.lessonId]).catch(() => {});
      console.log("Cleanup done.");
    } catch (cleanupErr) {
      console.error("Cleanup error:", cleanupErr.message);
    }
    await pool.end();
  }
})();
