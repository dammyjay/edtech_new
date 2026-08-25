const pool = require("../models/db");
const userController = require("./userController");
const getAnnouncements = require("../utils/getAnnouncements");
const generatePdf = require("../utils/generatePdf");
const { renderQuizReportHtml, renderCourseReportHtml } = require("../utils/reportTemplate");
const { computeClassroomTermAnalytics } = require("../services/classroomTermAnalyticsService");
const { getStudentStreak } = require("../services/streakService");
const { getLevelForXp } = require("../utils/xpLevels");
const { notifyUser, notifyClassroom, notifyNewDirectMessage, notifyNewClassMessage, notifyClassroomAnnouncement } = require("../utils/notify");
// const puppeteer = require("puppeteer");

// ----------------- DASHBOARD WRAPPER -----------------
exports.getDashboard = async (req, res) => {
  const announcements = await getAnnouncements("dashboard");
  const infoRes = await pool.query("SELECT * FROM company_info ORDER BY id DESC LIMIT 1");
  const info = infoRes.rows[0] || {};
  // Only render the shell with sidenav + empty main-content
  res.render("teacher/dashboard", { teacher: req.user, announcements, info });
};

exports.getDashboardData = async (req, res) => {
  try {
    const teacherId = req.user.id;
    const { classId } = req.query;
    const termId = req.query.termId ? parseInt(req.query.termId, 10) : undefined;
    const announcements = await getAnnouncements("dashboard");

    let classFilter = "";
    // Same alias `ct` used inside the "struggling students" subquery below —
    // that subquery's FROM clause aliases classroom_teachers as `ct` too, so
    // this one filter fragment is reused verbatim across every query in this
    // function rather than needing a per-query variant.
    const params = [teacherId];

    if (classId && classId !== "all") {
      params.push(classId);
      classFilter = ` AND ct.classroom_id = $2 `;
    }

     const profileRes = await pool.query(
       `SELECT fullname, email, profile_picture
       FROM users2 
       WHERE id = $1`,
       [teacherId]
     );
     const profile = profileRes.rows[0] || {};

    // ✅ Key Stats (with filter)
    const statsRes = await pool.query(
      `WITH last_activity AS (
         SELECT user_id, MAX(created_at) AS last_login
         FROM activities GROUP BY user_id
       )
       SELECT 
          COUNT(DISTINCT ct.classroom_id) AS total_classes,
          COUNT(DISTINCT s.id) AS total_students,
          COUNT(DISTINCT l.id) AS total_lessons,
          COUNT(DISTINCT ulp.lesson_id) FILTER (WHERE ulp.completed_at IS NOT NULL) AS lessons_completed,
          ROUND(AVG(qs.score::numeric),1) AS avg_quiz_score,
          ROUND(AVG(asub.grade::numeric),1) AS avg_assignment_score,
          ROUND(
            (COUNT(DISTINCT u.id) FILTER (WHERE la.last_login >= NOW() - INTERVAL '7 days')
             * 100.0 / NULLIF(COUNT(DISTINCT u.id),0))::numeric, 1
          ) AS engagement_last7
       FROM classroom_teachers ct
       JOIN user_school s ON ct.classroom_id = s.classroom_id 
                          AND s.role_in_school = 'student' 
                          AND s.approved = true
       JOIN users2 u ON u.id = s.user_id
       LEFT JOIN last_activity la ON la.user_id = u.id
       LEFT JOIN classroom_courses cc ON ct.classroom_id = cc.classroom_id
       LEFT JOIN courses cr ON cc.course_id = cr.id
       LEFT JOIN modules m ON cr.id = m.course_id
       LEFT JOIN lessons l ON l.module_id = m.id
       LEFT JOIN user_lesson_progress ulp ON ulp.user_id = u.id AND ulp.lesson_id = l.id
       LEFT JOIN quiz_submissions qs ON qs.student_id = u.id
       LEFT JOIN assignment_submissions asub ON asub.student_id = u.id
       WHERE ct.teacher_id = $1 ${classFilter}
       GROUP BY ct.teacher_id`,
      params
    );
    const keyStats = statsRes.rows[0] || {};

    // ✅ Class overview
    const classStatsRes = await pool.query(
      `WITH last_activity AS (
         SELECT user_id, MAX(created_at) AS last_login
         FROM activities GROUP BY user_id
       )
       SELECT 
          c.id, 
          c.name AS class_name,
          COUNT(DISTINCT s.id) AS students,
          COUNT(DISTINCT l.id) AS total_lessons,
          COUNT(DISTINCT ulp.lesson_id) FILTER (WHERE ulp.completed_at IS NOT NULL) AS lessons_completed,
          ROUND(AVG(qs.score::numeric),1) AS avg_quiz_score,
          ROUND(AVG(asub.grade::numeric),1) AS avg_assignment_score,
          ROUND(
            (COUNT(DISTINCT u.id) FILTER (WHERE la.last_login >= NOW() - INTERVAL '7 days')
             * 100.0 / NULLIF(COUNT(DISTINCT u.id),0))::numeric, 1
          ) AS engagement
       FROM classrooms c
       JOIN classroom_teachers ct ON c.id = ct.classroom_id
       JOIN user_school s ON s.classroom_id = c.id 
                          AND s.role_in_school = 'student' 
                          AND s.approved = true
       JOIN users2 u ON u.id = s.user_id
       LEFT JOIN last_activity la ON la.user_id = u.id
       LEFT JOIN classroom_courses cc ON c.id = cc.classroom_id
       LEFT JOIN courses cr ON cc.course_id = cr.id
       LEFT JOIN modules m ON cr.id = m.course_id
       LEFT JOIN lessons l ON l.module_id = m.id
       LEFT JOIN user_lesson_progress ulp ON ulp.user_id = u.id AND ulp.lesson_id = l.id
       LEFT JOIN quiz_submissions qs ON qs.student_id = u.id
       LEFT JOIN assignment_submissions asub ON asub.student_id = u.id
       WHERE ct.teacher_id = $1 ${classFilter}
       GROUP BY c.id, c.name
       ORDER BY c.name`,
      params
    );
    const classStats = classStatsRes.rows;

    // ✅ Top students
    const topStudentsRes = await pool.query(
      `SELECT u.id, u.fullname, ROUND(AVG(qs.score::numeric),1) AS avg_score
       FROM users2 u
       JOIN quiz_submissions qs ON qs.student_id = u.id
       WHERE u.id IN (
         SELECT us.user_id
         FROM user_school us
         JOIN classroom_teachers ct ON ct.classroom_id = us.classroom_id
         WHERE ct.teacher_id = $1 ${classFilter}
           AND us.role_in_school = 'student'
       )
       GROUP BY u.id
       ORDER BY avg_score DESC NULLS LAST
       LIMIT 3`,
      params
    );
    const topStudents = topStudentsRes.rows;

    // ✅ Struggling students
    const strugglingStudentsRes = await pool.query(
      `SELECT u.id, u.fullname,
              COUNT(ulp.lesson_id) FILTER (WHERE ulp.completed_at IS NOT NULL) AS lessons_done
       FROM users2 u
       JOIN user_school us ON us.user_id = u.id
       LEFT JOIN user_lesson_progress ulp ON ulp.user_id = u.id
       WHERE us.classroom_id IN (
         SELECT classroom_id FROM classroom_teachers ct WHERE teacher_id = $1 ${classFilter}
       )
       AND us.role_in_school = 'student'
       GROUP BY u.id
       ORDER BY lessons_done ASC NULLS FIRST
       LIMIT 3`,
      params
    );
    const strugglingStudents = strugglingStudentsRes.rows;

    // ✅ Pending assignments
    const pendingAssignmentsRes = await pool.query(
      `SELECT COUNT(asub.*) AS pending_assignments
       FROM assignment_submissions asub
       JOIN module_assignments ma ON ma.id = asub.assignment_id
       JOIN modules m ON m.id = ma.module_id
       JOIN courses cr ON cr.id = m.course_id
       JOIN classroom_courses cc ON cc.course_id = cr.id
       JOIN classroom_teachers ct ON ct.classroom_id = cc.classroom_id
       WHERE ct.teacher_id = $1 ${classFilter}
         AND asub.grade IS NULL`,
      params
    );
    const pendingAssignments =
      pendingAssignmentsRes.rows[0]?.pending_assignments || 0;

    // ✅ Term-aware leaderboard + at-risk students, per classroom the
    // teacher owns — a thin wrapper over the exact same service school-admin
    // already uses (services/classroomTermAnalyticsService.js), which is
    // already classroom-scoped and caller-agnostic. Not touched by classId
    // filtering (that only affects the stat cards above); always shown for
    // every classroom the teacher has. `termId` comes from the dashboard's
    // term selector — undefined defaults to the active term.
    const analytics = await getTeacherClassroomAnalytics(teacherId, termId);

    // Every term this teacher's school has, for the dashboard's term
    // selector — any one classroom's analytics result carries its own
    // school's term list, and a teacher only ever has classrooms in one
    // school, so the first classroom's list is authoritative here.
    const terms = analytics[0]?.terms || [];
    const selectedTermId = termId || analytics[0]?.selectedTerm?.id || null;

    // The class-filter dropdown's AJAX refresh only wants the inner content
    // re-rendered (stats/classes/leaderboard/charts) — the full template
    // also contains the hero + dropdown + #dashboardContent wrapper, which
    // would otherwise get nested a second time inside itself.
    const viewName = req.query.partial ? "teacher/sections/dashboard-inner" : "teacher/sections/dashboard";
    res.render(viewName, {
      keyStats,
      classStats,
      topStudents,
      strugglingStudents,
      pendingAssignments,
      profile,
      analytics,
      terms,
      selectedTermId,
      classId: classId || "all",
      teacher: req.user,
      announcements,
    });
  } catch (err) {
    console.error("Dashboard Data Error:", err);
    res.status(500).send("<p>Error loading dashboard data</p>");
  }
};

