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

exports.exportClassroomSummary = async (req, res) => {
  const { classroomId } = req.params;

  res.redirect(`/admin/classrooms/${classroomId}/dashboard`);
};
