require("dotenv").config();
const pool = require("./models/db");
const bcrypt = require("bcrypt");
const puppeteer = require("puppeteer");

(async () => {
  const ids = {};
  try {
    const pwdHash = await bcrypt.hash("Test1234!", 10);

    const teacherIns = await pool.query(
      `INSERT INTO users2 (fullname, email, password, role) VALUES ('__Test Style Teacher__','__test_style_teacher__@example.com',$1,'teacher') RETURNING id`,
      [pwdHash]
    );
    ids.teacherId = teacherIns.rows[0].id;

    const schoolIns = await pool.query(
      `INSERT INTO schools (school_id, name, created_by) VALUES ('SCH-STYLE-1', '__Test Style School__', $1) RETURNING id`,
      [ids.teacherId]
    );
    ids.schoolId = schoolIns.rows[0].id;

    const classroomIns = await pool.query(
      `INSERT INTO classrooms (school_id, name) VALUES ($1, '__Test Style Classroom__') RETURNING id`,
      [ids.schoolId]
    );
    ids.classroomId = classroomIns.rows[0].id;

    await pool.query(
      `INSERT INTO user_school (user_id, school_id, classroom_id, role_in_school, approved) VALUES ($1,$2,$3,'teacher',true)`,
      [ids.teacherId, ids.schoolId, ids.classroomId]
    );
    await pool.query(`INSERT INTO classroom_teachers (classroom_id, teacher_id) VALUES ($1,$2)`, [
      ids.classroomId,
      ids.teacherId,
    ]);

    const student1Ins = await pool.query(
      `INSERT INTO users2 (fullname, email, password, role) VALUES ('__Test Style Student One__','__test_style_student1__@example.com',$1,'user') RETURNING id`,
      [pwdHash]
    );
    ids.student1Id = student1Ins.rows[0].id;

    await pool.query(
      `INSERT INTO user_school (user_id, school_id, classroom_id, role_in_school, approved) VALUES ($1,$2,$3,'student',true)`,
      [ids.student1Id, ids.schoolId, ids.classroomId]
    );

    await pool.query(`INSERT INTO muted_students (classroom_id, student_id, muted_by) VALUES ($1,$2,$3)`, [
      ids.classroomId,
      ids.student1Id,
      ids.teacherId,
    ]);

    await pool.query(`INSERT INTO class_messages (classroom_id, sender_id, message) VALUES ($1,$2,'Hi everyone, welcome to class!')`, [
      ids.classroomId,
      ids.teacherId,
    ]);
    await pool.query(`INSERT INTO class_messages (classroom_id, sender_id, message) VALUES ($1,$2,'Thanks teacher!')`, [
      ids.classroomId,
      ids.student1Id,
    ]);

    await pool.query(
      `INSERT INTO classroom_announcements (classroom_id, teacher_id, title, message) VALUES ($1,$2,'Homework Reminder','Please submit your homework by Friday.')`,
      [ids.classroomId, ids.teacherId]
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
          body: JSON.stringify({ email: "__test_style_teacher__@example.com", password: "Test1234!" }),
        });
      });

      // ---- Desktop: dashboard ----
      await page.setViewport({ width: 1400, height: 900 });
      await page.goto("http://localhost:3000/teacher/dashboard", { waitUntil: "networkidle0" });
      await new Promise((r) => setTimeout(r, 400));
      const dashHasHero = await page.evaluate(() => !!document.querySelector(".tc-hero"));
      console.log("desktop dashboard hero present:", dashHasHero);
      await page.screenshot({ path: "C:/Users/HP/AppData/Local/Temp/claude/c--Users-HP-Documents-Vs-Code-edtech-new/def66857-90bc-4e11-a42f-ee7b683fba35/scratchpad/tc_dashboard_desktop.png" });

      // ---- Mobile: dashboard ----
      await page.setViewport({ width: 375, height: 800 });
      await page.reload({ waitUntil: "networkidle0" });
      await new Promise((r) => setTimeout(r, 400));
      const sidenavHidden = await page.evaluate(() => {
        const sn = document.getElementById("sidenav");
        const style = getComputedStyle(sn);
        return style.transform !== "none" && style.transform !== "matrix(1, 0, 0, 1, 0, 0)";
      });
      const bodyOverflowX = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      console.log("mobile sidenav off-canvas by default:", sidenavHidden);
      console.log("mobile dashboard has horizontal overflow:", bodyOverflowX);
      await page.screenshot({ path: "C:/Users/HP/AppData/Local/Temp/claude/c--Users-HP-Documents-Vs-Code-edtech-new/def66857-90bc-4e11-a42f-ee7b683fba35/scratchpad/tc_dashboard_mobile.png" });

      // ---- Desktop: chat ----
      await page.setViewport({ width: 1400, height: 900 });
      await page.goto(`http://localhost:3000/teacher/class-chat/${ids.classroomId}`, { waitUntil: "networkidle0" });
      await new Promise((r) => setTimeout(r, 700));
      const chatDesktopInfo = await page.evaluate(() => {
        const layout = getComputedStyle(document.querySelector(".tc-chat-layout"));
        const msgs = document.querySelectorAll(".tc-chat-msg").length;
        const announcementCard = !!document.querySelector(".tc-announcement-card");
        const mutedIcon = document.querySelector(".tc-icon-btn.muted") ? document.querySelector(".tc-icon-btn.muted").outerHTML : null;
        return { flexDirection: layout.flexDirection, msgCount: msgs, announcementCard, mutedIcon };
      });
      console.log("desktop chat:", JSON.stringify(chatDesktopInfo));
      await page.screenshot({ path: "C:/Users/HP/AppData/Local/Temp/claude/c--Users-HP-Documents-Vs-Code-edtech-new/def66857-90bc-4e11-a42f-ee7b683fba35/scratchpad/tc_chat_desktop.png" });

      // ---- Mobile: chat (tab toggle) ----
      await page.setViewport({ width: 375, height: 800 });
      await page.reload({ waitUntil: "networkidle0" });
      await new Promise((r) => setTimeout(r, 700));
      const mobileChatInitial = await page.evaluate(() => ({
        chatVisible: !document.getElementById("chatPanel").classList.contains("tc-hidden-mobile"),
        studentsVisible: !document.getElementById("studentPanel").classList.contains("tc-hidden-mobile"),
        tabsVisible: getComputedStyle(document.querySelector(".tc-chat-tabs")).display !== "none",
      }));
      console.log("mobile chat initial state:", JSON.stringify(mobileChatInitial));
      await page.click("#tabStudentsBtn");
      await new Promise((r) => setTimeout(r, 200));
      const mobileChatAfterTab = await page.evaluate(() => ({
        chatVisible: !document.getElementById("chatPanel").classList.contains("tc-hidden-mobile"),
        studentsVisible: !document.getElementById("studentPanel").classList.contains("tc-hidden-mobile"),
      }));
      console.log("mobile chat after clicking Students tab:", JSON.stringify(mobileChatAfterTab));
      const chatBodyOverflowX = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      console.log("mobile chat has horizontal overflow:", chatBodyOverflowX);
      await page.screenshot({ path: "C:/Users/HP/AppData/Local/Temp/claude/c--Users-HP-Documents-Vs-Code-edtech-new/def66857-90bc-4e11-a42f-ee7b683fba35/scratchpad/tc_chat_mobile.png" });

      console.log("console errors:", JSON.stringify(consoleErrors));
    } finally {
      await browser.close();
    }
  } catch (e) {
    console.error("TEST_ERROR", e);
  } finally {
    // Cleanup
    if (ids.classroomId) {
      await pool.query("DELETE FROM classroom_announcements WHERE classroom_id=$1", [ids.classroomId]);
      await pool.query("DELETE FROM class_messages WHERE classroom_id=$1", [ids.classroomId]);
      await pool.query("DELETE FROM muted_students WHERE classroom_id=$1", [ids.classroomId]);
      await pool.query("DELETE FROM classroom_teachers WHERE classroom_id=$1", [ids.classroomId]);
    }
    if (ids.schoolId) await pool.query("DELETE FROM user_school WHERE school_id=$1", [ids.schoolId]);
    if (ids.classroomId) await pool.query("DELETE FROM classrooms WHERE id=$1", [ids.classroomId]);
    if (ids.schoolId) await pool.query("DELETE FROM schools WHERE id=$1", [ids.schoolId]);
    const userIds = [ids.teacherId, ids.student1Id].filter(Boolean);
    if (userIds.length) await pool.query("DELETE FROM users2 WHERE id = ANY($1)", [userIds]);
    console.log("CLEANUP_OK");
    await pool.end();
  }
})();