// Thin wrapper over computeClassroomTermAnalytics — loops the teacher's own
// classrooms through the exact same, already-correct function school-admin
// uses (services/classroomTermAnalyticsService.js), so the leaderboard/
// at-risk-student logic isn't duplicated. Returns one entry per classroom.
async function getTeacherClassroomAnalytics(teacherId, termId) {
  const classroomsRes = await pool.query(
    `SELECT c.id, c.school_id, c.name
     FROM classroom_teachers ct
     JOIN classrooms c ON c.id = ct.classroom_id
     WHERE ct.teacher_id = $1
     ORDER BY c.name`,
    [teacherId]
  );

  return Promise.all(
    classroomsRes.rows.map(async (classroom) => {
      try {
        const result = await computeClassroomTermAnalytics(classroom.school_id, classroom.id, termId);
        return { classroomId: classroom.id, classroomName: classroom.name, ...result };
      } catch (err) {
        console.error(`Analytics failed for classroom ${classroom.id}:`, err.message);
        return { classroomId: classroom.id, classroomName: classroom.name, terms: [], selectedTerm: null, leaderboard: [], atRiskStudents: [] };
      }
    })
  );
}


exports.getClassesSection = async (req, res) => {
  try {
    const teacherId = req.user.id;

    // Fetch teacher's classes
    const classesRes = await pool.query(
      `SELECT c.id, c.name
       FROM classrooms c
       JOIN classroom_teachers ct ON ct.classroom_id = c.id
       WHERE ct.teacher_id = $1`,
      [teacherId]
    );
    const classes = classesRes.rows;

    // Students per class
    const studentCountsRes = await pool.query(
      `SELECT c.id, c.name, COUNT(us.user_id) AS student_count
       FROM classrooms c
       JOIN classroom_teachers ct ON ct.classroom_id = c.id
       LEFT JOIN user_school us 
         ON us.classroom_id = c.id 
        AND us.role_in_school = 'student' 
        AND us.approved = true
       WHERE ct.teacher_id = $1
       GROUP BY c.id, c.name
       ORDER BY c.name`,
      [teacherId]
    );

    // Avg quiz score per class
    const quizScoresRes = await pool.query(
      `SELECT c.id, c.name, ROUND(AVG(qs.score::numeric),1) AS avg_quiz_score
       FROM classrooms c
       JOIN classroom_teachers ct ON ct.classroom_id = c.id
       LEFT JOIN user_school us 
         ON us.classroom_id = c.id 
        AND us.role_in_school = 'student' 
        AND us.approved = true
       LEFT JOIN quiz_submissions qs ON qs.student_id = us.user_id
       WHERE ct.teacher_id = $1
       GROUP BY c.id, c.name
       ORDER BY c.name`,
      [teacherId]
    );

    // Gender distribution (all students across teacher's classes)
    const genderRes = await pool.query(
      `SELECT u.gender, COUNT(*) AS count
       FROM classrooms c
       JOIN classroom_teachers ct ON ct.classroom_id = c.id
       JOIN user_school us ON us.classroom_id = c.id 
                          AND us.role_in_school = 'student' 
                          AND us.approved = true
       JOIN users2 u ON u.id = us.user_id
       WHERE ct.teacher_id = $1
       GROUP BY u.gender`,
      [teacherId]
    );

    // ✅ Total lessons across all teacher’s classes
    const lessonsRes = await pool.query(
      `SELECT COUNT(l.id) AS total_lessons
       FROM lessons l
       JOIN modules m ON m.id = l.module_id
       JOIN courses co ON co.id = m.course_id
       JOIN classroom_courses cc ON cc.course_id = co.id
       JOIN classrooms c ON c.id = cc.classroom_id
       JOIN classroom_teachers ct ON ct.classroom_id = c.id
       WHERE ct.teacher_id = $1`,
      [teacherId]
    );

    // ✅ Lessons per class
    const lessonsPerClassRes = await pool.query(
      `SELECT c.id, c.name, COUNT(l.id) AS lesson_count
       FROM classrooms c
       JOIN classroom_teachers ct ON ct.classroom_id = c.id
       LEFT JOIN classroom_courses cc ON cc.classroom_id = c.id
       LEFT JOIN courses co ON co.id = cc.course_id
       LEFT JOIN modules m ON m.course_id = co.id
       LEFT JOIN lessons l ON l.module_id = m.id
       WHERE ct.teacher_id = $1
       GROUP BY c.id, c.name
       ORDER BY c.name`,
      [teacherId]
    );

    // === Build overview ===
    const totalClasses = classes.length;
    const totalStudents = studentCountsRes.rows.reduce(
      (sum, c) => sum + parseInt(c.student_count || 0),
      0
    );
    const avgQuizScore = quizScoresRes.rows.length
      ? (
          quizScoresRes.rows.reduce(
            (sum, c) => sum + (parseFloat(c.avg_quiz_score) || 0),
            0
          ) / quizScoresRes.rows.length
        ).toFixed(1)
      : null;

    const overview = {
      total_classes: totalClasses,
      total_students: totalStudents,
      avg_quiz_score: avgQuizScore,
      total_lessons: parseInt(lessonsRes.rows[0]?.total_lessons || 0), // ✅ real total
      avg_assignment_score: "–",
      engagement_last7: 0,
    };

    // Term-aware leaderboard/at-risk signal per classroom — same service
    // reused throughout this rework, so "Classes" isn't just headcounts.
    const analytics = await getTeacherClassroomAnalytics(teacherId);
    const analyticsByClassId = new Map(analytics.map((a) => [a.classroomId, a]));

    res.render("teacher/sections/classes", {
      classes,
      overview,
      studentCounts: studentCountsRes.rows,
      quizScores: quizScoresRes.rows,
      genderStats: genderRes.rows,
      lessonsPerClass: lessonsPerClassRes.rows, // ✅ pass into EJS
      analyticsByClassId,
    });
  } catch (err) {
    console.error("Teacher Classes Section Error:", err);
    res.status(500).send("<p>Error loading classes</p>");
  }
};



// ----------------- STUDENTS SECTION -----------------
exports.getStudentsSection = async (req, res) => {
  try {
    const teacherId = req.user.id;
    const studentsRes = await pool.query(
      `SELECT u.id, u.fullname, u.email, c.name AS classroom_name
       FROM user_school us
       JOIN users2 u ON u.id = us.user_id
       JOIN classrooms c ON c.id = us.classroom_id
       JOIN classroom_teachers ct ON ct.classroom_id = us.classroom_id
       WHERE ct.teacher_id = $1 AND us.role_in_school = 'student' AND us.approved = true`,
      [teacherId]
    );
    res.render("teacher/sections/students", { students: studentsRes.rows });
  } catch (err) {
    console.error("Teacher Students Section Error:", err);
    res.status(500).send("<p>Error loading students</p>");
  }
};

// ----------------- REPORTS SECTION -----------------
exports.getReportsSection = async (req, res) => {
  try {
    const teacherId = req.user.id;
    const reportsRes = await pool.query(
      `SELECT u.id, u.fullname, u.email, c.name AS classroom_name
       FROM user_school us
       JOIN users2 u ON u.id = us.user_id
       JOIN classrooms c ON c.id = us.classroom_id
       JOIN classroom_teachers ct ON ct.classroom_id = us.classroom_id
       WHERE ct.teacher_id = $1 AND us.role_in_school = 'student' AND us.approved = true`,
      [teacherId]
    );
    res.render("teacher/sections/reports", { students: reportsRes.rows });
  } catch (err) {
    console.error("Teacher Reports Section Error:", err);
    res.status(500).send("<p>Error loading reports</p>");
  }
};



