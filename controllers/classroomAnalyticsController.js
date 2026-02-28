const pool = require("../models/db");

exports.getClassroomDashboard = async (req, res) => {
  try {
    const { classroomId } = req.params;

    /* ============================
       1️⃣ Fetch Classroom Info
    ============================ */

    const classroomResult = await pool.query(
    `
    SELECT 
        c.*,
        s.id AS school_id,
        s.name AS school_name,
        s.email AS school_email,
        s.phone AS school_phone,
        s.address AS school_address,
        s.logo_url AS school_logo
    FROM classrooms c
    JOIN schools s ON c.school_id = s.id
    WHERE c.id = $1
    `,
    [classroomId]
    );

    const classroom = classroomResult.rows[0];

    if (!classroom) {
    return res.status(404).send("Classroom not found");
    }


    /* ============================
       2️⃣ Total Students
    ============================ */

    const studentsResult = await pool.query(
      `
      SELECT u.id, u.fullname
      FROM users2 u
      JOIN user_school us ON us.user_id = u.id
      WHERE us.classroom_id = $1
      AND us.role_in_school = 'student'
      `,
      [classroomId]
    );

    const students = studentsResult.rows;
    const totalStudents = students.length;

    /* ============================
       3️⃣ Lesson Completion Stats
    ============================ */

    const lessonStats = await pool.query(
      `
      SELECT 
        u.id,
        u.fullname,
        COUNT(ulp.lesson_id) FILTER (WHERE ulp.completed_at IS NOT NULL) AS completed,
        COUNT(l.id) AS total_lessons
      FROM users2 u
      JOIN user_school us ON us.user_id = u.id
      JOIN classroom_courses cc ON cc.classroom_id = us.classroom_id
      JOIN modules m ON m.course_id = cc.course_id
      JOIN lessons l ON l.module_id = m.id
      LEFT JOIN user_lesson_progress ulp
        ON ulp.lesson_id = l.id AND ulp.user_id = u.id
      WHERE us.classroom_id = $1
      AND us.role_in_school = 'student'
      GROUP BY u.id
      `,
      [classroomId]
    );

    /* ============================
       4️⃣ Quiz Average Per Student
    ============================ */

    const quizStats = await pool.query(
      `
      SELECT 
        u.id,
        AVG(qs.score) AS quiz_avg
      FROM users2 u
      JOIN user_school us ON us.user_id = u.id
      LEFT JOIN quiz_submissions qs
        ON qs.student_id = u.id
      WHERE us.classroom_id = $1
      AND us.role_in_school = 'student'
      GROUP BY u.id
      `,
      [classroomId]
    );

    /* ============================
       5️⃣ Merge Student Metrics
    ============================ */

    // const studentMetrics = students.map(student => {
    //   const lessonData = lessonStats.rows.find(s => s.id === student.id);
    //   const quizData = quizStats.rows.find(s => s.id === student.id);

    //   const completionPercent = lessonData && lessonData.total_lessons > 0
    //     ? Math.round((lessonData.completed / lessonData.total_lessons) * 100)
    //     : 0;

    //   const quizAvg = quizData && quizData.quiz_avg
    //     ? Math.round(quizData.quiz_avg)
    //     : 0;

    //   const overallScore = Math.round((completionPercent + quizAvg) / 2);

    //   return {
    //     ...student,
    //     completionPercent,
    //     quizAvg,
    //     overallScore
    //   };
    // });

    const studentMetrics = students.map(student => {
    const lessonData = lessonStats.rows.find(s => s.id === student.id);
    const quizData = quizStats.rows.find(s => s.id === student.id);

    const completedLessons = lessonData ? Number(lessonData.completed) : 0;
    const totalLessons = lessonData ? Number(lessonData.total_lessons) : 0;

    const completionPercent =
        totalLessons > 0
        ? Math.round((completedLessons / totalLessons) * 100)
        : 0;

    const quizAvg =
        quizData && quizData.quiz_avg
        ? parseFloat(quizData.quiz_avg).toFixed(1)
        : "0.0";

    const overallScore = Math.round(
        (completionPercent + parseFloat(quizAvg)) / 2
    );

    return {
        ...student,
        completedLessons,
        totalLessons,
        completionPercent,
        quizAvg,
        overallScore
    };
    });

    /* ============================
       6️⃣ Leaderboard
    ============================ */

    const leaderboard = [...studentMetrics]
      .sort((a, b) => b.overallScore - a.overallScore)
      .slice(0, 10);

    /* ============================
       7️⃣ At-Risk Students
    ============================ */

    const atRiskStudents = studentMetrics.filter(
      s => s.completionPercent < 40 || s.quizAvg < 50
    );

    /* ============================
       8️⃣ Class Averages
    ============================ */

    const averageCompletion =
      studentMetrics.reduce((sum, s) => sum + s.completionPercent, 0) /
      totalStudents;

    const averageQuiz =
      studentMetrics.reduce((sum, s) => sum + s.quizAvg, 0) /
      totalStudents;

    res.render("admin/classroom-dashboard", {
        info: req.companyInfo || {},
        role: req.userRole || "admin",
        currentPage: "schools",
      classroom,
      totalStudents,
      averageCompletion: Math.round(averageCompletion || 0),
      averageQuiz: Math.round(averageQuiz || 0),
      studentMetrics,
      leaderboard,
      atRiskStudents
    });

  } catch (error) {
    console.error(error);
    res.status(500).send("Server Error");
  }
};

