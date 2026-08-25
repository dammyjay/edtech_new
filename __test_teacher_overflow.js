require("dotenv").config();
const pool = require("./models/db");
const bcrypt = require("bcrypt");
const puppeteer = require("puppeteer");

(async () => {
  const ids = {};
  try {
    const pwdHash = await bcrypt.hash("Test1234!", 10);
    const teacherIns = await pool.query(
      `INSERT INTO users2 (fullname, email, password, role) VALUES ('__Test Overflow Teacher__','__test_overflow_teacher__@example.com',$1,'teacher') RETURNING id`,
      [pwdHash]
    );
    ids.teacherId = teacherIns.rows[0].id;
    const schoolIns = await pool.query(
      `INSERT INTO schools (school_id, name, created_by) VALUES ('SCH-OVERFLOW-1', '__Test Overflow School__', $1) RETURNING id`,
      [ids.teacherId]
    );
    ids.schoolId = schoolIns.rows[0].id;
    const classroomIns = await pool.query(
      `INSERT INTO classrooms (school_id, name) VALUES ($1, '__Test Overflow Classroom__') RETURNING id`,
      [ids.schoolId]
    );
    ids.classroomId = classroomIns.rows[0].id;
    await pool.query(
      `INSERT INTO user_school (user_id, school_id, classroom_id, role_in_school, approved) VALUES ($1,$2,$3,'teacher',true)`,
      [ids.teacherId, ids.schoolId, ids.classroomId]
    );
    await pool.query(`INSERT INTO classroom_teachers (classroom_id, teacher_id) VALUES ($1,$2)`, [ids.classroomId, ids.teacherId]);
    const studentIns = await pool.query(
      `INSERT INTO users2 (fullname, email, password, role) VALUES ('__Test Overflow Student__','__test_overflow_student__@example.com',$1,'user') RETURNING id`,
      [pwdHash]
    );
    ids.studentId = studentIns.rows[0].id;
    await pool.query(
      `INSERT INTO user_school (user_id, school_id, classroom_id, role_in_school, approved) VALUES ($1,$2,$3,'student',true)`,
      [ids.studentId, ids.schoolId, ids.classroomId]
    );
    await pool.query(`INSERT INTO class_messages (classroom_id, sender_id, message) VALUES ($1,$2,'Hello class!')`, [ids.classroomId, ids.teacherId]);
    await pool.query(
      `INSERT INTO classroom_announcements (classroom_id, teacher_id, title, message) VALUES ($1,$2,'Reminder','Submit homework by Friday.')`,
      [ids.classroomId, ids.teacherId]
    );

    const browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath(),
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    try {
      const page = await browser.newPage();
      await page.goto("http://localhost:3000/admin/login", { waitUntil: "networkidle0" });
      await page.evaluate(async () => {
        await fetch("/admin/login", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: "__test_overflow_teacher__@example.com", password: "Test1234!" }),
        });
      });

      await page.setViewport({ width: 375, height: 800 });
      await page.goto(`http://localhost:3000/teacher/class-chat/${ids.classroomId}`, { waitUntil: "networkidle0" });
      await new Promise((r) => setTimeout(r, 700));

      const culprits = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const results = [];
        document.querySelectorAll("body *").forEach((el) => {
          const rect = el.getBoundingClientRect();
          if (rect.right > vw + 2 || rect.width > vw + 2) {
            results.push({
              tag: el.tagName,
              id: el.id,
              className: typeof el.className === "string" ? el.className : "",
              width: Math.round(rect.width),
              right: Math.round(rect.right),
              text: (el.textContent || "").trim().slice(0, 50),
            });
          }
        });
        return { vw, results: results.slice(0, 20) };
      });
      console.log(JSON.stringify(culprits, null, 2));
    } finally {
      await browser.close();
    }
  } catch (e) {
    console.error("TEST_ERROR", e);
  } finally {
    if (ids.classroomId) {
      await pool.query("DELETE FROM classroom_announcements WHERE classroom_id=$1", [ids.classroomId]);
      await pool.query("DELETE FROM class_messages WHERE classroom_id=$1", [ids.classroomId]);
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