// ----------------- STUDENT PROGRESS -----------------
exports.viewStudentProgress = async (req, res) => {
  try {
    const { id } = req.params; // studentId
    const teacherId = req.user.id;

    // ✅ Ensure teacher is authorized for this student via classroom
    const checkRes = await pool.query(
      `SELECT 1
       FROM user_school us
       JOIN classroom_teachers ct ON ct.classroom_id = us.classroom_id
       WHERE us.user_id = $1 AND ct.teacher_id = $2`,
      [id, teacherId]
    );

    if (checkRes.rowCount === 0) {
      return res.status(403).send("Not authorized to view this student");
    }

    // ✅ Student info
    const studentRes = await pool.query(
      `SELECT id, fullname, email, profile_picture FROM users2 WHERE id = $1`,
      [id]
    );
    if (!studentRes.rows.length) {
      return res.status(404).send("Student not found");
    }
    const student = studentRes.rows[0];

    // Gamification data — same infrastructure the admin/parent-facing
    // studentProgress page already uses, so a teacher sees a student's
    // achievements with the same depth/polish instead of a bare table.
    const streak = await getStudentStreak(id);
    const xpTotalRes = await pool.query(
      `SELECT COALESCE(SUM(xp), 0) AS total FROM xp_history WHERE user_id = $1`,
      [id]
    );
    const levelInfo = getLevelForXp(xpTotalRes.rows[0].total);
    const badgesRes = await pool.query(
      `SELECT ub.badge_name, ub.badge_image, ub.awarded_at, m.title AS module_title
       FROM user_badges ub
       LEFT JOIN modules m ON m.id = ub.module_id
       WHERE ub.user_id = $1
       ORDER BY ub.awarded_at DESC`,
      [id]
    );
    const certificatesRes = await pool.query(
      `SELECT uc.certificate_url, uc.issued_at, c.title AS course_title
       FROM user_certificates uc
       JOIN courses c ON c.id = uc.course_id
       WHERE uc.user_id = $1
       ORDER BY uc.issued_at DESC`,
      [id]
    );

    // ✅ Courses for this student (via classroom_courses + teacher tie)
    const coursesRes = await pool.query(
      `SELECT DISTINCT
      c.id,
      c.title AS course_title,
      cc.assigned_at
   FROM classroom_courses cc
   JOIN courses c ON c.id = cc.course_id
   JOIN classroom_teachers ct ON ct.classroom_id = cc.classroom_id
   JOIN user_school us ON us.classroom_id = cc.classroom_id
   WHERE us.user_id = $1
     AND ct.teacher_id = $2
   ORDER BY c.title`,
      [id, teacherId]
    );

    if (!coursesRes.rows.length) {
      return res.render("teacher/sections/student-progress", {
        student,
        courses: [],
        streak,
        levelInfo,
        badges: badgesRes.rows,
        certificates: certificatesRes.rows,
        overallQuizAvg: null,
        overallAssignmentAvg: null,
      });
    }

    const courseIds = coursesRes.rows.map((c) => c.id);

    // ✅ Modules
    const modulesRes = await pool.query(
      `SELECT id, title AS module_title, course_id
       FROM modules
       WHERE course_id = ANY($1::int[])
       ORDER BY order_number`,
      [courseIds]
    );

    // ✅ Lessons
    const lessonsRes = await pool.query(
      `SELECT l.id, l.title, l.module_id,
              CASE WHEN ulp.completed_at IS NOT NULL THEN true ELSE false END AS completed
       FROM lessons l
       LEFT JOIN user_lesson_progress ulp
              ON ulp.lesson_id = l.id AND ulp.user_id = $1
       WHERE l.module_id = ANY(SELECT id FROM modules WHERE course_id = ANY($2::int[]))
       ORDER BY l.order_number`,
      [id, courseIds]
    );

    // ✅ Quizzes (note: no module_id column → derive via lessons)
    const quizzesRes = await pool.query(
      `SELECT q.id, q.title, l.module_id, l.id AS lesson_id,
            COALESCE(qs.score, NULL) AS score
      FROM quizzes q
      JOIN lessons l ON q.lesson_id = l.id
      LEFT JOIN quiz_submissions qs
            ON qs.quiz_id = q.id AND qs.student_id = $1
      WHERE l.module_id = ANY(SELECT id FROM modules WHERE course_id = ANY($2::int[]))
      ORDER BY q.id
`,
      [id, courseIds]
    );

    // ✅ Module Assignments
    const assignmentsRes = await pool.query(
      `SELECT ma.id, ma.title, ma.module_id,
              COALESCE(asub.grade, NULL) AS grade,
              COALESCE(asub.total, NULL) AS total
       FROM module_assignments ma
       LEFT JOIN assignment_submissions asub
              ON asub.assignment_id = ma.id AND asub.student_id = $1
       WHERE ma.module_id = ANY(SELECT id FROM modules WHERE course_id = ANY($2::int[]))
       ORDER BY ma.id`,
      [id, courseIds]
    );

    // --- Build Nested Structure ---
    const courses = coursesRes.rows.map((course) => {
      const courseModules = modulesRes.rows.filter(
        (m) => m.course_id === course.id
      );

      const modules = courseModules.map((module) => {
        const moduleLessons = lessonsRes.rows.filter(
          (l) => l.module_id === module.id
        );

        const totalLessons = moduleLessons.length;
        const completedLessons = moduleLessons.filter(
          (l) => l.completed
        ).length;
        const modulePercent = totalLessons
          ? Math.round((completedLessons / totalLessons) * 100)
          : 0;

        const moduleQuizzes = quizzesRes.rows.filter(
          (q) => q.module_id === module.id
        );
        const moduleAssignments = assignmentsRes.rows.filter(
          (a) => a.module_id === module.id
        );

        return {
          ...module,
          lessons: moduleLessons,
          totalLessons,
          completedLessons,
          percent: modulePercent,
          quizzes: moduleQuizzes,
          assignments: moduleAssignments,
        };
      });

      // Course-level progress
      const totalLessons = modules.reduce((sum, m) => sum + m.totalLessons, 0);
      const completedLessons = modules.reduce(
        (sum, m) => sum + m.completedLessons,
        0
      );
      const coursePercent = totalLessons
        ? Math.round((completedLessons / totalLessons) * 100)
        : 0;

      return {
        ...course,
        modules,
        totalLessons,
        completedLessons,
        percent: coursePercent,
      };
    });

    // Overall quiz/assignment averages across everything just built, for
    // the hero's summary stats.
    const allQuizzes = courses.flatMap((c) => c.modules.flatMap((m) => m.quizzes));
    const scoredQuizzes = allQuizzes.filter((q) => q.score !== null && q.score !== undefined);
    const overallQuizAvg = scoredQuizzes.length
      ? Math.round(scoredQuizzes.reduce((sum, q) => sum + Number(q.score), 0) / scoredQuizzes.length)
      : null;

    const allAssignments = courses.flatMap((c) => c.modules.flatMap((m) => m.assignments));
    const scoredAssignments = allAssignments.filter((a) => a.total !== null && a.total !== undefined);
    const overallAssignmentAvg = scoredAssignments.length
      ? Math.round(scoredAssignments.reduce((sum, a) => sum + Number(a.total), 0) / scoredAssignments.length)
      : null;

    // ✅ Render
    res.render("teacher/sections/student-progress", {
      student,
      courses,
      streak,
      levelInfo,
      badges: badgesRes.rows,
      certificates: certificatesRes.rows,
      overallQuizAvg,
      overallAssignmentAvg,
    });
  } catch (err) {
    console.error("Teacher Student Progress Error:", err);
    res.status(500).send("Error loading progress");
  }
};

