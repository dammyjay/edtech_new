// controllers/schoolAdminController.js
const pool = require("../models/db");
const { logActivityForUser } = require("../utils/activityLogger");
const csv = require("csv-parser");
const fs = require("fs");
const bcrypt = require("bcrypt");
const generatePdf = require("../utils/generatePdf");
const ExcelJS = require("exceljs");
const axios = require("axios");
const getAnnouncements = require("../utils/getAnnouncements");

exports.getDashboard = async (req, res) => {
  const announcements = await getAnnouncements("dashboard");

  const schoolRes = await pool.query(
  `SELECT s.id, s.name
   FROM schools s
   WHERE s.created_by = $1
   LIMIT 1`,
  [req.session.user.id]
);

if (!schoolRes.rows.length) {
  return res.status(404).send("School not found");
}

const schoolDbId = schoolRes.rows[0].id;
// const schoolName = schoolRes.rows[0].name;

  // Get school name
  const schoolRow = await pool.query(
    "SELECT id, name FROM schools WHERE id = $1",
    [schoolDbId]
  );

  if (!schoolRow.rows.length) {
    return res.status(404).send("School not found");
  }

  const schoolName = schoolRow.rows[0].name;

  // Company info
  const infoResult = await pool.query(
    "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
  );
  const info = infoResult.rows[0] || {};
  const profilePic = req.session.user?.profile_picture || null;

  // Pending teachers/students
  const pendingUsers = await pool.query(
    `SELECT u.id, u.fullname, u.email, us.role_in_school, us.joined_at
     FROM users2 u
     JOIN user_school us ON u.id = us.user_id
     WHERE us.school_id = $1 AND us.approved = false`,
    [schoolDbId]
  );

  // Classrooms
  const classrooms = await pool.query(
    `SELECT c.id, c.name,
       COALESCE(STRING_AGG(u.fullname, ', '), 'Unassigned') AS teacher_names,
       COALESCE(ARRAY_AGG(u.id) FILTER (WHERE u.id IS NOT NULL), '{}') AS teacher_ids,
       (SELECT COUNT(*) 
          FROM user_school us2 
         WHERE us2.classroom_id = c.id
           AND us2.role_in_school = 'student'
           AND us2.approved = true) AS student_count
FROM classrooms c
LEFT JOIN classroom_teachers ct ON c.id = ct.classroom_id
LEFT JOIN users2 u ON u.id = ct.teacher_id
WHERE c.school_id = $1
GROUP BY c.id, c.name;`,
    [schoolDbId]
  );

  // Teachers
  const teachers = await pool.query(
    `SELECT u.id, u.fullname, u.email, us.role_in_school, us.joined_at
     FROM users2 u
     JOIN user_school us ON u.id = us.user_id
     WHERE us.school_id = $1 AND us.role_in_school = 'teacher' AND us.approved = true`,
    [schoolDbId]
  );

  const students = await pool.query(
    `SELECT u.id, u.fullname, u.email, u.gender, us.joined_at,
            COALESCE(c.name, 'Not assigned') AS classroom_name
    FROM users2 u
    JOIN user_school us ON u.id = us.user_id
    LEFT JOIN classrooms c ON us.classroom_id = c.id
    WHERE us.school_id = $1 AND us.role_in_school = 'student' AND us.approved = true
    ORDER BY u.fullname`,
    [schoolDbId]  
  );

  // ✅ Recent activities (limit 10 for dashboard)
  const recentActivities = await pool.query(
    `SELECT a.id, a.action, a.details, a.role, a.scope, a.created_at, u.fullname
     FROM activities a
     LEFT JOIN users2 u ON a.user_id = u.id
     WHERE a.school_id = $1 OR a.scope = 'global'
     ORDER BY a.created_at DESC
     LIMIT 10`,
    [schoolDbId]
  );

  // Student Engagement
  const studentEngagement = await pool.query(
    `SELECT 
    u.id,
    u.fullname,
    u.email,
    COUNT(DISTINCT l.id) AS total_lessons,  -- all lessons available in their classrooms
    COUNT(DISTINCT ulp.lesson_id) FILTER (WHERE ulp.completed_at IS NOT NULL) AS lessons_completed,
    COUNT(DISTINCT a.id) AS activities_logged,
    COALESCE(
      ROUND(
        (COUNT(DISTINCT ulp.lesson_id) FILTER (WHERE ulp.completed_at IS NOT NULL)::numeric /
         NULLIF(COUNT(DISTINCT l.id), 0)) * 100
      , 1),
      0
    ) AS engagement_rate
FROM users2 u
JOIN user_school us 
    ON u.id = us.user_id
JOIN classrooms c 
    ON us.classroom_id = c.id
JOIN classroom_courses cc 
    ON c.id = cc.classroom_id
JOIN courses cr 
    ON cc.course_id = cr.id
JOIN modules m 
    ON cr.id = m.course_id
JOIN lessons l 
    ON m.id = l.module_id
LEFT JOIN user_lesson_progress ulp 
    ON ulp.user_id = u.id AND ulp.lesson_id = l.id
LEFT JOIN activities a 
    ON a.user_id = u.id
WHERE us.school_id = $1
  AND us.role_in_school = 'student'
  AND us.approved = true
GROUP BY u.id, u.fullname, u.email
ORDER BY engagement_rate DESC;

`,
    [schoolDbId]
  );

  // Teacher Performance
  const teacherPerformance = await pool.query(
    `WITH student_engagement AS (
    SELECT 
      u.id AS student_id,             -- ✅ use users2.id instead of user_school.id
      ct.teacher_id,
      COUNT(DISTINCT ulp.lesson_id) FILTER (WHERE ulp.completed_at IS NOT NULL) AS lessons_completed,
      COUNT(DISTINCT l.id) AS total_lessons
    FROM classroom_teachers ct
    JOIN user_school us2 
      ON ct.classroom_id = us2.classroom_id
     AND us2.role_in_school = 'student'
     AND us2.approved = true
    JOIN users2 u 
      ON us2.user_id = u.id           -- ✅ proper student link
    LEFT JOIN classroom_courses cc 
      ON ct.classroom_id = cc.classroom_id
    LEFT JOIN courses cr 
      ON cc.course_id = cr.id
    LEFT JOIN modules m 
      ON cr.id = m.course_id
    LEFT JOIN lessons l 
      ON m.id = l.module_id
    LEFT JOIN user_lesson_progress ulp 
      ON ulp.user_id = u.id AND ulp.lesson_id = l.id
    GROUP BY u.id, ct.teacher_id
  )
  SELECT 
    t.id,
    t.fullname,
    t.email,
    COUNT(DISTINCT ct.classroom_id) AS classrooms_assigned,
    COUNT(DISTINCT s.id) AS total_students,
    ROUND(
      COALESCE(AVG(
        CASE WHEN se.total_lessons > 0 
             THEN (se.lessons_completed::numeric / se.total_lessons) * 100
             ELSE 0
        END
      ), 0), 1
    ) AS avg_engagement
  FROM users2 t
  JOIN user_school us 
    ON t.id = us.user_id
  LEFT JOIN classroom_teachers ct 
    ON t.id = ct.teacher_id
  LEFT JOIN user_school s 
    ON ct.classroom_id = s.classroom_id 
   AND s.role_in_school = 'student'
   AND s.approved = true
  LEFT JOIN student_engagement se 
    ON se.teacher_id = t.id AND se.student_id = s.id
  WHERE us.school_id = $1
    AND us.role_in_school = 'teacher'
    AND us.approved = true
  GROUP BY t.id, t.fullname, t.email
  ORDER BY total_students DESC;

`,
    [schoolDbId]
  );

  res.render("school-admin/dashboard", {
    schoolAdmin: req.session.user,
    school: { id: schoolDbId, name: schoolName },
    pendingUsers: pendingUsers.rows,
    classrooms: classrooms.rows,
    teachers: teachers.rows,
    students: students.rows,
    recentActivities: recentActivities.rows, // ✅ pass it
    teacherPerformance: teacherPerformance.rows, // ✅ add this
    studentEngagement: studentEngagement.rows, // ✅ add this
    info,
    profilePic,
    announcements,
    users: req.session.user,
  });
};

