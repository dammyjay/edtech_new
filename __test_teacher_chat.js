require("dotenv").config();
const pool = require("./models/db");
const bcrypt = require("bcrypt");
const puppeteer = require("puppeteer");

(async () => {
  const ids = {};
  try {
    const pwdHash = await bcrypt.hash("Test1234!", 10);

    const teacherIns = await pool.query(
      `INSERT INTO users2 (fullname, email, password, role) VALUES ('__Test Chat Teacher__','__test_chat_teacher__@example.com',$1,'teacher') RETURNING id`,
      [pwdHash]
    );
    ids.teacherId = teacherIns.rows[0].id;

    const schoolIns = await pool.query(
      `INSERT INTO schools (school_id, name, created_by) VALUES ('SCH-CHAT-1', '__Test Chat School__', $1) RETURNING id`,
      [ids.teacherId]
    );
    ids.schoolId = schoolIns.rows[0].id;

    const classroomIns = await pool.query(
      `INSERT INTO classrooms (school_id, name) VALUES ($1, '__Test Chat Classroom__') RETURNING id`,
      [ids.schoolId]
    );
    ids.classroomId = classroomIns.rows[0].id;

    await pool.query(
      `INSERT INTO user_school (user_id, school_id, classroom_id, role_in_school, approved) VALUES ($1,$2,$3,'teacher',true)`,
      [ids.teacherId, ids.schoolId, ids.classroomId]
    );
    await pool.query(`INSERT INTO classroom_teachers (classroom_id, teacher_id) VALUES ($1,$2)`, [ids.classroomId, ids.teacherId]);

    const studentIns = await pool.query(
      `INSERT INTO users2 (fullname, email, password, role) VALUES ('__Test Chat Student__','__test_chat_student__@example.com',$1,'user') RETURNING id`,
      [pwdHash]
    );
    ids.studentId = studentIns.rows[0].id;
    await pool.query(
      `INSERT INTO user_school (user_id, school_id, classroom_id, role_in_school, approved) VALUES ($1,$2,$3,'student',true)`,
      [ids.studentId, ids.schoolId, ids.classroomId]
    );

    console.log("SETUP_OK", JSON.stringify(ids));

    const browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath(),
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    try {
      const page = await browser.newPage();
      const consoleErrors = [];
      page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
      page.on("pageerror", (err) => consoleErrors.push("pageerror: " + err.message));

      await page.goto("http://localhost:3000/admin/login", { waitUntil: "networkidle0" });
      await page.evaluate(async () => {
        await fetch("/admin/login", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: "__test_chat_teacher__@example.com", password: "Test1234!" }),
        });
      });

      await page.setViewport({ width: 1400, height: 900 });
      await page.goto("http://localhost:3000/teacher/dashboard", { waitUntil: "networkidle0" });
      await new Promise((r) => setTimeout(r, 500));

      const urlBeforeChat = page.url();

      // Open Class Chat via the Classes section (matches real usage)
      await page.evaluate(() => loadSection('classes'));
      await new Promise((r) => setTimeout(r, 400));
      await page.evaluate((classroomId) => loadUrl(`/teacher/class-chat/${classroomId}`, 'classes'), ids.classroomId);
      await new Promise((r) => setTimeout(r, 700));

      const urlAfterChat = page.url();
      const chatState1 = await page.evaluate(() => ({
        hasHero: !!document.querySelector('.tc-chat-hero'),
        activeNav: document.querySelector('a[data-section].active')?.dataset.section,
        hasBackBtn: !!document.querySelector('.back-btn'),
      }));
      console.log("URL unchanged after opening chat:", urlBeforeChat === urlAfterChat);
      console.log("chat state 1:", JSON.stringify(chatState1));

      // Send a message
      await page.evaluate(() => {
        document.getElementById('chatMessage').value = 'Hello from automated test';
      });
      await page.evaluate(() => window.sendClassMessage());
      await new Promise((r) => setTimeout(r, 500));
      const msgSent = await page.evaluate(() => document.getElementById('chatContainer').textContent.includes('Hello from automated test'));
      console.log("message sent and shown:", msgSent);

      // Navigate away then back to chat TWICE to check for interval stacking
      await page.evaluate(() => loadSection('dashboard'));
      await new Promise((r) => setTimeout(r, 400));
      await page.evaluate((classroomId) => loadUrl(`/teacher/class-chat/${classroomId}`, 'classes'), ids.classroomId);
      await new Promise((r) => setTimeout(r, 400));
      await page.evaluate(() => loadSection('dashboard'));
      await new Promise((r) => setTimeout(r, 400));
      await page.evaluate((classroomId) => loadUrl(`/teacher/class-chat/${classroomId}`, 'classes'), ids.classroomId);
      await new Promise((r) => setTimeout(r, 700));

      // Count how many /teacher/class/messages requests fire in a 5.5s window —
      // should be ~1 (one interval), not 3+ (stacked intervals from repeat visits)
      let pollCount = 0;
      const onRequest = (req) => {
        if (req.url().includes('/teacher/class/messages/')) pollCount++;
      };
      page.on('request', onRequest);
      await new Promise((r) => setTimeout(r, 5500));
      page.off('request', onRequest);
      console.log("poll requests in 5.5s after 3 visits (expect ~1, not stacked):", pollCount);

      // Test "Back" button returns to Classes
      await page.evaluate(() => window.goBackSection());
      await new Promise((r) => setTimeout(r, 400));
      const afterBack = await page.evaluate(() => document.getElementById('main-content').innerHTML.includes('My Classes Overview'));
      console.log("back button returned to classes:", afterBack);

      console.log("console errors:", JSON.stringify(consoleErrors));
    } finally {
      await browser.close();
    }
  } catch (e) {
    console.error("TEST_ERROR", e);
  } finally {
    if (ids.classroomId) {
      await pool.query("DELETE FROM classroom_announcements WHERE classroom_id=$1", [ids.classroomId]);
      await pool.query("DELETE FROM class_messages WHERE classroom_id=$1", [ids.classroomId]);
      await pool.query("DELETE FROM muted_students WHERE classroom_id=$1", [ids.classroomId]);
      await pool.query("DELETE FROM classroom_teachers WHERE classroom_id=$1", [ids.classroomId]);
    }
    if (ids.schoolId) await pool.query("DELETE FROM user_school WHERE school_id=$1", [ids.schoolId]);
    if (ids.classroomId) await pool.query("DELETE FROM classrooms WHERE id=$1", [ids.classroomId]);
    if (ids.schoolId) await pool.query("DELETE FROM schools WHERE id=$1", [ids.schoolId]);
    const userIds = [ids.teacherId, ids.studentId].filter(Boolean);
    if (userIds.length) await pool.query("DELETE FROM users2 WHERE id = ANY($1)", [userIds]);
    console.log("CLEANUP_OK");
    await pool.end();
  }
})();