// ----------------- CLASSROOM STUDENTS -----------------
exports.viewClassroomStudents = async (req, res) => {
  try {
    const { id } = req.params; // classroomId
    const teacherId = req.user.id;
    const requestedTermId = req.query.termId ? parseInt(req.query.termId, 10) : undefined;

    // ✅ Check teacher permission
    const classroomRes = await pool.query(
      `SELECT c.id, c.name, c.school_id
       FROM classroom_teachers ct
       JOIN classrooms c ON c.id = ct.classroom_id
       WHERE ct.classroom_id = $1 AND ct.teacher_id = $2`,
      [id, teacherId]
    );
    if (classroomRes.rowCount === 0) {
      return res.status(403).send("Not authorized to view this class");
    }
    const classroom = classroomRes.rows[0];

    // Term-aware leaderboard / at-risk students / course breakdown — the
    // exact same service school-admin's classroom dashboard already uses,
    // so a teacher sees the same depth of analytics for their own
    // classroom instead of the thinner ad-hoc stats this view used to
    // compute on its own.
    const termAnalytics = await computeClassroomTermAnalytics(
      classroom.school_id,
      classroom.id,
      requestedTermId
    );

    // ✅ Fetch students with stats
    const studentsRes = await pool.query(
      `WITH last_activity AS (
         SELECT user_id, MAX(created_at) AS last_login
         FROM activities
         GROUP BY user_id
       )
       SELECT 
          u.id,
          u.fullname,
          u.email,
          u.gender,
          COUNT(DISTINCT ulp.lesson_id) FILTER (WHERE ulp.completed_at IS NOT NULL) AS lessons_completed,
          COUNT(DISTINCT l.id) AS total_lessons,
          ROUND(AVG(qs.score::numeric),1) AS avg_quiz_score,
          ROUND(AVG(asub.grade::numeric),1) AS avg_assignment_score,
          la.last_login
       FROM user_school us
       JOIN users2 u ON u.id = us.user_id
       LEFT JOIN last_activity la ON la.user_id = u.id
       LEFT JOIN classroom_courses cc ON us.classroom_id = cc.classroom_id
       LEFT JOIN courses cr ON cc.course_id = cr.id
       LEFT JOIN modules m ON m.course_id = cr.id
       LEFT JOIN lessons l ON l.module_id = m.id
       LEFT JOIN user_lesson_progress ulp ON ulp.user_id = u.id AND ulp.lesson_id = l.id
       LEFT JOIN quiz_submissions qs ON qs.student_id = u.id
       LEFT JOIN assignment_submissions asub ON asub.student_id = u.id
       WHERE us.classroom_id = $1
         AND us.role_in_school = 'student'
         AND us.approved = true
       GROUP BY u.id, u.fullname, u.email, u.gender, la.last_login
       ORDER BY u.fullname`,
      [id]
    );

    const students = studentsRes.rows;

    // ✅ Gender breakdown
    const genderSummary = await pool.query(
      `SELECT u.gender, COUNT(*) 
       FROM user_school us
       JOIN users2 u ON u.id = us.user_id
       WHERE us.classroom_id = $1 AND us.role_in_school = 'student' AND us.approved = true
       GROUP BY u.gender`,
      [id]
    );

    // ✅ Top student
    const topStudent = students.reduce(
      (best, s) =>
        (s.avg_quiz_score || 0) > (best.avg_quiz_score || 0) ? s : best,
      { avg_quiz_score: 0 }
    );

    // ✅ Avg progress
    const avgProgress =
      students.length > 0
        ? Math.round(
            students.reduce(
              (sum, s) =>
                sum +
                (s.total_lessons > 0
                  ? (s.lessons_completed / s.total_lessons) * 100
                  : 0),
              0
            ) / students.length
          )
        : 0;

    // ✅ Progress distribution
    const progressDist = { low: 0, mid: 0, high: 0 };
    students.forEach((s) => {
      const percent =
        s.total_lessons > 0 ? (s.lessons_completed / s.total_lessons) * 100 : 0;
      if (percent < 50) progressDist.low++;
      else if (percent < 75) progressDist.mid++;
      else progressDist.high++;
    });

    // ✅ Gamification chips per student (streak/level/badges) — the one
    // place in the teacher redesign that surfaces a student's existing
    // gamification data, mirroring how the parent dashboard does it per
    // child. Kept lightweight (no full studentProgress-style computation).
    const badgeCountsRes = await pool.query(
      `SELECT user_id, COUNT(*) AS count FROM user_badges WHERE user_id = ANY($1) GROUP BY user_id`,
      [students.map((s) => s.id)]
    );
    const badgeCountByStudent = new Map(
      badgeCountsRes.rows.map((r) => [r.user_id, parseInt(r.count, 10)])
    );
    const studentsWithGamification = await Promise.all(
      students.map(async (s) => {
        const streak = await getStudentStreak(s.id);
        const xpRes = await pool.query(
          `SELECT COALESCE(SUM(xp), 0) AS total FROM xp_history WHERE user_id = $1`,
          [s.id]
        );
        return {
          ...s,
          streak,
          levelInfo: getLevelForXp(xpRes.rows[0].total),
          badgeCount: badgeCountByStudent.get(s.id) || 0,
        };
      })
    );

    res.render("teacher/sections/classroom-students", {
      students: studentsWithGamification,
      classroomId: id,
      classroomName: classroom.name,
      genderSummary: genderSummary.rows,
      topStudent,
      avgProgress,
      progressDist,
      termAnalytics,
    });
  } catch (err) {
    console.error("Teacher Classroom Students Error:", err);
    res.status(500).send("Error loading students");
  }
};


exports.downloadQuizReport = async (req, res) => {
  const { studentId, quizId } = req.params;

  try {
    // --- Company Info
    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const info = infoResult.rows[0] || {};

    // --- Student + School info
    const studentRes = await pool.query(
      `SELECT u.id, u.fullname, u.email, 
              s.id AS school_id, s.name AS school_name, s.logo_url AS school_logo
       FROM users2 u
       LEFT JOIN user_school us ON u.id = us.user_id
       LEFT JOIN schools s ON us.school_id = s.id
       WHERE u.id = $1
       LIMIT 1`,
      [studentId]
    );
    if (!studentRes.rows.length)
      return res.status(404).send("Student not found");

    const student = studentRes.rows[0];

    // --- Quiz info + lesson/module/course
    const quizRes = await pool.query(
      `SELECT q.id, q.title AS quiz_title, l.title AS lesson_title, 
              m.title AS module_title, c.title AS course_title
       FROM quizzes q
       JOIN lessons l ON q.lesson_id = l.id
       JOIN modules m ON l.module_id = m.id
       JOIN courses c ON m.course_id = c.id
       WHERE q.id = $1`,
      [quizId]
    );
    if (!quizRes.rows.length) return res.status(404).send("Quiz not found");
    const quiz = quizRes.rows[0];

    // --- Submission info
    const submissionRes = await pool.query(
      `SELECT id, score, passed, created_at, review_data
       FROM quiz_submissions
       WHERE quiz_id = $1 AND student_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [quizId, studentId]
    );
    const submission = submissionRes.rows[0];

    // Parse review_data
    let reviewData = [];
    if (submission && submission.review_data) {
      try {
        reviewData = JSON.parse(submission.review_data);
      } catch (e) {
        reviewData = [];
      }
    }

    // --- Build HTML (shared gamified report template)
    const html = renderQuizReportHtml({
      info,
      student,
      courseTitle: quiz.course_title,
      moduleTitle: quiz.module_title,
      lessonTitle: quiz.lesson_title,
      quizTitle: quiz.quiz_title,
      score: submission ? submission.score : null,
      passed: submission ? submission.passed : false,
      takenAt: submission ? submission.created_at : null,
      reviewData,
    });

    // --- Generate PDF
    const pdfBuffer = await generatePdf(html);

    // --- File name with student + quiz
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${student.fullname.replace(/\s+/g, "_")}_${
        quiz.lesson_title
      }_Quiz_Report.pdf`
    );
    res.setHeader("Content-Type", "application/pdf");
    res.send(pdfBuffer);
  } catch (err) {
    console.error("Quiz PDF Error:", err);
    res.status(500).send("Error generating quiz report");
  }
};

// Resolves which courses count for a given term, same semantics as
// services/classroomTermAnalyticsService.js (kept duplicated here rather
// than imported, since that service is scoped to a classroom, not a
// student — active term uses classroom_courses+school_courses so a
// dropped/superseded course doesn't linger forever; a past term uses the
// confirmed course_term_links record instead). Also returns the date
// cutoff progress should be capped at: the term's own end_date once it's
// ended, or "now" while it's still the active term.
async function resolveCoursesForTerm(classroomId, schoolId, term) {
  const coursesRes = term.is_active
    ? await pool.query(
        `SELECT DISTINCT c.id, c.title
         FROM classroom_courses cc
         JOIN courses c ON c.id = cc.course_id
         JOIN school_courses sc ON sc.course_id = cc.course_id AND sc.school_id = $2
         WHERE cc.classroom_id = $1 AND (sc.term_id IS NULL OR sc.term_id = $3)
         ORDER BY c.title`,
        [classroomId, schoolId, term.id]
      )
    : await pool.query(
        `SELECT DISTINCT c.id, c.title
         FROM course_term_links ctl
         JOIN courses c ON c.id = ctl.course_id
         WHERE ctl.classroom_id = $1 AND ctl.term_id = $2
         ORDER BY c.title`,
        [classroomId, term.id]
      );
  const cutoffDate = term.is_active ? new Date() : term.end_date;
  return { courses: coursesRes.rows, cutoffDate };
}

// ----------------- STUDENT REPORT: COURSE CHOOSER -----------------
// Teachers can VIEW a student's report but not download one — and rather
// than dumping every course into one long combined page, this lists the
// student's courses (with a quick completion %) so the teacher picks
// exactly the one they want, per feedback that the combined version was
// too crowded. AJAX-loadable fragment, consistent with the rest of the
// teacher section (the actual formatted report, viewCourseReport below,
// still opens as its own page — it's a genuine standalone document, same
// reasoning as the class chat / other full-document views).
exports.viewStudentReport = async (req, res) => {
  try {
    const { id } = req.params; // studentId
    const teacherId = req.user.id;

    const checkRes = await pool.query(
      `SELECT 1
       FROM user_school us
       JOIN classroom_teachers ct ON ct.classroom_id = us.classroom_id
       WHERE us.user_id = $1 AND ct.teacher_id = $2`,
      [id, teacherId]
    );
    if (checkRes.rowCount === 0) {
      return res.status(403).send("Not authorized");
    }

    const studentRes = await pool.query(
      `SELECT id, fullname, email FROM users2 WHERE id = $1`,
      [id]
    );
    const student = studentRes.rows[0];
    if (!student) return res.status(404).send("Student not found");

    const enrollRes = await pool.query(
      `SELECT classroom_id, school_id FROM user_school WHERE user_id = $1 AND role_in_school = 'student' LIMIT 1`,
      [id]
    );
    const enrollment = enrollRes.rows[0];
    if (!enrollment) {
      return res.render("teacher/sections/report-courses", { student, courses: [], terms: [], selectedTerm: null });
    }

    const termsRes = await pool.query(
      `SELECT id, name, start_date, end_date, is_active, is_ended FROM academic_terms WHERE school_id = $1 ORDER BY id DESC`,
      [enrollment.school_id]
    );
    const terms = termsRes.rows;
    const requestedTermId = req.query.termId ? parseInt(req.query.termId, 10) : undefined;
    const selectedTerm = terms.find((t) => t.id === requestedTermId) || terms.find((t) => t.is_active) || terms[0] || null;

    if (!selectedTerm) {
      return res.render("teacher/sections/report-courses", { student, courses: [], terms: [], selectedTerm: null });
    }

    const { courses: termCourses, cutoffDate } = await resolveCoursesForTerm(
      enrollment.classroom_id,
      enrollment.school_id,
      selectedTerm
    );

    // Quick completion % per course, capped at the term's cutoff date so
    // an ended term's report reflects progress as of when it actually
    // ended, not whatever the student has done since.
    const courses = await Promise.all(
      termCourses.map(async (course) => {
        const progressRes = await pool.query(
          `SELECT COUNT(DISTINCT l.id) AS total_lessons,
                  COUNT(DISTINCT ulp.lesson_id) FILTER (WHERE ulp.completed_at::date <= $3) AS completed_lessons
           FROM modules m
           JOIN lessons l ON l.module_id = m.id
           LEFT JOIN user_lesson_progress ulp ON ulp.lesson_id = l.id AND ulp.user_id = $1
           WHERE m.course_id = $2`,
          [id, course.id, cutoffDate]
        );
        const { total_lessons, completed_lessons } = progressRes.rows[0];
        const percent = total_lessons > 0 ? Math.round((completed_lessons / total_lessons) * 100) : 0;
        return { id: course.id, title: course.title, percent };
      })
    );

    res.render("teacher/sections/report-courses", { student, courses, terms, selectedTerm });
  } catch (err) {
    console.error("Teacher Report Chooser Error:", err);
    res.status(500).send("Error loading report");
  }
};

