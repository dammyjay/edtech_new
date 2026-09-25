require("dotenv").config();
const pool = require("./models/db");
const bcrypt = require("bcrypt");
const axios = require("axios");
const fs = require("fs");

const BASE = "http://localhost:3098";
const ids = {};

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERTION FAILED: " + msg);
  console.log("OK:", msg);
}

const CURRICULUM_CONTENT = `
<h2>Course Description</h2>
<p>This course introduces young learners to the fundamentals of programming using PictoBlox Jr, a beginner-friendly, block-based coding platform designed to help children understand how computers follow instructions. Students will learn core coding concepts such as commands, sequencing, and simple events while creating animations and interactive scenes.</p>
<p>Through fun, hands-on activities and guided mini-projects, learners will explore how to control characters, trigger actions, and build simple stories. By the end of the course, students will be able to create basic interactive projects and develop an early understanding of computational thinking.</p>

<h2>Course Overview</h2>
<table>
  <tr><td>Grade Level / Age</td><td>Primary 1 &amp; 2 (typically 6-8 years old)</td></tr>
  <tr><td>Prerequisites</td><td>None; basic familiarity with a tablet or computer mouse/keyboard</td></tr>
  <tr><td>Number of Modules</td><td>2</td></tr>
  <tr><td>Number of Lessons</td><td>12</td></tr>
</table>

<h2>Course Objectives</h2>
<ul>
  <li><strong>Navigate the PictoBlox Jr interface</strong> and identify sprites, blocks, and the stage.</li>
  <li><strong>Understand and apply basic programming concepts</strong> such as commands and sequencing.</li>
  <li><strong>Control characters</strong> to move, speak, and perform simple actions.</li>
  <li><strong>Combine motion, looks, and event blocks</strong> to create simple animations.</li>
  <li><strong>Design and present</strong> a short animated story.</li>
</ul>

<h2>Skills Developed</h2>
<ul>
  <li><strong>Logical Thinking:</strong> Understanding step-by-step instructions and outcomes.</li>
  <li><strong>Digital Literacy:</strong> Using drag-and-drop coding blocks and navigating software interfaces.</li>
  <li><strong>Creativity:</strong> Designing characters, scenes, and simple animated stories.</li>
  <li><strong>Problem Solving:</strong> Identifying and fixing simple coding errors.</li>
</ul>

<h2>Course Modules &amp; Lessons</h2>

<h3>Module 1: Getting Started with PictoBlox Jr — 6 Lessons</h3>
<ol>
  <li><strong>What Is Coding?</strong> — Understanding coding through everyday examples of instructions and sequences.</li>
  <li><strong>Meet PictoBlox Jr</strong> — Exploring the PictoBlox Jr interface: sprites, blocks, stage, and controls.</li>
  <li><strong>Moving a Character</strong> — Using motion blocks to move characters forward, backward, and turn.</li>
  <li><strong>Making Characters Speak</strong> — Adding speech bubbles and coordinating actions with timing.</li>
  <li><strong>Sequencing Actions</strong> — Arranging blocks in the correct order to create smooth animations.</li>
  <li><strong>Mini Project: "Hello from PictoBlox Jr!"</strong> — Creating a character that introduces itself using movement and speech.</li>
</ol>

<h3>Module 2: Animation and Story Creation — 6 Lessons</h3>
<ol>
  <li><strong>Adding New Characters</strong> — Selecting and adding multiple sprites to a project.</li>
  <li><strong>Changing Backgrounds</strong> — Choosing backgrounds to set the scene for animations.</li>
  <li><strong>Making Characters Work Together</strong> — Coordinating actions between two or more characters.</li>
  <li><strong>Using Start Events</strong> — Starting animations using simple event triggers (e.g. green flag).</li>
  <li><strong>Creating Simple Stories</strong> — Organizing animations into a beginning, middle, and end.</li>
  <li><strong>Project: "A Fun Day Adventure"</strong> — Designing a short animated story with multiple characters and actions.</li>
</ol>

<h2>Course Materials</h2>
<ul>
  <li><strong>Tablet or computer</strong> with PictoBlox Jr installed</li>
  <li><strong>Projector or display screen</strong> for teacher demonstrations</li>
  <li><strong>Printable activity sheets</strong> for story planning</li>
  <li><strong>Speakers or headphones</strong> for sound-based activities</li>
</ul>

<h2>Assessment &amp; Certification</h2>
<ul>
  <li><strong>Teacher Observation:</strong> Monitoring understanding through participation and engagement.</li>
  <li><strong>Mini Projects:</strong> Short animations demonstrating basic motion and sequencing.</li>
  <li><strong>Final Project:</strong> "A Fun Day Adventure" — a simple animated story showing sequencing, movement, and interaction.</li>
  <li><strong>Certification:</strong> Issued upon successful participation and completion of the final project.</li>
</ul>
`;

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
      `INSERT INTO users2 (fullname, email, password, role) VALUES ('__Test Curr Admin__','__test_curr_admin__@example.com',$1,'admin') RETURNING id`,
      [pwdHash]
    );
    ids.adminId = adminIns.rows[0].id;

    const courseIns = await pool.query(
      `INSERT INTO courses (title, level, curriculum_content) VALUES ('Introduction to Coding with PictoBlox Jr','Beginner',$1) RETURNING id`,
      [CURRICULUM_CONTENT]
    );
    ids.courseId = courseIns.rows[0].id;

    console.log("SETUP_OK", JSON.stringify(ids));

    const cookie = await login("__test_curr_admin__@example.com", "Test1234!");
    assert(cookie, "admin login ok");

    const res = await axios.get(`${BASE}/admin/courses/${ids.courseId}/curriculum/download`, {
      headers: { Cookie: cookie },
      responseType: "arraybuffer",
      validateStatus: () => true,
    });
    console.log("download status:", res.status, "content-type:", res.headers["content-type"], "bytes:", res.data.length);
    assert(res.status === 200, "curriculum PDF download succeeded");
    assert(res.headers["content-type"].includes("pdf"), "response is a PDF");
    assert(res.data.length > 20000, "PDF is a real, non-trivial file");

    fs.writeFileSync("./tmp/test_curriculum.pdf", res.data);
    console.log("Saved to ./tmp/test_curriculum.pdf");

    console.log("\nALL CURRICULUM PDF TESTS PASSED");
  } catch (err) {
    console.error("TEST FAILURE:", err.message);
    if (err.response) console.error("status:", err.response.status);
    process.exitCode = 1;
  } finally {
    try {
      await pool.query("DELETE FROM courses WHERE id = $1", [ids.courseId]).catch(() => {});
      await pool.query("DELETE FROM users2 WHERE id = $1", [ids.adminId]).catch(() => {});
      console.log("DB cleanup done (PDF file kept for visual inspection).");
    } catch (cleanupErr) {
      console.error("Cleanup error:", cleanupErr.message);
    }
    await pool.end();
  }
})();
