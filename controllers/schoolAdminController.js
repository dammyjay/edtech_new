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
const { listReportsForSchool, getReportById } = require("../services/classTermReportStore");
const classroomAnalyticsController = require("./classroomAnalyticsController");

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
    `SELECT id, name FROM schools WHERE created_by = $1 LIMIT 1`,
    [req.session.user.id]
  );

  if (!schoolRes.rows.length) {
    return res.status(404).send("School not found");
  }

  const schoolName = schoolRes.rows[0].name;

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
  // The `quotes` table no longer has `requested_students`/`price_quote`
  // columns (this used to query a flat "request a quote" model) — it's
  // now term-linked: one quote per academic_terms row, auto-created by
  // createTerm() with a price_per_student, with totals/balance computed
  // live. This was silently 500ing on every load until fixed.
  if (section === "quotes") {
    const quotes = await pool.query(
      `
      SELECT
        q.id,
        t.name AS term_name,
        q.price_per_student,
        COALESCE(st.total_students, 0) AS total_students,
        (COALESCE(st.total_students, 0) * COALESCE(q.price_per_student, 0)) AS total_amount,
        COALESCE(p.total_paid, 0) AS total_paid,
        (
          (COALESCE(st.total_students, 0) * COALESCE(q.price_per_student, 0))
          - COALESCE(p.total_paid, 0)
        ) AS balance,
        q.status,
        t.start_date,
        t.end_date
      FROM quotes q
      JOIN academic_terms t ON t.id = q.term_id
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
      [schoolId]
    );
    return res.render("partials/quotes", { quotes: quotes.rows });
  }

  // === Payments (with adjustments) ===
  // school_payments has no status/start_date/end_date/student_limit
  // columns (this used to query a different shape) — it's just a log of
  // amounts paid against a quote (school_id, quote_id, amount,
  // payment_date). This was silently 500ing on every load until fixed.
  if (section === "payments") {
    const payments = await pool.query(
      `SELECT sp.id,
            sp.amount AS base_amount,
            COALESCE(SUM(adj.extra_amount), 0) AS adjustments_total,
            (sp.amount + COALESCE(SUM(adj.extra_amount), 0)) AS total_amount,
            t.name AS term_name,
            q.status AS quote_status,
            sp.payment_date,
            sp.created_at
     FROM school_payments sp
     LEFT JOIN school_payment_adjustments adj
       ON sp.id = adj.school_payment_id AND adj.status = 'paid'
     LEFT JOIN quotes q ON q.id = sp.quote_id
     LEFT JOIN academic_terms t ON t.id = q.term_id
     WHERE sp.school_id = $1
     GROUP BY sp.id, t.name, q.status
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

    return res.render("partials/overview", {
      schoolAdmin: req.session.user,
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

  if (section === "terms") {
    const terms = await pool.query(
      `SELECT
          t.id AS term_id,
          t.name AS term_name,
          t.start_date,
          t.end_date,
          t.is_active,
          t.is_ended,
          t.ended_at,
          COUNT(DISTINCT ste.student_id) AS student_count
      FROM academic_terms t
      LEFT JOIN student_term_enrollments ste
          ON ste.term_id = t.id
      WHERE t.school_id = $1
      GROUP BY t.id
      ORDER BY t.created_at DESC`,
      [schoolId]
    );

    const classroomsForReports = await pool.query(
      `SELECT id, name FROM classrooms WHERE school_id = $1 ORDER BY name`,
      [schoolId]
    );

    const storedReports = await listReportsForSchool(schoolId);

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
                <th>Reports</th>
                <th>Roster</th>
              </tr>
            </thead>
            <tbody>
              ${terms.rows.map(t => `
                <tr>
                  <td><strong>${t.term_name}</strong></td>
                  <td>${t.start_date || '-'} → ${t.end_date || '-'}</td>
                  <td>${t.student_count || 0}</td>
                  <td>${t.is_active ? '🟢 Active' : '⚪ Inactive'}</td>
                  <td>${t.is_ended ? `✅ Ended ${new Date(t.ended_at).toLocaleDateString()}` : '⏳ Not yet finalized by admin'}</td>
                  <td><a href="/school-admin/terms/${t.term_id}/export">📥 Export Excel</a></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <div style="margin-top:24px;">
          <h3>📄 Term Report Cards</h3>
          <p style="color:#666; font-size:13px;">Report cards are generated by the platform admin when a term is marked ended — pick a classroom + term to view what's available.</p>
          <div class="filter-bar" style="flex-wrap:wrap; gap:10px;">
            <select id="reportClassroom">
              <option value="">-- Classroom --</option>
              ${classroomsForReports.rows.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
            </select>
            <select id="reportTerm">
              <option value="">-- Term --</option>
              ${terms.rows.map(t => `<option value="${t.term_id}">${t.term_name}</option>`).join('')}
            </select>
            <button type="button" onclick="checkTermReportStatus()">🔍 View Reports</button>
          </div>
          <div id="termReportStudents" style="margin-top:12px;"></div>
        </div>

        <div style="margin-top:24px;">
          <h3>📁 All Generated Reports</h3>
          <p style="color:#666; font-size:13px;">Every report the platform admin has generated for your school so far — always the latest version if they've regenerated one.</p>
          <div class="table-responsive">
            <table class="user-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Classroom</th>
                  <th>Term</th>
                  <th>Generated</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                ${storedReports.length ? storedReports.map(r => `
                  <tr>
                    <td>${r.student_name ? 'Student: ' + r.student_name : 'Whole Class'}</td>
                    <td>${r.classroom_name}</td>
                    <td>${r.term_name}</td>
                    <td>${new Date(r.generated_at).toLocaleString()}</td>
                    <td><a href="/school-admin/stored-reports/${r.id}/download">📥 Download</a></td>
                  </tr>
                `).join('') : `<tr><td colspan="5" style="text-align:center;">No reports generated yet.</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `);
    // downloadClassTermReport() / loadTermReportStudents() are declared
    // globally in views/school-admin/dashboard.ejs's persistent <script>,
    // not inline here — a <script> tag inside HTML assigned via
    // innerHTML (which is how loadSection's response gets inserted) never
    // executes, so defining them here silently did nothing and both
    // buttons threw "not defined" the moment they were clicked.
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

    // NOTE: this route (GET /school-admin/quotes) isn't linked from the
    // sidebar — real navigation goes through loadSection('quotes') ->
    // GET /section/quotes, which renders the existing partials/quotes.ejs
    // against the older flat quotes model. This standalone route tried to
    // render a "schoolAdmin/quotes" view that has never existed (the real
    // views directory is "school-admin", singular dashboard.ejs only),
    // so hitting this URL directly always 500'd. Redirecting to the
    // dashboard at least stops the crash without inventing a new page.
    res.redirect("/school-admin/dashboard");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error loading quotes");
  }
};

// Normally unnecessary — createTerm() auto-creates a quote for every new
// term — but kept working (against the real schema: quotes are term-linked,
// there's no requested_students/price_quote column) in case a term is
// ever missing its quote row and needs one created manually.
exports.addQuote = async (req, res) => {
  try {
    const { term_id, price_per_student } = req.body;
    if (!term_id) {
      return res.status(400).send("A term is required to create a quote.");
    }
    const schoolRes = await pool.query(
      `SELECT id FROM schools WHERE created_by = $1 LIMIT 1`,
      [req.session.user.id]
    );

    const schoolId = schoolRes.rows[0].id;

    await pool.query(
      `INSERT INTO quotes (school_id, term_id, price_per_student, status)
       VALUES ($1, $2, $3, 'unpaid')`,
      [schoolId, term_id, price_per_student || 0]
    );
    await logActivityForUser(req, "Quote created", `School ID: ${schoolId}, Term ID: ${term_id}`);

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
// NOTE: this route (GET /school-admin/section/payments) is shadowed by the
// generic `router.get("/section/:section", loadSection)` registered
// earlier in routes/schoolAdmin.js — Express matches routes in
// registration order, so loadSection's own "payments" branch always
// handles this request in practice, not this function. Left in place
// (fixed rather than removed, in case routing is ever reordered) but
// currently dead code — it also referenced a `payments` table that
// doesn't exist in the current schema (school payments live in
// school_payments, keyed by quote_id, see loadSection's "payments"
// branch), which is fixed here too.
exports.getPayments = async (req, res) => {
  try {
    const schoolRes = await pool.query(
      `SELECT id FROM schools WHERE created_by = $1 LIMIT 1`,
      [req.session.user.id]
    );

    const schoolId = schoolRes.rows[0].id;
    const payments = await pool.query(
      `SELECT sp.id, sp.amount, sp.payment_date, sp.created_at,
              t.name AS term_name, q.status AS quote_status
       FROM school_payments sp
       LEFT JOIN quotes q ON q.id = sp.quote_id
       LEFT JOIN academic_terms t ON t.id = q.term_id
       WHERE sp.school_id = $1
       ORDER BY sp.created_at DESC`,
      [schoolId]
    );
    res.render("partials/payments", { payments: payments.rows });
  } catch (err) {
    console.error("Error fetching payments:", err);
    res.status(500).send("Server Error");
  }
};

// The form that used to POST here (a per-payment status dropdown) has
// been removed from partials/payments.ejs — school_payments has no
// status column to update (payment state lives on the linked quote
// instead), so there was never a correct query this could run. Kept as a
// safe no-op redirect rather than a 500 in case anything still links here.
exports.updatePayment = async (req, res) => {
  res.redirect("/school-admin/dashboard");
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

    // NOTE: same dead-entry-point situation as getQuotes above — real
    // navigation goes through loadSection('terms') -> GET /section/terms,
    // not this standalone route, which rendered a view that never existed.
    res.redirect("/school-admin/dashboard");
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

    // NOTE: same dead-entry-point situation as getQuotes above — real
    // navigation goes through loadSection('attendance') ->
    // GET /section/attendance, not this standalone route, which rendered
    // a view that never existed.
    res.redirect("/school-admin/dashboard");
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

// One receipt PDF per school_payments row — same generatePdf/invoice
// styling as downloadQuotePDF above, scoped to this school via
// sp.school_id so a school admin can only ever pull their own payments.
exports.downloadPaymentReceipt = async (req, res) => {
  const { id } = req.params;

  try {
    const schoolId = req.session.user.school_id;

    const result = await pool.query(
      `
      SELECT
        sp.id,
        sp.amount,
        sp.payment_date,
        sp.created_at,
        s.name AS school_name,
        s.address,
        t.name AS term_name,
        q.status AS quote_status,
        q.balance AS quote_balance
      FROM school_payments sp
      JOIN schools s ON s.id = sp.school_id
      LEFT JOIN quotes q ON q.id = sp.quote_id
      LEFT JOIN academic_terms t ON t.id = q.term_id
      WHERE sp.id = $1 AND sp.school_id = $2
      `,
      [id, schoolId],
    );

    if (result.rows.length === 0) {
      return res.status(404).send("Payment not found");
    }

    const p = result.rows[0];
    const numberToWords = require("number-to-words");
    const amount = Number(p.amount || 0);
    const words = numberToWords.toWords(amount).toUpperCase();
    const receiptNumber = `RCPT-${String(p.id).padStart(6, "0")}`;
    const paymentDate = new Date(p.payment_date || p.created_at).toDateString();

    const html = `
    <html>
    <head>
    <style>
      body{ font-family: Arial; padding:40px; }
      .header{ text-align:center; margin-bottom:30px; }
      .title{ font-size:28px; font-weight:bold; }
      table{ width:100%; border-collapse:collapse; margin-top:20px; }
      th{ background:#000; color:#fff; padding:10px; }
      td{ border:1px solid #ccc; padding:10px; text-align:center; }
      .summary{ margin-top:30px; font-size:14px; }
    </style>
    </head>
    <body>
      <div class="header">
        <div class="title">PAYMENT RECEIPT</div>
        <p><b>${p.school_name}</b><br/>${p.address || ""}</p>
        <p><b>Receipt No:</b> ${receiptNumber}</p>
        <p>Date: ${paymentDate}</p>
      </div>

      <table>
        <tr>
          <th>Term</th>
          <th>Amount Paid</th>
        </tr>
        <tr>
          <td>${p.term_name || "-"}</td>
          <td>₦${amount.toLocaleString()}</td>
        </tr>
      </table>

      <div class="summary">
        ${p.quote_status ? `<p><b>Term Payment Status:</b> ${p.quote_status}</p>` : ""}
        ${p.quote_balance !== null && p.quote_balance !== undefined ? `<p><b>Remaining Balance for Term:</b> ₦${Number(p.quote_balance).toLocaleString()}</p>` : ""}
        <p><b>Amount in Words:</b> ${words} NAIRA ONLY</p>
      </div>
    </body>
    </html>
    `;

    const pdf = await generatePdf(html);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${p.school_name.replace(/\s+/g, "_")}_${receiptNumber}.pdf`,
    );
    res.send(pdf);
  } catch (err) {
    console.error("Error generating payment receipt:", err);
    res.status(500).send("Error generating receipt");
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
    const { termId } = req.params;
    const schoolId = req.session.user.school_id;

    const termCheck = await pool.query(
      "SELECT id FROM academic_terms WHERE id = $1 AND school_id = $2",
      [termId, schoolId],
    );
    if (!termCheck.rows.length) {
      return res.status(404).json({ error: "Term not found" });
    }

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
    const { termId } = req.params;
    const schoolId = req.session.user.school_id;

    const termCheck = await pool.query(
      "SELECT id FROM academic_terms WHERE id = $1 AND school_id = $2",
      [termId, schoolId],
    );
    if (!termCheck.rows.length) {
      return res.status(404).send("Term not found");
    }

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
// attendance_sessions has no "attendance_date" column — the real column
// is "date" (see attendance_records.status/attendance_sessions.date in
// models/initTables.js) — this insert always threw, so taking attendance
// as a school admin has never actually worked. Rewritten to match the
// real schema and the same upsert pattern adminController.js's
// saveAttendance already uses (same unique constraint on
// term_id+classroom_id+date), so re-saving the same session's attendance
// updates it instead of erroring on a duplicate.
exports.saveAttendance = async (req, res) => {
  try {
    const {
      term_id,
      classroom_id,
      date,
      attendance_date, // accepted as a fallback for any older caller
      records,
      session_status,
      note,
      week_number,
    } = req.body;
    const schoolId = req.session.user.school_id;
    const sessionDate = date || attendance_date;

    const sessionResult = await pool.query(
      `
      INSERT INTO attendance_sessions
        (school_id, term_id, classroom_id, taken_by, date, session_status, note, week_number)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (term_id, classroom_id, date)
      DO UPDATE SET
        taken_by = EXCLUDED.taken_by,
        session_status = EXCLUDED.session_status,
        note = EXCLUDED.note
      RETURNING id, session_status
      `,
      [
        schoolId,
        term_id,
        classroom_id,
        req.session.user.id,
        sessionDate,
        session_status || "held",
        note || null,
        week_number || 1,
      ],
    );

    const sessionId = sessionResult.rows[0].id;
    const status = sessionResult.rows[0].session_status;

    if (status !== "held") {
      await pool.query(`DELETE FROM attendance_records WHERE session_id = $1`, [sessionId]);
      return res.json({ success: true, message: "Session saved without attendance" });
    }

    for (const record of records || []) {
      await pool.query(
        `
        INSERT INTO attendance_records (session_id, student_id, status)
        VALUES ($1,$2,$3)
        ON CONFLICT (session_id, student_id)
        DO UPDATE SET status = EXCLUDED.status
        `,
        [sessionId, record.student_id, record.status],
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
// Matches adminController.js's getWeeklyAttendanceStats contract exactly
// (grouped by week_number within a term, same response shape) rather than
// the old hardcoded-7-day/attendance_date query (a column that doesn't
// exist — this always threw) — this lets the school-admin dashboard reuse
// the exact same Chart.js rendering code as the platform admin's.
exports.getWeeklyAttendanceStats = async (req, res) => {
  try {
    const schoolId = req.session.user.school_id;
    const { term_id, classroom_id } = req.query;

    if (!term_id) {
      return res.status(400).json({ error: "term_id is required" });
    }

    const termCheck = await pool.query(
      "SELECT id FROM academic_terms WHERE id = $1 AND school_id = $2",
      [term_id, schoolId],
    );
    if (!termCheck.rows.length) {
      return res.status(404).json({ error: "Term not found" });
    }

    const params = [term_id];
    let classroomClause = "";
    if (classroom_id) {
      params.push(classroom_id);
      classroomClause = `AND s.classroom_id = $${params.length}`;
    }

    const result = await pool.query(
      `
      SELECT
        s.week_number,
        COUNT(r.id) FILTER (WHERE r.status = 'present') AS present,
        COUNT(r.id) FILTER (WHERE r.status = 'absent') AS absent,
        COUNT(r.id) FILTER (WHERE r.status = 'late') AS late,
        COUNT(r.id) AS total,
        ROUND(
          (COUNT(r.id) FILTER (WHERE r.status = 'present') * 100.0) / NULLIF(COUNT(r.id), 0),
          2
        ) AS attendance_percent
      FROM attendance_sessions s
      LEFT JOIN attendance_records r ON r.session_id = s.id
      WHERE s.term_id = $1
      ${classroomClause}
      GROUP BY s.week_number
      ORDER BY s.week_number
      `,
      params,
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

    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const company = infoResult.rows[0] || {};

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

        <img class="logo" src="${company.logo_url || ""}" />

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
        Generated by ${company.company_name || ""} School Management System • ${new Date().getFullYear()}
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

// =============================
// ANALYTICS & REPORTS — parity with what the platform admin can see about
// a school (adminController.js's getTermAnalytics / downloadSchoolProgressReport
// / reportController.js's downloadClassReport / downloadStudentReport),
// but always scoped to req.session.user.school_id (set by
// middlewares/auth.js's requireSchoolAdmin) rather than trusting a school
// id from the URL — a school admin can only ever pull their own school's
// data through these.
// =============================

// Growth-per-term + retention + totals — same shape as adminController.js's
// getTermAnalytics, feeding the same loadAnalytics() JS pattern.
exports.getTermAnalytics = async (req, res) => {
  try {
    const schoolId = req.session.user.school_id;

    const growth = await pool.query(
      `
      SELECT
        t.id,
        t.name,
        COUNT(e.student_id) as total_students
      FROM academic_terms t
      LEFT JOIN student_term_enrollments e ON e.term_id = t.id
      WHERE t.school_id = $1
      GROUP BY t.id
      ORDER BY t.start_date
      `,
      [schoolId],
    );

    const retention = await pool.query(
      `
      SELECT COUNT(*) as retained_students FROM (
        SELECT student_id
        FROM student_term_enrollments
        WHERE school_id = $1
        GROUP BY student_id
        HAVING COUNT(term_id) > 1
      ) sub
      `,
      [schoolId],
    );

    const totals = await pool.query(
      `
      SELECT
        COUNT(DISTINCT student_id) as total_unique_students,
        COUNT(*) as total_enrollments
      FROM student_term_enrollments
      WHERE school_id = $1
      `,
      [schoolId],
    );

    res.json({
      growth: growth.rows,
      retention: retention.rows[0],
      totals: totals.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Analytics error");
  }
};

// School-wide summary PDF — same content/layout as adminController.js's
// downloadSchoolProgressReport, scoped to the requesting admin's school.
exports.downloadSchoolProgressReport = async (req, res) => {
  try {
    const schoolId = req.session.user.school_id;

    const schoolRes = await pool.query(
      `SELECT id, name, address, email, phone, created_at FROM schools WHERE id = $1`,
      [schoolId],
    );
    const school = schoolRes.rows[0];
    if (!school) return res.status(404).send("School not found");

    const classRes = await pool.query(
      `SELECT id, name FROM classrooms WHERE school_id = $1 ORDER BY name`,
      [schoolId],
    );
    const classrooms = classRes.rows;

    const studentRes = await pool.query(
      `SELECT u.id, u.fullname AS full_name, u.email, c.name AS classroom_name
       FROM user_school us
       JOIN users2 u ON us.user_id = u.id
       LEFT JOIN classrooms c ON us.classroom_id = c.id
       WHERE us.role_in_school = 'student' AND us.school_id = $1
       ORDER BY c.name, u.fullname`,
      [schoolId],
    );
    const students = studentRes.rows;

    const teacherRes = await pool.query(
      `SELECT u.id, u.fullname AS full_name, u.email
       FROM user_school us
       JOIN users2 u ON us.user_id = u.id
       WHERE us.role_in_school = 'teacher' AND us.school_id = $1
       ORDER BY u.fullname`,
      [schoolId],
    );
    const teachers = teacherRes.rows;

    const studentIds = students.map((s) => s.id);

    const progressRes = studentIds.length
      ? await pool.query(
          `SELECT
             us.user_id,
             COUNT(DISTINCT l.id) AS total_lessons,
             COUNT(DISTINCT ulp.lesson_id) AS completed_lessons
           FROM user_school us
           LEFT JOIN classrooms cls ON us.classroom_id = cls.id
           LEFT JOIN classroom_courses cc ON cc.classroom_id = cls.id
           LEFT JOIN courses c ON c.id = cc.course_id
           LEFT JOIN modules m ON m.course_id = c.id
           LEFT JOIN lessons l ON l.module_id = m.id
           LEFT JOIN user_lesson_progress ulp
             ON ulp.user_id = us.user_id AND ulp.lesson_id = l.id AND ulp.completed_at IS NOT NULL
           WHERE us.role_in_school = 'student' AND us.user_id = ANY($1)
           GROUP BY us.user_id`,
          [studentIds],
        )
      : { rows: [] };

    const progressMap = Object.fromEntries(progressRes.rows.map((p) => [p.user_id, p]));

    const quizRes = studentIds.length
      ? await pool.query(
          `SELECT student_id, AVG(score) AS avg_quiz FROM quiz_submissions WHERE student_id = ANY($1) GROUP BY student_id`,
          [studentIds],
        )
      : { rows: [] };
    const quizMap = Object.fromEntries(quizRes.rows.map((q) => [q.student_id, Math.round(q.avg_quiz)]));

    const assignmentRes = studentIds.length
      ? await pool.query(
          `SELECT student_id, AVG(total) AS avg_assignment FROM assignment_submissions WHERE student_id = ANY($1) GROUP BY student_id`,
          [studentIds],
        )
      : { rows: [] };
    const assignmentMap = Object.fromEntries(
      assignmentRes.rows.map((a) => [a.student_id, Math.round(a.avg_assignment)]),
    );

    const summaryHTML = `
      <div class="summary">
        <h2>🏫 School Summary</h2>
        <table>
          <tr><th>School Name</th><td>${school.name}</td></tr>
          <tr><th>Email</th><td>${school.email || "N/A"}</td></tr>
          <tr><th>Phone</th><td>${school.phone || "N/A"}</td></tr>
          <tr><th>Address</th><td>${school.address || "N/A"}</td></tr>
          <tr><th>Total Classrooms</th><td>${classrooms.length}</td></tr>
          <tr><th>Total Teachers</th><td>${teachers.length}</td></tr>
          <tr><th>Total Students</th><td>${students.length}</td></tr>
          <tr><th>Date Created</th><td>${new Date(school.created_at).toLocaleDateString()}</td></tr>
        </table>
      </div>
    `;

    const teachersHTML = `
      <div class="teachers">
        <h2>👨‍🏫 Teachers</h2>
        ${
          teachers.length
            ? `<table><thead><tr><th>Name</th><th>Email</th></tr></thead><tbody>
                ${teachers.map((t) => `<tr><td>${t.full_name}</td><td>${t.email}</td></tr>`).join("")}
               </tbody></table>`
            : "<p><em>No teachers registered.</em></p>"
        }
      </div>
    `;

    const classesHTML = classrooms
      .map((cls) => {
        const classStudents = students.filter((s) => s.classroom_name === cls.name);
        if (classStudents.length === 0) {
          return `<div class="class-block"><h2>${cls.name}</h2><p><em>No students enrolled.</em></p></div>`;
        }
        return `
          <div class="class-block">
            <h2>📘 ${cls.name}</h2>
            <table>
              <thead>
                <tr><th>Student Name</th><th>Email</th><th>Lessons Completed</th><th>Quiz Avg</th><th>Assignment Avg</th><th>Progress %</th></tr>
              </thead>
              <tbody>
                ${classStudents
                  .map((stu) => {
                    const prog = progressMap[stu.id] || { total_lessons: 0, completed_lessons: 0 };
                    const percent = prog.total_lessons > 0
                      ? Math.round((prog.completed_lessons / prog.total_lessons) * 100)
                      : 0;
                    return `
                      <tr>
                        <td>${stu.full_name}</td>
                        <td>${stu.email}</td>
                        <td>${prog.completed_lessons}/${prog.total_lessons}</td>
                        <td>${quizMap[stu.id] ?? "N/A"}</td>
                        <td>${assignmentMap[stu.id] ?? "N/A"}</td>
                        <td>${percent}%</td>
                      </tr>`;
                  })
                  .join("")}
              </tbody>
            </table>
          </div>
        `;
      })
      .join("");

    const html = `
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; padding: 40px; color: #2c3e50; }
          h1, h2 { color: #2c3e50; }
          h1 { text-align: center; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; }
          th, td { border: 1px solid #ccc; padding: 6px; font-size: 12px; }
          th { background-color: #34495e; color: white; }
          tr:nth-child(even) { background-color: #f9f9f9; }
          .class-block, .teachers, .summary { margin-top: 30px; }
          .footer { margin-top: 30px; text-align: center; font-size: 10px; color: gray; }
        </style>
      </head>
      <body>
        <h1>${school.name} — School Progress Report</h1>
        <p style="text-align:center; color:gray;">Generated on ${new Date().toLocaleString()}</p>
        ${summaryHTML}
        ${teachersHTML}
        ${classesHTML}
        <div class="footer">© ${new Date().getFullYear()} School Progress Report</div>
      </body>
      </html>
    `;

    const pdf = await generatePdf(html);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${school.name.replace(/\s+/g, "_")}_Summary_Report.pdf`,
    );
    res.send(pdf);
  } catch (err) {
    console.error("Error generating school progress report:", err);
    res.status(500).send("Error generating report");
  }
};

// Whether a term's reports are ready to view yet, and if so, the class
// report + every enrolled student's report for the chosen classroom.
// School admins never generate these themselves — only the platform admin
// does (creating a term, or explicitly marking one "ended", see
// adminController.js's endTerm) — this just reports what's already
// stored (see services/classTermReportStore.js), gated on
// academic_terms.is_ended so a school admin can't see a term's reports
// before the admin has finalized it.
exports.getClassTermReportStatus = async (req, res) => {
  try {
    const schoolId = req.session.user.school_id;
    const { classroomId, termId } = req.params;

    const termCheck = await pool.query(
      "SELECT id, is_ended, ended_at FROM academic_terms WHERE id = $1 AND school_id = $2",
      [termId, schoolId],
    );
    if (!termCheck.rows.length) {
      return res.status(404).json({ success: false, message: "Term not found" });
    }
    const term = termCheck.rows[0];

    const classroomCheck = await pool.query(
      "SELECT id FROM classrooms WHERE id = $1 AND school_id = $2",
      [classroomId, schoolId],
    );
    if (!classroomCheck.rows.length) {
      return res.status(404).json({ success: false, message: "Classroom not found" });
    }

    if (!term.is_ended) {
      return res.json({ success: true, termEnded: false });
    }

    const classReportRes = await pool.query(
      `SELECT id, generated_at FROM class_term_reports
       WHERE school_id = $1 AND classroom_id = $2 AND term_id = $3 AND student_id IS NULL`,
      [schoolId, classroomId, termId],
    );

    const studentsRes = await pool.query(
      `SELECT u.id, u.fullname, u.email, ctr.id AS report_id, ctr.generated_at
       FROM student_term_enrollments ste
       JOIN users2 u ON u.id = ste.student_id
       LEFT JOIN class_term_reports ctr
         ON ctr.school_id = $1 AND ctr.classroom_id = $2 AND ctr.term_id = $3 AND ctr.student_id = u.id
       WHERE ste.term_id = $3 AND ste.classroom_id = $2
       ORDER BY u.fullname`,
      [schoolId, classroomId, termId],
    );

    res.json({
      success: true,
      termEnded: true,
      endedAt: term.ended_at,
      classReport: classReportRes.rows[0] || null,
      students: studentsRes.rows,
    });
  } catch (err) {
    console.error("Error checking report status:", err);
    res.status(500).json({ success: false, message: "Error checking report status" });
  }
};

// Reports the platform admin generated for this school (from
// views/admin/classroom-dashboard.ejs) and that got persisted to
// class_term_reports (see services/classTermReportStore.js) — a school
// admin views the same stored copy here rather than regenerating it
// themselves. Regenerating on the admin side replaces the stored row, so
// this list always reflects the latest version.
exports.listStoredReports = async (req, res) => {
  try {
    const schoolId = req.session.user.school_id;
    const reports = await listReportsForSchool(schoolId);
    res.json({ success: true, reports });
  } catch (err) {
    console.error("Error listing stored reports:", err);
    res.status(500).json({ success: false, message: "Error loading reports" });
  }
};

exports.downloadStoredReport = async (req, res) => {
  try {
    const schoolId = req.session.user.school_id;
    const report = await getReportById(req.params.id);
    if (!report || report.school_id !== schoolId) {
      return res.status(404).send("Report not found");
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${report.filename}"`);
    res.send(report.pdf);
  } catch (err) {
    console.error("Error downloading stored report:", err);
    res.status(500).send("Error downloading report");
  }
};

// Classroom analytics, scoped to a specific term. Unlike the platform
// admin's all-time version (classroomAnalyticsController.getClassroomDashboard,
// which this used to just delegate to), a school admin sees a term
// selector: pick a term and the roster/course breakdown are scoped to
// students actually enrolled in THIS classroom for THAT term
// (student_term_enrollments — a student's classroom can differ term to
// term), and lesson completion is scoped to activity that happened
// within that term's start_date/end_date window. Quiz average is
// deliberately NOT date-windowed — the user asked for it to reflect the
// student's full quiz history for the course, not just attempts taken
// during this specific term. There's no course<->term link in the
// schema (classroom_courses/user_lesson_progress lack a term_id), so
// "courses done this term" is reconstructed by date-windowing lesson
// completion against the courses assigned to the classroom.
async function computeClassroomTermAnalytics(schoolId, classroomId, requestedTermId) {
  const classroomRes = await pool.query(
    `SELECT c.id, c.name, s.name AS school_name, s.logo_url AS school_logo
     FROM classrooms c
     JOIN schools s ON s.id = c.school_id
     WHERE c.id = $1 AND c.school_id = $2`,
    [classroomId, schoolId]
  );
  if (!classroomRes.rows.length) return null;
  const classroom = classroomRes.rows[0];

  const termsRes = await pool.query(
    `SELECT id, name, start_date, end_date, is_active
     FROM academic_terms
     WHERE school_id = $1
     ORDER BY start_date DESC`,
    [schoolId]
  );
  const terms = termsRes.rows;

  const empty = (selectedTerm) => ({
    classroom,
    terms,
    selectedTerm,
    totalStudents: 0,
    averageCompletion: 0,
    averageQuiz: 0,
    studentMetrics: [],
    leaderboard: [],
    atRiskStudents: [],
    courseBreakdown: [],
  });

  if (!terms.length) return empty(null);

  const selectedTerm =
    terms.find((t) => t.id === requestedTermId) ||
    terms.find((t) => t.is_active) ||
    terms[0];

  const studentsRes = await pool.query(
    `SELECT u.id, u.fullname
     FROM student_term_enrollments ste
     JOIN users2 u ON u.id = ste.student_id
     WHERE ste.term_id = $1 AND ste.classroom_id = $2
     ORDER BY u.fullname`,
    [selectedTerm.id, classroomId]
  );
  const students = studentsRes.rows;
  const studentIds = students.map((s) => s.id);

  // For the active/current term, show every course assigned to the
  // classroom (matches what's actually available to work on right now,
  // even before any activity exists yet to confirm it). For a past
  // term, use the confirmed course_term_links record instead — the
  // real, evidence-backed list of what was actually worked on that
  // term, which can be a strict subset of everything ever assigned to
  // the classroom.
  const coursesRes = selectedTerm.is_active
    ? await pool.query(
        `SELECT c.id, c.title, c.level
         FROM classroom_courses cc
         JOIN courses c ON c.id = cc.course_id
         WHERE cc.classroom_id = $1
         ORDER BY c.title`,
        [classroomId]
      )
    : await pool.query(
        `SELECT DISTINCT c.id, c.title, c.level
         FROM course_term_links ctl
         JOIN courses c ON c.id = ctl.course_id
         WHERE ctl.classroom_id = $1 AND ctl.term_id = $2
         ORDER BY c.title`,
        [classroomId, selectedTerm.id]
      );
  const courses = coursesRes.rows;
  const courseIds = courses.map((c) => c.id);

  if (!studentIds.length || !courseIds.length) {
    const result = empty(selectedTerm);
    result.courseBreakdown = courses.map((c) => ({
      id: c.id,
      title: c.title,
      level: c.level,
      totalLessons: 0,
      studentsEngaged: 0,
      totalStudents: students.length,
      avgCompletion: 0,
      avgQuiz: 0,
    }));
    result.totalStudents = students.length;
    return result;
  }

  const lessonsRes = await pool.query(
    `SELECT l.id, m.course_id
     FROM lessons l
     JOIN modules m ON m.id = l.module_id
     WHERE m.course_id = ANY($1)`,
    [courseIds]
  );
  const lessonIds = lessonsRes.rows.map((l) => l.id);
  const lessonToCourse = new Map(lessonsRes.rows.map((l) => [l.id, l.course_id]));
  const totalLessonsByCourse = {};
  lessonsRes.rows.forEach((l) => {
    totalLessonsByCourse[l.course_id] = (totalLessonsByCourse[l.course_id] || 0) + 1;
  });

  // Lesson completions by these students, on these lessons — all-time,
  // not restricted to the term's date window. user_lesson_progress only
  // ever holds ONE completed_at per (student, lesson), set the first
  // time they finish it and never moved (ON CONFLICT DO NOTHING in
  // completeLesson) — so if a course gets reassigned to a later term,
  // a student who already finished a lesson back when it was first
  // taught would show 0 progress on it here if we filtered by date.
  // Carrying it forward instead: the "is this course part of this
  // term" gate already happened when `courses`/lessonIds was resolved
  // (course_term_links for a past term, classroom_courses for the
  // active one) — once a course counts as part of a term, all of a
  // student's completions on its lessons count too, no matter when
  // they happened. completed_at is kept to measure how quickly each
  // student worked through their lessons relative to THIS term's
  // start — used as the leaderboard's speed tiebreaker below.
  const progressRes = lessonIds.length
    ? await pool.query(
        `SELECT ulp.user_id AS student_id, ulp.lesson_id, ulp.completed_at
         FROM user_lesson_progress ulp
         WHERE ulp.user_id = ANY($1)
           AND ulp.lesson_id = ANY($2)
           AND ulp.completed_at IS NOT NULL`,
        [studentIds, lessonIds]
      )
    : { rows: [] };

  const quizzesRes = lessonIds.length
    ? await pool.query(
        `SELECT q.id AS quiz_id, m.course_id
         FROM quizzes q
         JOIN lessons l ON l.id = q.lesson_id
         JOIN modules m ON m.id = l.module_id
         WHERE m.course_id = ANY($1)`,
        [courseIds]
      )
    : { rows: [] };
  const quizIdToCourse = new Map(quizzesRes.rows.map((q) => [q.quiz_id, q.course_id]));
  const quizIds = quizzesRes.rows.map((q) => q.quiz_id);

  // Quiz average is all-time (not term-windowed) — it reflects overall
  // mastery of the course material, not whether a quiz happened to be
  // taken inside this term's date range.
  const submissionsRes = quizIds.length
    ? await pool.query(
        `SELECT qs.student_id, qs.quiz_id, qs.score
         FROM quiz_submissions qs
         WHERE qs.student_id = ANY($1)
           AND qs.quiz_id = ANY($2)`,
        [studentIds, quizIds]
      )
    : { rows: [] };

  const completedByStudentCourse = {}; // "studentId-courseId" -> Set(lessonId)
  const completionTimestampsByStudent = {}; // studentId -> [completed_at, ...]
  progressRes.rows.forEach((p) => {
    const courseId = lessonToCourse.get(p.lesson_id);
    if (!courseId) return;
    const key = `${p.student_id}-${courseId}`;
    if (!completedByStudentCourse[key]) completedByStudentCourse[key] = new Set();
    completedByStudentCourse[key].add(p.lesson_id);

    if (!completionTimestampsByStudent[p.student_id]) completionTimestampsByStudent[p.student_id] = [];
    completionTimestampsByStudent[p.student_id].push(p.completed_at);
  });

  const quizScoresByStudentCourse = {}; // "studentId-courseId" -> [scores]
  submissionsRes.rows.forEach((s) => {
    const courseId = quizIdToCourse.get(s.quiz_id);
    if (!courseId) return;
    const key = `${s.student_id}-${courseId}`;
    if (!quizScoresByStudentCourse[key]) quizScoresByStudentCourse[key] = [];
    quizScoresByStudentCourse[key].push(Number(s.score));
  });

  // Per-course breakdown: what did students actually do in this
  // course, during this term (lessons), against their overall quiz
  // mastery of it (all-time).
  const courseBreakdown = courses.map((course) => {
    const totalLessons = totalLessonsByCourse[course.id] || 0;
    let studentsEngaged = 0;
    let completionSum = 0;
    let quizScores = [];
    students.forEach((stu) => {
      const key = `${stu.id}-${course.id}`;
      const completed = completedByStudentCourse[key] ? completedByStudentCourse[key].size : 0;
      if (completed > 0) studentsEngaged += 1;
      completionSum += totalLessons > 0 ? (completed / totalLessons) * 100 : 0;
      if (quizScoresByStudentCourse[key]) quizScores.push(...quizScoresByStudentCourse[key]);
    });
    return {
      id: course.id,
      title: course.title,
      level: course.level,
      totalLessons,
      studentsEngaged,
      totalStudents: students.length,
      avgCompletion: students.length ? Math.round(completionSum / students.length) : 0,
      avgQuiz: quizScores.length
        ? Math.round(quizScores.reduce((a, b) => a + b, 0) / quizScores.length)
        : 0,
    };
  });

  // Per-student metrics, averaged across all courses assigned to the
  // classroom: lesson completion uses this term's windowed activity,
  // quiz average uses all-time submissions.
  const studentMetrics = students.map((stu) => {
    let totalCompleted = 0;
    let totalLessonsAll = 0;
    let quizScoresAll = [];
    courses.forEach((course) => {
      const key = `${stu.id}-${course.id}`;
      const completed = completedByStudentCourse[key] ? completedByStudentCourse[key].size : 0;
      totalCompleted += completed;
      totalLessonsAll += totalLessonsByCourse[course.id] || 0;
      if (quizScoresByStudentCourse[key]) quizScoresAll.push(...quizScoresByStudentCourse[key]);
    });
    const completionPercent =
      totalLessonsAll > 0 ? Math.round((totalCompleted / totalLessonsAll) * 100) : 0;
    const quizAvg = quizScoresAll.length
      ? Math.round(quizScoresAll.reduce((a, b) => a + b, 0) / quizScoresAll.length)
      : 0;

    // Speed tiebreaker: average gap (in days) between the term's start
    // and when each of this student's lessons was completed — lower
    // means they got through their lessons sooner after the term began.
    // Clamped at 0: a carried-forward completion from an earlier term
    // (see progressRes above) can predate this term's start entirely —
    // treated as "already knew it coming in", i.e. the best possible
    // pace, not a negative number.
    const timestamps = completionTimestampsByStudent[stu.id] || [];
    const termStartMs = new Date(selectedTerm.start_date).getTime();
    const avgDaysToComplete = timestamps.length
      ? Math.max(
          0,
          timestamps.reduce((sum, t) => sum + (new Date(t).getTime() - termStartMs), 0) /
            timestamps.length /
            (1000 * 60 * 60 * 24)
        )
      : null;

    return {
      id: stu.id,
      fullname: stu.fullname,
      completedLessons: totalCompleted,
      totalLessons: totalLessonsAll,
      completionPercent,
      quizAvg,
      avgDaysToComplete: avgDaysToComplete !== null ? Math.round(avgDaysToComplete * 10) / 10 : null,
      overallScore: Math.round((completionPercent + quizAvg) / 2),
    };
  });

  // Leaderboard ranking, in order of precedence:
  // 1. Lesson completion — how much of the term's course material they
  //    actually got through, out of the whole.
  // 2. Quiz average — among students with similar completion, who
  //    understood the material better.
  // 3. Speed — among students tied on both, who worked through their
  //    lessons sooner after the term started (lower avgDaysToComplete
  //    wins; students with no completions at all sort last here too,
  //    though criterion 1 already puts them at the bottom).
  const leaderboard = [...studentMetrics]
    .sort((a, b) => {
      if (b.completionPercent !== a.completionPercent) return b.completionPercent - a.completionPercent;
      if (b.quizAvg !== a.quizAvg) return b.quizAvg - a.quizAvg;
      const aSpeed = a.avgDaysToComplete === null ? Infinity : a.avgDaysToComplete;
      const bSpeed = b.avgDaysToComplete === null ? Infinity : b.avgDaysToComplete;
      return aSpeed - bSpeed;
    })
    .slice(0, 10);
  const atRiskStudents = studentMetrics.filter(
    (s) => s.completionPercent < 40 || s.quizAvg < 50
  );

  const averageCompletion = studentMetrics.length
    ? Math.round(studentMetrics.reduce((sum, s) => sum + s.completionPercent, 0) / studentMetrics.length)
    : 0;
  const averageQuiz = studentMetrics.length
    ? Math.round(studentMetrics.reduce((sum, s) => sum + s.quizAvg, 0) / studentMetrics.length)
    : 0;

  return {
    classroom,
    terms,
    selectedTerm,
    totalStudents: students.length,
    averageCompletion,
    averageQuiz,
    studentMetrics,
    leaderboard,
    atRiskStudents,
    courseBreakdown,
  };
}

exports.getClassroomDashboard = async (req, res) => {
  try {
    const schoolId = req.session.user.school_id;
    const { classroomId } = req.params;
    const requestedTermId = req.query.term_id ? Number(req.query.term_id) : null;

    const result = await computeClassroomTermAnalytics(schoolId, classroomId, requestedTermId);
    if (!result) return res.status(404).send("Classroom not found");

    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const info = infoResult.rows[0] || {};

    res.render("school-admin/classroomDashboard", {
      ...result,
      info,
      users: req.session.user,
    });
  } catch (err) {
    console.error("Error loading classroom dashboard:", err);
    res.status(500).send("Server error");
  }
};

exports.exportClassroomSummary = async (req, res) => {
  try {
    const schoolId = req.session.user.school_id;
    const { classroomId } = req.params;
    const requestedTermId = req.query.term_id ? Number(req.query.term_id) : null;

    const result = await computeClassroomTermAnalytics(schoolId, classroomId, requestedTermId);
    if (!result) return res.status(404).send("Classroom not found");

    const { classroom, selectedTerm, totalStudents, averageCompletion, averageQuiz,
      leaderboard, atRiskStudents, courseBreakdown } = result;

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
    <div style="background-color:#ffffff; display:flex;align-items:center;gap:20px; justify-content:space-between; border-bottom:2px solid #b19915; padding-bottom:15px; margin-bottom:30px; box-shadow:0 2px 5px rgba(0,0,0,0.1);">
      <div style="margin-top:10px;">
        <h1>Classroom Analytics Report</h1>
        <p><strong>School:</strong> ${classroom.school_name}</p>
        <p><strong>Classroom:</strong> ${classroom.name}</p>
        <p><strong>Term:</strong> ${selectedTerm ? selectedTerm.name : "N/A"}</p>
        <p><strong>Date:</strong> ${new Date().toDateString()}</p>
      </div>
      <div>${classroom.school_logo ? `<img src="${classroom.school_logo}" style="width:80px;height:80px;object-fit:contain;">` : ""}</div>
    </div>

    <div>
      <div class="card blue">
        <h2>${totalStudents}</h2>
        <p>Total Students (this term)</p>
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

    <h3>Courses This Term</h3>
    <table>
    <tr>
      <th>Course</th>
      <th>Level</th>
      <th>Lessons</th>
      <th>Students Engaged</th>
      <th>Avg Completion</th>
      <th>Avg Quiz Score</th>
    </tr>
    ${courseBreakdown.length
      ? courseBreakdown.map((c) => `
        <tr>
          <td>${c.title}</td>
          <td>${c.level || "-"}</td>
          <td>${c.totalLessons}</td>
          <td>${c.studentsEngaged} / ${c.totalStudents}</td>
          <td>${c.avgCompletion}%</td>
          <td>${c.avgQuiz}%</td>
        </tr>
      `).join("")
      : `<tr><td colspan="6">No courses assigned to this classroom</td></tr>`
    }
    </table>

    <h3>Leaderboard</h3>
    <table>
    <tr>
      <th>Rank</th>
      <th>Name</th>
      <th>Lessons</th>
      <th>Completion %</th>
      <th>Quiz Avg</th>
      <th>Pace</th>
      <th>Overall</th>
    </tr>

    ${leaderboard.map((s,i)=>`
      <tr>
        <td>${i+1}</td>
        <td>${s.fullname}</td>
        <td>${s.completedLessons} / ${s.totalLessons}</td>
        <td>${s.completionPercent}%</td>
        <td>${s.quizAvg}%</td>
        <td>${s.avgDaysToComplete !== null ? s.avgDaysToComplete + "d avg" : "-"}</td>
        <td><strong>${s.overallScore}%</strong></td>
      </tr>
    `).join("")}
    </table>

    <h3>At Risk Students</h3>
    <table>
    <tr>
      <th>Name</th>
      <th>Lessons</th>
      <th>Completion %</th>
      <th>Quiz Avg</th>
      <th>Overall</th>
    </tr>

    ${atRiskStudents.length > 0
      ? atRiskStudents.map(s=>`
        <tr class="risk">
          <td>${s.fullname}</td>
          <td>${s.completedLessons} / ${s.totalLessons}</td>
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

    const pdf = await generatePdf(html);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${classroom.name}-analytics.pdf`
    );
    res.send(pdf);
  } catch (err) {
    console.error("Error exporting classroom summary:", err);
    res.status(500).send("Server error");
  }
};

// Attendance summary for a term: every classroom's session log (week,
// date, status, note) plus a student x week attendance matrix built from
// the same sessions. "Note" is whatever text was entered when attendance
// was taken for that session (attendance_sessions.note) — there's no
// separate "curriculum covered this week" table in the schema, so this
// is the closest real record of "what happened that week" the database
// actually has.
exports.getAttendanceSummary = async (req, res) => {
  try {
    const schoolId = req.session.user.school_id;
    const { term_id } = req.query;

    if (!term_id) {
      return res.status(400).json({ success: false, message: "term_id is required" });
    }

    const termCheck = await pool.query(
      "SELECT id, name FROM academic_terms WHERE id = $1 AND school_id = $2",
      [term_id, schoolId],
    );
    if (!termCheck.rows.length) {
      return res.status(404).json({ success: false, message: "Term not found" });
    }

    const sessionsRes = await pool.query(
      `SELECT s.classroom_id, c.name AS classroom_name, s.week_number, s.date, s.session_status, s.note
       FROM attendance_sessions s
       JOIN classrooms c ON c.id = s.classroom_id
       WHERE s.term_id = $1 AND s.school_id = $2
       ORDER BY c.name, s.week_number`,
      [term_id, schoolId],
    );

    const recordsRes = await pool.query(
      `SELECT s.classroom_id, s.week_number, r.student_id, u.fullname AS student_name, r.status
       FROM attendance_sessions s
       JOIN attendance_records r ON r.session_id = s.id
       JOIN users2 u ON u.id = r.student_id
       WHERE s.term_id = $1 AND s.school_id = $2`,
      [term_id, schoolId],
    );

    const classroomsMap = {};
    sessionsRes.rows.forEach((s) => {
      if (!classroomsMap[s.classroom_id]) {
        classroomsMap[s.classroom_id] = {
          classroomId: s.classroom_id,
          classroomName: s.classroom_name,
          sessions: [],
          weekSet: new Set(),
          studentsMap: {},
        };
      }
      const cls = classroomsMap[s.classroom_id];
      cls.sessions.push({
        week: s.week_number,
        date: s.date,
        status: s.session_status,
        note: s.note || "",
      });
      cls.weekSet.add(s.week_number);
    });

    recordsRes.rows.forEach((r) => {
      const cls = classroomsMap[r.classroom_id];
      if (!cls) return;
      if (!cls.studentsMap[r.student_id]) {
        cls.studentsMap[r.student_id] = { id: r.student_id, name: r.student_name, weeks: {} };
      }
      cls.studentsMap[r.student_id].weeks[r.week_number] = r.status;
    });

    const classrooms = Object.values(classroomsMap).map((c) => ({
      classroomId: c.classroomId,
      classroomName: c.classroomName,
      sessions: c.sessions.sort((a, b) => a.week - b.week),
      weeks: Array.from(c.weekSet).sort((a, b) => a - b),
      students: Object.values(c.studentsMap).sort((a, b) => a.name.localeCompare(b.name)),
    }));

    res.json({ success: true, termName: termCheck.rows[0].name, classrooms });
  } catch (err) {
    console.error("Error loading attendance summary:", err);
    res.status(500).json({ success: false, message: "Error loading attendance summary" });
  }
};