// ----------------- STUDENT REPORT: SINGLE COURSE -----------------
// The actual formatted report, one course at a time — reuses the exact
// same gamified HTML report template used elsewhere (renderCourseReportHtml)
// and the same query shape as userController.downloadCourseSummary, but
// res.send()s the HTML directly instead of converting to a PDF and forcing
// a download.
exports.viewCourseReport = async (req, res) => {
  try {
    const { id, courseId } = req.params; // studentId, courseId
    const teacherId = req.user.id;

    const checkRes = await pool.query(
      `SELECT 1
       FROM user_school us
       JOIN classroom_teachers ct ON ct.classroom_id = us.classroom_id
       WHERE us.user_id = $1 AND ct.teacher_id = $2`,
      [id, teacherId]
    );
    if (checkRes.rowCount === 0) {
      return res.status(403).send("Not authorized");
    }

    const studentRes = await pool.query(
      `SELECT fullname, email, created_at FROM users2 WHERE id = $1`,
      [id]
    );
    const student = studentRes.rows[0];
    if (!student) return res.status(404).send("Student not found");

    const courseRes = await pool.query(`SELECT id, title FROM courses WHERE id = $1`, [courseId]);
    const course = courseRes.rows[0];
    if (!course) return res.status(404).send("Course not found");

    const infoRes = await pool.query(
      `SELECT company_name, logo_url FROM company_info ORDER BY id DESC LIMIT 1`
    );
    const info = infoRes.rows[0] || { company_name: "" };

    // If a term was specified (from the report-courses chooser), progress
    // is capped as-of that term's cutoff date — same "snapshot in time"
    // semantics as the chooser's own completion % and as
    // classroomTermAnalyticsService.js elsewhere in this app.
    let cutoffDate = null;
    let termLabel = null;
    const requestedTermId = req.query.termId ? parseInt(req.query.termId, 10) : undefined;
    if (requestedTermId) {
      const termRes = await pool.query(`SELECT id, name, is_active, end_date FROM academic_terms WHERE id = $1`, [requestedTermId]);
      const term = termRes.rows[0];
      if (term) {
        cutoffDate = term.is_active ? new Date() : term.end_date;
        termLabel = term.name;
      }
    }

    const modulesRes = await pool.query(`SELECT id, title FROM modules WHERE course_id = $1`, [courseId]);
    const lessonsRes = await pool.query(
      cutoffDate
        ? `SELECT l.id, l.title, l.module_id,
                  CASE WHEN ulp.completed_at::date <= $3 THEN ulp.completed_at ELSE NULL END AS completed_at
           FROM lessons l
           JOIN modules m ON l.module_id = m.id
           LEFT JOIN user_lesson_progress ulp ON ulp.lesson_id = l.id AND ulp.user_id = $1
           WHERE m.course_id = $2
           ORDER BY l.id`
        : `SELECT l.id, l.title, l.module_id, ulp.completed_at
           FROM lessons l
           JOIN modules m ON l.module_id = m.id
           LEFT JOIN user_lesson_progress ulp ON ulp.lesson_id = l.id AND ulp.user_id = $1
           WHERE m.course_id = $2
           ORDER BY l.id`,
      cutoffDate ? [id, courseId, cutoffDate] : [id, courseId]
    );
    const quizzesRes = await pool.query(
      cutoffDate
        ? `SELECT q.id, q.title, l.module_id,
                  CASE WHEN qs.created_at::date <= $3 THEN qs.score ELSE NULL END AS score,
                  qs.created_at AS taken_at
           FROM quizzes q
           LEFT JOIN quiz_submissions qs ON qs.quiz_id = q.id AND qs.student_id = $1
           JOIN lessons l ON q.lesson_id = l.id
           JOIN modules m ON l.module_id = m.id
           WHERE m.course_id = $2
           ORDER BY q.id`
        : `SELECT q.id, q.title, l.module_id, qs.score, qs.created_at AS taken_at
           FROM quizzes q
           LEFT JOIN quiz_submissions qs ON qs.quiz_id = q.id AND qs.student_id = $1
           JOIN lessons l ON q.lesson_id = l.id
           JOIN modules m ON l.module_id = m.id
           WHERE m.course_id = $2
           ORDER BY q.id`,
      cutoffDate ? [id, courseId, cutoffDate] : [id, courseId]
    );
    const assignmentsRes = await pool.query(
      cutoffDate
        ? `SELECT ma.id, ma.title, ma.module_id,
                  CASE WHEN s.created_at::date <= $3 THEN s.total ELSE NULL END AS total,
                  CASE WHEN s.created_at::date <= $3 THEN s.grade ELSE NULL END AS grade,
                  s.ai_feedback, s.created_at AS submitted_at
           FROM module_assignments ma
           JOIN modules m ON ma.module_id = m.id
           LEFT JOIN assignment_submissions s ON s.assignment_id = ma.id AND s.student_id = $1
           WHERE m.course_id = $2
           ORDER BY ma.id`
        : `SELECT ma.id, ma.title, ma.module_id, s.total, s.grade, s.ai_feedback, s.created_at AS submitted_at
           FROM module_assignments ma
           JOIN modules m ON ma.module_id = m.id
           LEFT JOIN assignment_submissions s ON s.assignment_id = ma.id AND s.student_id = $1
           WHERE m.course_id = $2
           ORDER BY ma.id`,
      cutoffDate ? [id, courseId, cutoffDate] : [id, courseId]
    );
    const badgesRes = await pool.query(
      `SELECT ub.badge_name, ub.badge_image, ub.awarded_at, ub.module_id
       FROM user_badges ub
       JOIN modules m ON ub.module_id = m.id
       WHERE ub.user_id = $1 AND m.course_id = $2
       ORDER BY ub.awarded_at`,
      [id, courseId]
    );
    const certRes = await pool.query(
      `SELECT certificate_url, issued_at FROM user_certificates WHERE user_id = $1 AND course_id = $2 LIMIT 1`,
      [id, courseId]
    );

    const modules = modulesRes.rows.map((m) => ({
      title: m.title,
      lessons: lessonsRes.rows.filter((l) => l.module_id === m.id),
      quizzes: quizzesRes.rows.filter((q) => q.module_id === m.id),
      assignments: assignmentsRes.rows.filter((a) => a.module_id === m.id),
      badges: badgesRes.rows.filter((b) => b.module_id === m.id),
    }));

    const html = renderCourseReportHtml({
      info,
      student,
      courseTitle: termLabel ? `${course.title} — ${termLabel}` : course.title,
      certificate: certRes.rows[0] || null,
      badges: badgesRes.rows,
      modules,
    });

    res.send(html);
  } catch (err) {
    console.error("Teacher Course Report Error:", err);
    res.status(500).send("Error loading report");
  }
};