/* ============================
   EXPORT FUNCTION (Basic JSON)
============================ */

const puppeteer = require("puppeteer");

exports.exportClassroomSummary = async (req, res) => {
  try {
    const { classroomId } = req.params;

    /* ============================
       1️⃣ Fetch Classroom Info
    ============================ */

    const classroomResult = await pool.query(
      `
      SELECT 
          c.*,
          s.name AS school_name,
          s.logo_url AS school_logo
      FROM classrooms c
      JOIN schools s ON c.school_id = s.id
      WHERE c.id = $1
      `,
      [classroomId]
    );

    const classroom = classroomResult.rows[0];
    if (!classroom) return res.status(404).send("Classroom not found");

    /* ============================
       2️⃣ Get Students
    ============================ */

    const studentsResult = await pool.query(
      `
      SELECT u.id, u.fullname
      FROM users2 u
      JOIN user_school us ON us.user_id = u.id
      WHERE us.classroom_id = $1
      AND us.role_in_school = 'student'
      `,
      [classroomId]
    );

    const students = studentsResult.rows;
    const totalStudents = students.length;

    /* ============================
       3️⃣ Lesson Completion
    ============================ */

    // const lessonStats = await pool.query(
    //   `
    //   SELECT 
    //     u.id,
    //     COUNT(ulp.lesson_id) FILTER (WHERE ulp.completed_at IS NOT NULL) AS completed,
    //     COUNT(l.id) AS total_lessons
    //   FROM users2 u
    //   JOIN user_school us ON us.user_id = u.id
    //   JOIN classroom_courses cc ON cc.classroom_id = us.classroom_id
    //   JOIN modules m ON m.course_id = cc.course_id
    //   JOIN lessons l ON l.module_id = m.id
    //   LEFT JOIN user_lesson_progress ulp
    //     ON ulp.lesson_id = l.id AND ulp.user_id = u.id
    //   WHERE us.classroom_id = $1
    //   AND us.role_in_school = 'student'
    //   GROUP BY u.id
    //   `,
    //   [classroomId]
    // );

    const lessonStats = await pool.query(
      `
      SELECT 
        u.id,
        COUNT(DISTINCT l.id) AS total_lessons,
        COUNT(DISTINCT ulp.lesson_id) FILTER (
          WHERE ulp.completed_at IS NOT NULL
        ) AS completed
      FROM users2 u
      JOIN user_school us ON us.user_id = u.id
      JOIN classroom_courses cc ON cc.classroom_id = us.classroom_id
      JOIN modules m ON m.course_id = cc.course_id
      JOIN lessons l ON l.module_id = m.id
      LEFT JOIN user_lesson_progress ulp
        ON ulp.lesson_id = l.id 
        AND ulp.user_id = u.id
      WHERE us.classroom_id = $1
      AND us.role_in_school = 'student'
      GROUP BY u.id
      `,
      [classroomId]
    );
    /* ============================
       4️⃣ Quiz Average
    ============================ */

    const quizStats = await pool.query(
      `
      SELECT 
        u.id,
        AVG(qs.score) AS quiz_avg
      FROM users2 u
      JOIN user_school us ON us.user_id = u.id
      LEFT JOIN quiz_submissions qs
        ON qs.student_id = u.id
      WHERE us.classroom_id = $1
      AND us.role_in_school = 'student'
      GROUP BY u.id
      `,
      [classroomId]
    );

    const quizCountStats = await pool.query(
      `
      SELECT
        u.id,
        COUNT(DISTINCT q.id) AS total_quiz,
        COUNT(DISTINCT qs.id) AS quizzes_done
      FROM users2 u
      JOIN user_school us ON us.user_id = u.id
      JOIN classroom_courses cc ON cc.classroom_id = us.classroom_id
      JOIN modules m ON m.course_id = cc.course_id
      JOIN lessons l ON l.module_id = m.id
      JOIN quizzes q ON q.lesson_id = l.id
      LEFT JOIN quiz_submissions qs
        ON qs.quiz_id = q.id
        AND qs.student_id = u.id
      WHERE us.classroom_id = $1
      AND us.role_in_school = 'student'
      GROUP BY u.id
      `,
      [classroomId]
    );
    /* ============================
       5️⃣ Merge Metrics
    ============================ */

    const studentMetrics = students.map(student => {
      const lessonData = lessonStats.rows.find(s => s.id === student.id);
      const quizData = quizStats.rows.find(s => s.id === student.id);
      const quizCountData = quizCountStats.rows.find(s => s.id === student.id);

      const completedLessons = lessonData ? Number(lessonData.completed) : 0;
      const totalLessons = lessonData ? Number(lessonData.total_lessons) : 0;

      const quizzesDone = quizCountData ? Number(quizCountData.quizzes_done) : 0;
      const totalQuiz = quizCountData ? Number(quizCountData.total_quiz) : 0;

      const completionPercent =
        totalLessons > 0
          ? Math.round((completedLessons / totalLessons) * 100)
          : 0;

      const quizAvg = Math.round(
        quizData && quizData.quiz_avg
          ? parseFloat(quizData.quiz_avg)
          : 0);

      const overallScore = Math.round(
        (completionPercent + quizAvg) / 2
      );

      return {
        ...student,
        completedLessons,
        totalLessons,
        quizzesDone,
        totalQuiz,
        completionPercent,
        quizAvg,
        overallScore
      };
    });
    /* ============================
       6️⃣ Leaderboard
    ============================ */

    const leaderboard = [...studentMetrics]
      .sort((a, b) => b.overallScore - a.overallScore)
      .slice(0, 10);

    /* ============================
       7️⃣ At Risk
    ============================ */

    const atRiskStudents = studentMetrics.filter(
      s => s.completionPercent < 40 || s.quizAvg < 50
    );

    /* ============================
       8️⃣ Averages
    ============================ */

    const averageCompletion =
      totalStudents > 0
        ? Math.round(
            studentMetrics.reduce((sum, s) => sum + s.completionPercent, 0) /
              totalStudents
          )
        : 0;

    const averageQuiz =
      totalStudents > 0
        ? Math.round(
            studentMetrics.reduce((sum, s) => sum + s.quizAvg, 0) /
              totalStudents
          )
        : 0;

    /* ============================
       9️⃣ BUILD HTML
    ============================ */

    const html = `
    <html>
    <head>
    <style>
    body { font-family: Arial; padding:40px; }
    .card { display:inline-block; width:25%; padding:20px; color:white; border-radius:8px; margin-right:10px;}
    .blue{background:#3498db;}
    .green{background:#2ecc71;}
    .orange{background:#f39c12;}
    table{width:100%; border-collapse:collapse; margin-top:20px;}
    th{background:#34495e;color:white;padding:8px;}
    td{padding:8px;border-bottom:1px solid #ddd;}
    .risk{background:#fdecea;}
    </style>
    </head>
    <body>
    <div style="background-color:#fffffff; display:flex;align-items:center;gap:20px; justify-content:space-between; border-bottom:2px solid #b19915; padding-bottom:15px; margin-bottom:30px; box-shadow:0 2px 5px rgba(0,0,0,0.1);">
      <div style="margin-top:10px;">
        <h1>Classroom Analytics Report</h1>
        <p><strong>School:</strong> ${classroom.school_name}</p>
        <p><strong>Classroom:</strong> ${classroom.name}</p>
        <p><strong>Date:</strong> ${new Date().toDateString()}</p>
      </div>
      <div><img src="${classroom.school_logo}" style="width:80px;height:80px;object-fit:contain;"></div>
    </div>

    <div>
      <div class="card blue">
        <h2>${totalStudents}</h2>
        <p>Total Students</p>
      </div>

      <div class="card green">
        <h2>${averageCompletion}%</h2>
        <p>Average Completion</p>
      </div>

      <div class="card orange">
        <h2>${averageQuiz}%</h2>
        <p>Average Quiz</p>
      </div>
    </div>

    <h3>Leaderboard</h3>
    <table>
    <tr>
      <th>Rank</th>
      <th>Name</th>
      <th>Lessons</th>
      <th>Quizzes</th>
      <th>Completion %</th>
      <th>Quiz Avg</th>
      <th>Overall</th>
    </tr>

    ${leaderboard.map((s,i)=>`
      <tr>
        <td>${i+1}</td>
        <td>${s.fullname}</td>
        <td>${s.completedLessons} / ${s.totalLessons}</td>
        <td>${s.quizzesDone} / ${s.totalQuiz}</td>
        <td>${s.completionPercent}%</td>
        <td>${s.quizAvg}%</td>
        <td><strong>${s.overallScore}%</strong></td>
      </tr>
    `).join("")}
    </table>

    <h3>At Risk Students</h3>
    <table>
    <tr>
      <th>Name</th>
      <th>Lessons</th>
      <th>Quizzes</th>
      <th>Completion %</th>
      <th>Quiz Avg</th>
      <th>Overall</th>
    </tr>

    ${atRiskStudents.length > 0
      ? atRiskStudents.map(s=>`
        <tr class="risk">
          <td>${s.fullname}</td>
          <td>${s.completedLessons} / ${s.totalLessons}</td>
          <td>${s.quizzesDone} / ${s.totalQuiz}</td>
          <td>${s.completionPercent}%</td>
          <td>${s.quizAvg}%</td>
          <td><strong>${s.overallScore}%</strong></td>
        </tr>
      `).join("")
      : `<tr><td colspan="5">No students at risk</td></tr>`
    }
    </table>

    </body>
    </html>
    `;

    /* ============================
       10️⃣ Generate PDF
    ============================ */

    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdfBuffer = await page.pdf({
      format: "A4",
      landscape: true,
      printBackground: true,
    });

    await browser.close();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${classroom.name}-analytics.pdf`
    );

    res.send(pdfBuffer);

  } catch (err) {
    console.error(err);
    res.status(500).send("Export failed");
  }
};