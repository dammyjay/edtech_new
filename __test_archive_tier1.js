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
      `INSERT INTO users2 (fullname, email, password, role) VALUES ('__Test T1 Admin__','__test_t1_admin__@example.com',$1,'admin') RETURNING id`,
      [pwdHash]
    );
    ids.adminId = adminIns.rows[0].id;

    const schoolIns = await pool.query(
      `INSERT INTO schools (school_id, name, created_by) VALUES ('SCH-T1-TEST', '__Test T1 School__', $1) RETURNING id`,
      [ids.adminId]
    );
    ids.schoolId = schoolIns.rows[0].id;

    const classroomIns = await pool.query(
      `INSERT INTO classrooms (school_id, name) VALUES ($1, '__Test T1 Classroom__') RETURNING id`,
      [ids.schoolId]
    );
    ids.classroomId = classroomIns.rows[0].id;

    const termIns = await pool.query(
      `INSERT INTO academic_terms (school_id, name, start_date, end_date, is_active) VALUES ($1,'__Test T1 Term__','2026-01-01','2026-12-31',true) RETURNING id`,
      [ids.schoolId]
    );
    ids.termId = termIns.rows[0].id;

    const quoteIns = await pool.query(
      `INSERT INTO quotes (school_id, term_id, price_per_student, status) VALUES ($1,$2,1000,'unpaid') RETURNING id`,
      [ids.schoolId, ids.termId]
    );
    ids.quoteId = quoteIns.rows[0].id;

    const courseIns = await pool.query(`INSERT INTO courses (title, level) VALUES ('__Test T1 Course__','Beginner') RETURNING id`);
    ids.courseId = courseIns.rows[0].id;

    const epIns = await pool.query(
      `INSERT INTO external_projects (course_id, title, instructions, deliverables, rubric, created_by) VALUES ($1,'__Test T1 ExternalProject__','do it','[]','[]',$2) RETURNING id`,
      [ids.courseId, ids.adminId]
    );
    ids.externalProjectId = epIns.rows[0].id;

    const eventIns = await pool.query(
      `INSERT INTO events (title, description, event_date, show_on_homepage) VALUES ('__Test T1 Event__','desc','2026-12-31', true) RETURNING id`
    );
    ids.eventId = eventIns.rows[0].id;

    console.log("SETUP_OK", JSON.stringify(ids));

    const cookie = await login("__test_t1_admin__@example.com", "Test1234!");
    assert(cookie, "admin login ok");

    const dashRes = await axios.get(`${BASE}/admin/dashboard`, { headers: { Cookie: cookie } });
    const csrfToken = dashRes.data.match(/name="csrf-token" content="([^"]+)"/)[1];
    const authed = (extra = {}) => ({ headers: { Cookie: cookie, "X-CSRF-Token": csrfToken, ...extra }, validateStatus: () => true });

    // === BEFORE: everything shows up on the school-details page and admin lists ===
    let sdPage = await axios.get(`${BASE}/admin/schools/${ids.schoolId}`, { headers: { Cookie: cookie } });
    assert(sdPage.data.includes("__Test T1 Classroom__"), "classroom shows on school-details BEFORE archiving");
    assert(sdPage.data.includes("__Test T1 Term__"), "term shows on school-details BEFORE archiving");

    let eventsPage = await axios.get(`${BASE}/admin/events`, { headers: { Cookie: cookie } });
    assert(eventsPage.data.includes("__Test T1 Event__"), "event shows on admin events list BEFORE archiving");

    let quotesPage = await axios.get(`${BASE}/admin/quotes`, { headers: { Cookie: cookie } });
    assert(quotesPage.data.includes("__Test T1 School__") || quotesPage.data.includes("__Test T1 Term__"), "quote shows on admin quotes list BEFORE archiving");

    // === ARCHIVE: classroom (admin DELETE /admin/classrooms/:id) ===
    let r = await axios.delete(`${BASE}/admin/classrooms/${ids.classroomId}`, authed());
    assert(r.status === 200 && r.data.success, "classroom archive succeeded");
    let row = await pool.query("SELECT archived_at FROM classrooms WHERE id=$1", [ids.classroomId]);
    assert(row.rows[0].archived_at !== null, "classroom.archived_at set");

    // === ARCHIVE: term (admin DELETE /admin/terms/:id) ===
    r = await axios.delete(`${BASE}/admin/terms/${ids.termId}`, authed());
    assert(r.status === 200, "term archive request succeeded");
    row = await pool.query("SELECT archived_at FROM academic_terms WHERE id=$1", [ids.termId]);
    assert(row.rows[0].archived_at !== null, "term.archived_at set");

    // Trap check: quote should NOT have been duplicated by re-visiting school-details
    // after the term (and thus its quote) are both archived out of the "ensure every
    // term has a quote" loop.
    await axios.get(`${BASE}/admin/schools/${ids.schoolId}`, { headers: { Cookie: cookie } });
    const quoteCount = await pool.query("SELECT COUNT(*) FROM quotes WHERE term_id=$1", [ids.termId]);
    assert(Number(quoteCount.rows[0].count) === 1, "no duplicate quote created for the now-archived term (still exactly 1)");

    // === ARCHIVE: external project (admin POST /admin/external-projects/:id/delete) ===
    r = await axios.post(`${BASE}/admin/external-projects/${ids.externalProjectId}/delete`, null, authed());
    assert(r.status === 200 && r.data.success, "external project archive succeeded");
    row = await pool.query("SELECT archived_at FROM external_projects WHERE id=$1", [ids.externalProjectId]);
    assert(row.rows[0].archived_at !== null, "external_project.archived_at set");

    // === ARCHIVE: event (admin DELETE /admin/events/:id — redirect-based, not JSON;
    // maxRedirects:0 here because axios, unlike a real browser, preserves the DELETE
    // verb when auto-following a 302, which would re-request "DELETE /admin/events"
    // with no id and 404. A real <form method=POST action="...?_method=DELETE">
    // submit doesn't hit this — the browser correctly GETs the redirect target.) ===
    r = await axios.delete(`${BASE}/admin/events/${ids.eventId}`, {
      headers: { Cookie: cookie, "X-CSRF-Token": csrfToken },
      maxRedirects: 0,
      validateStatus: () => true,
    });
    assert(r.status === 302 && r.headers.location === "/admin/events", "event archive request redirected to /admin/events (success)");
    row = await pool.query("SELECT archived_at FROM events WHERE id=$1", [ids.eventId]);
    assert(row.rows[0].archived_at !== null, "event.archived_at set");

    // === ARCHIVE: quote directly (service-level, since school-admin UI button is commented out) ===
    const archiveService = require("./services/archiveService");
    await archiveService.archive("quote", ids.quoteId, ids.adminId);
    row = await pool.query("SELECT archived_at FROM quotes WHERE id=$1", [ids.quoteId]);
    assert(row.rows[0].archived_at !== null, "quote.archived_at set");

    // === AFTER: excluded from live listings ===
    sdPage = await axios.get(`${BASE}/admin/schools/${ids.schoolId}`, { headers: { Cookie: cookie } });
    assert(!sdPage.data.includes("__Test T1 Classroom__"), "classroom excluded from school-details AFTER archiving");
    assert(!sdPage.data.includes("__Test T1 Term__"), "term excluded from school-details AFTER archiving");

    eventsPage = await axios.get(`${BASE}/admin/events`, { headers: { Cookie: cookie } });
    assert(!eventsPage.data.includes("__Test T1 Event__"), "event excluded from admin events list AFTER archiving");

    const homeRes = await axios.get(`${BASE}/`, { headers: { Cookie: cookie } });
    assert(!homeRes.data.includes("__Test T1 Event__"), "event excluded from homepage AFTER archiving");

    // === Archive screen shows all 5 ===
    const archivePage = await axios.get(`${BASE}/admin/archive`, { headers: { Cookie: cookie } });
    assert(archivePage.status === 200, "GET /admin/archive returns 200");
    assert(archivePage.data.includes("__Test T1 Classroom__"), "archive page shows classroom");
    assert(archivePage.data.includes("__Test T1 Term__"), "archive page shows term");
    assert(archivePage.data.includes("__Test T1 ExternalProject__"), "archive page shows external project");
    assert(archivePage.data.includes("__Test T1 Event__"), "archive page shows event");
    assert(archivePage.data.includes("__Test T1 School__"), "archive page shows the quote (labeled with school name)");

    // === Restore classroom ===
    r = await axios.post(`${BASE}/admin/archive/classroom/${ids.classroomId}/restore`, null, authed());
    assert(r.status === 200 && r.data.success, "classroom restore succeeded");
    row = await pool.query("SELECT archived_at FROM classrooms WHERE id=$1", [ids.classroomId]);
    assert(row.rows[0].archived_at === null, "classroom.archived_at cleared after restore");

    // === Permanent delete: term (special-cased — must also remove its quote, which has no real FK) ===
    r = await axios.post(`${BASE}/admin/archive/term/${ids.termId}/delete-permanent`, null, authed());
    assert(r.status === 200 && r.data.success, "term permanent delete succeeded");
    const goneTerm = await pool.query("SELECT id FROM academic_terms WHERE id=$1", [ids.termId]);
    assert(goneTerm.rows.length === 0, "term row truly gone");
    const goneQuote = await pool.query("SELECT id FROM quotes WHERE id=$1", [ids.quoteId]);
    assert(goneQuote.rows.length === 0, "quote row also gone (no real FK, so archiveService special-cases this)");

    // === Permanent delete: event ===
    r = await axios.post(`${BASE}/admin/archive/event/${ids.eventId}/delete-permanent`, null, authed());
    assert(r.status === 200 && r.data.success, "event permanent delete succeeded");
    const goneEvent = await pool.query("SELECT id FROM events WHERE id=$1", [ids.eventId]);
    assert(goneEvent.rows.length === 0, "event row truly gone");

    console.log("\nALL TIER-1 ARCHIVE TESTS PASSED");
  } catch (err) {
    console.error("TEST FAILURE:", err.message);
    if (err.response) console.error("status/data:", err.response.status, JSON.stringify(err.response.data).slice(0, 400));
    process.exitCode = 1;
  } finally {
    try {
      await pool.query("DELETE FROM classrooms WHERE id = $1", [ids.classroomId]).catch(() => {});
      await pool.query("DELETE FROM external_projects WHERE id = $1", [ids.externalProjectId]).catch(() => {});
      await pool.query("DELETE FROM courses WHERE id = $1", [ids.courseId]).catch(() => {});
      await pool.query("DELETE FROM quotes WHERE id = $1", [ids.quoteId]).catch(() => {});
      await pool.query("DELETE FROM academic_terms WHERE id = $1", [ids.termId]).catch(() => {});
      await pool.query("DELETE FROM events WHERE id = $1", [ids.eventId]).catch(() => {});
      await pool.query("DELETE FROM schools WHERE id = $1", [ids.schoolId]).catch(() => {});
      await pool.query("DELETE FROM users2 WHERE id = $1", [ids.adminId]).catch(() => {});
      console.log("Cleanup done.");
    } catch (cleanupErr) {
      console.error("Cleanup error:", cleanupErr.message);
    }
    await pool.end();
  }
})();