exports.sendChatMessage = async (req, res) => {
  try {
    const { receiverId, message } = req.body;
    const senderId = req.session.user?.id; // Use logged-in user's ID

    if (!senderId) {
      return res.status(401).json({ success: false, message: "Not logged in" });
    }

    if (!receiverId || !message.trim()) {
      return res.status(400).json({ success: false, message: "Invalid input" });
    }

    await pool.query(
      `INSERT INTO messages (sender_id, receiver_id, message)
       VALUES ($1, $2, $3)`,
      [senderId, receiverId, message]
    );
    await notifyNewDirectMessage({ senderId, receiverId, message });

    res.json({ success: true, message: "Message sent successfully" });
  } catch (err) {
    console.error("Send chat message error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ✅ Get chat messages (conversation
exports.getChatMessages = async (req, res) => {
  try {
    const receiverId = req.params.receiverId;
    const senderId = req.session.user?.id;

    if (!senderId) {
      return res.status(401).json({ success: false, message: "Not logged in" });
    }

    // 1️⃣ Mark messages as delivered when fetched
    await pool.query(
      `UPDATE messages
       SET is_delivered = TRUE
       WHERE receiver_id = $1 AND sender_id = $2 AND is_delivered = FALSE`,
      [senderId, receiverId]
    );

    // 2️⃣ Fetch all chat messages
    const { rows } = await pool.query(
      `
      SELECT 
        id, sender_id, receiver_id, message, created_at, is_read, is_delivered,
        CASE WHEN sender_id = $1 THEN 'self' ELSE 'other' END AS sender
      FROM messages
      WHERE (sender_id = $1 AND receiver_id = $2)
         OR (sender_id = $2 AND receiver_id = $1)
      ORDER BY created_at ASC
      `,
      [senderId, receiverId]
    );

    // 3️⃣ Optionally mark as read
    await pool.query(
      `UPDATE messages 
       SET is_read = TRUE 
       WHERE receiver_id = $1 AND sender_id = $2 AND is_read = FALSE`,
      [senderId, receiverId]
    );

    res.json(rows);
  } catch (err) {
    console.error("Get chat messages error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.markMessagesAsRead = async (req, res) => {
  try {
    const { receiverId } = req.params;
    const senderId = req.session.user?.id;

    await pool.query(
      `UPDATE messages
       SET is_read = TRUE
       WHERE receiver_id = $1 AND sender_id = $2 AND is_read = FALSE`,
      [senderId, receiverId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Mark read error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Shared ownership check reused by every attendance/chat/grading/
// announcement function below — a teacher may only act on a classroom
// that's actually theirs via classroom_teachers.
async function teacherOwnsClassroom(classroomId, teacherId) {
  const result = await pool.query(
    `SELECT 1 FROM classroom_teachers WHERE classroom_id = $1 AND teacher_id = $2`,
    [classroomId, teacherId]
  );
  return result.rowCount > 0;
}

// ===================== ATTENDANCE =====================
// Adapted from instructorController.js's live (non-dead) attendance
// functions, scoped to classroom_teachers instead of classroom_instructors.
// Teacher has no multi-school "active school" session concept (unlike
// instructor), so school_id is resolved from the classroom row itself.

// Section shell: the teacher's own classrooms + their (single) school's
// academic terms, for the attendance filter dropdowns and take-attendance
// modal. A teacher belongs to exactly one school (user_school), unlike
// instructor which switches between several.
exports.getAttendanceSection = async (req, res) => {
  try {
    const teacherId = req.user.id;

    const classesRes = await pool.query(
      `SELECT c.id, c.name FROM classrooms c
       JOIN classroom_teachers ct ON ct.classroom_id = c.id
       WHERE ct.teacher_id = $1 ORDER BY c.name`,
      [teacherId]
    );

    const schoolRes = await pool.query(
      `SELECT school_id FROM user_school WHERE user_id = $1 AND role_in_school = 'teacher' LIMIT 1`,
      [teacherId]
    );
    const schoolId = schoolRes.rows[0]?.school_id;

    let terms = [];
    if (schoolId) {
      // is_active included so the dropdown can default to the term
      // actually in session — the view previously had no such logic, so
      // it silently defaulted to whichever term the browser picks as the
      // first <option> (highest id, not necessarily the active one).
      // Taking/loading attendance against the wrong term looks exactly
      // like "my new attendance isn't showing" if the active term isn't
      // the newest-created one.
      const termsRes = await pool.query(
        `SELECT id AS term_id, name AS term_name, is_active, is_ended FROM academic_terms WHERE school_id = $1 ORDER BY id DESC`,
        [schoolId]
      );
      terms = termsRes.rows;
    }

    res.render("teacher/sections/attendance", { classes: classesRes.rows, school: { terms } });
  } catch (err) {
    console.error("Teacher attendance section error:", err);
    res.status(500).send("<p>Error loading attendance</p>");
  }
};

exports.getAttendanceStudents = async (req, res) => {
  const { classroom_id } = req.query;
  const teacherId = req.user.id;

  try {
    if (!classroom_id) {
      return res.status(400).json({ error: "classroom_id is required" });
    }
    if (!(await teacherOwnsClassroom(classroom_id, teacherId))) {
      return res.status(403).json({ error: "Not your classroom" });
    }

    // Roster comes straight from user_school — same source every other
    // teacher query uses (Students section, Classroom Overview, Class
    // Chat). The original version (mirrored from instructor's attendance
    // code) instead required a student_term_enrollments row per student,
    // which most real classrooms never populate, so the picker came back
    // empty even for a classroom full of students.
    const result = await pool.query(
      `SELECT u.id, u.fullname
       FROM user_school us
       JOIN users2 u ON u.id = us.user_id
       WHERE us.classroom_id = $1 AND us.role_in_school = 'student' AND us.approved = true
       ORDER BY u.fullname ASC`,
      [classroom_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching attendance students:", err);
    res.status(500).json({ error: "Server error" });
  }
};

exports.saveAttendance = async (req, res) => {
  const { term_id, classroom_id, date, records, session_status, note, week_number } = req.body;
  const teacherId = req.user.id;

  try {
    if (!(await teacherOwnsClassroom(classroom_id, teacherId))) {
      return res.status(403).json({ success: false, message: "Not your classroom" });
    }

    const classroomRes = await pool.query(`SELECT school_id FROM classrooms WHERE id = $1`, [classroom_id]);
    const schoolId = classroomRes.rows[0]?.school_id;
    if (!schoolId) {
      return res.status(404).json({ success: false, message: "Classroom not found" });
    }

    const sessionResult = await pool.query(
      `INSERT INTO attendance_sessions
       (school_id, term_id, classroom_id, taken_by, date, session_status, note, week_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (term_id, classroom_id, date)
       DO UPDATE SET taken_by = EXCLUDED.taken_by, session_status = EXCLUDED.session_status, note = EXCLUDED.note
       RETURNING id, session_status`,
      [schoolId, term_id, classroom_id, teacherId, date, session_status, note || null, week_number]
    );

    const sessionId = sessionResult.rows[0].id;

    if (session_status !== "held") {
      await pool.query(`DELETE FROM attendance_records WHERE session_id = $1`, [sessionId]);
      return res.json({ success: true, message: "Session saved without attendance" });
    }

    for (const r of records || []) {
      await pool.query(
        `INSERT INTO attendance_records (session_id, student_id, status)
         VALUES ($1, $2, $3)
         ON CONFLICT (session_id, student_id) DO UPDATE SET status = EXCLUDED.status`,
        [sessionId, r.student_id, r.status]
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Save attendance error:", err);
    res.status(500).json({ success: false, message: "Error saving attendance" });
  }
};

exports.getAttendanceHistory = async (req, res) => {
  const { term_id, classroom_id } = req.query;
  const teacherId = req.user.id;

  try {
    if (classroom_id && !(await teacherOwnsClassroom(classroom_id, teacherId))) {
      return res.status(403).json({ error: "Not your classroom" });
    }

    const result = await pool.query(
      `SELECT s.id, s.date, s.session_status, c.name AS classroom, u.fullname AS taken_by,
              COUNT(ar.id) AS student_count
       FROM attendance_sessions s
       JOIN classroom_teachers ct ON ct.classroom_id = s.classroom_id
       LEFT JOIN classrooms c ON s.classroom_id = c.id
       LEFT JOIN users2 u ON s.taken_by = u.id
       LEFT JOIN attendance_records ar ON ar.session_id = s.id
       WHERE s.term_id = $1 AND ct.teacher_id = $2
       ${classroom_id ? "AND s.classroom_id = $3" : ""}
       GROUP BY s.id, c.name, u.fullname
       ORDER BY s.date DESC`,
      classroom_id ? [term_id, teacherId, classroom_id] : [term_id, teacherId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Attendance history error:", err);
    res.status(500).json({ error: "Error loading attendance history" });
  }
};

exports.getAttendanceSessionDetails = async (req, res) => {
  const { id } = req.params;
  const teacherId = req.user.id;

  try {
    const ownershipCheck = await pool.query(
      `SELECT 1 FROM attendance_sessions s
       JOIN classroom_teachers ct ON ct.classroom_id = s.classroom_id
       WHERE s.id = $1 AND ct.teacher_id = $2`,
      [id, teacherId]
    );
    if (!ownershipCheck.rowCount) {
      return res.status(403).json({ error: "Not your session" });
    }

    const result = await pool.query(
      `SELECT u.fullname, ar.status
       FROM attendance_records ar
       JOIN users2 u ON ar.student_id = u.id
       WHERE ar.session_id = $1
       ORDER BY u.fullname`,
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Attendance session details error:", err);
    res.status(500).json({ error: "Error loading attendance details" });
  }
};

exports.exportAttendancePDF = async (req, res) => {
  const { sessionId } = req.params;
  const teacherId = req.user.id;

  try {
    const ownershipCheck = await pool.query(
      `SELECT 1 FROM attendance_sessions s
       JOIN classroom_teachers ct ON ct.classroom_id = s.classroom_id
       WHERE s.id = $1 AND ct.teacher_id = $2`,
      [sessionId, teacherId]
    );
    if (!ownershipCheck.rowCount) {
      return res.status(403).send("Not your session");
    }

    const session = await pool.query(`SELECT * FROM attendance_sessions WHERE id=$1`, [sessionId]);
    const students = await pool.query(
      `SELECT u.fullname, r.status
       FROM attendance_records r
       JOIN users2 u ON r.student_id = u.id
       WHERE r.session_id=$1`,
      [sessionId]
    );

    const html = `
      <html><head><style>
        body { font-family: Arial; padding: 30px; }
        .header { text-align: center; border-bottom: 2px solid #A17807; margin-bottom: 20px; }
        .header h2 { margin: 0; color: #4C3802; }
        .meta { display: flex; justify-content: space-between; margin-bottom: 20px; font-size: 14px; }
        table { width: 100%; border-collapse: collapse; }
        th { background: #A17807; color: white; padding: 10px; }
        td { padding: 8px; border-bottom: 1px solid #ddd; }
        .status-present { color: green; } .status-absent { color: red; } .status-late { color: orange; }
      </style></head><body>
        <div class="header"><h2>ATTENDANCE REPORT</h2></div>
        <div class="meta"><div>Week: ${session.rows[0].week_number}</div><div>Date: ${session.rows[0].date}</div></div>
        <table><tr><th>Student</th><th>Status</th></tr>
          ${students.rows.map((s) => `<tr><td>${s.fullname}</td><td class="status-${s.status}">${s.status}</td></tr>`).join("")}
        </table>
      </body></html>`;

    const pdf = await generatePdf(html);
    res.setHeader("Content-Type", "application/pdf");
    res.send(pdf);
  } catch (err) {
    console.error("Attendance PDF error:", err);
    res.status(500).send("PDF error");
  }
};

// Whole-term attendance summary — a gamified, one-page view of every
// student's attendance across every "held" session in a term, for once
// the term has ended (session-by-session history is what the main
// attendance table already shows; this is the roll-up). AJAX-loadable
// fragment, consistent with the rest of the teacher section.
exports.getTermAttendanceSummary = async (req, res) => {
  const { term_id, classroom_id } = req.query;
  const teacherId = req.user.id;

  try {
    if (!term_id || !classroom_id) {
      return res.status(400).send("<p>term_id and classroom_id are required</p>");
    }
    if (!(await teacherOwnsClassroom(classroom_id, teacherId))) {
      return res.status(403).send("<p>Not your classroom</p>");
    }

    const termRes = await pool.query(`SELECT id, name, is_ended FROM academic_terms WHERE id = $1`, [term_id]);
    const term = termRes.rows[0];
    if (!term) return res.status(404).send("<p>Term not found</p>");

    const classroomRes = await pool.query(`SELECT id, name FROM classrooms WHERE id = $1`, [classroom_id]);
    const classroom = classroomRes.rows[0];

    const sessionsRes = await pool.query(
      `SELECT COUNT(*) AS total FROM attendance_sessions WHERE classroom_id = $1 AND term_id = $2 AND session_status = 'held'`,
      [classroom_id, term_id]
    );
    const totalSessions = parseInt(sessionsRes.rows[0].total, 10) || 0;

    const studentsRes = await pool.query(
      `SELECT
         u.id, u.fullname,
         COUNT(ar.id) FILTER (WHERE ar.status = 'present') AS present_count,
         COUNT(ar.id) FILTER (WHERE ar.status = 'absent') AS absent_count,
         COUNT(ar.id) FILTER (WHERE ar.status = 'late') AS late_count
       FROM user_school us
       JOIN users2 u ON u.id = us.user_id
       LEFT JOIN attendance_sessions s
         ON s.classroom_id = us.classroom_id AND s.term_id = $2 AND s.session_status = 'held'
       LEFT JOIN attendance_records ar ON ar.session_id = s.id AND ar.student_id = u.id
       WHERE us.classroom_id = $1 AND us.role_in_school = 'student' AND us.approved = true
       GROUP BY u.id, u.fullname
       ORDER BY u.fullname`,
      [classroom_id, term_id]
    );

    const students = studentsRes.rows
      .map((s) => {
        const present = parseInt(s.present_count, 10) || 0;
        const absent = parseInt(s.absent_count, 10) || 0;
        const late = parseInt(s.late_count, 10) || 0;
        const marked = present + absent + late;
        // Late counts as half-credit toward the attendance rate — present
        // and fully-absent are the two clean endpoints, late sits between.
        const attendancePercent = totalSessions > 0
          ? Math.round(((present + late * 0.5) / totalSessions) * 100)
          : 0;
        return { id: s.id, fullname: s.fullname, present, absent, late, marked, attendancePercent };
      })
      .sort((a, b) => b.attendancePercent - a.attendancePercent);

    const averageAttendance = students.length
      ? Math.round(students.reduce((sum, s) => sum + s.attendancePercent, 0) / students.length)
      : 0;

    res.render("teacher/sections/attendance-term-summary", {
      term,
      classroom,
      totalSessions,
      students,
      averageAttendance,
    });
  } catch (err) {
    console.error("Term attendance summary error:", err);
    res.status(500).send("<p>Error loading term attendance summary</p>");
  }
};

// ===================== MANUAL GRADING =====================
// Genuinely new — grading is otherwise 100% AI-only (studentController's
// assignment submit handler), with no human review path anywhere.

exports.getGradingQueue = async (req, res) => {
  const teacherId = req.user.id;
  const filter = req.query.filter || "ungraded"; // ungraded | unreviewed | all

  try {
    let filterClause = "";
    if (filter === "ungraded") filterClause = "AND asub.grade IS NULL";
    else if (filter === "unreviewed") filterClause = "AND asub.grade IS NOT NULL AND asub.manually_graded_at IS NULL";

    const result = await pool.query(
      `SELECT asub.id, asub.description, asub.score, asub.total, asub.grade, asub.ai_feedback,
              asub.teacher_feedback, asub.manually_graded_at, asub.created_at,
              u.id AS student_id, u.fullname AS student_name,
              ma.title AS assignment_title, ma.instructions,
              c.name AS classroom_name
       FROM assignment_submissions asub
       JOIN module_assignments ma ON ma.id = asub.assignment_id
       JOIN modules m ON m.id = ma.module_id
       JOIN courses cr ON cr.id = m.course_id
       JOIN classroom_courses cc ON cc.course_id = cr.id
       JOIN classroom_teachers ct ON ct.classroom_id = cc.classroom_id
       JOIN classrooms c ON c.id = cc.classroom_id
       JOIN users2 u ON u.id = asub.student_id
       WHERE ct.teacher_id = $1 ${filterClause}
       ORDER BY asub.created_at DESC`,
      [teacherId]
    );

    res.render("teacher/sections/grading", { submissions: result.rows, filter });
  } catch (err) {
    console.error("Grading queue error:", err);
    res.status(500).send("<p>Error loading grading queue</p>");
  }
};

exports.submitGrade = async (req, res) => {
  const { submissionId } = req.params;
  const { grade, score, total, teacher_feedback } = req.body;
  const teacherId = req.user.id;

  try {
    const ownershipCheck = await pool.query(
      `SELECT asub.student_id, ma.title AS assignment_title
       FROM assignment_submissions asub
       JOIN module_assignments ma ON ma.id = asub.assignment_id
       JOIN modules m ON m.id = ma.module_id
       JOIN courses cr ON cr.id = m.course_id
       JOIN classroom_courses cc ON cc.course_id = cr.id
       JOIN classroom_teachers ct ON ct.classroom_id = cc.classroom_id
       WHERE asub.id = $1 AND ct.teacher_id = $2`,
      [submissionId, teacherId]
    );
    if (!ownershipCheck.rowCount) {
      return res.status(403).json({ success: false, message: "Not authorized to grade this submission" });
    }

    await pool.query(
      `UPDATE assignment_submissions
       SET grade = $1, score = $2, total = $3, teacher_feedback = $4,
           graded_by = $5, manually_graded_at = NOW()
       WHERE id = $6`,
      [grade, score || null, total || null, teacher_feedback || null, teacherId, submissionId]
    );

    const { student_id, assignment_title } = ownershipCheck.rows[0];
    await notifyUser(student_id, {
      type: "grade_posted",
      title: "Your assignment was graded",
      message: `${assignment_title || "An assignment"} — grade: ${grade}`,
      url: "/student/dashboard",
    });

    res.json({ success: true, message: "Grade saved" });
  } catch (err) {
    console.error("Submit grade error:", err);
    res.status(500).json({ success: false, message: "Server error while saving grade" });
  }
};

// ===================== CLASSROOM-WIDE CHAT =====================
// Adapted from instructorController.js's class chat functions — same
// class_messages/muted_students/classrooms.chat_locked tables, but with a
// classroom_teachers ownership check added to every function (instructor's
// originals have none; that gap isn't replicated here).

exports.renderClassChat = async (req, res) => {
  try {
    const classroomId = req.params.classroomId;
    const teacherId = req.session.user?.id;

    if (!teacherId) return res.redirect("/admin/login");
    if (!(await teacherOwnsClassroom(classroomId, teacherId))) {
      return res.status(403).send("Not your classroom");
    }

    const infoResult = await pool.query("SELECT * FROM company_info ORDER BY id DESC LIMIT 1");
    const info = infoResult.rows[0] || {};

    const classResult = await pool.query(`SELECT id, name, chat_locked FROM classrooms WHERE id = $1`, [classroomId]);
    const classroom = classResult.rows[0];

    const studentsResult = await pool.query(
      `SELECT u.id, u.fullname, u.email, u.role, u.profile_picture
       FROM users2 u
       JOIN user_school us ON us.user_id = u.id
       WHERE us.classroom_id = $1 AND us.role_in_school = 'student'
       ORDER BY u.fullname`,
      [classroomId]
    );

    const mutedResult = await pool.query(
      `SELECT DISTINCT student_id FROM muted_students WHERE classroom_id = $1`,
      [classroomId]
    );
    const mutedIds = new Set(mutedResult.rows.map((r) => r.student_id));

    const badgeCountsRes = await pool.query(
      `SELECT user_id, COUNT(*) AS count FROM user_badges WHERE user_id = ANY($1) GROUP BY user_id`,
      [studentsResult.rows.map((s) => s.id)]
    );
    const badgeCountByStudent = new Map(badgeCountsRes.rows.map((r) => [r.user_id, parseInt(r.count, 10)]));

    // Gamification chips per student, same lightweight approach as
    // viewClassroomStudents — makes the roster feel alive, not a bare list.
    const students = await Promise.all(
      studentsResult.rows.map(async (s) => {
        const streak = await getStudentStreak(s.id);
        const xpRes = await pool.query(`SELECT COALESCE(SUM(xp), 0) AS total FROM xp_history WHERE user_id = $1`, [s.id]);
        return {
          ...s,
          streak,
          levelInfo: getLevelForXp(xpRes.rows[0].total),
          badgeCount: badgeCountByStudent.get(s.id) || 0,
          muted: mutedIds.has(s.id),
        };
      })
    );

    const { rows: messages } = await pool.query(
      `SELECT cm.id, cm.message, cm.created_at, cm.sender_id, u.fullname, u.role, u.profile_picture
       FROM class_messages cm
       JOIN users2 u ON u.id = cm.sender_id
       WHERE cm.classroom_id = $1
       ORDER BY cm.created_at ASC`,
      [classroomId]
    );

    const announcementsResult = await pool.query(
      `SELECT id, title, message, created_at FROM classroom_announcements
       WHERE classroom_id = $1 ORDER BY created_at DESC`,
      [classroomId]
    );

    res.render("teacher/classChatView", {
      classroom,
      messages,
      students,
      announcements: announcementsResult.rows,
      info,
      profilePic: req.session.user.profile_picture || null,
      role: "teacher",
      user: req.session.user,
    });
  } catch (err) {
    console.error("Render teacher class chat error:", err);
    res.status(500).send("Error loading class chat");
  }
};

exports.sendClassMessage = async (req, res) => {
  try {
    const { classroomId, message } = req.body;
    const senderId = req.session.user?.id;

    if (!senderId) return res.status(401).json({ success: false });
    if (!(await teacherOwnsClassroom(classroomId, senderId))) {
      return res.status(403).json({ success: false, message: "Not your classroom" });
    }
    if (!message || !message.trim()) return res.status(400).json({ success: false });

    await pool.query(
      `INSERT INTO class_messages (classroom_id, sender_id, message) VALUES ($1,$2,$3)`,
      [classroomId, senderId, message]
    );
    await notifyNewClassMessage({ senderId, classroomId, message });
    res.json({ success: true });
  } catch (err) {
    console.error("Teacher send class message error:", err);
    res.status(500).json({ success: false });
  }
};

exports.getClassMessages = async (req, res) => {
  try {
    const classroomId = req.params.classroomId;
    const teacherId = req.session.user?.id;
    if (!(await teacherOwnsClassroom(classroomId, teacherId))) {
      return res.status(403).json([]);
    }

    const { rows } = await pool.query(
      `SELECT cm.id, cm.message, cm.created_at, cm.sender_id, u.fullname, u.role, u.profile_picture
       FROM class_messages cm
       JOIN users2 u ON u.id = cm.sender_id
       WHERE cm.classroom_id = $1
       ORDER BY cm.created_at ASC`,
      [classroomId]
    );
    res.json(rows);
  } catch (err) {
    console.error("Teacher get class messages error:", err);
    res.status(500).json([]);
  }
};

exports.muteStudent = async (req, res) => {
  try {
    const { classroomId, studentId } = req.body;
    const teacherId = req.session.user.id;
    if (!(await teacherOwnsClassroom(classroomId, teacherId))) {
      return res.status(403).json({ success: false, message: "Not your classroom" });
    }

    await pool.query(
      `INSERT INTO muted_students (classroom_id, student_id, muted_by) VALUES ($1,$2,$3)`,
      [classroomId, studentId, teacherId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Mute student error:", err);
    res.json({ success: false });
  }
};

exports.unmuteStudent = async (req, res) => {
  try {
    const { classroomId, studentId } = req.body;
    const teacherId = req.session.user.id;
    if (!(await teacherOwnsClassroom(classroomId, teacherId))) {
      return res.status(403).json({ success: false, message: "Not your classroom" });
    }

    await pool.query(`DELETE FROM muted_students WHERE classroom_id = $1 AND student_id = $2`, [classroomId, studentId]);
    res.json({ success: true });
  } catch (err) {
    console.error("Unmute student error:", err);
    res.json({ success: false });
  }
};

exports.lockClassChat = async (req, res) => {
  try {
    const { classroomId } = req.body;
    const teacherId = req.session.user.id;
    if (!(await teacherOwnsClassroom(classroomId, teacherId))) {
      return res.status(403).json({ success: false, message: "Not your classroom" });
    }
    await pool.query(`UPDATE classrooms SET chat_locked = true WHERE id = $1`, [classroomId]);
    res.json({ success: true });
  } catch (err) {
    console.error("Lock class chat error:", err);
    res.json({ success: false });
  }
};

exports.unlockClassChat = async (req, res) => {
  try {
    const { classroomId } = req.body;
    const teacherId = req.session.user.id;
    if (!(await teacherOwnsClassroom(classroomId, teacherId))) {
      return res.status(403).json({ success: false, message: "Not your classroom" });
    }
    await pool.query(`UPDATE classrooms SET chat_locked = false WHERE id = $1`, [classroomId]);
    res.json({ success: true });
  } catch (err) {
    console.error("Unlock class chat error:", err);
    res.json({ success: false });
  }
};

exports.deleteClassMessage = async (req, res) => {
  try {
    const { messageId } = req.body;
    const teacherId = req.session.user.id;

    const ownershipCheck = await pool.query(
      `SELECT 1 FROM class_messages cm
       JOIN classroom_teachers ct ON ct.classroom_id = cm.classroom_id
       WHERE cm.id = $1 AND ct.teacher_id = $2`,
      [messageId, teacherId]
    );
    if (!ownershipCheck.rowCount) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }

    await pool.query(`DELETE FROM class_messages WHERE id=$1`, [messageId]);
    res.json({ success: true });
  } catch (err) {
    console.error("Delete class message error:", err);
    res.json({ success: false });
  }
};

// ===================== CLASSROOM-SCOPED ANNOUNCEMENTS =====================
// Separate from the platform-wide `announcements` table on purpose — that
// one has no per-classroom targeting. These are scoped to a single
// classroom, surfaced inside the classroom chat view.

exports.createClassroomAnnouncement = async (req, res) => {
  try {
    const { classroomId, title, message } = req.body;
    const teacherId = req.session.user.id;
    if (!(await teacherOwnsClassroom(classroomId, teacherId))) {
      return res.status(403).json({ success: false, message: "Not your classroom" });
    }
    if (!title?.trim() || !message?.trim()) {
      return res.status(400).json({ success: false, message: "Title and message are required" });
    }

    const result = await pool.query(
      `INSERT INTO classroom_announcements (classroom_id, teacher_id, title, message)
       VALUES ($1,$2,$3,$4) RETURNING id, title, message, created_at`,
      [classroomId, teacherId, title.trim(), message.trim()]
    );
    await notifyClassroomAnnouncement({ senderId: teacherId, classroomId, title: title.trim(), message: message.trim() });
    res.json({ success: true, announcement: result.rows[0] });
  } catch (err) {
    console.error("Create classroom announcement error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.deleteClassroomAnnouncement = async (req, res) => {
  try {
    const { id } = req.params;
    const teacherId = req.session.user.id;

    const ownershipCheck = await pool.query(
      `SELECT 1 FROM classroom_announcements ca
       JOIN classroom_teachers ct ON ct.classroom_id = ca.classroom_id
       WHERE ca.id = $1 AND ct.teacher_id = $2`,
      [id, teacherId]
    );
    if (!ownershipCheck.rowCount) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }

    await pool.query(`DELETE FROM classroom_announcements WHERE id = $1`, [id]);
    res.json({ success: true });
  } catch (err) {
    console.error("Delete classroom announcement error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