exports.loadSection = async (req, res) => {
  const section = req.params.section;


  const schoolRes = await pool.query(
    `SELECT id FROM schools WHERE created_by = $1 LIMIT 1`,
    [req.session.user.id]
  );

  if (!schoolRes.rows.length) {
    return res.status(404).send("School not found");
  }

  const schoolId = schoolRes.rows[0].id;

  if (section === "teachers") {
    const teachers = await pool.query(
      `SELECT u.id, u.fullname, u.email, us.joined_at
       FROM users2 u
       JOIN user_school us ON u.id = us.user_id
       WHERE us.school_id = $1 AND us.role_in_school = 'teacher' AND us.approved = true`,
      [schoolId]
    );
    return res.render("partials/teachers", { teachers: teachers.rows });
  }

  if (section === "students") {

    const students = await pool.query(
      `SELECT u.id, u.fullname, u.email, u.gender, us.joined_at,
              COALESCE(c.name, 'Not assigned') AS classroom_name
      FROM users2 u
      JOIN user_school us ON u.id = us.user_id
      LEFT JOIN classrooms c ON us.classroom_id = c.id
      WHERE us.school_id = $1 
        AND us.role_in_school = 'student' 
        AND us.approved = true
      ORDER BY u.fullname`,
      [schoolId]
    );

    // ✅ ADD THIS: fetch classrooms
    const classrooms = await pool.query(
      `SELECT c.id, c.name,
              COALESCE(STRING_AGG(u.fullname, ', '), 'Unassigned') AS teacher_names
      FROM classrooms c
      LEFT JOIN classroom_teachers ct ON c.id = ct.classroom_id
      LEFT JOIN users2 u ON u.id = ct.teacher_id
      WHERE c.school_id = $1
      GROUP BY c.id, c.name
      ORDER BY c.name`,
      [schoolId]
    );

    return res.render("partials/students", { 
      students: students.rows,
      classrooms: classrooms.rows   // ✅ FIXED
    });
  }

  if (section === "classrooms") {
    const classrooms = await pool.query(
      `SELECT c.id, c.name,
         COALESCE(STRING_AGG(u.fullname, ', '), 'Unassigned') AS teacher_names,
         COALESCE(ARRAY_AGG(u.id) FILTER (WHERE u.id IS NOT NULL), '{}') AS teacher_ids,
         (SELECT COUNT(*) 
            FROM user_school us2 
           WHERE us2.classroom_id = c.id
             AND us2.role_in_school = 'student'
             AND us2.approved = true) AS student_count
       FROM classrooms c
       LEFT JOIN classroom_teachers ct ON c.id = ct.classroom_id
       LEFT JOIN users2 u ON u.id = ct.teacher_id
       WHERE c.school_id = $1
       GROUP BY c.id, c.name;`,
      [schoolId]
    );

    const availableStudents = await pool.query(
      `SELECT u.id, u.fullname, u.email
       FROM users2 u
       JOIN user_school us ON u.id = us.user_id
       WHERE us.school_id = $1 
         AND us.role_in_school = 'student' 
         AND us.approved = true`,
      [schoolId]
    );

    for (let c of classrooms.rows) {
      const studentRows = await pool.query(
        `SELECT u.id, u.fullname, u.email, us.joined_at
         FROM users2 u
         JOIN user_school us ON u.id = us.user_id
         WHERE us.school_id = $1 AND us.classroom_id = $2 
           AND us.role_in_school = 'student' AND us.approved = true`,
        [schoolId, c.id]
      );
      c.students = studentRows.rows;
      c.availableStudents = availableStudents.rows.filter(
        (stu) => !studentRows.rows.some((s) => s.id === stu.id)
      );
    }

    const openClassroom = req.query.openClassroom || null;
    return res.render("partials/classrooms", {
      classrooms: classrooms.rows,
      openClassroom,
    });
  }

  if (section === "approvals") {
    const pendingUsers = await pool.query(
      `SELECT u.id, u.fullname, u.email, us.role_in_school, us.joined_at
       FROM users2 u
       JOIN user_school us ON u.id = us.user_id
       WHERE us.school_id = $1 AND us.approved = false`,
      [schoolId]
    );
    return res.render("partials/approvals", {
      pendingUsers: pendingUsers.rows,
    });
  }

  // === Quotes ===
  if (section === "quotes") {
    const quotes = await pool.query(
      "SELECT id, requested_students, price_quote, status, created_at FROM quotes WHERE school_id=$1 ORDER BY id DESC",
      [schoolId]
    );
    return res.render("partials/quotes", { quotes: quotes.rows });
  }

  // === Payments (with adjustments) ===
  if (section === "payments") {
    const payments = await pool.query(
      `SELECT sp.id,
            sp.amount AS base_amount,
            COALESCE(SUM(adj.extra_amount), 0) AS adjustments_total,
            (sp.amount + COALESCE(SUM(adj.extra_amount), 0)) AS total_amount,
            sp.student_limit + COALESCE(SUM(adj.extra_students), 0) AS effective_student_limit,
            sp.status,
            sp.start_date,
            sp.end_date,
            sp.created_at
     FROM school_payments sp
     LEFT JOIN school_payment_adjustments adj
       ON sp.id = adj.school_payment_id AND adj.status = 'paid'
     WHERE sp.school_id = $1
     GROUP BY sp.id
     ORDER BY sp.created_at DESC`,
      [schoolId]
    );

    return res.render("partials/payments", { payments: payments.rows });
  }

  if (section === "classroom-courses") {
    const classrooms = await pool.query(
      "SELECT id, name FROM classrooms WHERE school_id=$1",
      [schoolId]
    );

    // ✅ Only fetch courses assigned to this school
    const courses = await pool.query(
      `SELECT c.id, c.title
     FROM courses c
     INNER JOIN school_courses sc ON c.id = sc.course_id
     WHERE sc.school_id = $1
     ORDER BY c.title`,
      [schoolId]
    );

    const classroomCourses = await pool.query(
      `SELECT cc.id, c.name AS classroom, cr.title AS course
     FROM classroom_courses cc
     JOIN classrooms c ON cc.classroom_id = c.id
     JOIN courses cr ON cc.course_id = cr.id
     WHERE c.school_id=$1`,
      [schoolId]
    );

    return res.render("partials/classroom-courses", {
      classrooms: classrooms.rows,
      courses: courses.rows, // ✅ now only school courses
      classroomCourses: classroomCourses.rows,
    });
  }

  if (section === "overview") {
    const pendingUsers = await pool.query(
      `SELECT u.id, u.fullname, u.email, us.role_in_school, us.joined_at, u.profile_picture
       FROM users2 u
       JOIN user_school us ON u.id = us.user_id
       WHERE us.school_id = $1 AND us.approved = false`,
      [schoolId]
    );

    const classrooms = await pool.query(
      `SELECT c.id, c.name,
         COALESCE(STRING_AGG(u.fullname, ', '), 'Unassigned') AS teacher_names,
         COALESCE(ARRAY_AGG(u.id) FILTER (WHERE u.id IS NOT NULL), '{}') AS teacher_ids,
         (SELECT COUNT(*) 
            FROM user_school us2 
           WHERE us2.classroom_id = c.id
             AND us2.role_in_school = 'student'
             AND us2.approved = true) AS student_count
       FROM classrooms c
       LEFT JOIN classroom_teachers ct ON c.id = ct.classroom_id
       LEFT JOIN users2 u ON u.id = ct.teacher_id
       WHERE c.school_id = $1
       GROUP BY c.id, c.name;`,
      [schoolId]
    );

    const teachers = await pool.query(
      `SELECT u.id, u.fullname, u.email, us.joined_at
       FROM users2 u
       JOIN user_school us ON u.id = us.user_id
       WHERE us.school_id = $1 AND us.role_in_school = 'teacher' AND us.approved = true`,
      [schoolId]
    );

    const students = await pool.query(
      `SELECT u.id, u.fullname, u.email, us.joined_at
       FROM users2 u
       JOIN user_school us ON u.id = us.user_id
       WHERE us.school_id = $1 AND us.role_in_school = 'student' AND us.approved = true`,
      [schoolId]
    );

    // ✅ Recent activities
    const recentActivities = await pool.query(
      `SELECT a.id, a.action, a.details, a.role, a.scope, a.created_at, u.fullname
     FROM activities a
     LEFT JOIN users2 u ON a.user_id = u.id
     WHERE a.school_id = $1 OR a.scope = 'global'
     ORDER BY a.created_at DESC
     LIMIT 10`,
      [schoolId]
    );

    // Student Engagement
    const studentEngagement = await pool.query(
      `SELECT 
    u.id,
    u.fullname,
    u.email,
    COUNT(DISTINCT l.id) AS total_lessons,  -- all lessons available in their classrooms
    COUNT(DISTINCT ulp.lesson_id) FILTER (WHERE ulp.completed_at IS NOT NULL) AS lessons_completed,
    COUNT(DISTINCT a.id) AS activities_logged,
    COALESCE(
      ROUND(
        (COUNT(DISTINCT ulp.lesson_id) FILTER (WHERE ulp.completed_at IS NOT NULL)::numeric /
         NULLIF(COUNT(DISTINCT l.id), 0)) * 100
      , 1),
      0
    ) AS engagement_rate
FROM users2 u
JOIN user_school us 
    ON u.id = us.user_id
JOIN classrooms c 
    ON us.classroom_id = c.id
JOIN classroom_courses cc 
    ON c.id = cc.classroom_id
JOIN courses cr 
    ON cc.course_id = cr.id
JOIN modules m 
    ON cr.id = m.course_id
JOIN lessons l 
    ON m.id = l.module_id
LEFT JOIN user_lesson_progress ulp 
    ON ulp.user_id = u.id AND ulp.lesson_id = l.id
LEFT JOIN activities a 
    ON a.user_id = u.id
WHERE us.school_id = $1
  AND us.role_in_school = 'student'
  AND us.approved = true
GROUP BY u.id, u.fullname, u.email
ORDER BY engagement_rate DESC;

`,
      [schoolId]
    );
    // Teacher Performance
    const teacherPerformance = await pool.query(
      `WITH student_engagement AS (
          SELECT 
            u.id AS student_id,             -- ✅ use users2.id instead of user_school.id
            ct.teacher_id,
            COUNT(DISTINCT ulp.lesson_id) FILTER (WHERE ulp.completed_at IS NOT NULL) AS lessons_completed,
            COUNT(DISTINCT l.id) AS total_lessons
          FROM classroom_teachers ct
          JOIN user_school us2 
            ON ct.classroom_id = us2.classroom_id
          AND us2.role_in_school = 'student'
          AND us2.approved = true
          JOIN users2 u 
            ON us2.user_id = u.id           -- ✅ proper student link
          LEFT JOIN classroom_courses cc 
            ON ct.classroom_id = cc.classroom_id
          LEFT JOIN courses cr 
            ON cc.course_id = cr.id
          LEFT JOIN modules m 
            ON cr.id = m.course_id
          LEFT JOIN lessons l 
            ON m.id = l.module_id
          LEFT JOIN user_lesson_progress ulp 
            ON ulp.user_id = u.id AND ulp.lesson_id = l.id
          GROUP BY u.id, ct.teacher_id
        )
        SELECT 
          t.id,
          t.fullname,
          t.email,
          COUNT(DISTINCT ct.classroom_id) AS classrooms_assigned,
          COUNT(DISTINCT s.id) AS total_students,
          ROUND(
            COALESCE(AVG(
              CASE WHEN se.total_lessons > 0 
                  THEN (se.lessons_completed::numeric / se.total_lessons) * 100
                  ELSE 0
              END
            ), 0), 1
          ) AS avg_engagement
        FROM users2 t
        JOIN user_school us 
          ON t.id = us.user_id
        LEFT JOIN classroom_teachers ct 
          ON t.id = ct.teacher_id
        LEFT JOIN user_school s 
          ON ct.classroom_id = s.classroom_id 
        AND s.role_in_school = 'student'
        AND s.approved = true
        LEFT JOIN student_engagement se 
          ON se.teacher_id = t.id AND se.student_id = s.id
        WHERE us.school_id = $1
          AND us.role_in_school = 'teacher'
          AND us.approved = true
        GROUP BY t.id, t.fullname, t.email
        ORDER BY total_students DESC;

      `,
      [schoolId]
    );

    console.log("Dashboard schoolDbId:", schoolDbId);
    console.log("LoadSection schoolId:", schoolId);
    return res.render("partials/overview", {
      schoolAdmin: req.session.user,
      // school: { id: schoolId, name: req.session.user.school_name },
      school: { id: schoolId, name: schoolName },
      pendingUsers: pendingUsers.rows,
      classrooms: classrooms.rows,
      teachers: teachers.rows,
      students: students.rows,
      recentActivities: recentActivities.rows, // ✅ pass it
      teacherPerformance: teacherPerformance.rows, // ✅ add this
      studentEngagement: studentEngagement.rows, // ✅ add this
    });
  }

  // if (section === "terms") {
  //   const terms = await pool.query(
  //     `SELECT 
  //       t.id AS term_id,
  //       t.name AS term_name,
  //       t.start_date,
  //       t.end_date,
  //       t.is_active,
  //       t.created_at,
  //       COUNT(DISTINCT ste.student_id) AS student_count
  //    FROM academic_terms t
  //    LEFT JOIN student_term_enrollments ste 
  //       ON ste.term_id = t.id
  //    WHERE t.school_id = $1
  //    GROUP BY t.id
  //    ORDER BY t.created_at DESC`,
  //     [schoolId],
  //   );

  //   const classrooms = await pool.query(
  //     `SELECT id, name 
  //    FROM classrooms 
  //    WHERE school_id = $1`,
  //     [schoolId],
  //   );

  //   const students = await pool.query(
  //     `SELECT 
  //       u.id,
  //       u.fullname,
  //       us.classroom_id
  //    FROM users2 u
  //    JOIN user_school us ON us.user_id = u.id
  //    WHERE us.school_id = $1 
  //      AND us.role_in_school = 'student' 
  //      AND us.approved = true`,
  //     [schoolId],
  //   );

  //   return res.render("partials/terms", {
  //     school: {
  //       id: schoolId,
  //       terms: terms.rows,
  //       classrooms: classrooms.rows,
  //       students: students.rows,
  //     },
  //   });
  // }
  
  if (section === "terms") {
    const terms = await pool.query(
      `SELECT 
          t.id AS term_id,
          t.name AS term_name,
          t.start_date,
          t.end_date,
          t.is_active,
          COUNT(DISTINCT ste.student_id) AS student_count
      FROM academic_terms t
      LEFT JOIN student_term_enrollments ste 
          ON ste.term_id = t.id
      WHERE t.school_id = $1
      GROUP BY t.id
      ORDER BY t.created_at DESC`,
      [schoolId]
    );

    return res.send(`
      <div id="terms-section">
        <h3>📅 Academic Terms</h3>

        <div class="table-responsive">
          <table class="user-table">
            <thead>
              <tr>
                <th>Term</th>
                <th>Period</th>
                <th>Students</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${terms.rows.map(t => `
                <tr>
                  <td><strong>${t.term_name}</strong></td>
                  <td>${t.start_date || '-'} → ${t.end_date || '-'}</td>
                  <td>${t.student_count || 0}</td>
                  <td>${t.is_active ? '🟢 Active' : '⚪ Inactive'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `);
  }

  if (section === "attendance") {
    const terms = await pool.query(
      `SELECT id AS term_id, name AS term_name
     FROM academic_terms
     WHERE school_id = $1`,
      [schoolId],
    );

    const classrooms = await pool.query(
      `SELECT id, name
     FROM classrooms
     WHERE school_id = $1`,
      [schoolId],
    );

    return res.render("partials/attendance", {
      school: {
        terms: terms.rows,
        classrooms: classrooms.rows,
      },
    });
  }

  return res.send("<p>Section not found.</p>");
};

exports.addStudent = async (req, res) => {
  try {
    const { fullname, gender } = req.body;
    const schoolRes = await pool.query(
      "SELECT id, name FROM schools WHERE created_by = $1 LIMIT 1",
      [req.session.user.id]
    );

    if (!schoolRes.rows.length) {
      return res.status(404).send("School not found");
    }

    const schoolId = schoolRes.rows[0].id;
    const schoolName = schoolRes.rows[0].name; // ✅ now works

    // 🔥 Generate email
    const cleanName = fullname.toLowerCase().replace(/\s+/g, "");
    const schoolFirstWord = schoolName.split(" ")[0].toLowerCase();

    const email = `${cleanName}@${schoolFirstWord}school.com`;

    // 🔥 Default password
    const defaultPassword = "12345678";
    const hashedPassword = await bcrypt.hash(defaultPassword, 10);

    // 1️⃣ Create user
    const userRes = await pool.query(
      `INSERT INTO users2 (fullname, email, password, role, gender)
       VALUES ($1, $2, $3, 'student', $4)
       RETURNING id`,
      [fullname, email, hashedPassword, gender]
    );

    const userId = userRes.rows[0].id;

    // 2️⃣ Link to school
    await pool.query(
      `INSERT INTO user_school (user_id, school_id, role_in_school, approved)
       VALUES ($1, $2, 'student', true)`,
      [userId, schoolId]
    );

    res.redirect("/school-admin/dashboard?section=students");

  } catch (err) {
    console.error("Add student error:", err);
    res.status(500).send("Server error");
  }
};

exports.bulkAddStudents = async (req, res) => {
  try {
    if (!req.file) {
      return res.json({ success: false, message: "No file uploaded" });
    }

    const schoolRes = await pool.query(
      "SELECT id, name FROM schools WHERE created_by = $1 LIMIT 1",
      [req.session.user.id],
    );

    if (!schoolRes.rows.length) {
      return res.json({ success: false, message: "School not found" });
    }

    const schoolId = schoolRes.rows[0].id;
    const schoolName = schoolRes.rows[0].name;

    const schoolFirstWord = schoolName
      .split(" ")[0]
      .replace(/[^a-zA-Z]/g, "")
      .toLowerCase();

    const students = [];
    const errors = [];

    fs.createReadStream(req.file.path)
      .pipe(csv())
      .on("data", (row) => {
        students.push(row);
      })
      .on("end", async () => {
        for (const [index, s] of students.entries()) {
          try {
            if (!s.fullname || !s.gender) {
              errors.push(`Row ${index + 1}: Missing fullname or gender`);
              continue;
            }

            const cleanName = s.fullname.toLowerCase().replace(/\s+/g, "");
            const email = `${cleanName}@${schoolFirstWord}school.com`;

            const hashedPassword = await bcrypt.hash("12345678", 10);

            const userRes = await pool.query(
              `INSERT INTO users2 (fullname, email, password, role, gender)
               VALUES ($1, $2, $3, 'student', $4)
               ON CONFLICT (email) DO NOTHING
               RETURNING id`,
              [s.fullname, email, hashedPassword, s.gender],
            );

            if (userRes.rows.length > 0) {
              const userId = userRes.rows[0].id;

              await pool.query(
                `INSERT INTO user_school (user_id, school_id, role_in_school, approved)
                 VALUES ($1, $2, 'student', true)
                 ON CONFLICT DO NOTHING`,
                [userId, schoolId],
              );
            }
          } catch (err) {
            errors.push(`Row ${index + 1}: ${err.message}`);
          }
        }

        if (errors.length > 0) {
          return res.json({
            success: false,
            message: "Some rows failed",
            errors,
          });
        }

        res.json({
          success: true,
          message: "Students uploaded successfully",
        });
      });
  } catch (err) {
    console.error(err);
    res.json({ success: false, message: "Bulk upload failed" });
  }
};

exports.approveUser = async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(
      `UPDATE user_school 
       SET approved = true 
       WHERE user_id = $1 AND school_id = $2`,
      [id, req.session.user.school_id]
    );

    await logActivityForUser(req, "User approved", `Approved user ID: ${id}`);

    if (req.xhr || req.headers.accept.indexOf("json") > -1) {
      return res.json({ success: true, id });
    }

    res.redirect("/school-admin/dashboard");
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// Bulk approval
exports.approveAllUsers = async (req, res) => {
  try {
    await pool.query(
      `UPDATE user_school
       SET approved = true
       WHERE school_id = $1 AND approved = false`,
      [req.session.user.school_id]
    );

    await logActivityForUser(req, "Bulk approval", "Approved all pending users");

    if (req.xhr || req.headers.accept.indexOf("json") > -1) {
      return res.json({ success: true });
    }

    res.redirect("/school-admin/dashboard");
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// Reject user (remove link)
exports.rejectUser = async (req, res) => {
  const { id } = req.params;
  await pool.query(
    `DELETE FROM user_school 
     WHERE user_id = $1 AND school_id = $2`,
    [id, req.session.user.school_id]
  );
  res.redirect("/school-admin/dashboard");
};

// List classrooms
exports.listClassrooms = async (req, res) => {
  const schoolRes = await pool.query(
    `SELECT id FROM schools WHERE created_by = $1 LIMIT 1`,
    [req.session.user.id]
  );

  const schoolId = schoolRes.rows[0].id;
  const result = await pool.query(
    "SELECT * FROM classrooms WHERE school_id = $1",
    [schoolId]
  );
  res.render("school-admin/classrooms", { classrooms: result.rows });
};

// Create classroom
exports.createClassroom = async (req, res) => {
  const schoolRes = await pool.query(
    `SELECT id FROM schools WHERE created_by = $1 LIMIT 1`,
    [req.session.user.id]
  );

  const schoolId = schoolRes.rows[0].id;
  const { name, teacher_id } = req.body;

  try {
    // Step 1: create classroom
    const result = await pool.query(
      "INSERT INTO classrooms (school_id, name) VALUES ($1, $2) RETURNING id",
      [schoolId, name]
    );

    const classroomId = result.rows[0].id;
     await logActivityForUser(req, "Classroom created", `Classroom: ${name}`);


    // Step 2: assign teachers (into classroom_teachers)
    if (teacher_id) {
      const teacherIds = Array.isArray(teacher_id) ? teacher_id : [teacher_id];
      for (const tid of teacherIds) {
        await pool.query(
          `INSERT INTO classroom_teachers (classroom_id, teacher_id)
           VALUES ($1, $2)
           ON CONFLICT (classroom_id, teacher_id) DO NOTHING`,
          [classroomId, tid]
        );
      }
    }

    res.redirect("/school-admin/dashboard");
  } catch (err) {
    console.error("Error creating classroom:", err);
    res.status(500).send("Server error while creating classroom");
  }
};

// Assign student/teacher to a classroom

exports.assignToClassroom = async (req, res) => {
  try {
    const { student_id } = req.body;
    const classroomId = req.params.id;

    const schoolRes = await pool.query(
      `SELECT id FROM schools WHERE created_by = $1 LIMIT 1`,
      [req.session.user.id]
    );

    const schoolId = schoolRes.rows[0].id;

    // Check if user is part of this school
    const roleResult = await pool.query(
      `SELECT role_in_school 
       FROM user_school 
       WHERE user_id = $1 AND school_id = $2`,
      [student_id, schoolId]
    );

    if (!roleResult.rows.length) {
      return res.status(400).json({
        success: false,
        message: "User not part of this school"
      });
    }

    const role = roleResult.rows[0].role_in_school;

    if (role !== "student") {
      return res.status(400).json({
        success: false,
        message: "Only students can be assigned here"
      });
    }

    // ✅ Assign student
    await pool.query(
      `UPDATE user_school
       SET classroom_id = $1
       WHERE user_id = $2 AND school_id = $3`,
      [classroomId, student_id, schoolId]
    );

    // ✅ Fetch student
    const studentRes = await pool.query(
      `SELECT u.id, u.fullname, u.email, us.joined_at
       FROM users2 u
       JOIN user_school us ON u.id = us.user_id
       WHERE u.id = $1 AND us.school_id = $2`,
      [student_id, schoolId]
    );

    const student = studentRes.rows[0];

    res.json({ success: true, student });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Server error while assigning classroom"
    });
  }
};

exports.assignToClassroomB = async (req, res) => {
  try {
    const { classroom_id } = req.body; // From AJAX POST JSON
    const userId = req.params.id;       // From URL param
    const schoolRes = await pool.query(
      `SELECT id FROM schools WHERE created_by = $1 LIMIT 1`,
      [req.session.user.id]
    );

    const schoolId = schoolRes.rows[0].id;

    // Check if user is part of this school
    const roleResult = await pool.query(
      `SELECT role_in_school FROM user_school WHERE user_id = $1 AND school_id = $2`,
      [userId, schoolId]
    );

    if (!roleResult.rows.length) {
      return res.status(400).json({ success: false, message: "User not part of this school" });
    }

    const role = roleResult.rows[0].role_in_school;

    let student, classroom;

    if (role === "student") {
      // Assign student to classroom
      const updateRes = await pool.query(
        `UPDATE user_school
         SET classroom_id = $1
         WHERE user_id = $2 AND school_id = $3
         RETURNING user_id`,
        [classroom_id, userId, schoolId]
      );


      const studentRes = await pool.query(
        `SELECT u.id, u.fullname, u.email, us.joined_at
        FROM users2 u
        JOIN user_school us ON u.id = us.user_id
        WHERE u.id = $1 AND us.school_id = $2`,
        [userId, schoolId]
      );

      student = studentRes.rows[0];

      // Fetch classroom info
      const classroomRes = await pool.query(
        `SELECT id, name FROM classrooms WHERE id = $1`,
        [classroom_id]
      );

      classroom = classroomRes.rows[0];

      await logActivityForUser(req, "Student assigned to classroom", `Student ID: ${student.id}`);

    } else if (role === "teacher") {
      // Assign teacher to classroom
      await pool.query(
        `INSERT INTO classroom_teachers (classroom_id, teacher_id)
         VALUES ($1, $2)
         ON CONFLICT (classroom_id, teacher_id) DO NOTHING`,
        [classroom_id, userId]
      );

      await logActivityForUser(req, "Teacher assigned to classroom", `Teacher ID: ${userId}`);
      return res.json({ success: true, message: "Teacher assigned to classroom" });
    }

    res.json({ success: true, student, classroom });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error while assigning classroom" });
  }
};

exports.viewClassroom = async (req, res) => {
  const { id } = req.params;

  const classroom = await pool.query("SELECT * FROM classrooms WHERE id = $1", [
    id,
  ]);

  const students = await pool.query(
    `SELECT u.* 
     FROM users2 u
     JOIN user_school us ON u.id = us.user_id
     WHERE us.classroom_id = $1 AND us.approved = true AND us.role_in_school = 'student'`,
    [id]
  );

//   const teachers = await pool.query(
//     `SELECT u.*
//      FROM users2 u
//      JOIN user_school us ON u.id = us.user_id
//      WHERE us.classroom_id = $1 AND us.approved = true AND us.role_in_school = 'teacher'`,
//     [id]
//   );

    const teachers = await pool.query(
      `SELECT u.* 
        FROM users2 u
        JOIN classroom_teachers ct ON u.id = ct.teacher_id
        WHERE ct.classroom_id = $1`,
      [id]
    );
  res.render("school-admin/classroom-detail", {
    classroom: classroom.rows[0],
    students: students.rows,
    teachers: teachers.rows,
  });
};

// Edit classroom form
exports.editClassroomForm = async (req, res) => {
  const { id } = req.params;
  const classroom = await pool.query("SELECT * FROM classrooms WHERE id = $1", [
    id,
  ]);
  res.render("school-admin/edit-classroom", { classroom: classroom.rows[0] });
};

// Update classroom
exports.updateClassroom = async (req, res) => {
  const { id } = req.params; // classroomId
  const { name, teacher_id } = req.body;

  try {
    // Step 1: update classroom name
    await pool.query("UPDATE classrooms SET name = $1 WHERE id = $2", [
      name,
      id,
    ]);
    await logActivityForUser(req, "Classroom renamed", `Classroom: ${name}`);

    // Step 2: clear old assignments
    await pool.query("DELETE FROM classroom_teachers WHERE classroom_id = $1", [
      id,
    ]);
    await logActivityForUser(req, "Teacher Deleted from classroom", `Classroom: ${name}`);
    // Step 3: insert new teacher list
    if (teacher_id) {
      const teacherIds = Array.isArray(teacher_id) ? teacher_id : [teacher_id];
      for (const tid of teacherIds) {
        await pool.query(
          `INSERT INTO classroom_teachers (classroom_id, teacher_id)
           VALUES ($1, $2)
           ON CONFLICT (classroom_id, teacher_id) DO NOTHING`,
          [id, tid]
        );
        await logActivityForUser(
          req,
          "Teacher assigned to class",
          `Classroom: ${tid}`
        );
      }
    }
    await logActivityForUser(req, "Classroom updated", `Classroom: ${name}`);
    res.redirect("/school-admin/dashboard");
  } catch (err) {
    console.error("Error updating classroom:", err);
    res.status(500).send("Server error while updating classroom");
  }
};

// Delete classroom
exports.deleteClassroom = async (req, res) => {
  const { id } = req.params;
  await pool.query("DELETE FROM classrooms WHERE id = $1", [id]);
  await logActivityForUser(req, "Classroom deleted", `Classroom ID: ${id}`);
  res.redirect("/school-admin/dashboard");
};

exports.addStudentToClassroom = async (req, res) => {
  const classroomId = req.params.id;
  const { student_id } = req.body;
  const schoolRes = await pool.query(
    `SELECT id FROM schools WHERE created_by = $1 LIMIT 1`,
    [req.session.user.id]
  );

  const schoolId = schoolRes.rows[0].id;

  try {
    if (!student_id) {
      return res
        .status(400)
        .json({ success: false, message: "No student selected." });
    }

    // Verify the student exists and is approved
    const studentResult = await pool.query(
      `SELECT u.id, u.fullname, u.email, us.joined_at
       FROM users2 u
       JOIN user_school us ON u.id = us.user_id
       WHERE u.id = $1 AND us.school_id = $2 
         AND us.role_in_school = 'student' 
         AND us.approved = true`,
      [student_id, schoolId]
    );

    if (!studentResult.rows.length) {
      return res
        .status(404)
        .json({
          success: false,
          message: "Student not found or not approved.",
        });
    }

    const student = studentResult.rows[0];

    // Update user_school with the classroom assignment
    await pool.query(
      `UPDATE user_school
       SET classroom_id = $1
       WHERE user_id = $2 AND school_id = $3 
         AND role_in_school = 'student' 
         AND approved = true`,
      [classroomId, student_id, schoolId]
    );

    // ✅ Return JSON for AJAX
    res.json({
      success: true,
      student,
    });
  } catch (err) {
    console.error("Error adding student to classroom:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error while adding student" });
  }
};

// ------------------ QUOTES ------------------ //

// exports.getQuotes = async (req, res) => {
//   try {
//     // get school created by this admin
//     const schoolRes = await pool.query(
//       `SELECT id, name FROM schools WHERE created_by = $1 LIMIT 1`,
//       [req.session.user.id]
//     );

//     if (schoolRes.rows.length === 0) {
//       return res.status(404).send("No school found");
//     }

//     const schoolId = schoolRes.rows[0].id;

//     // ✅ NEW QUERY (term-based quotes)
//     const quotesResult = await pool.query(
//       `SELECT
//         q.id,
//         q.term_id,
//         q.price_per_student,
//         q.total_students,
//         q.total_amount,
//         q.status,
//         q.created_at,
//         s.name AS school_name,
//         t.name AS term_name
//       FROM quotes q
//       JOIN schools s ON q.school_id = s.id
//       JOIN academic_terms t ON q.term_id = t.id
//       WHERE q.school_id = $1
//       ORDER BY q.created_at DESC`,
//       [schoolId]
//     );

//     res.render("admin/quotes", {
//       quotes: quotesResult.rows,
//       currentPage: "quotes",
//       role: "admin"
//     });

//   } catch (err) {
//     console.error("Error fetching quotes:", err);
//     res.status(500).send("Server Error");
//   }
// };

exports.getQuotes = async (req, res) => {
  try {
    const schoolId = req.session.user.school_id;

    const result = await pool.query(
      `
      SELECT 
        q.id,
        t.name AS term_name,
        q.price_per_student,

        COALESCE(st.total_students, 0) AS total_students,

        (COALESCE(st.total_students, 0) * COALESCE(q.price_per_student,0))
          AS total_amount,

        COALESCE(p.total_paid,0) AS total_paid,

        (
          (COALESCE(st.total_students, 0) * COALESCE(q.price_per_student,0))
          - COALESCE(p.total_paid,0)
        ) AS balance,

        q.status,

        t.start_date,
        t.end_date

      FROM quotes q

      JOIN academic_terms t
        ON t.id = q.term_id

      LEFT JOIN (
        SELECT term_id, COUNT(*) AS total_students
        FROM student_term_enrollments
        GROUP BY term_id
      ) st ON st.term_id = q.term_id

      LEFT JOIN (
        SELECT quote_id, SUM(amount) AS total_paid
        FROM school_payments
        GROUP BY quote_id
      ) p ON p.quote_id = q.id

      WHERE q.school_id = $1

      ORDER BY t.start_date DESC
      `,
      [schoolId],
    );

    res.render("schoolAdmin/quotes", {
      quotes: result.rows,
      currentPage: "quotes",
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error loading quotes");
  }
};

exports.addQuote = async (req, res) => {
  try {
    const { requested_students, price_quote } = req.body;
    const schoolRes = await pool.query(
  `SELECT id FROM schools WHERE created_by = $1 LIMIT 1`,
  [req.session.user.id]
);

const schoolId = schoolRes.rows[0].id;

    await pool.query(
      `INSERT INTO quotes (school_id, requested_students, price_quote, status) 
       VALUES ($1, $2, $3, 'pending')`,
      [schoolId, requested_students, price_quote]
    );
    await logActivityForUser(req, "quote created created", `School ID: ${schoolId}`);

    res.redirect("/school-admin/dashboard");
  } catch (err) {
    console.error("Error adding quote:", err);
    res.status(500).send("Server Error");
  }
};

exports.deleteQuote = async (req, res) => {
  try {
    await pool.query("DELETE FROM quotes WHERE id=$1", [req.params.id]);
    
    res.redirect("/school-admin/dashboard");
  } catch (err) {
    console.error("Error deleting quote:", err);
    res.status(500).send("Server Error");
  }
};

// ------------------ PAYMENTS ------------------ //
exports.getPayments = async (req, res) => {
  try {
    const schoolRes = await pool.query(
  `SELECT id FROM schools WHERE created_by = $1 LIMIT 1`,
  [req.session.user.id]
);

const schoolId = schoolRes.rows[0].id;
    const payments = await pool.query(
      `SELECT p.id, u.fullname, p.amount, p.status, p.updated_at
       FROM payments p
       JOIN users2 u ON p.user_id = u.id
       WHERE p.school_id=$1
       ORDER BY p.updated_at DESC`,
      [schoolId]
    );
    res.render("partials/payments", { payments: payments.rows });
  } catch (err) {
    console.error("Error fetching payments:", err);
    res.status(500).send("Server Error");
  }
};

exports.updatePayment = async (req, res) => {
  try {
    const { paymentId, status } = req.body;
    await pool.query("UPDATE payments SET status=$1 WHERE id=$2", [
      status,
      paymentId,
    ]);
    res.redirect("/school-admin/dashboard");
  } catch (err) {
    console.error("Error updating payment:", err);
    res.status(500).send("Server Error");
  }
};

exports.getPaymentHistory = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      SELECT 
        amount,
        payment_date
      FROM school_payments
      WHERE quote_id = $1
      ORDER BY payment_date DESC
      `,
      [id],
    );

    res.render("schoolAdmin/paymentHistory", {
      payments: result.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error");
  }
};

// ------------------ CLASSROOM ↔ COURSES ------------------ //

// 📌 School Admin: Manage classroom-course assignments
exports.getClassroomCourses = async (req, res) => {
  try {
    const schoolRes = await pool.query(
  `SELECT id FROM schools WHERE created_by = $1 LIMIT 1`,
  [req.session.user.id]
);

const schoolId = schoolRes.rows[0].id;
    console.log("School Admin Dashboard -> School ID:", schoolId);

    // ✅ Only classrooms for this school
    const classrooms = await pool.query(
      "SELECT id, name FROM classrooms WHERE school_id=$1",
      [schoolId]
    );

    // ✅ Only fetch courses assigned to this school (via school_courses)
    const courses = await pool.query(
      `SELECT c.id, c.title
       FROM courses c
       INNER JOIN school_courses sc ON c.id = sc.course_id
       WHERE sc.school_id = $1
       ORDER BY c.title`,
      [schoolId]
    );

    console.log("Allowed Courses for this school:", courses.rows);

    // ✅ Classroom-course assignments only for this school
    const classroomCourses = await pool.query(
      `SELECT cc.id, c.name AS classroom, cr.title AS course
       FROM classroom_courses cc
       JOIN classrooms c ON cc.classroom_id = c.id
       JOIN courses cr ON cc.course_id = cr.id
       WHERE c.school_id=$1
       ORDER BY c.name, cr.title`,
      [schoolId]
    );

    res.render("partials/classroom-courses", {
      classrooms: classrooms.rows,
      courses: courses.rows, // ✅ filtered by school
      classroomCourses: classroomCourses.rows,
    });
  } catch (err) {
    console.error("Error fetching classroom courses:", err);
    res.status(500).send("Server Error");
  }
};


exports.assignCourseToClassroom = async (req, res) => {
  try {
    const { classroomId, courseId } = req.body;
    const schoolRes = await pool.query(
  `SELECT id FROM schools WHERE created_by = $1 LIMIT 1`,
  [req.session.user.id]
);

const schoolId = schoolRes.rows[0].id;

    // ✅ Check that this course actually belongs to the school
    const validCourse = await pool.query(
      "SELECT 1 FROM school_courses WHERE school_id=$1 AND course_id=$2",
      [schoolId, courseId]
    );
    if (!validCourse.rows.length) {
      return res.status(403).send("Not allowed to assign this course.");
    }

    // ✅ Prevent duplicates
    const exists = await pool.query(
      "SELECT 1 FROM classroom_courses WHERE classroom_id=$1 AND course_id=$2",
      [classroomId, courseId]
    );

    if (!exists.rows.length) {
      await pool.query(
        "INSERT INTO classroom_courses (classroom_id, course_id) VALUES ($1, $2)",
        [classroomId, courseId]
      );
    }
    await logActivityForUser(req, "course assigned to classroom", `Classroom ID: ${classroomId}`);
    res.redirect("/school-admin/dashboard");
  } catch (err) {
    console.error("Error assigning course:", err);
    res.status(500).send("Server Error");
  }
};

exports.updateClassroomCourse = async (req, res) => {
  try {
    const { courseId } = req.body;
    const { id } = req.params; // classroom_course.id

    await pool.query(
      "UPDATE classroom_courses SET course_id=$1 WHERE id=$2",
      [courseId, id]
    );
    await logActivityForUser(req, "Classroom course updated", `Course ID: ${courseId}`);

    res.redirect("/school-admin/dashboard");
  } catch (err) {
    console.error("Error updating classroom course:", err);
    res.status(500).send("Server Error");
  }
};

exports.deleteClassroomCourse = async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query("DELETE FROM classroom_courses WHERE id=$1", [id]);

    res.redirect("/school-admin/dashboard");
  } catch (err) {
    console.error("Error deleting classroom course:", err);
    res.status(500).send("Server Error");
  }
};

// POST /school/payments/:paymentId/adjustments
exports.addPaymentAdjustment = async (req, res) => {
  const { paymentId } = req.params;
  const { extra_students, extra_amount } = req.body;

  const result = await pool.query(
    `INSERT INTO school_payment_adjustments (school_payment_id, extra_students, extra_amount)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [paymentId, extra_students, extra_amount]
  );

  res.json({ success: true, adjustment: result.rows[0] });
};

exports.getTerms = async (req, res) => {
  try {
    const schoolId = req.session.user.school_id;

    const result = await pool.query(
      `
      SELECT *
      FROM academic_terms
      WHERE school_id = $1
      ORDER BY start_date DESC
      `,
      [schoolId],
    );

    res.render("schoolAdmin/terms", {
      terms: result.rows,
      currentPage: "terms",
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error");
  }
};

// =============================
// ATTENDANCE PAGE
// =============================
exports.attendancePage = async (req, res) => {
  try {
    const schoolId = req.session.user.school_id;

    const terms = await pool.query(
      `
      SELECT *
      FROM academic_terms
      WHERE school_id = $1
      ORDER BY start_date DESC
      `,
      [schoolId],
    );

    const classrooms = await pool.query(
      `
      SELECT *
      FROM classrooms
      WHERE school_id = $1
      ORDER BY name ASC
      `,
      [schoolId],
    );

    res.render("schoolAdmin/attendance", {
      terms: terms.rows,
      classrooms: classrooms.rows,
      currentPage: "attendance",
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error loading attendance page");
  }
};

// =============================
// QUOTE DETAILS
// =============================
exports.getQuoteDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const schoolId = req.session.user.school_id;

    const result = await pool.query(
      `
      SELECT 
        q.id,
        q.price_per_student,
        q.total_students,
        q.total_amount,
        q.total_paid,
        q.balance,
        q.status,

        t.name AS term_name,
        t.start_date,
        t.end_date,

        s.name AS school_name,
        s.address

      FROM quotes q

      JOIN academic_terms t
        ON t.id = q.term_id

      JOIN schools s
        ON s.id = q.school_id

      WHERE q.id = $1
      AND q.school_id = $2
      `,
      [id, schoolId],
    );

    if (result.rows.length === 0) {
      return res.status(404).send("Quote not found");
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error loading quote");
  }
};

// =============================
// PAYMENT HISTORY
// =============================
exports.getPaymentHistory = async (req, res) => {
  try {
    const { id } = req.params;
    const schoolId = req.session.user.school_id;

    const result = await pool.query(
      `
      SELECT 
        sp.id,
        sp.amount,
        sp.payment_date

      FROM school_payments sp

      JOIN quotes q
        ON q.id = sp.quote_id

      WHERE sp.quote_id = $1
      AND q.school_id = $2

      ORDER BY sp.payment_date DESC
      `,
      [id, schoolId],
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error loading payment history");
  }
};

// =============================
// DOWNLOAD QUOTE PDF
// =============================
exports.downloadQuotePDF = async (req, res) => {
  const { id } = req.params;

  try {
    const schoolId = req.session.user.school_id;

    const result = await pool.query(
      `
      SELECT 
        q.id,
        q.price_per_student,
        q.total_students,
        q.total_amount,
        q.total_paid,
        q.balance,
        q.status,

        s.name AS school_name,
        s.address,

        t.name AS term_name

      FROM quotes q

      JOIN schools s
        ON q.school_id = s.id

      JOIN academic_terms t
        ON q.term_id = t.id

      WHERE q.id = $1
      AND q.school_id = $2
      `,
      [id, schoolId],
    );

    if (result.rows.length === 0) {
      return res.status(404).send("Quote not found");
    }

    const q = result.rows[0];

    const numberToWords = require("number-to-words");

    const total = Number(q.total_amount || 0);
    const totalPaid = Number(q.total_paid || 0);
    const balance = Number(q.balance || 0);

    const words = numberToWords.toWords(total).toUpperCase();

    const today = new Date().toDateString();

    const html = `
    <html>
    <head>
    <style>
      body{
        font-family: Arial;
        padding:40px;
      }

      .header{
        text-align:center;
        margin-bottom:30px;
      }

      .title{
        font-size:28px;
        font-weight:bold;
      }

      table{
        width:100%;
        border-collapse:collapse;
        margin-top:20px;
      }

      th{
        background:#000;
        color:#fff;
        padding:10px;
      }

      td{
        border:1px solid #ccc;
        padding:10px;
        text-align:center;
      }

      .total-row{
        background:#f2f2f2;
        font-weight:bold;
      }

      .summary{
        margin-top:30px;
        font-size:14px;
      }

    </style>
    </head>

    <body>

      <div class="header">
        <div class="title">SCHOOL INVOICE</div>

        <p>
          <b>${q.school_name}</b><br/>
          ${q.address || ""}
        </p>

        <p>
          <b>Term:</b> ${q.term_name}
        </p>

        <p>
          Date: ${today}
        </p>
      </div>

      <table>
        <tr>
          <th>Students</th>
          <th>Price Per Student</th>
          <th>Total Amount</th>
        </tr>

        <tr>
          <td>${q.total_students}</td>
          <td>₦${Number(q.price_per_student).toLocaleString()}</td>
          <td>₦${total.toLocaleString()}</td>
        </tr>

        <tr class="total-row">
          <td colspan="2">TOTAL</td>
          <td>₦${total.toLocaleString()}</td>
        </tr>
      </table>

      <div class="summary">
        <p><b>Total Paid:</b> ₦${totalPaid.toLocaleString()}</p>

        <p><b>Balance:</b> ₦${balance.toLocaleString()}</p>

        <p><b>Status:</b> ${q.status}</p>

        <p>
          <b>Amount in Words:</b>
          ${words} NAIRA ONLY
        </p>
      </div>

    </body>
    </html>
    `;

    // const browser = await puppeteer.launch({
    //   headless: true,
    //   args: ["--no-sandbox", "--disable-setuid-sandbox"],
    // });

    // const page = await browser.newPage();

    // await page.setContent(html, {
    //   waitUntil: "networkidle0",
    // });

    // const pdf = await page.pdf({
    //   format: "A4",
    //   printBackground: true,
    // });

    // await browser.close();

    const pdf = await generatePdf(html);

    res.setHeader("Content-Type", "application/pdf");

    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${q.school_name.replace(/\s+/g, "_")}_Invoice.pdf`,
    );

    res.send(pdf);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error generating PDF");
  }
};

// =============================
// CREATE TERM
// =============================
exports.createTerm = async (req, res) => {
  try {
    const schoolId = req.session.user.school_id;

    const {
      name,
      start_date,
      end_date,
      price_per_student,
    } = req.body;

    const termResult = await pool.query(
      `
      INSERT INTO academic_terms (
        school_id,
        name,
        start_date,
        end_date
      )
      VALUES ($1,$2,$3,$4)
      RETURNING *
      `,
      [schoolId, name, start_date, end_date],
    );

    const term = termResult.rows[0];

    await pool.query(
      `
      INSERT INTO quotes (
        school_id,
        term_id,
        price_per_student,
        status
      )
      VALUES ($1,$2,$3,'unpaid')
      `,
      [schoolId, term.id, price_per_student || 0],
    );

    res.json({
      success: true,
      term,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Error creating term",
    });
  }
};

// =============================
// UPDATE TERM
// =============================
exports.updateTerm = async (req, res) => {
  try {
    const { id } = req.params;

    const {
      name,
      start_date,
      end_date,
      price_per_student,
    } = req.body;

    await pool.query(
      `
      UPDATE academic_terms
      SET
        name = $1,
        start_date = $2,
        end_date = $3
      WHERE id = $4
      `,
      [name, start_date, end_date, id],
    );

    if (price_per_student !== undefined) {
      await pool.query(
        `
        UPDATE quotes
        SET price_per_student = $1
        WHERE term_id = $2
        `,
        [price_per_student, id],
      );
    }

    res.json({
      success: true,
      message: "Term updated",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Error updating term",
    });
  }
};

// =============================
// DELETE TERM
// =============================
exports.deleteTerm = async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query(
      `DELETE FROM student_term_enrollments WHERE term_id = $1`,
      [id],
    );

    await pool.query(
      `DELETE FROM quotes WHERE term_id = $1`,
      [id],
    );

    await pool.query(
      `DELETE FROM attendance_sessions WHERE term_id = $1`,
      [id],
    );

    await pool.query(
      `DELETE FROM academic_terms WHERE id = $1`,
      [id],
    );

    res.json({
      success: true,
      message: "Term deleted",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Error deleting term",
    });
  }
};

// =============================
// ASSIGN STUDENTS TO TERM
// =============================
exports.assignStudentsToTerm = async (req, res) => {
  try {
    const { term_id, student_ids } = req.body;

    if (!student_ids || !student_ids.length) {
      return res.status(400).json({
        success: false,
        message: "No students selected",
      });
    }

    for (const studentId of student_ids) {
      await pool.query(
        `
        INSERT INTO student_term_enrollments (
          term_id,
          student_id
        )
        VALUES ($1,$2)
        ON CONFLICT DO NOTHING
        `,
        [term_id, studentId],
      );
    }

    res.json({
      success: true,
      message: "Students assigned successfully",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Error assigning students",
    });
  }
};

// =============================
// GET TERM STUDENTS
// =============================
exports.getTermStudents = async (req, res) => {
  try {
    // const { termId } = req.params;
    const { sessionId } = req.params;

    const result = await pool.query(
      `
      SELECT
        u.id,
        u.fullname,
        u.email,
        u.gender,
        c.name AS classroom

      FROM student_term_enrollments ste

      JOIN users2 u
        ON u.id = ste.student_id

      LEFT JOIN user_school us
        ON us.user_id = u.id

      LEFT JOIN classrooms c
        ON c.id = us.classroom_id

      WHERE ste.term_id = $1

      ORDER BY u.fullname ASC
      `,
      [termId],
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error loading students");
  }
};

// =============================
// EXPORT TERM STUDENTS EXCEL
// =============================
exports.exportTermStudentsExcel = async (req, res) => {
  try {
    // const { termId } = req.params;
    const { sessionId } = req.params;

    const result = await pool.query(
      `
      SELECT
        u.fullname,
        u.email,
        u.gender,
        c.name AS classroom

      FROM student_term_enrollments ste

      JOIN users2 u
        ON u.id = ste.student_id

      LEFT JOIN user_school us
        ON us.user_id = u.id

      LEFT JOIN classrooms c
        ON c.id = us.classroom_id

      WHERE ste.term_id = $1

      ORDER BY u.fullname ASC
      `,
      [termId],
    );

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Students");

    sheet.columns = [
      { header: "Full Name", key: "fullname", width: 30 },
      { header: "Email", key: "email", width: 30 },
      { header: "Gender", key: "gender", width: 15 },
      { header: "Classroom", key: "classroom", width: 25 },
    ];

    result.rows.forEach((row) => {
      sheet.addRow(row);
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );

    res.setHeader(
      "Content-Disposition",
      "attachment; filename=term_students.xlsx",
    );

    await workbook.xlsx.write(res);

    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).send("Error exporting excel");
  }
};

// =============================
// GET ATTENDANCE STUDENTS
// =============================
exports.getAttendanceStudents = async (req, res) => {
  try {
    const { classroom_id } = req.query;

    const result = await pool.query(
      `
      SELECT
        u.id,
        u.fullname

      FROM user_school us

      JOIN users2 u
        ON u.id = us.user_id

      WHERE us.classroom_id = $1
      AND us.role_in_school = 'student'
      AND us.approved = true

      ORDER BY u.fullname ASC
      `,
      [classroom_id],
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error loading students");
  }
};

// =============================
// SAVE ATTENDANCE
// =============================
exports.saveAttendance = async (req, res) => {
  try {
    const {
      term_id,
      classroom_id,
      attendance_date,
      records,
    } = req.body;

    const sessionResult = await pool.query(
      `
      INSERT INTO attendance_sessions (
        term_id,
        classroom_id,
        attendance_date
      )
      VALUES ($1,$2,$3)
      RETURNING id
      `,
      [term_id, classroom_id, attendance_date],
    );

    const sessionId = sessionResult.rows[0].id;

    for (const record of records) {
      await pool.query(
        `
        INSERT INTO attendance_records (
          session_id,
          student_id,
          status
        )
        VALUES ($1,$2,$3)
        `,
        [
          sessionId,
          record.student_id,
          record.status,
        ],
      );
    }

    res.json({
      success: true,
      message: "Attendance saved",
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error saving attendance");
  }
};

// =============================
// ATTENDANCE HISTORY
// =============================
exports.getAttendanceHistory = async (req, res) => {
  try {
    const schoolRes = await pool.query(
      `SELECT id FROM schools WHERE created_by = $1 LIMIT 1`,
      [req.session.user.id],
    );

    if (!schoolRes.rows.length) {
      return res.status(404).json({ error: "School not found" });
    }

    const schoolId = schoolRes.rows[0].id;
    const { term_id, classroom_id } = req.query;

    let query = `
      SELECT
        a.id,
        a.date,
        a.term_id,
        c.name AS classroom,
        t.name AS term_name,
        COUNT(ar.id) AS student_count
      FROM attendance_sessions a
      JOIN classrooms c ON c.id = a.classroom_id
      JOIN academic_terms t ON t.id = a.term_id
      LEFT JOIN attendance_records ar ON ar.session_id = a.id
      WHERE t.school_id = $1
    `;

    const params = [schoolId];

    // build WHERE conditions properly
    if (term_id) {
      params.push(term_id);
      query += ` AND a.term_id = $${params.length}`;
    }

    if (classroom_id) {
      params.push(classroom_id);
      query += ` AND a.classroom_id = $${params.length}`;
    }

    // ONLY ONE GROUP BY (at the end)
    query += `
      GROUP BY a.id, a.term_id, c.name, t.name
      ORDER BY a.date DESC
    `;

    const result = await pool.query(query, params);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error loading history");
  }
};

// =============================
// WEEKLY ATTENDANCE STATS
// =============================
exports.getWeeklyAttendanceStats = async (req, res) => {
  try {
    const schoolId = req.session.user.school_id;

    const result = await pool.query(
      `
      SELECT
        DATE(a.attendance_date) AS day,

        COUNT(*) FILTER (
          WHERE ar.status = 'present'
        ) AS present,

        COUNT(*) FILTER (
          WHERE ar.status = 'absent'
        ) AS absent

      FROM attendance_records ar

      JOIN attendance_sessions a
        ON a.id = ar.session_id

      JOIN academic_terms t
        ON t.id = a.term_id

      WHERE t.school_id = $1
      AND a.attendance_date >= NOW() - INTERVAL '7 days'

      GROUP BY DATE(a.attendance_date)

      ORDER BY day ASC
      `,
      [schoolId],
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error loading stats");
  }
};

// =============================
// GET ATTENDANCE SESSION
// =============================
exports.getAttendanceSession = async (req, res) => {
  try {
    const { id } = req.params;

    const session = await pool.query(
      `
      SELECT
        a.*,
        c.name AS classroom,
        t.name AS term_name

      FROM attendance_sessions a

      JOIN classrooms c
        ON c.id = a.classroom_id

      JOIN academic_terms t
        ON t.id = a.term_id

      WHERE a.id = $1
      `,
      [id],
    );

    const records = await pool.query(
      `
      SELECT
        u.fullname,
        ar.status

      FROM attendance_records ar

      JOIN users2 u
        ON u.id = ar.student_id

      WHERE ar.session_id = $1

      ORDER BY u.fullname ASC
      `,
      [id],
    );

    res.json({
      session: session.rows[0],
      records: records.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error loading attendance session");
  }
};

// =============================
// EXPORT ATTENDANCE PDF
// =============================
exports.exportAttendancePDF = async (req, res) => {
  try {
    const { sessionId } = req.params;

    // const session = await pool.query(
    //   `
    //   SELECT
    //     a.*,
    //     c.name AS classroom,
    //     t.name AS term_name

    //   FROM attendance_sessions a

    //   JOIN classrooms c
    //     ON c.id = a.classroom_id

    //   JOIN academic_terms t
    //     ON t.id = a.term_id

    //   WHERE a.id = $1
    //   `,
    //   [sessionId],
    // );


    const session = await pool.query(
      `
      SELECT
        a.*,
        c.name AS classroom,
        t.name AS term_name,
        s.name AS school_name,
        s.logo_url AS school_logo,
        a.date AS attendance_date
      FROM attendance_sessions a
      JOIN classrooms c ON c.id = a.classroom_id
      JOIN academic_terms t ON t.id = a.term_id
      JOIN schools s ON s.id = t.school_id
      WHERE a.id = $1
      `,
      [sessionId],
    );
    
    const records = await pool.query(
      `
      SELECT
        u.fullname,
        ar.status

      FROM attendance_records ar

      JOIN users2 u
        ON u.id = ar.student_id

      WHERE ar.session_id = $1
      `,
      [sessionId],
    );

    const s = session.rows[0];

    let rows = "";

    records.rows.forEach((r) => {
      rows += `
      <tr>
        <td>${r.fullname}</td>
        <td>${r.status}</td>
      </tr>
      `;
    });
    
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body {
          font-family: Arial, sans-serif;
          padding: 30px;
          color: #333;
        }

        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 5px solid #1f4e79;
          padding-bottom: 15px;
          margin-bottom: 25px;
        }

        .logo {
          height: 80px;
          width: 80px;
          object-fit: contain;
        }

        .title h2 {
          margin: 0;
          font-size: 22px;
          color: #1f4e79;
          text-transform: uppercase;
        }

        .title p {
          margin: 2px 0;
          font-size: 13px;
        }

        .title {
          text-align: center;
          flex: 1;
        }

        .info {
          margin-bottom: 20px;
          padding: 10px;
          background: #f4f6f8;
          border-radius: 6px;
          font-size: 14px;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 10px;
        }

        th {
          background: #2c3e50;
          color: white;
          padding: 10px;
          text-align: left;
        }

        td {
          padding: 10px;
          border-bottom: 1px solid #ddd;
        }

        .present {
          color: green;
          font-weight: bold;
        }

        .absent {
          color: red;
          font-weight: bold;
        }

        .footer {
          margin-top: 30px;
          font-size: 12px;
          text-align: center;
          color: #888;
        }
      </style>
    </head>

    <body>

      <div class="header">

        <img class="logo" src="${s.school_logo || "https://via.placeholder.com/80"}" />

        <div class="title">
          <h2>${s.school_name} - Attendance Report</h2>
          <p>${s.classroom} | ${s.term_name}</p>
          <p><b>Attendance Date:</b> ${new Date(s.attendance_date).toDateString()}</p>
        </div>

        <img class="logo" src="https://acad.jkthub.com/images/JKT%20logo.png" />

      </div>

      <div class="info">
        <b>Classroom:</b> ${s.classroom} <br/>
        <b>Term:</b> ${s.term_name} <br/>
        <b>Total Students:</b> ${records.rows.length}
      </div>

      <div style="
        position: fixed;
        top: 40%;
        left: 25%;
        opacity: 0.06;
        font-size: 80px;
        transform: rotate(-30deg);
        color: #000;
      ">
        ${s.school_name}
      </div>

      <table>
        <tr>
          <th>Student Name</th>
          <th>Status</th>
        </tr>

        ${records.rows
          .map(
            (r) => `
          <tr>
            <td>${r.fullname}</td>
            <td class="${r.status === "Present" ? "present" : "absent"}">
              ${r.status}
            </td>
          </tr>
        `,
          )
          .join("")}
      </table>

      <div class="footer">
        Generated by JKT Hub School Management System • ${new Date().getFullYear()}
      </div>

    </body>
    </html>
    `;
    
    // const browser = await puppeteer.launch({
    //   headless: true,
    //   args: ["--no-sandbox"],
    // });

    // const page = await browser.newPage();

    // await page.setContent(html);

    // const pdf = await page.pdf({
    //   format: "A4",
    //   printBackground: true,
    // });

    // await browser.close();

    const pdf = await generatePdf(html);

    res.setHeader("Content-Type", "application/pdf");

    const safeClass = s.classroom.replace(/\s+/g, "_");
    const safeDate = new Date(s.attendance_date)
      .toISOString()
      .split("T")[0]; // YYYY-MM-DD format

    const fileName = `attendance_${safeClass}_${s.term_name.replace(/\s+/g, "_")}_${safeDate}.pdf`;

    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${fileName}`,
    );

    res.send(pdf);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error exporting pdf");
  }
};

exports.exportAttendanceExcel = async (req, res) => {
  try {
    const { termId } = req.params;

    if (!termId) {
      return res.status(400).send("Missing term ID");
    }

    const result = await pool.query(
      `
      SELECT
        a.date,
        c.name AS classroom,
        u.fullname,
        ar.status
      FROM attendance_sessions a
      JOIN attendance_records ar ON ar.session_id = a.id
      JOIN users2 u ON u.id = ar.student_id
      JOIN classrooms c ON c.id = a.classroom_id
      WHERE a.term_id = $1
      ORDER BY a.date DESC
      `,
      [termId],
    );
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Attendance Report");

    // HEADER ROW STYLE
    sheet.columns = [
      { header: "Date", key: "date", width: 20 },
      { header: "Classroom", key: "classroom", width: 25 },
      { header: "Student Name", key: "fullname", width: 30 },
      { header: "Status", key: "status", width: 15 },
    ];

    // HEADER STYLE
    sheet.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFF" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "2C3E50" },
      };
      cell.alignment = { vertical: "middle", horizontal: "center" };
    });

    // DATA ROWS
    result.rows.forEach((row) => {
      const added = sheet.addRow(row);

      const statusCell = added.getCell(4);

      if (row.status === "Present") {
        statusCell.font = { color: { argb: "00AA00" }, bold: true };
      } else {
        statusCell.font = { color: { argb: "CC0000" }, bold: true };
      }
    });

    // ADD BORDER TO ALL CELLS
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: "thin" },
          left: { style: "thin" },
          bottom: { style: "thin" },
          right: { style: "thin" },
        };
      });
    });

    // AUTO FILTER
    sheet.autoFilter = {
      from: "A1",
      to: "D1",
    };

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );

    res.setHeader(
      "Content-Disposition",
      "attachment; filename=attendance.xlsx",
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).send("Error exporting excel");
  }
};