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

    // Independent student, public-profile-enabled, with a published project
    const studentIns = await pool.query(
      `INSERT INTO users2 (fullname, email, password, role, public_profile_enabled, public_profile_slug)
       VALUES ('__Test Gap Student__','__test_gap_student__@example.com',$1,'user',true,'__test-gap-slug__') RETURNING id`,
      [pwdHash]
    );
    ids.studentId = studentIns.rows[0].id;

    const projectIns = await pool.query(
      `INSERT INTO lab_projects (student_id, lab_type, project_name, project_data, status, is_published, published_at)
       VALUES ($1,'web','__Test Gap Project__','{}','submitted', true, NOW()) RETURNING id`,
      [ids.studentId]
    );
    ids.projectId = projectIns.rows[0].id;

    await pool.query(
      `INSERT INTO user_badges (user_id, badge_name, badge_image, awarded_at) VALUES ($1,'__Test Badge__','x.png', NOW()) RETURNING id`,
      [ids.studentId]
    );

    console.log("SETUP_OK", JSON.stringify(ids));

    // === BEFORE archiving: all three public surfaces show the content ===
    const showcaseBefore = await axios.get(`${BASE}/showcase`);
    assert(showcaseBefore.data.includes("__Test Gap"), "showcase shows project BEFORE archiving (sanity check)");

    const galleryBefore = await axios.get(`${BASE}/labs/gallery/projects?labType=web&sort=newest`, { validateStatus: () => true });
    // Gallery API may require login; just check the underlying showcase-detail page as the more reliable public probe
    const showcaseDetailBefore = await axios.get(`${BASE}/showcase/${ids.projectId}`, { validateStatus: () => true });
    assert(showcaseDetailBefore.status === 200, "showcase project detail page loads BEFORE archiving");

    const achievementsBefore = await axios.get(`${BASE}/achievements/__test-gap-slug__`, { validateStatus: () => true });
    assert(achievementsBefore.status === 200, "achievement page loads BEFORE archiving");

    // === Archive the student directly (bypassing HTTP/CSRF — this is just testing the READ-side filters) ===
    await pool.query("UPDATE users2 SET archived_at = NOW() WHERE id = $1", [ids.studentId]);

    // === AFTER archiving: all three public surfaces must hide the content ===
    const showcaseAfter = await axios.get(`${BASE}/showcase`);
    assert(!showcaseAfter.data.includes("__Test Gap Project__"), "showcase NO LONGER shows project after archiving");

    const showcaseDetailAfter = await axios.get(`${BASE}/showcase/${ids.projectId}`, { validateStatus: () => true });
    assert(showcaseDetailAfter.status === 404, "showcase project detail page 404s after archiving");

    const achievementsAfter = await axios.get(`${BASE}/achievements/__test-gap-slug__`, { validateStatus: () => true });
    assert(achievementsAfter.status === 404, "achievement page 404s after archiving");

    console.log("\nALL PUBLIC-SURFACE GAP-FIX TESTS PASSED");
  } catch (err) {
    console.error("TEST FAILURE:", err.message);
    if (err.response) console.error("Response status/data:", err.response.status, typeof err.response.data === 'string' ? err.response.data.slice(0,300) : err.response.data);
    process.exitCode = 1;
  } finally {
    try {
      if (ids.projectId) await pool.query("DELETE FROM lab_projects WHERE id = $1", [ids.projectId]);
      if (ids.studentId) await pool.query("DELETE FROM user_badges WHERE user_id = $1", [ids.studentId]);
      if (ids.studentId) await pool.query("DELETE FROM users2 WHERE id = $1", [ids.studentId]);
      console.log("Cleanup done.");
    } catch (cleanupErr) {
      console.error("Cleanup error:", cleanupErr.message);
    }
    await pool.end();
  }
})();
