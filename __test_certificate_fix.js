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
      `INSERT INTO users2 (fullname, email, password, role) VALUES ('__Test Cert Admin__','__test_cert_admin__@example.com',$1,'admin') RETURNING id`,
      [pwdHash]
    );
    ids.adminId = adminIns.rows[0].id;

    const studentIns = await pool.query(
      `INSERT INTO users2 (fullname, email, password, role) VALUES ('__Test Cert Student__','__test_cert_student__@example.com',$1,'user') RETURNING id`,
      [pwdHash]
    );
    ids.studentId = studentIns.rows[0].id;

    const courseIns = await pool.query(`INSERT INTO courses (title, level) VALUES ('__Test Cert Course__','Beginner') RETURNING id`);
    ids.courseId = courseIns.rows[0].id;

    const certIns = await pool.query(
      `INSERT INTO user_certificates (user_id, course_id, certificate_code, certificate_url)
       VALUES ($1,$2,'OLD-CODE-1234','https://example.com/old-fake-cert.png') RETURNING id`,
      [ids.studentId, ids.courseId]
    );
    ids.certId = certIns.rows[0].id;

    console.log("SETUP_OK", JSON.stringify(ids));

    const cookie = await login("__test_cert_admin__@example.com", "Test1234!");
    assert(cookie, "admin login ok");

    // === Part 1: certificate-preview no longer leaves any {{...}} placeholder unreplaced ===
    const previewRes = await axios.get(`${BASE}/admin/courses/${ids.courseId}/certificate-preview`, { headers: { Cookie: cookie } });
    assert(previewRes.status === 200, "certificate preview loads");
    assert(!previewRes.data.includes("{{"), "no unreplaced {{...}} placeholders left in the preview HTML");
    assert(previewRes.data.includes("__Test Cert Course__"), "preview shows the real course title");
    assert(previewRes.data.includes("Certificate.png") || previewRes.data.includes("certificate_background"), "preview has a real background image URL, not a broken one");

    // === Part 2: regenerate updates the existing row + uploads a real image to Cloudinary ===
    const dashRes = await axios.get(`${BASE}/admin/dashboard`, { headers: { Cookie: cookie } });
    const csrfToken = dashRes.data.match(/name="csrf-token" content="([^"]+)"/)[1];

    const regenRes = await axios.post(
      `${BASE}/admin/students/${ids.studentId}/certificates/${ids.courseId}/regenerate`,
      null,
      { headers: { Cookie: cookie, "X-CSRF-Token": csrfToken }, validateStatus: () => true }
    );
    console.log("regenerate response:", regenRes.status, JSON.stringify(regenRes.data));
    assert(regenRes.status === 200 && regenRes.data.success, "regenerate request succeeded");
    assert(regenRes.data.certificateUrl && regenRes.data.certificateUrl.includes("cloudinary"), "regenerate returned a real Cloudinary URL");
    assert(regenRes.data.created === false, "regenerate updated the EXISTING row, did not create a duplicate");

    const row = await pool.query("SELECT certificate_url, certificate_code FROM user_certificates WHERE id = $1", [ids.certId]);
    assert(row.rows[0].certificate_url !== "https://example.com/old-fake-cert.png", "certificate_url actually changed in the DB");
    assert(row.rows[0].certificate_code !== "OLD-CODE-1234", "certificate_code actually changed in the DB");

    const countRow = await pool.query("SELECT COUNT(*) FROM user_certificates WHERE user_id=$1 AND course_id=$2", [ids.studentId, ids.courseId]);
    assert(Number(countRow.rows[0].count) === 1, "still exactly one certificate row for this student+course (no duplicate)");

    // === Part 3: fetch the actual regenerated image and sanity-check its dimensions ===
    const imgRes = await axios.get(regenRes.data.certificateUrl, { responseType: "arraybuffer" });
    assert(imgRes.status === 200, "regenerated certificate image is fetchable from Cloudinary");
    assert(imgRes.data.length > 50000, `regenerated image is a real, non-trivial file (${imgRes.data.length} bytes)`);

    console.log("\nALL CERTIFICATE FIX TESTS PASSED");
  } catch (err) {
    console.error("TEST FAILURE:", err.message);
    if (err.response) console.error("status/data:", err.response.status, JSON.stringify(err.response.data).slice(0, 400));
    process.exitCode = 1;
  } finally {
    try {
      await pool.query("DELETE FROM user_certificates WHERE id = $1", [ids.certId]).catch(() => {});
      await pool.query("DELETE FROM courses WHERE id = $1", [ids.courseId]).catch(() => {});
      await pool.query("DELETE FROM users2 WHERE id = ANY($1)", [[ids.adminId, ids.studentId].filter(Boolean)]);
      console.log("Cleanup done.");
    } catch (cleanupErr) {
      console.error("Cleanup error:", cleanupErr.message);
    }
    await pool.end();
  }
})();
