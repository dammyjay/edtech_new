const pool = require("../models/db");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
// const nodemailer = require("nodemailer");
const sendEmail = require("../utils/sendEmail");
const sendEmailWithAttachment = require("../utils/sendEmailWithAttachment");
const cloudinary = require("../utils/cloudinary");
const buildFeedbackPDF = require("../utils/feedbackPdfTemplate");
const buildAnalyticsPDF = require("../utils/buildAnalyticsPDF");
const csv = require("csv-parser");
const fs = require("fs");
const { Parser } = require("json2csv");
const PDFDocument = require("pdfkit");
// const puppeteer = require("puppeteer");
const generatePdf = require("../utils/generatePdf");
const { logActivityForUser } = require("../utils/activityLogger");
const path = require("path");
const axios = require("axios");
const analyticsAggregationService = require("../services/analyticsAggregationService");
const { generateClassReport, generateStudentReport } = require("../services/reportGeneratorService");
const { saveReport } = require("../services/classTermReportStore");

// require at top of file
const Sentiment = require('sentiment');
const sw = require('stopword');
const ExcelJS = require('exceljs');

const sentiment = new Sentiment();
// const html_to_pdf = require("html-pdf-node");


// helper: extract keywords (very simple)
function extractKeywords(text, topN = 25) {
  if (!text) return [];
  // normalize & split
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  // remove stopwords
  const filtered = sw.removeStopwords(words);

  // freq map
  const freq = {};
  filtered.forEach(w => {
    if (w.length <= 2) return;
    freq[w] = (freq[w] || 0) + 1;
  });

  // sort and return topN
  return Object.entries(freq)
    .sort((a,b) => b[1] - a[1])
    .slice(0, topN)
    .map(([word, count]) => ({ word, count }));
}

// Show forgot password form
exports.showForgotPasswordForm = (req, res) => {
  res.render("admin/forgotPassword", { message: null });
};

// Handle forgot password form submission
exports.handleForgotPassword = async (req, res) => {
  const { email } = req.body;
  const result = await pool.query("SELECT * FROM users2 WHERE email = $1", [
    email,
  ]);
  if (result.rows.length === 0) {
    // Show a clear message if email does not exist
    return res.render("admin/forgotPassword", {
      message: "Email does not exist.",
    });
  }
  const user = result.rows[0];
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 3600000); // 1 hour

  await pool.query(
    "UPDATE users2 SET reset_token = $1, reset_token_expires = $2 WHERE id = $3",
    [token, expires, user.id]
  );

  const resetUrl = `https://${req.headers.host}/admin/reset-password/${token}`;
  await sendEmail(
    email,
    "Password Reset",
    `Click <a href="${resetUrl}">here</a> to reset your password.`
  );

  res.render("admin/forgotPassword", {
    message: "a reset link has been sent.",
  });
};

// Show reset password form
exports.showResetPasswordForm = async (req, res) => {
  const { token } = req.params;
  const result = await pool.query(
    "SELECT * FROM users2 WHERE reset_token = $1 AND reset_token_expires > NOW()",
    [token]
  );
  if (result.rows.length === 0) {
    return res.send("Invalid or expired token.");
  }
  res.render("admin/resetPassword", { token, message: null });
};

// Handle reset password submission
exports.handleResetPassword = async (req, res) => {
  const { token } = req.params;
  const { password, confirmPassword } = req.body;

  if (password !== confirmPassword) {
    return res.render("admin/resetPassword", {
      token,
      message: "Passwords do not match.",
    });
  }

  hashedPassword = await bcrypt.hash(password, 10); // Hash the new password
  hashedconfirmPassword = await bcrypt.hash(confirmPassword, 10); // Hash the confirm password
  const result = await pool.query(
    "SELECT * FROM users2 WHERE reset_token = $1 AND reset_token_expires > NOW()",
    [token]
  );
  if (result.rows.length === 0) {
    return res.send("Invalid or expired token.");
  }
  // const hashed = await bcrypt.hash(password, 10);
  await pool.query(
    "UPDATE users2 SET password = $1, reset_token = NULL, reset_token_expires = NULL WHERE reset_token = $2",
    [hashedPassword, token]
  );
  res.render("admin/login", {
    error: null,
    title: "Login",
    redirect: "",
    message: "Password reset successful. Please log in.",
    pendingEmail: "" 
  });
};

// Admin reset for student or teacher password
exports.resetPassword = async (req, res) => {
  try {
    const { userId } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).send("Password must be at least 6 characters");
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await pool.query("UPDATE users2 SET password = $1 WHERE id = $2", [
      hashedPassword,
      userId,
    ]);

    res.status(200).send("Password reset successfully");
  } catch (err) {
    console.error("Reset password error:", err);
    res.status(500).send("Server error");
  }
};

exports.showLogin = (req, res) => {
  res.render("admin/login", {
    error: null,
    title: "Login",
    redirect: req.query.redirect || "",
    pendingEmail: "", // <-- always include this
  });
};

exports.login = async (req, res) => {
  const { email, password } = req.body;
  const redirectUrl = req.query.redirect;

  try {
    // ===============================
    // 1️⃣ CHECK PENDING USERS FIRST
    // ===============================
    const pending = await pool.query(
      "SELECT otp_expires FROM pending_users WHERE email = $1",
      [email]
    );

    if (pending.rows.length > 0) {
      const expired = new Date(pending.rows[0].otp_expires) < new Date();

      if (expired) {
        // 👉 force user back to signup + OTP
        return res.render("admin/login", {
          error: "Your verification code has expired. Please verify again.",
          title: "Login",
          redirect: redirectUrl || "",
          pendingEmail: email, // 👈 key part
        });
      }

      // OTP still valid
      return res.render("admin/login", {
        error: "Account not verified. Please enter the OTP sent to your email.",
        title: "Login",
        redirect: redirectUrl || "",
        pendingEmail: email,
      });
    }

    // ===============================
    // 2️⃣ CHECK VERIFIED USERS
    // ===============================
    const result = await pool.query(
      "SELECT * FROM users2 WHERE email = $1",
      [email]
    );

    if (result.rows.length === 0) {
      return res.render("admin/login", {
        error: "Invalid credentials",
        title: "Login",
        redirect: redirectUrl || "",
        pendingEmail: "",  // <--- fix ReferenceError
      });
    }

    const user = result.rows[0];

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.render("admin/login", {
        error: "Invalid credentials",
        title: "Login",
        redirect: redirectUrl || "",
        pendingEmail: ""
      });
    }

    // ===============================
    // 3️⃣ SESSION + REDIRECT
    // ===============================
    req.session.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      profile_picture: user.profile_picture,
    };

    if (redirectUrl) return res.redirect(redirectUrl);

    if (user.role === "admin") return res.redirect("/admin/dashboard");
    if (user.role === "school_admin") return res.redirect("/school-admin/dashboard");
    if (user.role === "teacher") return res.redirect("/teacher/dashboard");
    if (user.role === "parent") return res.redirect("/parent/dashboard");
    if (user.role === "student" || user.role === "user")
      return res.redirect("/student/dashboard");
    if (user.role === "instructor")
      return res.redirect("/instructor/dashboard");

  } catch (err) {
    console.error("Login error:", err);
    res.status(500).send("Server error");
  }
};

exports.avatarPinLogin = async (req, res) => {
  const { studentId, pin } = req.body;

  try {
    const result = await pool.query(
      `
      SELECT *
      FROM users2
      WHERE id = $1
      AND pin = $2
      AND role = 'student'
      AND classroom_login_enabled = true
      `,
      [studentId, pin],
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid PIN or classroom login disabled",
      });
    }

    const user = result.rows[0];

    req.session.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      profile_picture: user.profile_picture,
    };

    return res.json({
      success: true,
      redirect: "/student/dashboard",
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

exports.logout = (req, res) => {
  req.session.destroy();
  res.redirect("/admin/login");
};

// inside controllers/adminController.js
exports.analyticsPage = async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/admin/login');
  }
  try {
    const infoResult = await pool.query("SELECT * FROM company_info ORDER BY id DESC LIMIT 1");
    const info = infoResult.rows[0] || {};
    res.render('admin/analytics', { info, user: req.session.user ,role: 'admin' });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
};

exports.dashboard = async (req, res) => {
  // if (!req.session.admin) return res.redirect('/admin/login');
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.redirect("/admin/login");
  }

  try {
    // Query filters
    const { gender, role, email } = req.query;
    // Step 1: Get Ministry Info
    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const info = infoResult.rows[0];

    // Step 2: Build dynamic user query
    let query = "SELECT * FROM users2 WHERE 1=1";
    const params = [];

    if (gender) {
      params.push(gender);
      query += ` AND gender = $${params.length}`;
    }

    if (role) {
      params.push(role);
      query += ` AND role = $${params.length}`;
    }

    if (email) {
      params.push(`%${email.toLowerCase()}%`);
      query += ` AND LOWER(email) LIKE $${params.length}`;
    }

    query += " ORDER BY created_at DESC";
    const usersResult = await pool.query(query, params);
    const users = usersResult.rows;

    // Step 3: Stats
    const totalResult = await pool.query("SELECT COUNT(*) FROM users2");
    const totalUsers = parseInt(totalResult.rows[0].count);

    const lastWeekResult = await pool.query(
      "SELECT COUNT(*) FROM users2 WHERE created_at >= NOW() - INTERVAL '7 days'"
    );
    const recentUsers = parseInt(lastWeekResult.rows[0].count);

    const percentageNew =
      totalUsers > 0 ? Math.round((recentUsers / totalUsers) * 100) : 0;

    const profilePic = req.session.user
      ? req.session.user.profile_picture
      : null;

    res.render("admin/dashboard", {
      info,
      users,
      profilePic,
      // pendingFaqCount,
      totalUsers,
      recentUsers,
      percentageNew,
      gender,
      role,
      email,
      role: "admin", // ✅ important
      user: req.session.user,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Server Error");
  }
};

exports.getUserGrowthChart = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        TO_CHAR(created_at,'Mon') AS month,
        DATE_TRUNC('month', created_at) AS sort_month,
        COUNT(*) AS total
      FROM users2
      GROUP BY sort_month, month
      ORDER BY sort_month;
    `);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err.message,
    });
  }
};

exports.getDashboardOverview = async (req, res) => {
  try {
    const data = await analyticsAggregationService.getOverviewAnalytics(null);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false
    });
  }
};

exports.getBusinessDashboard = async (req, res) => {
  try {
    const { year, month } = req.query;
    const data = await analyticsAggregationService.getBusinessAnalytics({ year, month });
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
};

exports.getLearningDashboard = async (req, res) => {
  try {
    const data = await analyticsAggregationService.getLearningAnalytics(null);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

exports.getCourseAnalytics = async (req, res) => {
  try {
    const { courseId } = req.params;

    const course = await pool.query(
      `
      SELECT *
      FROM courses
      WHERE id=$1
    `,
      [courseId],
    );

    const enrollments = await pool.query(
      `
      SELECT COUNT(*)
      FROM course_enrollments
      WHERE course_id=$1
    `,
      [courseId],
    );

    const schools = await pool.query(
      `
      SELECT COUNT(*)
      FROM school_courses
      WHERE course_id=$1
    `,
      [courseId],
    );

    const modules = await pool.query(`
      SELECT COUNT(*)
      FROM modules
      WHERE course_id=$1
    `, [courseId]);

    const lessons = await pool.query(`
      SELECT COUNT(*)
      FROM lessons l
      JOIN modules m
        ON l.module_id=m.id
      WHERE m.course_id=$1
    `, [courseId]);

    const certificates = await pool.query(
      `
      SELECT COUNT(*)
      FROM user_certificates
      WHERE course_id=$1
    `,
      [courseId],
    );

    const avgQuiz = await pool.query(
      `
      SELECT ROUND(AVG(score),2) avg
      FROM quiz_submissions qs

      JOIN quizzes q
        ON qs.quiz_id=q.id

      JOIN lessons l
        ON q.lesson_id=l.id

      JOIN modules m
        ON l.module_id=m.id

      WHERE m.course_id=$1
    `,
      [courseId],
    );

    const completion = await pool.query(
      `
      SELECT
        COUNT(DISTINCT ulp.user_id) completed
      FROM user_lesson_progress ulp

      JOIN lessons l
        ON ulp.lesson_id=l.id

      JOIN modules m
        ON l.module_id=m.id

      WHERE m.course_id=$1
    `,
      [courseId],
    );

    const totalEnrollments = Number(enrollments.rows[0].count);

    const completionRate =
      totalEnrollments > 0
        ? Math.round((completion.rows[0].completed / totalEnrollments) * 100)
        : 0;

    const topStudents = await pool.query(
      `

      SELECT

        u.fullname,

        ROUND(AVG(qs.score),2) avg_score

      FROM quiz_submissions qs

      JOIN users2 u
        ON qs.student_id=u.id

      JOIN quizzes q
        ON q.id=qs.quiz_id

      JOIN lessons l
        ON l.id=q.lesson_id

      JOIN modules m
        ON m.id=l.module_id

      WHERE m.course_id=$1

      GROUP BY u.id

      ORDER BY avg_score DESC

      LIMIT 20

    `,
      [courseId],
    );

    const bottomStudents = await pool.query(
      `

      SELECT

        u.fullname,

        ROUND(AVG(qs.score),2) avg_score

      FROM quiz_submissions qs

      JOIN users2 u
        ON qs.student_id=u.id

      JOIN quizzes q
        ON q.id=qs.quiz_id

      JOIN lessons l
        ON l.id=q.lesson_id

      JOIN modules m
        ON m.id=l.module_id

      WHERE m.course_id=$1

      GROUP BY u.id

      ORDER BY avg_score ASC

      LIMIT 10

    `,
      [courseId],
    );

    res.json({
      course: course.rows[0],

      enrollments: totalEnrollments,

      schools: schools.rows[0].count,

      learners: totalEnrollments,

      modules: modules.rows[0].count,

      lessons: lessons.rows[0].count,

      certificates: certificates.rows[0].count,

      completionRate,

      avgQuiz: avgQuiz.rows[0].avg || 0,

      topStudents: topStudents.rows,

      bottomStudents: bottomStudents.rows
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: err.message,
    });
  }
};

exports.getSchoolsDashboard = async (req, res) => {
  try {
    const data = await analyticsAggregationService.getSchoolsAnalytics(null);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
};

exports.getFinanceDashboard = async (req, res) => {
  try {
    const data = await analyticsAggregationService.getFinanceAnalytics(null);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
};

exports.getEngagementDashboard = async (req, res) => {
  try {
    const { page = 1, limit = 50, action, startDate, endDate } = req.query;

    // Preserve the live dashboard's free-text startDate/endDate query params
    // (distinct from the report generator's month/year period bounds) by
    // building an ad-hoc bounds object when either is supplied.
    let bounds = null;
    if (startDate || endDate) {
      bounds = {
        startDate: startDate ? new Date(startDate) : new Date(0),
        endDate: endDate ? new Date(endDate + " 23:59:59") : new Date(),
      };
    }

    const data = await analyticsAggregationService.getEngagementAnalytics(bounds, {
      page,
      limit,
      action,
    });
    res.json(data);
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: err.message,
    });
  }
};

exports.getStudentActivities = async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await pool.query(
      `
        SELECT
          a.id,
          a.action,
          a.details,
          a.created_at,

          l.title AS lesson_title,
          c.title AS course_title

        FROM activities a

        LEFT JOIN lessons l
          ON l.id = COALESCE(
            a.lesson_id,
            NULLIF(
              substring(a.details FROM '([0-9]+)'),
              ''
            )::INT
          )

        LEFT JOIN modules m
          ON m.id = l.module_id

        LEFT JOIN courses c
          ON c.id = m.course_id

        WHERE a.user_id = $1

        ORDER BY a.created_at DESC
        `,
      [userId],
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
};

exports.filterUsersAjax = async (req, res) => {
  try {
    const { gender, role, email } = req.query;

    let query = `SELECT * FROM users2 WHERE 1=1`;
    const values = [];

    if (gender) {
      values.push(gender);
      query += ` AND gender = $${values.length}`;
    }

    if (role) {
      values.push(role);
      query += ` AND role = $${values.length}`;
    }

    if (email) {
      values.push(`%${email}%`);
      query += ` AND email ILIKE $${values.length}`;
    }

    const result = await pool.query(query, values);
    res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json([]);
  }
};

exports.exportAnalyticsPDF = async (req, res) => {
  try {
    // Fetch all analytics in parallel
    const [
      overview,
      users,
      courses,
      quizzes,
      activity,
      finance,
      eventPaymentDetails,
    ] = await Promise.all([
      // OVERVIEW
      (async () => {
        const total = await pool.query(
          "SELECT COUNT(*)::int AS total_users FROM users2",
        );
        const roles = await pool.query(
          "SELECT role, COUNT(*)::int AS count FROM users2 GROUP BY role",
        );
        const newbies = await pool.query(`
          SELECT
            COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day')::int AS new_24h,
            COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS new_7d,
            COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int AS new_30d
          FROM users2;
        `);
        const dau = await pool.query(
          "SELECT COUNT(DISTINCT user_id)::int AS dau FROM activities WHERE created_at >= NOW() - INTERVAL '1 day'",
        );

        return {
          total_users: total.rows[0].total_users,
          roles: roles.rows,
          new_users: newbies.rows[0],
          dau: dau.rows[0].dau,
        };
      })(),

      // USERS
      (async () => {
        const byRole = await pool.query(
          "SELECT role, COUNT(*)::int AS count FROM users2 GROUP BY role",
        );
        const active = await pool.query(
          "SELECT COUNT(*)::int AS active_48h FROM activities WHERE created_at >= NOW() - INTERVAL '48 hours'",
        );
        const inactive = await pool.query(`
          SELECT COUNT(*)::int AS inactive_30d 
          FROM users2 
          WHERE id NOT IN (
            SELECT DISTINCT user_id FROM activities 
            WHERE created_at >= NOW() - INTERVAL '30 days'
          )
        `);

        return {
          byRole: byRole.rows,
          active: active.rows[0].active_48h,
          inactive: inactive.rows[0].inactive_30d,
        };
      })(),

      // COURSES
      (async () => {
        const counts = await pool.query(`
          SELECT
            (SELECT COUNT(*) FROM courses) AS total_courses,
            (SELECT COUNT(*) FROM modules) AS total_modules,
            (SELECT COUNT(*) FROM lessons) AS total_lessons;
        `);

        const topCourses = await pool.query(`
          WITH lesson_count AS (
            SELECT c.id AS course_id, COUNT(l.id)::int AS total_lessons
            FROM courses c
            LEFT JOIN modules m ON m.course_id = c.id
            LEFT JOIN lessons l ON l.module_id = m.id
            GROUP BY c.id
          ),
          completed_lessons AS (
            SELECT m.course_id, ulp.user_id, COUNT(ulp.lesson_id)::int AS completed_lessons
            FROM user_lesson_progress ulp
            JOIN lessons l ON l.id = ulp.lesson_id
            JOIN modules m ON m.id = l.module_id
            GROUP BY m.course_id, ulp.user_id
          ),
          avg_completion AS (
            SELECT course_id, AVG(completed_lessons)::numeric(6,2) AS avg_completed_lessons
            FROM completed_lessons
            GROUP BY course_id
          )
          SELECT
            c.id,
            c.title,
            lc.total_lessons,
            COALESCE(indiv.count,0) AS individual_enrollments,
            COALESCE(school.count,0) AS school_enrollments,
            COALESCE(indiv.count,0) + COALESCE(school.count,0) AS total_enrollments,
            COALESCE(ac.avg_completed_lessons,0)::numeric(6,2) AS avg_completed_lessons,
            CASE WHEN lc.total_lessons > 0 THEN
              ROUND((COALESCE(ac.avg_completed_lessons,0) / lc.total_lessons) * 100, 2)
            ELSE 0 END AS avg_progress
          FROM courses c
          LEFT JOIN lesson_count lc ON lc.course_id = c.id
          LEFT JOIN avg_completion ac ON ac.course_id = c.id
          LEFT JOIN (
            SELECT course_id, COUNT(*)::int AS count FROM course_enrollments GROUP BY course_id
          ) indiv ON indiv.course_id = c.id
          LEFT JOIN (
            SELECT sc.course_id, COUNT(us.user_id)::int AS count
            FROM school_courses sc
            JOIN user_school us 
              ON us.school_id = sc.school_id
             AND us.role_in_school = 'student'
             AND us.approved = true
            GROUP BY sc.course_id
          ) school ON school.course_id = c.id
          ORDER BY total_enrollments DESC
          LIMIT 10;
        `);

        return {
          counts: counts.rows[0],
          topCourses: topCourses.rows,
        };
      })(),

      // QUIZZES
      (async () => {
        const summary = await pool.query(`
          SELECT
            (SELECT COUNT(*) FROM quizzes)::int AS total_quizzes,
            (SELECT COUNT(*) FROM quiz_submissions)::int AS total_quiz_submissions,
            (SELECT COALESCE(AVG(score),0) FROM quiz_submissions)::numeric(6,2) AS avg_score;
        `);

        const passFail = await pool.query(
          "SELECT passed, COUNT(*)::int AS count FROM quiz_submissions GROUP BY passed",
        );

        return { summary: summary.rows[0], passFail: passFail.rows };
      })(),

      // ACTIVITY
      (async () => {
        const feed = await pool.query(`
          SELECT id, user_id, role, action, details, created_at
          FROM activities
          ORDER BY created_at DESC
          LIMIT 50
        `);
        return feed.rows;
      })(),

      // FINANCE
      (async () => {
        const revenue = await pool.query(`
          SELECT 
            COALESCE(SUM(amount),0)::numeric(12,2) AS total_revenue,
            COALESCE(SUM(amount) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days'),0)::numeric(12,2) AS revenue_30d
          FROM transactions;
        `);

        const schoolPayments = await pool.query(`
          SELECT status, COUNT(*)::int AS count FROM school_payments GROUP BY status
        `);

        const eventPayments = await pool.query(`
          SELECT payment_status, COUNT(*)::int AS count,
                 COALESCE(SUM(amount_paid),0)::numeric(12,2) AS total_collected
          FROM event_registrations
          GROUP BY payment_status
        `);

        return {
          revenue: revenue.rows[0],
          schoolPayments: schoolPayments.rows,
          eventPayments: eventPayments.rows,
        };
      })(),

      // EVENT PAYMENT DETAILS
      (async () => {
        const q = await pool.query(`
          SELECT 
            er.id, er.registrant_name, er.registrant_email, er.registrant_phone,
            er.payment_status, er.amount_paid, er.balance_due, er.total_amount,
            er.num_people, er.child_names, er.payment_option, er.created_at,
            ev.title AS event_title
          FROM event_registrations er
          JOIN events ev ON ev.id = er.event_id
          ORDER BY er.created_at DESC
        `);
        return q.rows;
      })(),
    ]);

    // Build HTML
    const html = buildAnalyticsPDF({
      overview,
      users: { byRole: users.byRole, active: users.active, inactive: users.inactive },
      courses: { counts: courses.counts, topCourses: courses.topCourses },
      quizzes: { summary: quizzes.summary, passFail: quizzes.passFail },
      activity: { feed: activity },
      finance,
      eventPaymentDetails,
    });

    // Launch Puppeteer with sandbox flags
    // const browser = await puppeteer.launch({
    //   headless: true,
    //   args: ["--no-sandbox", "--disable-setuid-sandbox"],
    // });

    // const page = await browser.newPage();
    // await page.setContent(html, { waitUntil: "networkidle0" });

    // // Generate PDF
    // const pdf = await page.pdf({ format: "A4", printBackground: true });

    // await browser.close();

    const pdf = await generatePdf(html);

    // Send PDF to client
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "inline; filename=analytics.pdf");
    res.send(pdf);

   

    // const browser = await puppeteer.launch({
    //   headless: true,
    //   args: ["--no-sandbox", "--disable-setuid-sandbox"],
    // });

    // const page = await browser.newPage();

    // await page.setContent(html, { waitUntil: "networkidle0" });

    // const pdf = await page.pdf({
    //   format: "A4",
    //   printBackground: true,
    // });

    // await browser.close();

    // res.setHeader("Content-Type", "application/pdf");
    // res.setHeader("Content-Disposition", "inline; filename=analytics.pdf");
    // res.send(pdf);

  } catch (err) {
    console.error("Analytics PDF Export Error:", err);
    res.status(500).send("Failed to generate analytics PDF");
  }
};

exports.overview = async (req, res) => {
  try {
    const total = await pool.query('SELECT COUNT(*)::int AS total_users FROM users2');
    const roles = await pool.query('SELECT role, COUNT(*)::int AS count FROM users2 GROUP BY role');
    const newbies = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day')::int AS new_24h,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS new_7d,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int AS new_30d
      FROM users2;
    `);
    const dau = await pool.query("SELECT COUNT(DISTINCT user_id)::int AS dau FROM activities WHERE created_at >= NOW() - INTERVAL '1 day'");

    res.json({
      totalUsers: total.rows[0].total_users,
      roles: roles.rows,
      newUsers: newbies.rows[0],
      dau: dau.rows[0].dau
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.addUser = async (req, res) => {

  async function generateSchoolId() {

    let schoolId;
    let exists = true;

    while (exists) {

        schoolId =
            "SCH-" +
            Math.floor(100000 + Math.random() * 900000);

        const check = await pool.query(
            `
            SELECT id
            FROM schools
            WHERE school_id=$1
            `,
            [schoolId]
        );

        exists = check.rows.length > 0;
    }

    return schoolId;
} 

  try {
    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );

    const company = infoResult.rows[0] || {};

    // const { fullname, email, phone, gender, role, schoolId } = req.body;
    let { fullname,email,phone,gender,role,schoolId } = req.body;

    // Default password
    const defaultPassword = "12345678";

    const hashedPassword = await bcrypt.hash(defaultPassword, 10);

    const roleConfig = {
  admin: {
    title: "Administrator Account",
    subject: "Administrator Account Created",
    loginUrl: "https://acad.jkthub.com/admin/login",
    welcome:
      "Your administrator account has been created. You now have full administrative access to manage the platform, users, courses, reports, and system settings.",
    description:
      "You can now access your Administrator Dashboard to manage the platform, users, courses, reports and system settings.",
    instructions: [
      "Visit the Administrator Login page.",
      "Login with your email address.",
      "Enter your temporary password.",
      "Manage users, courses, reports and platform settings.",
      "Change your password immediately from your Profile page."
    ]
  },

  school_admin: {
    title: "School Administrator Account",
    subject: "School Administrator Account Created",
    loginUrl: "https://acad.jkthub.com/admin/login",
    welcome:
      "Your School Administrator account has been created. You can now manage your school, teachers, students, classes and academic records.",
    description:
      "You can now access your School Administrator Dashboard to manage your school's settings, teachers, students and academic records.",
    instructions: [
      "Login using your email.",
      "Manage your school's teachers.",
      "Manage students and classes.",
      "Configure school settings.",
      "Change your password from your Profile page."
    ]
  },

  teacher: {
    title: "Teacher Account",
    subject: "Teacher Account Created",
    loginUrl: "https://acad.jkthub.com/admin/login",
    welcome:
      "Welcome! Your teacher account is ready. You can now manage your classes, lessons, quizzes, assignments and student results.",
    description:
      "You can now access your Teacher Dashboard to manage classes, lessons, assignments, quizzes, attendance and student results.",
    instructions: [
      "Login with your email.",
      "Access your teaching dashboard.",
      "Create lessons and assignments.",
      "Monitor students' progress.",
      "Change your password from your Profile page."
    ]
  },

  school_student: {
    title: "Student Account",
    subject: "Student Account Created",
    loginUrl: "https://acad.jkthub.com/admin/login",
    welcome:
      "Welcome to the learning platform. Your student account has been created successfully.",
    description:
      "You can now access your Student Dashboard to manage your courses, lessons, quizzes, assignments and certificates.",
    instructions: [
      "Login with your email.",
      "Access your enrolled courses.",
      "Complete lessons, quizzes and assignments.",
      "Track your progress and certificates.",
      "Change your password from your Profile page."
    ]
  },

  parent: {
    title: "Parent Account",
    subject: "Parent Account Created",
    loginUrl: "https://acad.jkthub.com/admin/login",
    welcome:
      "Your parent account is ready. You can now monitor your children's learning progress, invoices and reports.",
    description:
      "You can now access your Parent Dashboard to monitor your children's academic progress, view invoices and reports.",
    instructions: [
      "Login using your email.",
      "View your children.",
      "Monitor academic progress.",
      "Access invoices and receipts.",
      "Change your password from your Profile page."
    ]
  },

  instructor: {
    title: "Instructor Account",
    subject: "Instructor Account Created",
    loginUrl: "https://acad.jkthub.com/admin/login",
    welcome:
      "Welcome! Your instructor account has been created successfully.",
    description:
      "You can now access your Instructor Dashboard to manage your courses, lessons, quizzes and student progress.",
    instructions: [
      "Login using your email.",
      "Manage your courses.",
      "Upload lessons and quizzes.",
      "Review learners' progress.",
      "Change your password from your Profile page."
    ]
  },

  user: {
    title: "Learning Account",
    subject: "Welcome to Our Learning Platform",
    loginUrl: "https://acad.jkthub.com/admin/login",
    welcome:
      "Welcome! Your learning account has been created successfully.",
    description:
      "You can now access your learning dashboard to manage your courses, lessons, quizzes, assignments and certificates.",
    instructions: [
      "Login with your email.",
      "Start learning.",
      "Take quizzes and assignments.",
      "Earn certificates.",
      "Change your password from your Profile page."
    ]
  }
};

const userRole = role || "user";

const config = roleConfig[userRole] || roleConfig.user;

if(role==="teacher" || role==="student"){

    if(!schoolId){
        throw new Error("School ID is required.");
    }

    const school = await pool.query(
        `
        SELECT *
        FROM schools
        WHERE school_id=$1
        `,
        [schoolId]
    );

    if(school.rows.length===0){
        throw new Error("Invalid School ID");
    }

}

    const existingUser = await pool.query(
      `
      SELECT id
      FROM users2
      WHERE email=$1
      `,
      [email]
  );

  if (existingUser.rows.length > 0) {
      req.flash("error", "Email already exists.");
      return res.redirect("/admin/students");
      }
    
    const insert = await pool.query(
    `
    INSERT INTO users2
    (fullname,email,phone,gender,password,role)
    VALUES($1,$2,$3,$4,$5,$6)
    RETURNING id
    `,
    [
        fullname,
        email,
        phone,
        gender,
        hashedPassword,
        role
    ]
    );

    const userId = insert.rows[0].id;

    let createdSchoolId = schoolId;

if(role === "school_admin"){

    createdSchoolId = await generateSchoolId();

    await pool.query(
        `
        INSERT INTO schools
        (
            school_id,
            name,
            address,
            email,
            phone,
            created_by
        )
        VALUES
        ($1,$2,$3,$4,$5,$6)
        `,
        [
            createdSchoolId,
            req.body.schoolName,
            req.body.schoolAddress,
            req.body.schoolEmail,
            req.body.schoolPhone,
            userId
        ]
    );

}
    
    if(
        role==="teacher" ||
        role==="student" ||
        role==="school_admin"
    ){

        const school =
          await pool.query(
          `
          SELECT id
          FROM schools
          WHERE school_id=$1
          `,
          [createdSchoolId]
          );

        await pool.query(
            `
            INSERT INTO user_school
            (
                user_id,
                school_id,
                role_in_school,
                approved
            )
            VALUES
            ($1,$2,$3,true)
            `,
            [
                userId,
                school.rows[0].id,
                role
            ]
        );

    }

    // ==========================
    // Send Welcome Email
    // ==========================

    // const loginUrl = "https://acad.jkthub.com/admin/login"; // change if necessary
    const loginUrl = config.loginUrl;

    const html = `

    <meta
name="viewport"
content="width=device-width, initial-scale=1.0">

<div style="
background:#f4f4f4;
padding:40px;
font-family:Calibri,Arial,sans-serif;
">

<div style="
max-width:720px;
width:100%;
margin:auto;
background:#fff;
border-radius:10px;
overflow:hidden;
box-shadow:0 5px 20px rgba(0,0,0,.08);
">

<div style="
background:#b89b5e;
padding:25px;
text-align:center;
color:white;
">

<img
src="${company.logo_url || ""}"
width="80">

<h2 style="margin:15px 0 5px;">
${company.company_name || ""}
</h2>

<p style="margin:0;">
${config.title}
</p>

</div>

<div style="padding:25px;">

<h2 style="margin-top:0;color:#333;">
Hello ${fullname},
</h2>

<p>
${config.welcome}
</p>

<p>
${config.description}
</p>

<table
style="
width:100%;
border-collapse:collapse;
margin:25px 0;
">

<tr>
<td style="padding:12px;border-bottom:1px solid #eee;">
<b>Login Email</b>
</td>

<td style="border-bottom:1px solid #eee; word-break:break-all;
overflow-wrap:anywhere;">
${email}
</td>
</tr>

<tr>
<td style="padding:12px;border-bottom:1px solid #eee;">
<b>Temporary Password</b>
</td>

<td style="border-bottom:1px solid #eee;">
${defaultPassword}
</td>
</tr>

<tr>
<td style="padding:12px;">
<b>Role</b>
</td>

<td>
${role || "Student"}
</td>
</tr>

${role === "school_admin" ? `
<tr>
<td style="padding:12px;border-bottom:1px solid #eee;">
<b>School ID</b>
</td>

<td style="border-bottom:1px solid #eee;">
${createdSchoolId}
</td>
</tr>
` : ""}


</table>

<div
style="
background:#faf8f1;
padding:20px;
border-left:5px solid #b89b5e;
margin:25px 0;
">

<b>How to Login</b>


<ol style="line-height:28px;padding-left:20px;">
${config.instructions.map(step => `
<li>${step}</li>
`).join("")}
</ol>

</div>

<div style="text-align:center;margin:35px 0;">

<a href="${loginUrl}"
style="
background:#b89b5e;
color:white;
text-decoration:none;
padding:14px 30px;
border-radius:6px;
display:inline-block;
font-weight:bold;
">
Login Now
</a>

</div>

<p>
<b>Important:</b><br>
For your security, we strongly recommend changing your password immediately after your first login. You can do this anytime from your <b>Profile</b> page.
</p>

<p>

If you experience any difficulty accessing your account,
please contact our support team.

</p>

<br>

Kind regards,

<br><br>

<b>
${company.company_name || ""}
</b>

</div>

<div style="
background:#222;
color:#fff;
padding:20px;
text-align:center;
font-size:12px;
">

© ${new Date().getFullYear()}
${company.company_name || ""}

</div>

</div>

</div>
`;

    await sendEmail(
      email,
      `🎉 ${config.subject}`,
      html
    );

    // res.redirect("/admin/students");
    req.flash(
    "success",
    `School created successfully.
    School ID: ${createdSchoolId}`
    );

    res.redirect("/admin/students");

  } catch (err) {
    console.error(err);
    res.redirect("/admin/students");
  }
};

exports.checkSchool = async (req, res) => {

    const { schoolId } = req.params;

    const school = await pool.query(
        `
        SELECT *
        FROM schools
        WHERE school_id=$1
        `,
        [schoolId]
    );

    if(school.rows.length){

        return res.json({

            found:true,

            school:school.rows[0]

        });

    }

    res.json({

        found:false

    });

};

exports.users = async (req, res) => {
  try {
    const byRole = await pool.query("SELECT role, COUNT(*)::int AS count FROM users2 GROUP BY role");
    const active = await pool.query("SELECT COUNT(*)::int AS active_48h FROM activities WHERE created_at >= NOW() - INTERVAL '48 hours'");
    const inactive = await pool.query("SELECT COUNT(*)::int AS inactive_30d FROM users2 WHERE id NOT IN (SELECT DISTINCT user_id FROM activities WHERE created_at >= NOW() - INTERVAL '30 days')");

    res.json({ byRole: byRole.rows, active: active.rows[0].active_48h, inactive: inactive.rows[0].inactive_30d });
  } catch (err) { console.error(err); res.status(500).json({error:'Server error'}); }
};

exports.courses = async (req, res) => {
  try {
    const counts = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM courses) AS total_courses,
        (SELECT COUNT(*) FROM modules) AS total_modules,
        (SELECT COUNT(*) FROM lessons) AS total_lessons;
    `);

    const topCourses = await pool.query(`
      WITH lesson_count AS (
        SELECT 
          c.id AS course_id,
          COUNT(l.id)::int AS total_lessons
        FROM courses c
        LEFT JOIN modules m ON m.course_id = c.id
        LEFT JOIN lessons l ON l.module_id = m.id
        GROUP BY c.id
      ),

      completed_lessons AS (
        SELECT 
          m.course_id,
          ulp.user_id,
          COUNT(ulp.lesson_id)::int AS completed_lessons
        FROM user_lesson_progress ulp
        JOIN lessons l ON l.id = ulp.lesson_id
        JOIN modules m ON m.id = l.module_id
        GROUP BY m.course_id, ulp.user_id
      ),

      avg_completion AS (
        SELECT 
          course_id,
          AVG(completed_lessons)::numeric(6,2) AS avg_completed_lessons
        FROM completed_lessons
        GROUP BY course_id
      )

      SELECT
        c.id,
        c.title,

        lc.total_lessons,

        -- INDIVIDUAL ENROLLMENTS
        COALESCE(indiv.count, 0) AS individual_enrollments,

        -- SCHOOL ENROLLMENTS
        COALESCE(school.count, 0) AS school_enrollments,

        -- TOTAL ENROLLMENTS
        COALESCE(indiv.count,0) + COALESCE(school.count,0) AS total_enrollments,

        -- AVERAGE COMPLETED LESSONS (REAL DATA)
        COALESCE(ac.avg_completed_lessons, 0)::numeric(6,2) AS avg_completed_lessons,

        -- AVG PROGRESS (%) = completed / total lessons × 100
        CASE 
          WHEN lc.total_lessons > 0 THEN
            ROUND((COALESCE(ac.avg_completed_lessons, 0) / lc.total_lessons) * 100, 2)
          ELSE 0
        END AS avg_progress

      FROM courses c

      LEFT JOIN lesson_count lc ON lc.course_id = c.id
      LEFT JOIN avg_completion ac ON ac.course_id = c.id

      -- INDIVIDUAL ENROLLMENTS
      LEFT JOIN (
        SELECT course_id, COUNT(*)::int AS count
        FROM course_enrollments
        GROUP BY course_id
      ) indiv ON indiv.course_id = c.id

      -- SCHOOL ENROLLMENTS
      LEFT JOIN (
        SELECT 
          sc.course_id,
          COUNT(us.user_id)::int AS count
        FROM school_courses sc
        JOIN user_school us 
              ON us.school_id = sc.school_id
             AND us.role_in_school = 'student'
             AND us.approved = true
        GROUP BY sc.course_id
      ) school ON school.course_id = c.id

      ORDER BY total_enrollments DESC
      LIMIT 10;
    `);

    res.json({
      counts: counts.rows[0],
      topCourses: topCourses.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
};

exports.progress = async (req, res) => {
  try {
    const lessonsToday = await pool.query("SELECT COUNT(*)::int AS lessons_completed_today FROM user_lesson_progress WHERE completed_at >= CURRENT_DATE");
    const moduleComps = await pool.query("SELECT COUNT(*)::int AS module_completions FROM unlocked_modules");
    const courseProgress = await pool.query(`
      SELECT COUNT(*) FILTER (WHERE progress >= 100)::int AS courses_completed,
             COUNT(*)::int AS total_enrollments
      FROM course_enrollments;
    `);

    res.json({
      lessonsCompletedToday: lessonsToday.rows[0].lessons_completed_today,
      moduleCompletions: moduleComps.rows[0].module_completions,
      courseProgress: courseProgress.rows[0]
    });
  } catch (err) { console.error(err); res.status(500).json({error:'Server error'}); }
};

exports.quizzes = async (req, res) => {
  try {
    const q = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM quizzes)::int AS total_quizzes,
        (SELECT COUNT(*) FROM quiz_submissions)::int AS total_quiz_submissions,
        (SELECT COALESCE(AVG(score),0) FROM quiz_submissions)::numeric(6,2) AS avg_score;
    `);
    const passFail = await pool.query("SELECT passed, COUNT(*)::int AS count FROM quiz_submissions GROUP BY passed");

    res.json({ summary: q.rows[0], passFail: passFail.rows });
  } catch (err) { console.error(err); res.status(500).json({error:'Server error'}); }
};

exports.finance = async (req, res) => {
  try {
    // Total revenue
    const revenue = await pool.query(`
      SELECT 
        COALESCE(SUM(amount),0)::numeric(12,2) AS total_revenue,
        COALESCE(SUM(amount) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days'),0)::numeric(12,2) AS revenue_30d
      FROM transactions;
    `);

    // School payments by status
    const schoolPayments = await pool.query(`
      SELECT status, COUNT(*)::int AS count
      FROM school_payments
      GROUP BY status
    `);

    // Event payments by status
    const eventPayments = await pool.query(`
      SELECT payment_status, COUNT(*)::int AS count, 
             COALESCE(SUM(amount_paid),0)::numeric(12,2) AS total_collected
      FROM event_registrations
      GROUP BY payment_status
    `);

    res.json({
      revenue: revenue.rows[0],
      schoolPayments: schoolPayments.rows,
      eventPayments: eventPayments.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
};

// exports.eventPaymentDetails = async (req, res) => {
//   const q = await pool.query(`
//      SELECT ep.id, ep.payment_status, ep.amount,
//             ep.created_at,
//             u.fullname, u.email,
//             ev.title AS event_title
//      FROMevent_registrations ep
//      JOIN users2 u ON u.id = ep.user_id
//      JOIN events ev ON ev.id = ep.event_id
//      ORDER BY ep.created_at DESC
//   `);

//   res.json(q.rows);
// };

exports.eventPaymentDetails = async (req, res) => {
  const q = await pool.query(`
    SELECT
      er.id,
      er.payment_status,
      er.amount_paid AS amount,
      er.created_at,
      er.registrant_name AS fullname,
      er.registrant_email AS email,
      e.title AS event_title
    FROM event_registrations er
    JOIN events e
      ON e.id = er.event_id
    ORDER BY er.created_at DESC
  `);

  res.json(q.rows);
};

exports.feedback = async (req, res) => {
  try {
    const feedbackSummary = await pool.query("SELECT COUNT(*)::int AS total_feedback, AVG(rating)::numeric(4,2) AS avg_rating FROM feedback");
    const byType = await pool.query("SELECT user_type, COUNT(*)::int AS count FROM feedback GROUP BY user_type");
    res.json({ summary: feedbackSummary.rows[0], byType: byType.rows });
  } catch (err) { console.error(err); res.status(500).json({error:'Server error'}); }
};

exports.activity = async (req, res) => {
  try {
    const feed = await pool.query(`
      SELECT id, user_id, role, action, details, created_at
      FROM activities
      ORDER BY created_at DESC
      LIMIT 50
    `);
    res.json({ feed: feed.rows });
  } catch (err) { console.error(err); res.status(500).json({error:'Server error'}); }
};

exports.submitFeedbackAPI = async (req, res) => {
  try {
    const {
      user_type,
      name,
      email,
      message,
      rating,
      student_class,
      school_name,
      organization_name,
    } = req.body;

    await pool.query(
      `INSERT INTO feedback(user_type, fullname, email, message, rating, student_class, school_name, organization_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        user_type,
        name,
        email,
        message,
        rating,
        student_class || null,
        school_name || null,
        organization_name || null,
      ]
    );

    return res.json({
      success: true,
      message: "Thank you! Your feedback has been submitted successfully.",
    });
  } catch (err) {
    console.error("❌ FEEDBACK ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Could not submit feedback",
    });
  }
};

exports.showFeedbackForm = (req, res) => {
  res.render("feedback"); // feedback.ejs
};

exports.submitFeedbackAPI = async (req, res) => {
  try {
    const {
      user_type,
      name,
      email,
      message,
      rating,
      student_class,
      school_name,
      organization_name,
      category,
      extra,
    } = req.body;

    // sentiment analysis
    const s = sentiment.analyze((message || "") + " " + (category || ""));
    const sentiment_score = s.score;
    let sentiment_label = "neutral";
    if (sentiment_score > 1) sentiment_label = "positive";
    if (sentiment_score < -1) sentiment_label = "negative";

    // keywords
    const keywords = extractKeywords(message || "");

    // insert (include optional sentiment & keywords if the columns exist)
    await pool.query(
      `INSERT INTO feedback(user_type, name, email, message, rating, student_class, school_name, organization_name, category, extra, sentiment_label, sentiment_score, keywords, is_published)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        user_type,
        name,
        email || null,
        message,
        rating || null,
        student_class || null,
        school_name || null,
        organization_name || null,
        category || null,
        extra || null,
        sentiment_label,
        sentiment_score,
        JSON.stringify(keywords),
        false, // default unpublished until admin approves
      ]
    );

    return res.json({
      success: true,
      message: "Thank you! Your feedback has been submitted successfully.",
    });
  } catch (err) {
    console.error("❌ FEEDBACK ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Could not submit feedback",
    });
  }
};


// Admin HTML view
exports.viewFeedback = async (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.redirect("/admin/login");
  }

  try {
    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );

    const feedbackResult = await pool.query(
      "SELECT * FROM feedback ORDER BY created_at DESC"
    );

    res.render("admin/feedback", {
      info: infoResult.rows[0],
      feedback: feedbackResult.rows,
      user: req.session.user,
      role: "admin",
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error loading feedback");
  }
};

// GET /admin/feedback/api
exports.getFeedbackAPI = async (req, res) => {
  try {
    // query params: page, perPage, user_type, rating, dateFrom, dateTo, school, search, published
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const perPage = Math.min(200, parseInt(req.query.perPage) || 20);
    const offset = (page - 1) * perPage;

    const filters = [];
    const params = [];

    if (req.query.user_type) {
      params.push(req.query.user_type);
      filters.push(`user_type = $${params.length}`);
    }
    if (req.query.rating) {
      params.push(parseInt(req.query.rating));
      filters.push(`rating = $${params.length}`);
    }
    if (req.query.published) {
      params.push(req.query.published === 'true');
      filters.push(`is_published = $${params.length}`);
    }
    if (req.query.school_name) {
      params.push(`%${req.query.school_name}%`);
      filters.push(`school_name ILIKE $${params.length}`);
    }
    if (req.query.dateFrom) {
      params.push(req.query.dateFrom);
      filters.push(`created_at >= $${params.length}`);
    }
    if (req.query.dateTo) {
      params.push(req.query.dateTo);
      filters.push(`created_at <= $${params.length}`);
    }
    if (req.query.search) {
      params.push(`%${req.query.search}%`);
      filters.push(`(name ILIKE $${params.length} OR message ILIKE $${params.length} OR email ILIKE $${params.length})`);
    }

    const where = filters.length ? 'WHERE ' + filters.join(' AND ') : '';

    // total count
    const totalQ = await pool.query(`SELECT COUNT(*)::int AS total FROM feedback ${where}`, params);
    const total = totalQ.rows[0].total;

    // fetch page
    params.push(perPage, offset);
    const q = await pool.query(
      `SELECT id, user_type, name, email, message, rating, school_name, student_class, organization_name, category, created_at, sentiment_label, sentiment_score, keywords, is_published
       FROM feedback
       ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length-1} OFFSET $${params.length}`,
      params
    );

    res.json({ total, page, perPage, rows: q.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.exportFeedbackPDF = async (req, res) => {
  try {
    const { rows: feedback } = await pool.query(`
      SELECT *
      FROM feedback
      ORDER BY created_at DESC
    `);

    const html = buildFeedbackPDF(feedback);

    // const browser = await puppeteer.launch({
    //   headless: true,
    //   args: ["--no-sandbox", "--disable-setuid-sandbox"],
    // });

    // const page = await browser.newPage();
    // await page.setContent(html, { waitUntil: "networkidle0" });

    // const pdf = await page.pdf({
    //   format: "A4",
    //   printBackground: true,
    //   margin: { top: "20px", bottom: "20px" },
    // });

    // await browser.close();

    const pdf = await generatePdf(html);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=feedback_report.pdf`
    );

    res.send(pdf);
  } catch (err) {
    console.error("PDF Export Error:", err);
    res.status(500).send("Failed to generate PDF");
  }
};

// CSV export
exports.exportFeedbackCSV = async (req, res) => {
  try {
    // reuse getFeedbackAPI style filter building or simpler: export all / with same filters
    // For brevity, keep same query as getFeedbackAPI but without pagination
    const filters = [];
    const params = [];
    if (req.query.user_type) { params.push(req.query.user_type); filters.push(`user_type = $${params.length}`); }
    if (req.query.published) { params.push(req.query.published === 'true'); filters.push(`is_published = $${params.length}`); }
    if (req.query.search) { params.push(`%${req.query.search}%`); filters.push(`(name ILIKE $${params.length} OR message ILIKE $${params.length})`); }
    const where = filters.length ? 'WHERE ' + filters.join(' AND ') : '';

    const q = await pool.query(
      `SELECT id, user_type, name, email, message, rating, school_name, category, student_class, organization_name, created_at FROM feedback ${where} ORDER BY created_at DESC`,
      params
    );
 
    const fields = ['id','user_type','name','email','rating', 'message', 'category','school_name', 'student_class', 'organization_name','created_at'];
    const parser = new Parser({ fields });
    const csv = parser.parse(q.rows);

    res.setHeader('Content-disposition', 'attachment; filename=feedback.csv');
    res.set('Content-Type', 'text/csv');
    res.status(200).send(csv);
  } catch (err) {
    console.error(err);
    res.status(500).send('Export failed');
  }
};

// Excel export
exports.exportFeedbackExcel = async (req, res) => {
  try {
    const q = await pool.query('SELECT id, user_type, name, email, message, rating, school_name, category, student_class, organization_name, created_at FROM feedback ORDER BY created_at DESC');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Feedback');

    sheet.columns = [
      { header: 'ID', key: 'id', width: 8 },
      { header: 'Type', key: 'user_type', width: 15 },
      { header: 'Name', key: 'name', width: 25 },
      { header: 'Email', key: 'email', width: 25 },
      { header: 'Rating', key: 'rating', width: 10 },
      { header: 'Category', key: 'category', width: 25 },
      { header: 'School', key: 'school_name', width: 20 },
      { header: 'Student class', key: 'student_class', width: 20 },
      { header: 'Organization', key: 'organization_name', width: 20 },
      { header: 'Message', key: 'message', width: 60 },
      { header: 'Date', key: 'created_at', width: 20 }
    ];

    q.rows.forEach(r => sheet.addRow(r));

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=feedback.xlsx');

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).send('Excel export failed');
  }
};

// GET /admin/feedback/detail/:id
exports.getFeedbackDetail = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const q = await pool.query('SELECT * FROM feedback WHERE id = $1', [id]);
    if(q.rowCount === 0) return res.status(404).json({ error: 'not found' });
    return res.json(q.rows[0]);
  } catch(err) {
    console.error(err); res.status(500).json({error:'server'});
  }
};

exports.togglePublish = async (req, res) => {
  try {
    const id = req.params.id;
    const { status } = req.body;

    await pool.query("UPDATE feedback SET is_published=$1 WHERE id=$2", [
      status,
      id,
    ]);

    res.json({ success: true });
  } catch (err) {
    console.error("Publish toggle error:", err);
    res.status(500).json({ success: false });
  }
};

exports.deleteFeedback = async (req, res) => {
  try {
    const id = req.params.id;

    await pool.query("DELETE FROM feedback WHERE id=$1", [id]);

    res.json({ success: true });
  } catch (err) {
    console.error("Delete error:", err);
    res.status(500).json({ success: false });
  }
};

exports.instructorDashboard = async (req, res) => {

  const instructorId = req.session.user.id;
  let schoolId = req.query.school_id || req.session.activeSchoolId;

  if (req.query.school_id) {
    req.session.activeSchoolId = req.query.school_id;
  }

  console.log("INSTRUCTOR ID:", instructorId);
  console.log("ACTIVE SCHOOL:", schoolId);

  try {
    // --- Company Info
    const info =
      (await pool.query("SELECT * FROM company_info ORDER BY id DESC LIMIT 1"))
        .rows[0] || {};

    const profilePic = req.session.user?.profile_picture || null;

    // --- Schools instructor has access to
   const schoolsRes = await pool.query(
     `
      SELECT DISTINCT 
        s.id,
        s.name
      FROM classroom_instructors ci
      JOIN classrooms c ON c.id = ci.classroom_id
      JOIN schools s ON s.id = c.school_id
      WHERE ci.instructor_id = $1
    `,
     [instructorId],
   );

    console.log("RAW SCHOOL DEBUG:", schoolsRes.rows);

    const schools = schoolsRes.rows;
    const selectedSchoolId = schoolId || schools[0]?.id || null;

    if (!schoolId) {
      schoolId = req.session.activeSchoolId || null;
    }

    const test = await pool.query(
      `SELECT * FROM classroom_instructors WHERE instructor_id = $1`,
      [instructorId]
    );

    console.log("Instructor classrooms:", test.rows);

    let classroomQuery = `
  SELECT c.id, c.name
  FROM classrooms c
  JOIN classroom_instructors ci ON ci.classroom_id = c.id
  WHERE ci.instructor_id = $1
`;

    let params = [instructorId];

    if (schoolId) {
      classroomQuery += ` AND c.school_id = $2`;
      params.push(schoolId);
    }

    const classroomsRes = await pool.query(classroomQuery, params);

    const classrooms = classroomsRes.rows;

    // --- Courses in selected classroom
    let courses = [];
    let modules = [];
    let lessons = [];

    if (req.query.classroom) {
      const coursesRes = await pool.query(
        `
        SELECT cr.*, p.title AS pathway_name
        FROM classroom_courses cc
        JOIN courses cr ON cc.course_id = cr.id
        LEFT JOIN career_pathways p ON cr.career_pathway_id = p.id
        WHERE cc.classroom_id = $1
        ORDER BY cr.title
        `,
        [req.query.classroom],
      );
      courses = coursesRes.rows;
    }

    // --- Modules (no unlock checks)
    if (req.query.course) {
      const modulesRes = await pool.query(
        `
        SELECT * FROM modules
        WHERE course_id = $1
        ORDER BY order_number ASC
        `,
        [req.query.course],
      );
      modules = modulesRes.rows;
    }

    // --- Lessons (no unlock checks)
    if (req.query.module) {
      const lessonsRes = await pool.query(
        `
        SELECT l.*,
               EXISTS(SELECT 1 FROM quizzes q WHERE q.lesson_id = l.id) AS has_quiz
        FROM lessons l
        WHERE l.module_id = $1
        ORDER BY order_number ASC
        `,
        [req.query.module],
      );
      lessons = lessonsRes.rows;
    }

    console.log("Instructor ID:", instructorId);
    console.log("Schools:", schools);
    console.log("Active School:", schoolId);
    res.render("instructor/dashboard", {
      info,
      profilePic,
      classrooms,
      courses,
      modules,
      lessons,
      schools,
      selectedSchoolId,
      selected: req.query,
      user: req.session.user,
      role: "instructor",
    });
  } catch (err) {
    console.error("Instructor dashboard error:", err);
    res.status(500).send("Server error");
  }
};

exports.editUserForm = async (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.redirect("/admin/login");
  }
  const userId = req.params.id;
  const infoResult = await pool.query(
    "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
  );
  const info = infoResult.rows[0];

  try {
    const result = await pool.query("SELECT * FROM users2 WHERE id = $1", [
      userId,
    ]);
    const user = result.rows[0];
    if (!user) {
      return res.status(404).send("User not found");
    }

    res.render("admin/editUser", { info, user, role: "admin" });
  } catch (error) {
    console.error("Error loading user edit form:", error);
    res.status(500).send("Server error");
  }
};

exports.updateUser = async (req, res) => {
  const userId = req.params.id;
  const { fullname, email, phone, gender, role, wallet_balance2 } = req.body;
  

  try {
    // Convert empty string to 0, otherwise keep number
    const balance = wallet_balance2 === "" ? 0 : parseFloat(wallet_balance2);

    await pool.query(
      "UPDATE users2 SET fullname = $1, email = $2, phone = $3, gender = $4, role = $5, wallet_balance2 = $6 WHERE id = $7",
      [fullname, email, phone, gender, role, wallet_balance2, userId]
    );
    await logActivityForUser(req, "User updated", `user name: ${fullname}`);
    res.redirect("/admin/dashboard");
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).send("Server error");
  }
};

exports.deleteUser = async (req, res) => {
  const userId = req.params.id;

  try {
    await pool.query("DELETE FROM users2 WHERE id = $1", [userId]);
    await logActivityForUser(req, "User Deleted");
    res.redirect("/admin/dashboard");
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).send("Server error");
  }
};

exports.getAdminProfile = async (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.redirect("/admin/login");
  }
  const userId = req.session.user?.id;
  if (!userId || req.session.user.role !== "admin")
    return res.redirect("/admin/login");
  const result = await pool.query("SELECT * FROM users2 WHERE id = $1", [
    userId,
  ]);
  res.render("adminProfile", {
    user: result.rows[0],
    title: "Admin Profile",
  });
};

exports.updateAdminProfile = async (req, res) => {
  const { fullname, phone, dob } = req.body;
  const dobValue = dob && dob.trim() !== "" ? dob : null;
  const profile_picture = req.file
    ? req.file.path
    : req.session.user.profile_picture;
  await pool.query(
    "UPDATE users2 SET fullname = $1, phone = $2, profile_picture = $3, dob = $4 WHERE id = $5",
    [fullname, phone, profile_picture, dobValue, req.session.user.id]
  );
  req.session.user.profile_picture = profile_picture; // update session
  await logActivityForUser(
    req,
    "Admin Profile Updated ",
    `Admin name: ${fullname}`
  );
  res.redirect("/admin/profile");
};

exports.getUserProfile = async (req, res) => {
  const userId = req.session.user?.id;
  if (!userId || req.session.user.role !== "admin")
    return res.redirect("/admin/login");
  const result = await pool.query("SELECT * FROM users2 WHERE id = $1", [
    userId,
  ]);
  res.render("adminProfile", {
    user: result.rows[0],
    title: "User Profile",
  });
};

// --- CAREER PATHWAYS ---
exports.showPathways = async (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.redirect("/admin/login");
  }
  const search = req.query.search || ""; // ✅ define the variable
  const infoResult = await pool.query(
    "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
  );
  const info = infoResult.rows[0] || {};
  const result = await pool.query(
    "SELECT * FROM career_pathways ORDER BY id DESC"
  );
  res.render("admin/pathways", {
    info,
    search,
    pathways: result.rows,
    role: req.session.user?.role || "admin",
  });
};

exports.createPathway = async (req, res) => {
  const {
    title,
    description,
    target_audience,
    expected_outcomes,
    duration_estimate,
    video_intro_url,
    show_on_homepage,
  } = req.body;

  let thumbnail_url = null;

  if (req.file) {
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: "pathways",
    });
    thumbnail_url = result.secure_url;
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  }

  await pool.query(
    "INSERT INTO career_pathways (title, description, thumbnail_url, target_audience, expected_outcomes, duration_estimate, video_intro_url, show_on_homepage) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    [
      title,
      description,
      thumbnail_url,
      target_audience,
      expected_outcomes,
      duration_estimate,
      video_intro_url,
      show_on_homepage === "true",
    ]
  );
  await logActivityForUser(req, "Pathway Created", `Pathway name: ${title}`);
  res.redirect("/admin/pathways");
};

exports.deletePathway = async (req, res) => {
  const { id } = req.params;
  await pool.query("DELETE FROM career_pathways WHERE id = $1", [id]);
  await logActivityForUser(req, "Pathway deleted", `Pathway ID: ${id}`);
  res.redirect("/admin/pathways");
};

exports.editPathway = async (req, res) => {
  const { id } = req.params;
  const {
    title,
    description,
    target_audience,
    expected_outcomes,
    duration_estimate,
    video_intro_url,
    show_on_homepage,
  } = req.body;

  let thumbnail_url = null;

  if (req.file) {
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: "pathways",
    });
    thumbnail_url = result.secure_url;
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  }

  const existing = await pool.query(
    "SELECT * FROM career_pathways WHERE id = $1",
    [id]
  );
  const current = existing.rows[0];

  const updatedThumbnail = thumbnail_url || current.thumbnail_url;

  await pool.query(
    `UPDATE career_pathways
     SET title = $1,
         description = $2,
         thumbnail_url = $3,
         target_audience = $4,
         expected_outcomes = $5,
         duration_estimate = $6,
         video_intro_url = $7,
         show_on_homepage = $8
     WHERE id = $9`,
    [
      title,
      description,
      updatedThumbnail,
      target_audience,
      expected_outcomes,
      duration_estimate,
      video_intro_url,
      show_on_homepage === "true",
      id,
    ]
  );
  await logActivityForUser(req, "Pathway edited", `Pathway title: ${title}`);
  res.redirect("/admin/pathways");
};

// --- COURSES ---

exports.showCourses = async (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.redirect("/admin/login");
  }
  const infoResult = await pool.query(
    "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
  );
  const info = infoResult.rows[0] || {};

  let coursesQuery = `
    SELECT courses.*, cp.title AS pathway_name
    FROM courses
    LEFT JOIN career_pathways cp ON cp.id = courses.career_pathway_id
  `;
  let params = [];

  // ✅ If instructor → only fetch their courses
  if (req.user.role === "instructor") {
    coursesQuery += ` WHERE courses.instructor_id = $1 `;
    params.push(req.user.id);
  }

  coursesQuery += ` ORDER BY cp.title ASC, courses.level ASC, sort_order ASC`;

  const coursesResult = await pool.query(coursesQuery, params);

  const pathwaysResult = await pool.query("SELECT * FROM career_pathways");

  // Group courses by pathway and level
  const groupedCourses = {};
  coursesResult.rows.forEach((course) => {
    const pathway = course.pathway_name || "Unassigned";
    const level = course.level || "Unspecified";

    if (!groupedCourses[pathway]) groupedCourses[pathway] = {};
    if (!groupedCourses[pathway][level]) groupedCourses[pathway][level] = [];

    groupedCourses[pathway][level].push(course);
  });

  res.render("admin/courses", {
    info,
    search: req.query.search || "",
    careerPathways: pathwaysResult.rows,
    groupedCourses,
    role: req.session.user?.role || "admin",
  });
};

exports.previewCertificate = async (req, res) => {
  const courseId = req.params.id;

  try {
    const courseResult = await pool.query(
      "SELECT title FROM courses WHERE id = $1",
      [courseId]
    );

    const course = courseResult.rows[0];
    if (!course) return res.status(404).send("Course not found");

    const fs = require("fs");
    const path = require("path");

    const templatePath = path.join(
      __dirname,
      "../views/partials/certificate.html"
    );

    let html = fs.readFileSync(templatePath, "utf8");

    html = html
      .replace(/{{STUDENT_NAME}}/g, "Student Name")
      .replace(/{{COURSE_TITLE}}/g, course.title)
      .replace(/{{DATE}}/g, new Date().toDateString())
      .replace(/{{CERT_CODE}}/g, "PREVIEW-12345");

    res.send(html); // 👈 display certificate in browser

  } catch (err) {
    console.error(err);
    res.status(500).send("Error generating preview");
  }
};

exports.createCourse = async (req, res) => {
  console.log("📘 Creating course with:", req.body);
  const { title, description, level, career_pathway_id, sort_order, amount, curriculum_content } =
    req.body;

  let thumbnail_url = null;
  let curriculum_url = null;
  let curriculum_mime = null;
  let curriculum_name = null;
  let certificate_url = null;
  let certificate_mime = null;
  let certificate_name = null;

  try {
    // ✅ Upload thumbnail (image)
    if (req.files?.thumbnail?.[0]) {
      const thumbPath = req.files.thumbnail[0].path;
      const thumbResult = await cloudinary.uploader.upload(thumbPath, {
        folder: "courses/thumbnails",
        resource_type: "image",
        use_filename: true,
        unique_filename: false,
      });
      thumbnail_url = thumbResult.secure_url;
      if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
    }

    // ✅ Upload curriculum (PDF/DOC/DOCX)
    if (req.files?.curriculum?.[0]) {
      const file = req.files.curriculum[0];
      const filePath = file.path;
      const fileResult = await cloudinary.uploader.upload(filePath, {
        folder: "courses/curriculums",
        resource_type: "raw",
        use_filename: true,
        unique_filename: false,
      });
      curriculum_url = fileResult.secure_url;
      curriculum_mime = file.mimetype;
      curriculum_name = file.originalname;
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    // ✅ Upload certificate (PDF or Image)
    if (req.files?.certificate?.[0]) {
      const cert = req.files.certificate[0];
      const certPath = cert.path;
      const certResult = await cloudinary.uploader.upload(certPath, {
        folder: "courses/certificates",
        resource_type: "auto",
        use_filename: true,
        unique_filename: false,
      });
      certificate_url = certResult.secure_url;
      certificate_mime = cert.mimetype;
      certificate_name = cert.originalname;
      if (fs.existsSync(certPath)) fs.unlinkSync(certPath);
    }

    await pool.query(
      `INSERT INTO courses (
        title, description, level, career_pathway_id,
        thumbnail_url, sort_order, amount,
        created_by, instructor_id,
        curriculum_content
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        title,
        description,
        level,
        career_pathway_id || null,
        thumbnail_url,
        sort_order || 0,
        amount || 0,
        req.user.role === "instructor" ? "instructor" : "admin",
        req.user.role === "instructor" ? req.user.id : null,
        curriculum_content
      ]
    );


    await logActivityForUser(req, "Course Created", `Course title: ${title}`);
    console.log("✅ Course created successfully.");

    res.redirect(`/admin/pathways/${career_pathway_id}/courses`);
  } catch (err) {
    console.error("❌ Error creating course:", err);
    res
      .status(500)
      .send("Error creating course: " + (err.message || "unknown"));
  }
};

exports.createCourse = async (req, res) => {
  console.log("📘 Creating course with:", req.body);
  const { title, description, level, career_pathway_id, sort_order, amount, curriculum_content } =
    req.body;

  let thumbnail_url = null;

  try {
    // ✅ Upload thumbnail (image)
    if (req.files?.thumbnail?.[0]) {
      const thumbPath = req.files.thumbnail[0].path;
      const thumbResult = await cloudinary.uploader.upload(thumbPath, {
        folder: "courses/thumbnails",
        resource_type: "image",
        use_filename: true,
        unique_filename: false,
      });
      thumbnail_url = thumbResult.secure_url;
      if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
    }


    await pool.query(
      `INSERT INTO courses (
        title, description, level, career_pathway_id,
        thumbnail_url, sort_order, amount,
        created_by, instructor_id,
        curriculum_content
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        title,
        description,
        level,
        career_pathway_id || null,
        thumbnail_url,
        sort_order || 0,
        amount || 0,
        req.user.role === "instructor" ? "instructor" : "admin",
        req.user.role === "instructor" ? req.user.id : null,
        curriculum_content
      ]
    );


    await logActivityForUser(req, "Course Created", `Course title: ${title}`);
    console.log("✅ Course created successfully.");

    res.redirect(`/admin/pathways/${career_pathway_id}/courses`);
  } catch (err) {
    console.error("❌ Error creating course:", err);
    res
      .status(500)
      .send("Error creating course: " + (err.message || "unknown"));
  }
};

// ✅ EDIT COURSE

exports.editCourse = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, level, career_pathway_id, sort_order, amount, curriculum_content } = req.body;

    let thumbnailUrl = null;
    let curriculumUrl = null;
    let certificateUrl = null;

    // Get existing course data
    const existingCourse = await pool.query(
      "SELECT * FROM courses WHERE id = $1",
      [id]
    );

    if (existingCourse.rows.length === 0) {
      return res.status(404).send("Course not found");
    }

    const course = existingCourse.rows[0];

    // Upload new files if provided
    if (req.files?.thumbnail) {
      const uploadedThumb = await cloudinary.uploader.upload(
        req.files.thumbnail[0].path
      );
      thumbnailUrl = uploadedThumb.secure_url;
    } else {
      thumbnailUrl = course.thumbnail_url;
    }

    if (req.files?.curriculum) {
      const uploadedCurr = await cloudinary.uploader.upload(
        req.files.curriculum[0].path,
        { resource_type: "auto" }
      );
      curriculumUrl = uploadedCurr.secure_url;
    } else {
      curriculumUrl = course.curriculum_url;
    }

    if (req.files?.certificate) {
      const uploadedCert = await cloudinary.uploader.upload(
        req.files.certificate[0].path,
        { resource_type: "auto" }
      );
      certificateUrl = uploadedCert.secure_url;
    } else {
      certificateUrl = course.certificate_url;
    }

    await pool.query(
      `UPDATE courses SET
        title=$1, description=$2, level=$3, career_pathway_id=$4,
        thumbnail_url=$5, sort_order=$6, amount=$7,
        created_by=$8, instructor_id=$9,
        curriculum_content=$10
      WHERE id=$11`,
      [
        title,
        description,
        level,
        career_pathway_id || null,
        thumbnailUrl,
        sort_order || 0,
        amount || 0,
        req.user.role === "instructor" ? "instructor" : "admin",
        req.user.role === "instructor" ? req.user.id : null,
        curriculum_content || null,
        id
      ]
    );
        

    // Update the course
    // await pool.query(
    //   `UPDATE courses
    //    SET title=$1, description=$2, level=$3, amount=$4,
    //        thumbnail_url=$5, curriculum_url=$6, certificate_url=$7
    //    WHERE id=$8`,
    //   [
    //     title,
    //     description,
    //     level,
    //     amount,
    //     thumbnailUrl,
    //     curriculumUrl,
    //     certificateUrl,
    //     id,
    //   ]
    // );

    res.redirect("back");
  } catch (error) {
    console.error("❌ Error editing course:", error);
    res.status(500).send("Server error while editing course");
  }
};


exports.deleteCourse = async (req, res) => {
  const { id } = req.params;

  try {
    // 🔒 Check ownership
    let checkQuery = `SELECT * FROM courses WHERE id = $1`;
    let checkParams = [id];

    const courseResult = await pool.query(checkQuery, checkParams);
    const course = courseResult.rows[0];

    if (!course) {
      return res.status(404).send("Course not found.");
    }

    if (
      req.user.role === "instructor" &&
      course.instructor_id !== req.user.id
    ) {
      return res.status(403).send("You are not allowed to delete this course.");
    }

    // ✅ Delete course
    await pool.query("DELETE FROM courses WHERE id = $1", [id]);

    res.redirect("/admin/courses");
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error.");
  }
};

exports.downloadCurriculum = async (req, res) => {
  const courseId = req.params.id;

  const result = await pool.query(
    `SELECT title, curriculum_content FROM courses WHERE id = $1`,
    [courseId]
  );

  if (result.rows.length === 0) {
    return res.status(404).send("Course not found");
  }

  const course = result.rows[0];

  if (!course.curriculum_content) {
    return res.status(400).send("No curriculum available");
  }

  const infoResult = await pool.query(
    "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
  );
  const company = infoResult.rows[0] || {};

  const html = `
  <html>
    <head>
      <style>
        body {
          font-family: Arial, sans-serif;
          padding: 40px;
          line-height: 1.6;
        }
        h1 {
          text-align: center;
          margin-bottom: 30px;
        }
        .watermark {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          opacity: 0.06;
          z-index: 0;
          text-align: center;
        }
        .watermark h2 {
          font-size: 48px;
        }
        .content {
          position: relative;
          z-index: 2;
        }
        .footer {
          margin-top: 80px;
          font-size: 13px;
          text-align: center;
          color: #555;
        }
      </style>
    </head>

    <body>
      <div class="watermark">
        <img
          src="${company.logo_url || ""}"
          alt="${company.company_name || ""} Logo"
        />
        <h2>${company.company_name || ""}</h2>
      </div>


      <div class="content">
        <h1>${course.title} – Course Curriculum</h1>

        ${course.curriculum_content}

        <div class="footer">
          <hr />
          <p>Generated from JKT Academy</p>
        </div>
      </div>
    </body>
  </html>
  `;

  // const browser = await puppeteer.launch({
  //   headless: true,
  //   args: ["--no-sandbox", "--disable-setuid-sandbox"],
  // });

  // const page = await browser.newPage();
  // await page.setContent(html, { waitUntil: "networkidle0" });

  // const pdf = await page.pdf({
  //   format: "A4",
  //   printBackground: true,
  //   margin: {
  //     top: "1cm",
  //     bottom: "1cm",
  //     left: "1cm",
  //     right: "1cm",
  //   },
  // });

  // await browser.close();

  const pdf = await generatePdf(html);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${course.title.replace(/\s+/g, "_")}_Curriculum.pdf"`
  );

  res.send(pdf);
};

exports.showCoursesByPathway = async (req, res) => {
  const { id } = req.params;
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.redirect("/admin/login");
  }

  const infoResult = await pool.query(
    "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
  );
  const info = infoResult.rows[0] || {};

  const pathwayResult = await pool.query(
    "SELECT * FROM career_pathways WHERE id = $1",
    [id]
  );
  const pathway = pathwayResult.rows[0];

  const careerPathways = await pool.query(
    "SELECT id, title FROM career_pathways"
  );

  let coursesQuery = `
    SELECT * FROM courses 
    WHERE career_pathway_id = $1
  `;
  let params = [id];

  // ✅ Restrict instructors to their own courses
  if (req.user.role === "instructor") {
    coursesQuery += " AND instructor_id = $2";
    params.push(req.user.id);
  }

  coursesQuery += " ORDER BY level ASC, sort_order ASC";

  const coursesResult = await pool.query(coursesQuery, params);

  res.render("admin/pathwayCourses", {
    info,
    pathway,
    careerPathways: careerPathways.rows,
    courses: coursesResult.rows,
    role: req.session.user?.role || "admin",
  });
};

exports.createCourseUnderPathway = async (req, res) => {
  const { id } = req.params;
  const { title, description, level, sort_order } = req.body;

  let thumbnail_url = null;

  if (req.file) {
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: "courses",
    });
    thumbnail_url = result.secure_url;
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  }

  await pool.query(
    `INSERT INTO courses (
      title, description, level, career_pathway_id, thumbnail_url, sort_order, amount, created_by, instructor_id
   )
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      title,
      description,
      level,
      career_pathway_id || null,
      thumbnail_url,
      sort_order || 0,
      amount || 0,
      req.user.role === "instructor" ? "instructor" : "admin",
      req.user.role === "instructor" ? req.user.id : null,
    ]
  );

  res.redirect(`/admin/pathways/${id}/courses`);
};

exports.showBenefits = async (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.redirect("/admin/login");
  }
  const infoResult = await pool.query(
    "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
  );
  const info = infoResult.rows[0] || {};
  const benefitsResult = await pool.query(
    "SELECT * FROM benefits ORDER BY created_at DESC"
  );
  res.render("admin/benefits", {
    info,
    benefits: benefitsResult.rows,
    search: req.query.search || "",
    role: "admin",
    users: req.session.user,
  });
};

exports.createBenefit = async (req, res) => {
  console.log("Form Data:", req.body);
  console.log("Uploaded File:", req.file);
  const { title, description } = req.body;
  let icon = null;

  if (req.file) {
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: "benefits",
    });
    icon = result.secure_url;
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  }

  await pool.query(
    "INSERT INTO benefits (title, description, icon) VALUES ($1, $2, $3)",
    [title, description, icon]
  );
  await logActivityForUser(req, "Benefit created", `Benefit title: ${title}`);
  res.redirect("/admin/benefits");
};

exports.editBenefitForm = async (req, res) => {
  const id = req.params.id;
  const benefitResult = await pool.query(
    "SELECT * FROM benefits WHERE id = $1",
    [id]
  );
  const infoResult = await pool.query(
    "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
  );

  res.render("admin/editBenefit", {
    info: infoResult.rows[0] || {},
    benefit: benefitResult.rows[0],
  });
};

exports.updateBenefit = async (req, res) => {
  const id = req.params.id;
  const { title, description } = req.body;
  let icon;

  if (req.file) {
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: "benefits",
    });
    icon = result.secure_url;
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  }

  const benefit = await pool.query("SELECT * FROM benefits WHERE id = $1", [
    id,
  ]);
  const currentIcon = benefit.rows[0]?.icon;

  const query = icon
    ? "UPDATE benefits SET title = $1, description = $2, icon = $3 WHERE id = $4"
    : "UPDATE benefits SET title = $1, description = $2 WHERE id = $3";

  const params = icon
    ? [title, description, icon, id]
    : [title, description, id];

  await pool.query(query, params);
  res.redirect("/admin/benefits");
};

exports.deleteBenefit = async (req, res) => {
  const id = req.params.id;
  await pool.query("DELETE FROM benefits WHERE id = $1", [id]);
  res.redirect("/admin/benefits");
};

exports.createEvent = async (req, res) => {
  try {
    const show_on_homepage = req.body.show_on_homepage === "on";
    const is_paid = req.body.is_paid === "true" || req.body.is_paid === "on";
    const allow_split_payment = req.body.allow_split_payment === "on";

    const {
      title,
      description,
      event_date,
      time,
      location,
      amount,
      discount_amount,
      discount_deadline,
    } = req.body;

    let image_url = null;

    if (req.file) {
      const result = await cloudinary.uploader.upload(req.file.path, {
        folder: "events",
      });
      image_url = result.secure_url;
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    }

    await pool.query(
      `INSERT INTO events 
        (title, description, event_date, time, location, is_paid, amount, discount_amount, discount_deadline, allow_split_payment, image_url, show_on_homepage)
       VALUES 
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        title,
        description,
        event_date,
        time,
        location,
        is_paid,
        amount || 0,
        discount_amount || 0,
        discount_deadline || null,
        allow_split_payment,
        image_url,
        show_on_homepage,
      ]
    );
    await logActivityForUser(req, "Event created", `Event title: ${title}`);
    res.redirect("/admin/events");
  } catch (err) {
    console.error("Error creating event:", err.message);
    res.status(500).send("Server error while creating event");
  }
};

exports.viewEventRegistrations = async (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.redirect("/admin/login");
  }
  const eventId = req.params.id;
  const { search = "", page = 1 } = req.query;
  const limit = 10;
  const offset = (page - 1) * limit;

  try {
    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const info = infoResult.rows[0] || {};

    const eventResult = await pool.query("SELECT * FROM events WHERE id = $1", [
      eventId,
    ]);
    const event = eventResult.rows[0];
    if (!event) return res.status(404).send("Event not found");

    const searchQuery = `%${search}%`;

    // Get total count for pagination
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM event_registrations 
       WHERE event_id = $1 AND 
       (registrant_name ILIKE $2 OR registrant_email ILIKE $2)`,
      [eventId, searchQuery]
    );
    const total = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(total / limit);

    const registrationsResult = await pool.query(
      `SELECT * FROM event_registrations 
       WHERE event_id = $1 AND 
       (registrant_name ILIKE $2 OR registrant_email ILIKE $2)
       ORDER BY created_at DESC
       LIMIT $3 OFFSET $4`,
      [eventId, searchQuery, limit, offset]
    );

    res.render("admin/eventRegistrations", {
      info,
      event,
      registrations: registrationsResult.rows,
      currentPage: parseInt(page),
      totalPages,
      search,
      role: req.session.user?.role || "admin",
    });
  } catch (err) {
    console.error("Error loading registrations:", err.message);
    res.status(500).send("Server error");
  }
};

exports.showEvents = async (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.redirect("/admin/login");
  }
  try {
    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const eventsResult = await pool.query(
      "SELECT * FROM events ORDER BY event_date DESC"
    );

    res.render("admin/events", {
      info: infoResult.rows[0] || {},
      events: eventsResult.rows,
      event: {}, // default for create form
      formAction: "/admin/events/create",
      submitLabel: "Create Event",
      role: "admin",
      users: req.session.user,
    });
  } catch (err) {
    console.error("Error loading events:", err);
    res.status(500).send("Server error");
  }
};

exports.exportEventRegistrations = async (req, res) => {
  const eventId = req.params.id;

  try {
    const registrationsResult = await pool.query(
      `SELECT * FROM event_registrations WHERE event_id = $1`,
      [eventId]
    );

    const fields = [
      "registrant_name",
      "registrant_email",
      "registrant_phone",
      "is_parent",
      "child_name",
      "amount_paid",
      "payment_status",
      "created_at",
    ];
    const parser = new Parser({ fields });
    const csv = parser.parse(registrationsResult.rows);

    res.header("Content-Type", "text/csv");
    res.attachment("event_registrations.csv");
    return res.send(csv);
  } catch (err) {
    console.error("CSV Export Error:", err.message);
    res.status(500).send("Failed to export CSV.");
  }
};

// UPDATE EVENT
exports.updateEvent = async (req, res) => {
  try {
    const eventId = req.params.id;
    const show_on_homepage = req.body.show_on_homepage === "on";
    const is_paid = req.body.is_paid === "true" || req.body.is_paid === "on";
    const allow_split_payment = req.body.allow_split_payment === "on";

    const {
      title,
      description,
      event_date,
      time,
      location,
      amount,
      discount_amount,
      discount_deadline,
    } = req.body;

    let image_url = req.body.current_image || null;

    if (req.file) {
      const result = await cloudinary.uploader.upload(req.file.path, {
        folder: "events",
      });
      image_url = result.secure_url;
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    }

    await pool.query(
      `UPDATE events 
       SET title = $1, description = $2, event_date = $3, time = $4, location = $5, 
           is_paid = $6, amount = $7, discount_amount = $8, discount_deadline = $9, 
           allow_split_payment = $10, image_url = $11, show_on_homepage = $12
       WHERE id = $13`,
      [
        title,
        description,
        event_date,
        time,
        location,
        is_paid,
        amount || 0,
        discount_amount || 0,
        discount_deadline || null,
        allow_split_payment,
        image_url,
        show_on_homepage,
        eventId,
      ]
    );

    res.redirect("/admin/events");
  } catch (err) {
    console.error("Error updating event:", err.message);
    res.status(500).send("Server error while updating event");
  }
};

// DELETE EVENT
exports.deleteEvent = async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("DELETE FROM events WHERE id = $1", [id]);
    res.redirect("/admin/events");
  } catch (err) {
    console.error("❌ Error deleting event:", err.message);
    res.status(500).send("Server error");
  }
};

exports.listStudents = async (req, res) => {
  try {
    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const info = infoResult.rows[0];
    const users = await pool.query(
      `SELECT id, fullname, email, phone, gender, role, created_at, profile_picture
       FROM users2 WHERE role='user'
       ORDER BY created_at DESC`
    );
    const parentsRes = await pool.query(
      `
      SELECT
        id,
        fullname,
        email,
        phone,
        profile_picture,
        created_at
      FROM users2
      WHERE role='parent'
      ORDER BY created_at DESC
      `
    );
    res.render("admin/students", { users: users.rows, parents: parentsRes.rows, info });
  } catch (err) {
    console.error("List students error:", err.message);
    res.status(500).send("Failed to fetch students");
  }
};

exports.viewStudentDetails = async (req, res) => {
  
  try {
    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const info = infoResult.rows[0];
    const { id } = req.params;
    const studentRes = await pool.query(
      `SELECT id, fullname, email, phone, gender, dob, wallet_balance2, profile_picture, created_at
       FROM users2 WHERE id=$1`,
      [id]
    );
    if (studentRes.rows.length === 0)
      return res.status(404).send("Student not found");

    res.render("admin/studentDetails", { student: studentRes.rows[0], info });
  } catch (err) {
    console.error("View student details error:", err.message);
    res.status(500).send("Failed to fetch student");
  }
};

exports.viewStudentProgress = async (req, res) => {
  try {
    const { id } = req.params;

    const from =
      req.query.from ||
      (req.get("referer")?.includes("/parent") ? "parent" : "admin");

    // This route previously had no auth check at all. Rather than
    // retrofitting a full guard for every existing caller (admin, parent,
    // teacher/instructor links all point here), this only adds the new
    // case: a school_admin viewing this page must own the school the
    // target student actually belongs to, so one school admin can't page
    // through another school's students by guessing IDs.
    if (from === "school_admin") {
      if (!req.session.user || req.session.user.role !== "school_admin") {
        return res.status(403).send("Access denied");
      }
      const ownershipCheck = await pool.query(
        `SELECT 1
         FROM user_school us
         JOIN schools s ON s.id = us.school_id
         WHERE us.user_id = $1 AND s.created_by = $2 AND us.role_in_school = 'student'`,
        [id, req.session.user.id],
      );
      if (!ownershipCheck.rows.length) {
        return res.status(404).send("Student not found");
      }
    }

    // =========================
    // 1. COMPANY INFO
    // =========================
    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1",
    );
    const info = infoResult.rows[0];

    // =========================
    // 2. STUDENT
    // =========================
    const studentRes = await pool.query(
      `SELECT id, fullname, email, created_at FROM users2 WHERE id = $1`,
      [id],
    );

    if (!studentRes.rows.length)
      return res.status(404).send("Student not found");

    const student = studentRes.rows[0];

    // =========================
    // 3. COURSES
    // =========================
    const coursesRes = await pool.query(
      `
      SELECT DISTINCT
        c.id,
        c.title AS course_title,
        COALESCE(e.enrolled_at, cc.assigned_at) AS enrolled_at
      FROM courses c
      LEFT JOIN course_enrollments e 
        ON e.course_id = c.id AND e.user_id = $1
      LEFT JOIN classroom_courses cc 
        ON cc.course_id = c.id
      LEFT JOIN user_school us 
        ON us.classroom_id = cc.classroom_id AND us.user_id = $1
      WHERE e.user_id IS NOT NULL OR us.user_id IS NOT NULL
      ORDER BY c.title;
      `,
      [id],
    );

    // =========================
    // 4. MODULES
    // =========================
    const modulesRes = await pool.query(
      `
      SELECT 
        m.id,
        m.title AS module_title,
        m.course_id
      FROM modules m
      ORDER BY m.id;
      `,
    );

    // =========================
    // 5. LESSONS + PROGRESS
    // =========================
    const lessonsRes = await pool.query(
      `
      SELECT 
        l.id,
        l.title AS lesson_title,
        l.module_id,
        ulp.completed_at
      FROM lessons l
      LEFT JOIN user_lesson_progress ulp 
        ON ulp.lesson_id = l.id AND ulp.user_id = $1
      ORDER BY l.order_number;
      `,
      [id],
    );

    // =========================
    // 6. QUIZZES
    // =========================
    const quizzesRes = await pool.query(
      `
      SELECT 
        q.id,
        q.title,
        l.module_id,
        qs.score,
        qs.created_at AS taken_at,
        l.title AS lesson_title,
        qs.passed
      FROM quiz_submissions qs
      JOIN quizzes q ON qs.quiz_id = q.id
      JOIN lessons l ON q.lesson_id = l.id
      WHERE qs.student_id = $1
      ORDER BY qs.created_at DESC;
      `,
      [id],
    );

    // =========================
    // 7. ASSIGNMENTS
    // =========================
    const assignmentsRes = await pool.query(
      `
      SELECT 
        ma.id,
        ma.title,
        ma.module_id,
        s.total,
        s.grade,
        s.ai_feedback,
        s.created_at AS submitted_at
      FROM assignment_submissions s
      JOIN module_assignments ma ON s.assignment_id = ma.id
      WHERE s.student_id = $1
      ORDER BY s.created_at DESC;
      `,
      [id],
    );

    // ======================================================
    // GROUPING
    // ======================================================

    const lessonsByModule = new Map();
    lessonsRes.rows.forEach((l) => {
      if (!lessonsByModule.has(l.module_id))
        lessonsByModule.set(l.module_id, []);
      lessonsByModule.get(l.module_id).push(l);
    });

    const quizzesByModule = new Map();
    quizzesRes.rows.forEach((q) => {
      if (!quizzesByModule.has(q.module_id))
        quizzesByModule.set(q.module_id, []);
      quizzesByModule.get(q.module_id).push(q);
    });

    const assignmentsByModule = new Map();
    assignmentsRes.rows.forEach((a) => {
      if (!assignmentsByModule.has(a.module_id))
        assignmentsByModule.set(a.module_id, []);
      assignmentsByModule.get(a.module_id).push(a);
    });

    const modulesByCourse = new Map();
    modulesRes.rows.forEach((m) => {
      if (!modulesByCourse.has(m.course_id))
        modulesByCourse.set(m.course_id, []);
      modulesByCourse.get(m.course_id).push(m);
    });

    const lessonTimeMap = {}; // ✅ ADD THIS
    const activityRes = await pool.query(
      `
      SELECT action, details, created_at, duration_seconds
      FROM activities
      WHERE user_id = $1
      ORDER BY created_at ASC
      `,
      [id],
    );

    const logs = activityRes.rows;

    let totalLessonTime = 0;
    let totalAssignmentTime = 0;

    const lessonStart = {};
    const assignmentStart = {};

    // fallback calculation if duration is missing
    
    for (const log of logs) {
      const time = new Date(log.created_at);

      const match = log.details?.match(/\d+/);
      const lessonId = match ? Number(match[0]) : null;

      // =========================
      // LESSON START
      // =========================
      if (log.action === "Viewed Lesson" && lessonId) {
        lessonStart[lessonId] = time;
      }

      // =========================
      // LESSON END (QUIZ SUBMIT)
      // =========================
      if (log.action === "Student submitted Quiz" && lessonId) {
        if (lessonStart[lessonId]) {
          const duration = (time - lessonStart[lessonId]) / 1000;

          totalLessonTime += duration;

          lessonTimeMap[lessonId] = (lessonTimeMap[lessonId] || 0) + duration;

          delete lessonStart[lessonId];
        }
      }

      // =========================
      // ASSIGNMENT START
      // =========================
      if (log.action === "Viewed Assignment" && lessonId) {
        assignmentStart[lessonId] = time;
      }

      // =========================
      // ASSIGNMENT END
      // =========================
      if (log.action === "Submitted Assignment" && lessonId) {
        if (assignmentStart[lessonId]) {
          totalAssignmentTime += (time - assignmentStart[lessonId]) / 1000;

          delete assignmentStart[lessonId];
        }
      }
    }
    
    let lastLessonStart = null;
    let lastAssignmentStart = null;

    logs.forEach((log) => {
      const time = new Date(log.created_at);

      if (log.action === "Viewed Lesson") {
        lastLessonStart = time;
      }

      if (log.action === "Student submitted Quiz") {
        if (lastLessonStart) {
          totalLessonTime += (time - lastLessonStart) / 1000;
          lastLessonStart = null;
        }
      }

      if (log.action === "Viewed Assignment") {
        lastAssignmentStart = time;
      }

      if (log.action === "Submitted Assignment") {
        if (lastAssignmentStart) {
          totalAssignmentTime += (time - lastAssignmentStart) / 1000;
          lastAssignmentStart = null;
        }
      }
    });

    // ========================
    // COURSE STRUCTURE
    // ========================
    const courses = coursesRes.rows.map((course) => {
      const modules = modulesByCourse.get(course.id) || [];

      const enrichedModules = modules.map((module) => {
        // const moduleLessons = lessonsByModule.get(module.id) || [];
        const rawLessons = lessonsByModule.get(module.id) || [];

        const moduleLessons = rawLessons.map((l) => {
          const seconds = lessonTimeMap[l.id] || 0;

          return {
            ...l,
            timeSpent: formatTimeReadable(seconds),
            rawTime: seconds,
          };
        });

        // ✅ calculate module total time AFTER mapping
        const moduleTimeSeconds = moduleLessons.reduce(
          (sum, l) => sum + (l.rawTime || 0),
          0,
        );

        const moduleTime = formatTimeReadable(moduleTimeSeconds);
        const moduleQuizzes = quizzesByModule.get(module.id) || [];
        const moduleAssignments = assignmentsByModule.get(module.id) || [];

        const totalLessons = moduleLessons.length;
        const completedLessons = moduleLessons.filter(
          (l) => l.completed_at,
        ).length;

        const percent = totalLessons
          ? Math.round((completedLessons / totalLessons) * 100)
          : 0;

        const quizAvg = moduleQuizzes.length
          ? Math.round(
              moduleQuizzes.reduce((a, b) => a + b.score, 0) /
                moduleQuizzes.length,
            )
          : null;

        const assignmentAvg = moduleAssignments.length
          ? Math.round(
              moduleAssignments.reduce((a, b) => a + (b.total || 0), 0) /
                moduleAssignments.length,
            )
          : null;

        return {
          ...module,
          lessons: moduleLessons,
          quizzes: moduleQuizzes,
          assignments: moduleAssignments,
          totalLessons,
          completedLessons,
          percent,
          quizAvg,
          assignmentAvg,
          moduleTime,
        };
      });

      const totalLessons = enrichedModules.reduce(
        (a, b) => a + b.totalLessons,
        0,
      );

      const completedLessons = enrichedModules.reduce(
        (a, b) => a + b.completedLessons,
        0,
      );

      const percent = totalLessons
        ? Math.round((completedLessons / totalLessons) * 100)
        : 0;

      return {
        ...course,
        modules: enrichedModules,
        totalLessons,
        completedLessons,
        percent,
      };
    });

    // =========================
    // QUIZ + ASSIGNMENT METRICS
    // =========================
    const allQuizzes = quizzesRes.rows;
    const allAssignments = assignmentsRes.rows;

    const quizAvg = allQuizzes.length
      ? Math.round(
          allQuizzes.reduce((a, b) => a + b.score, 0) / allQuizzes.length,
        )
      : null;

    const assignmentAvg = allAssignments.length
      ? Math.round(
          allAssignments.reduce((a, b) => a + (b.total || 0), 0) /
            allAssignments.length,
        )
      : null;
    // =========================
    // ENGAGEMENT (FIXED LOGIC)
    // =========================

    // function formatTime(seconds) {
    //   const sec = Math.floor(seconds % 60);
    //   const min = Math.floor((seconds / 60) % 60);
    //   const hr = Math.floor(seconds / 3600);

    //   return {
    //     seconds: sec,
    //     minutes: min,
    //     hours: hr,
    //     totalHours: +(seconds / 3600).toFixed(2),
    //   };
    // }

    function formatTimeReadable(seconds) {
      const sec = Math.floor(seconds % 60);
      const min = Math.floor((seconds / 60) % 60);
      const hr = Math.floor(seconds / 3600);

      let result = "";

      if (hr > 0) result += `${hr}hr `;
      if (min > 0) result += `${min}min `;
      if (sec > 0 || result === "") result += `${sec}sec`;

      return result.trim();
    }

    function formatDuration(startDate) {
      const now = new Date();
      const start = new Date(startDate);

      const diffMs = now - start;

      const seconds = Math.floor(diffMs / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);
      const weeks = Math.floor(days / 7);
      const months = Math.floor(days / 30);
      const years = Math.floor(days / 365);

      return {
        seconds,
        minutes,
        hours,
        days,
        weeks,
        months,
        years,
        readable:
          years > 0
            ? `${years} year(s)`
            : months > 0
              ? `${months} month(s)`
              : weeks > 0
                ? `${weeks} week(s)`
                : days > 0
                  ? `${days} day(s)`
                  : hours > 0
                    ? `${hours} hour(s)`
                    : `${minutes} minute(s)`,
      };
    }

    const membershipDuration = formatDuration(student.created_at);

    // engagement summary
    const engagementRes = await pool.query(
      `
      SELECT COUNT(*) AS total_activities,
            MAX(created_at) AS last_active
      FROM activities
      WHERE user_id = $1
      `,
      [id],
    );

    const engagementBase = engagementRes.rows[0];

    const loginFrequencyRes = await pool.query(
      `
      SELECT COUNT(DISTINCT DATE(created_at)) AS active_days
      FROM activities
      WHERE user_id = $1
        AND created_at > NOW() - INTERVAL '7 days'
      `,
      [id],
    );

    async function getActiveDaysWithDates(userId, interval = null) {
      let query = `
        SELECT 
          DATE(created_at) AS date,
          COUNT(*) AS count
        FROM activities
        WHERE user_id = $1
      `;

      const params = [userId];

      if (interval) {
        query += ` AND created_at > NOW() - INTERVAL '${interval}'`;
      }

      query += `
        GROUP BY DATE(created_at)
        ORDER BY date DESC
      `;

      const result = await pool.query(query, params);

      return result.rows.map((r) => ({
        date: r.date.toISOString().split("T")[0],
        count: Number(r.count),
      }));
    }

    const activeDaysWeek = await getActiveDaysWithDates(id, "7 days");
    const activeDaysMonth = await getActiveDaysWithDates(id, "1 month");
    const activeDaysYear = await getActiveDaysWithDates(id, "1 year");
    const activeDaysAll = await getActiveDaysWithDates(id, null);

    const totalTime = totalLessonTime + totalAssignmentTime;

    const consistencyBase = (activeDaysWeek + activeDaysMonth) / 2;

    function summarizeDays(data) {
      return {
        count: data.length,
        dates: data,
      };
    }

    const engagement = {
      totalActivities: Number(engagementBase.total_activities || 0),

      lessonTime: formatTimeReadable(totalLessonTime),
      assignmentTime: formatTimeReadable(totalAssignmentTime),

      totalTimeSpent: formatTimeReadable(totalTime),

      lastActive: engagementBase.last_active || null,

      activeDays: {
        week: summarizeDays(activeDaysWeek),
        month: summarizeDays(activeDaysMonth),
        year: summarizeDays(activeDaysYear),
        all: summarizeDays(activeDaysAll),
      },

      consistencyScore: Math.min(
        100,
        ((activeDaysWeek.length + activeDaysMonth.length) / 2) * 15,
      ),
    };

    const quizScores = allQuizzes.map((q) => q.score);
    const assignmentScores = allAssignments.map((a) => a.total || 0);

    const quizAvgMetric = quizScores.length
      ? Math.round(quizScores.reduce((a, b) => a + b, 0) / quizScores.length)
      : 0;

    const assignmentAvgMetric = assignmentScores.length
      ? Math.round(
          assignmentScores.reduce((a, b) => a + b, 0) / assignmentScores.length,
        )
      : 0;

    const passRate = allQuizzes.length
      ? Math.round(
          (allQuizzes.filter((q) => q.passed).length / allQuizzes.length) * 100,
        )
      : 0;

    // =========================
    // PROGRESS
    // =========================
    const totalLessonsCount = courses.reduce((a, c) => a + c.totalLessons, 0);
    const completedLessonsCount = courses.reduce(
      (a, c) => a + c.completedLessons,
      0,
    );

    const progressPercent = totalLessonsCount
      ? Math.round((completedLessonsCount / totalLessonsCount) * 100)
      : 0;

    // =========================
    // BEHAVIOR
    // =========================
    const inactivityDays = engagement.lastActive
      ? Math.floor(
          (Date.now() - new Date(engagement.lastActive)) /
            (1000 * 60 * 60 * 24),
        )
      : 999;

    const isInactive = inactivityDays > 3;

    // =========================
    // MASTERY
    // =========================
    const masteryScore = Math.round(
      quizAvgMetric * 0.5 + assignmentAvgMetric * 0.3 + passRate * 0.2,
    );

    // =========================
    // RISK
    // =========================
    const riskFlags = [];

    if (quizAvgMetric < 50) riskFlags.push("Low quiz performance");
    if (assignmentAvgMetric < 50) riskFlags.push("Low assignment performance");
    if (isInactive) riskFlags.push("Inactive student");
    if (progressPercent < 30) riskFlags.push("Low progress");

    const riskLevel =
      riskFlags.length >= 3
        ? "High Risk"
        : riskFlags.length === 2
          ? "Medium Risk"
          : riskFlags.length === 1
            ? "Low Risk"
            : "Healthy";

    // =========================
    // PLATFORM SCORE
    // =========================
    const platformScore = Math.round(
      progressPercent * 0.25 +
        quizAvgMetric * 0.2 +
        assignmentAvgMetric * 0.15 +
        engagement.consistencyScore * 0.15 +
        masteryScore * 0.25,
    );

    // =========================
    // FINAL METRICS
    // =========================
    const metrics = {
      engagement,
      performance: {
        quizAvg: quizAvgMetric,
        assignmentAvg: assignmentAvgMetric,
        passRate,
      },
      progress: {
        totalLessons: totalLessonsCount,
        completedLessons: completedLessonsCount,
        progressPercent,
      },
      completion: {
        completionRate: progressPercent,
        assignmentSubmissionRate: allAssignments.length,
      },
      mastery: {
        masteryScore,
      },
      behavior: {
        inactivityDays,
        isInactive,
      },
      risk: {
        riskLevel,
        flags: riskFlags,
      },
      overall: {
        platformScore,
      },
    };

    res.render("admin/studentProgress", {
      student,
      courses,
      quizzes: allQuizzes,
      assignments: allAssignments,
      quizAvg,
      assignmentAvg,
      info,
      from,
      metrics,
      membershipDuration,
    });
  } catch (err) {
    console.error("View student progress error:", err.message);
    res.status(500).send("Failed to fetch progress");
  }
};

exports.viewStudentEnrollments = async (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.redirect("/admin/login");
  }

  try {
    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const info = infoResult.rows[0];
    const { id } = req.params;
    const courses = await pool.query(
      `SELECT c.title, e.enrolled_at
       FROM course_enrollments e
       JOIN courses c ON e.course_id = c.id
       WHERE e.user_id = $1
       ORDER BY e.enrolled_at DESC`,
      [id]
    );

    res.render("admin/studentEnrollments", {
      courses: courses.rows,
      info,
      role: "admin",
    });
  } catch (err) {
    console.error("View student enrollments error:", err.message);
    res.status(500).send("Failed to fetch enrollments");
  }
};

exports.assignChildToParent = async (req, res) => {
  const { parentEmail, childEmail } = req.body;

  try {

    // ✅ Find parent by EMAIL
    const parentRes = await pool.query(
      `SELECT id, fullname, email
       FROM users2
       WHERE LOWER(email) = LOWER($1)
       AND role = 'parent'`,
      [parentEmail]
    );

    if (parentRes.rows.length === 0) {
      return res.status(404).send("Parent not found");
    }

    // ✅ Find child by EMAIL
    const childRes = await pool.query(
      `SELECT id, fullname, email
       FROM users2
       WHERE LOWER(email) = LOWER($1)
       AND role = 'user'`,
      [childEmail]
    );

    if (childRes.rows.length === 0) {
      return res.status(404).send("Child not found");
    }

    const parent = parentRes.rows[0];
    const child = childRes.rows[0];

    // ✅ Insert relationship
    await pool.query(
      `INSERT INTO parent_children (parent_id, child_id)
       VALUES ($1, $2)
       ON CONFLICT (parent_id, child_id) DO NOTHING`,
      [parent.id, child.id]
    );

    // res.redirect(`/admin/parents/${parent.id}/children`);
    res.redirect(`/admin/students`);

  } catch (err) {
    console.error("Assign child error:", err);
    res.status(500).send("Server error");
  }
}; 

exports.searchUsers = async (req, res) => {
  try {
    const { q, role } = req.query;

    if (!q) {
      return res.json([]);
    }

    const result = await pool.query(
      `
      SELECT
        id,
        fullname,
        email,
        role
      FROM users2
      WHERE role = $1
      AND (
        fullname ILIKE $2
        OR email ILIKE $2
      )
      ORDER BY fullname ASC
      LIMIT 10
      `,
      [role, `%${q}%`],
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json([]);
  }
};

function calculateGrade(score) {
  if (score >= 85) return "A (Excellent)";
  if (score >= 75) return "B (Very Good)";
  if (score >= 65) return "C (Good)";
  if (score >= 50) return "D (Pass)";
  return "F (Needs Improvement)";
}


  exports.downloadCourseSummary = async (req, res) => {
    const { studentId, courseId } = req.params;

    try {
      function formatTimeReadable(seconds) {
        const sec = Math.floor(seconds % 60);
        const min = Math.floor((seconds / 60) % 60);
        const hr = Math.floor(seconds / 3600);

        let result = "";

        if (hr > 0) result += `${hr}hr `;
        if (min > 0) result += `${min}min `;
        if (sec > 0 || result === "") result += `${sec}sec`;

        return result.trim();
      }
      /* ==========================
        FETCH CORE DATA
      ========================== */

      const studentRes = await pool.query(
        `SELECT fullname, email, created_at
        FROM users2 WHERE id = $1`,
        [studentId],
      );
      const student = studentRes.rows[0];

      const courseRes = await pool.query(
        `SELECT id, title, created_at
        FROM courses WHERE id = $1`,
        [courseId],
      );
      const course = courseRes.rows[0];

      const modulesRes = await pool.query(
        `SELECT id, title
        FROM modules
        WHERE course_id = $1
        ORDER BY id`,
        [courseId],
      );
      const modules = modulesRes.rows;

      const lessonsRes = await pool.query(
        `SELECT l.id, l.title, l.module_id,
                ulp.completed_at
        FROM lessons l
        JOIN modules m ON l.module_id = m.id
        LEFT JOIN user_lesson_progress ulp
          ON ulp.lesson_id = l.id
          AND ulp.user_id = $1
        WHERE m.course_id = $2
        ORDER BY l.id`,
        [studentId, courseId],
      );
      // const lessons = lessonsRes.rows;

      const lessonTimeMap = {};

      const activityRes = await pool.query(
        `
        SELECT action, details, created_at
        FROM activities
        WHERE user_id = $1
        ORDER BY created_at ASC
        `,
        [studentId],
      );

      const lessonStart = {};

      for (const log of activityRes.rows) {
        const time = new Date(log.created_at);

        const match = log.details?.match(/\d+/);
        const lessonId = match ? Number(match[0]) : null;

        if (log.action === "Viewed Lesson" && lessonId) {
          lessonStart[lessonId] = time;
        }

        if (log.action === "Student submitted Quiz" && lessonId) {
          if (lessonStart[lessonId]) {
            const duration = (time - lessonStart[lessonId]) / 1000;

            lessonTimeMap[lessonId] = (lessonTimeMap[lessonId] || 0) + duration;

            delete lessonStart[lessonId];
          }
        }
      }
      const lessons = lessonsRes.rows.map((l) => ({
        ...l,
        timeSpent: "0sec",
      }));
      lessons.forEach((l) => {
        l.timeSpent = formatTimeReadable(lessonTimeMap[l.id] || 0);
      });

      const quizzesRes = await pool.query(
        `
    SELECT
        q.id,
        q.title AS quiz_title,
        l.title AS lesson_title,
        l.module_id,
        qs.score,
        qs.created_at AS taken_at
    FROM quizzes q
    JOIN lessons l ON q.lesson_id = l.id
    JOIN modules m ON l.module_id = m.id
    LEFT JOIN quiz_submissions qs
        ON qs.quiz_id = q.id
        AND qs.student_id = $1
    WHERE m.course_id = $2
    ORDER BY q.id
    `,
        [studentId, courseId], // ✅ CORRECT
      );

      const quizzes = quizzesRes.rows;

      const assignmentsRes = await pool.query(
        `SELECT ma.id, ma.title, ma.module_id,
                s.total, s.grade, s.ai_feedback,
                s.created_at AS submitted_at
        FROM module_assignments ma
        JOIN modules m ON ma.module_id = m.id
        LEFT JOIN assignment_submissions s
          ON s.assignment_id = ma.id
          AND s.student_id = $1
        WHERE m.course_id = $2
        ORDER BY ma.id`,
        [studentId, courseId],
      );
      const assignments = assignmentsRes.rows;

      const badgesRes = await pool.query(
        `SELECT 
            ub.id,
            ub.badge_name,
            ub.badge_image,
            ub.awarded_at,
            m.title AS module_title
        FROM user_badges ub
        JOIN modules m ON ub.module_id = m.id
        WHERE ub.user_id = $1
        AND m.course_id = $2
        ORDER BY ub.awarded_at`,
        [studentId, courseId],
      );

      const badges = badgesRes.rows;
      const totalBadges = badges.length;

      /* ==========================
        MODULE TIME CALCULATION
      ========================== */

      const moduleTimeMap = {};

      modules.forEach((module) => {
        const moduleLessons = lessons.filter((l) => l.module_id === module.id);

        const totalSeconds = moduleLessons.reduce(
          (sum, lesson) => sum + (lessonTimeMap[lesson.id] || 0),
          0,
        );

        moduleTimeMap[module.id] = {
          seconds: totalSeconds,
          formatted: formatTimeReadable(totalSeconds),
        };
      });

      /* ==========================
        MODULE PERFORMANCE MAP
      ========================== */

      const modulePerformanceMap = {};

      modules.forEach((module) => {
        const moduleLessons = lessons.filter((l) => l.module_id === module.id);

        const moduleQuizzes = quizzes.filter((q) => q.module_id === module.id);

        const moduleAssignments = assignments.filter(
          (a) => a.module_id === module.id,
        );

        /* Lesson Completion */

        const moduleCompletedLessons = moduleLessons.filter(
          (l) => l.completed_at,
        ).length;

        const moduleCompletionPercent = moduleLessons.length
          ? Math.round((moduleCompletedLessons / moduleLessons.length) * 100)
          : 0;

        /* Quiz Average */

        const moduleQuizScores = moduleQuizzes
          .filter((q) => q.score !== null)
          .map((q) => q.score);

        const moduleQuizAvg = moduleQuizScores.length
          ? Math.round(
              moduleQuizScores.reduce((a, b) => a + b, 0) /
                moduleQuizScores.length,
            )
          : 0;

        /* Assignment Average */

        const moduleAssignmentScores = moduleAssignments
          .filter((a) => a.total !== null)
          .map((a) => a.total);

        const moduleAssignmentAvg = moduleAssignmentScores.length
          ? Math.round(
              moduleAssignmentScores.reduce((a, b) => a + b, 0) /
                moduleAssignmentScores.length,
            )
          : 0;

        /* Smart Module Score */

        let moduleParts = [];
        let moduleTotal = 0;

        moduleParts.push(moduleCompletionPercent);
        moduleTotal += moduleCompletionPercent;

        if (moduleQuizzes.length > 0) {
          moduleParts.push(moduleQuizAvg);
          moduleTotal += moduleQuizAvg;
        }

        if (moduleAssignments.length > 0) {
          moduleParts.push(moduleAssignmentAvg);
          moduleTotal += moduleAssignmentAvg;
        }

        const moduleScore = moduleParts.length
          ? Math.round(moduleTotal / moduleParts.length)
          : 0;

        /* Module Grade */

        let moduleGrade = "F";

        if (moduleScore >= 80) moduleGrade = "A";
        else if (moduleScore >= 70) moduleGrade = "B";
        else if (moduleScore >= 60) moduleGrade = "C";
        else if (moduleScore >= 50) moduleGrade = "D";

        /* Consistency */

        let consistencyComment = "No completion data.";

        const completionDates = moduleLessons
          .filter((l) => l.completed_at)
          .map((l) => new Date(l.completed_at))
          .sort((a, b) => a - b);

        if (completionDates.length > 1) {
          const first = completionDates[0];
          const last = completionDates[completionDates.length - 1];

          const daysDiff = Math.ceil((last - first) / (1000 * 60 * 60 * 24));

          if (daysDiff <= 7) {
            consistencyComment = "Excellent completion consistency.";
          } else if (daysDiff <= 30) {
            consistencyComment = "Moderate completion consistency.";
          } else {
            consistencyComment =
              "Completion interval is wide. Improvement recommended.";
          }
        }

        modulePerformanceMap[module.id] = {
          completionPercent: moduleCompletionPercent,
          quizAvg: moduleQuizAvg,
          assignmentAvg: moduleAssignmentAvg,
          moduleScore,
          moduleGrade,
          consistencyComment,
        };
      });

      const certRes = await pool.query(
        `SELECT certificate_url, certificate_code, issued_at
        FROM user_certificates
        WHERE user_id = $1
        AND course_id = $2
        LIMIT 1`,
        [studentId, courseId],
      );

      const certificate = certRes.rows[0] || null;

      const infoResult = await pool.query(
        "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
      );
      const company = infoResult.rows[0] || {};

      const COMPANY_LOGO = company.logo_url || "";

      /* ==========================
        CHECK IF STUDENT BELONGS TO A SCHOOL
      ========================== */

      const schoolRes = await pool.query(
        `SELECT s.name, s.logo_url
    FROM user_school us
    JOIN schools s ON us.school_id = s.id
    WHERE us.user_id = $1
    AND us.approved = true
    LIMIT 1`,
        [studentId],
      );

      const school = schoolRes.rows[0] || null;

      /* ==========================
        GLOBAL STATISTICS
      ========================== */

      const totalModules = modules.length;
      const totalLessons = lessons.length;
      const totalQuizzes = quizzes.length;
      const totalAssignments = assignments.length;

      const completedLessons = lessons.filter((l) => l.completed_at).length;
      const lessonPercent = totalLessons
        ? Math.round((completedLessons / totalLessons) * 100)
        : 0;

      const quizScores = quizzes
        .filter((q) => q.score !== null)
        .map((q) => q.score);
      const quizAvg = quizScores.length
        ? Math.round(quizScores.reduce((a, b) => a + b, 0) / quizScores.length)
        : 0;

      const assignmentScores = assignments
        .filter((a) => a.total !== null)
        .map((a) => a.total);

      const assignmentAvg = assignmentScores.length
        ? Math.round(
            assignmentScores.reduce((a, b) => a + b, 0) /
              assignmentScores.length,
          )
        : 0;

      /* ==========================
    SMART COURSE GRADE CALCULATION
  ========================== */

      let gradingParts = [];
      let gradingTotal = 0;

      // Always include lesson completion
      gradingParts.push(lessonPercent);
      gradingTotal += lessonPercent;

      // Always include quiz average
      gradingParts.push(quizAvg);
      gradingTotal += quizAvg;

      // Include assignments ONLY if they exist
      const hasAssignments = assignments.length > 0;

      if (hasAssignments) {
        gradingParts.push(assignmentAvg);
        gradingTotal += assignmentAvg;
      }

      let overallScore = gradingParts.length
        ? Math.round(gradingTotal / gradingParts.length)
        : 0;

      let courseGrade = "F";
      if (overallScore >= 80) courseGrade = "A";
      else if (overallScore >= 70) courseGrade = "B";
      else if (overallScore >= 60) courseGrade = "C";
      else if (overallScore >= 50) courseGrade = "D";

      /* ==========================
    LESSON COMPLETION INTERVAL CHECK
  ========================== */

      let consistencyComment = "";
      const completionDates = lessons
        .filter((l) => l.completed_at)
        .map((l) => new Date(l.completed_at))
        .sort((a, b) => a - b);

      if (completionDates.length > 1) {
        const first = completionDates[0];
        const last = completionDates[completionDates.length - 1];
        const daysDiff = Math.ceil((last - first) / (1000 * 60 * 60 * 24));

        if (daysDiff <= 7) {
          consistencyComment =
            "Excellent learning consistency. Lessons completed within a short time frame.";
        } else if (daysDiff <= 30) {
          consistencyComment = "Moderate learning pace with steady progress.";
        } else {
          consistencyComment =
            "Lessons were completed over a long interval. Improved consistency is recommended.";
        }
      }

      /* ==========================
        PROFESSIONAL COMMENT
      ========================== */

      let evaluation = "";

      if (overallScore >= 80) {
        evaluation =
          "Outstanding academic performance with strong mastery of course materials and excellent engagement.";
      } else if (overallScore >= 70) {
        evaluation =
          "Very good academic standing with consistent engagement and solid assessment performance.";
      } else if (overallScore >= 60) {
        evaluation =
          "Satisfactory performance. Greater focus on quizzes and lesson consistency is recommended.";
      } else {
        evaluation =
          "Performance is below expectations. Increased participation and assessment improvement is strongly advised.";
      }

      evaluation += `<br/><br/><strong>Consistency Analysis:</strong> ${consistencyComment}`;

      /* ==========================
        BUILD BEAUTIFUL HTML
      ========================== */

      const html = `
  <!DOCTYPE html>
  <html>
  <head>
  <meta charset="utf-8">
  <title>Detailed Course Report</title>

  <link rel="stylesheet"
  href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css"/>

  <style>
  body { 
    font-family: Arial; 
    padding:40px; 
    background:#f4f6f9; 
    color:#2c3e50; 
  }

  /* WATERMARK */
  body::before {
    content: "";
    position: fixed;
    top: 30%;
    left: 20%;
    width: 60%;
    height: 60%;
    background-image: url('${COMPANY_LOGO}');
    background-repeat: no-repeat;
    background-size: contain;
    opacity: 0.05;
    z-index: 0;
  }

  /* CONTENT ABOVE WATERMARK */
  body > * {
    position: relative;
    z-index: 2;
  }


  /* HEADER */
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 30px;
  }

  .school-info {
    text-align: right;
  }

  .school-logo {
    max-height: 60px;
  }

  /* FOOTER */
  .footer {
    position: fixed;
    bottom: 10px;
    left: 0;
    right: 0;
    text-align: center;
    font-size: 11px;
    color: #666;
  }

  h1 { 
    text-align:center; 
    color:#1e2a38; 
  }

  .section { 
    margin-top:40px; 
  }

  .grid { 
    display:grid; 
    grid-template-columns:repeat(4,1fr); 
    gap:20px; 
    margin-top:20px; 
  }

  .card {
    background:white;
    padding:20px;
    border-radius:10px;
    box-shadow:0 4px 10px rgba(0,0,0,0.08);
    text-align:center;
  }

  .card-info {
    background:white;
    padding:20px;
    border-radius:10px;
    text-align:Left;
    box-shadow:0 4px 10px rgba(0,0,0,0.08);
  }

  .card h2 { margin:10px 0; }

  table {
    width:100%;
    border-collapse:collapse;
    margin-top:15px;
    background:white;
    font-size:12px;
  }

  th {
    background:#1e2a38;
    color:white;
    padding:8px;
    text-align:left;
  }

  td {
    padding:8px;
    border:1px solid #ddd;
  }

  tr:nth-child(even) { background:#f9f9f9; }

  .module-block {
    page-break-inside: avoid;
    margin-top:40px;
  }

  .page-break {
    page-break-after: always;
  }

  .comment-box {
    background:white;
    padding:20px;
    border-left:6px solid #2980b9;
    margin-top:20px;
  }

  .footer {
    margin-top:40px;
    text-align:center;
    font-size:11px;
    color:#888;
  }
  </style>
  </head>

  <body>
  <div class="header">
    <div>
      <h2>Student Course Report</h2>
    </div>

    ${
      school
        ? `
    <div class="school-info">
      <strong>${school.name}</strong><br/>
      ${school.logo_url ? `<img src="${school.logo_url}" class="school-logo"/>` : ""}
    </div>
    `
        : ""
    }
  </div>


  <h1><i class="fa-solid fa-graduation-cap"></i> Detailed Student Course Report</h1>
  <p style="text-align:center;">Generated: ${new Date().toLocaleString()}</p>

  <div class="card-info">
    <p><strong>Student:</strong> ${student.fullname}</p><br/>
    <p><strong>Email:</strong> ${student.email}</p><br/>
    <p><strong>Course:</strong> ${course.title}</p><br/>
    <p>
  </div>

  <div class="section grid">
    <div class="card">
      <i style="color: #3498db;" class="fa-solid fa-layer-group fa-2x"></i>
      <h2>${totalModules}</h2>
      <p>Total Modules</p>
    </div>
    <div class="card">
      <i style="color: #27ae60;" class="fa-solid fa-book fa-2x"></i>
      <h2>${totalLessons}</h2>
      <p>Total Lessons</p>
    </div>
    <div class="card">
      <i style="color: #f39c12;" class="fa-solid fa-clipboard-check fa-2x"></i>
      <h2>${totalQuizzes}</h2>
      <p>Total Quizzes</p>
    </div>
    <div class="card">
      <i style="color: #e74c3c;" class="fa-solid fa-pen-to-square fa-2x"></i>
      <h2>${totalAssignments}</h2>
      <p>Total Assignments</p>
    </div>
    
  </div>

  <div class="section grid">
    <div style="color: #3498db;" class="card"><h2>${lessonPercent}%</h2><p>Completion</p></div>
    <div style="color: #27ae60;" class="card"><h2>${quizAvg}%</h2><p>Quiz Average</p></div>
    ${
      hasAssignments
        ? `
    <div style="color: #f39c12;" class="card">
      <h2>${assignmentAvg}%</h2>
      <p>Assignment Average</p>
    </div>`
        : ""
    }

    <div style="color: #f39c12;;" class="card">
      <h2>${overallScore}%</h2>
      <p>Course Score</p>
    </div>

    <div style="color: #ceba05;" class="card"><h2>${courseGrade}</h2><p>Course Grade</p></div>

    <div class="card">
      <i style="color: #9b59b6;" class="fa-solid fa-award fa-2x"></i>
      <h2>${totalBadges}</h2>
      <p>Badges Earned</p>
    </div>
  </div>

  <div class="section">
    <h2>🏅 Course Badges Earned</h2>

    ${
      badges.length === 0
        ? `
    <p>No badges earned yet.</p>
    `
        : `
    <div style="display:grid; grid-template-columns:repeat(2,1fr); gap:20px; margin-top:20px;">
    ${badges
      .map(
        (b) => `
      <div style="background:white;padding:15px;border-radius:10px;text-align:center;box-shadow:0 4px 10px rgba(0,0,0,0.08);">
        
        ${
          b.badge_image
            ? `
          <img src="${b.badge_image}" 
              style="width:200px;height:200px;object-fit:contain;margin-bottom:10px;">
        `
            : ""
        }
          <hr><br>
        <small>Awarded: ${new Date(b.awarded_at).toLocaleDateString()}</small>

      </div>
    `,
      )
      .join("")}
    </div>
    `
    }
  </div>

  <div class="section">
    <h2>🎓 Course Certificate</h2>

    ${
      certificate
        ? `
    <div style="background:white;padding:20px;border-radius:10px;text-align:center;box-shadow:0 4px 10px rgba(0,0,0,0.08);">

      <img src="${certificate.certificate_url}" 
          style="max-width:100%; margin-bottom:20px; border:1px solid #ddd;"/>

      <p><strong>Certificate Code:</strong> ${certificate.certificate_code}</p>
      <p><strong>Issued:</strong> ${new Date(certificate.issued_at).toLocaleDateString()}</p>

    </div>
    `
        : `
    <p>No certificate issued yet.</p>
    `
    }

  </div>

  <div class="section">
    <h2>Performance Evaluation</h2>

    <div class="card" style="margin-bottom:20px;">
      <h2>${overallScore}%</h2>
      <p>Overall Course Score</p>
    </div>

    <div class="comment-box">
      ${evaluation}
    </div>
  </div>

  ${modules
    .map(
      (m) => `
  <div class="module-block">
  <h2>📦 Module: ${m.title}</h2>

  <div class="section grid">

    <div class="card" style="background-color: #bb1188; color: #ffffff">
      <h2>${modulePerformanceMap[m.id].completionPercent}%</h2>
      <p>Completion</p>
    </div>

    <div class="card" style="background-color: #280dc2; color: #ffffff">
      <h2>${modulePerformanceMap[m.id].quizAvg}%</h2>
      <p>Quiz Average</p>
    </div>

    ${
      assignments.some((a) => a.module_id === m.id)
        ? `
        <div class="card">
          <h2>${modulePerformanceMap[m.id].assignmentAvg}%</h2>
          <p>Assignment Average</p>
        </div>
        `
        : ""
    }

    <div class="card" style="background-color: #c20d86; color: #ffffff">
      <h2>${modulePerformanceMap[m.id].moduleScore}%</h2>
      <p>Module Score</p>
    </div>

    <div class="card" style="background-color: #11b447; color: #ffffff">
      <h2>${modulePerformanceMap[m.id].moduleGrade}</h2>
      <p>Module Grade</p>
    </div>
    <div class="card" style="background-color: #743b07; color: #ffffff">
      <h2>${moduleTimeMap[m.id].formatted}</h2>
      <p>Total Learning Time</p>
    </div>
  </div>

  

  <div class="comment-box">
    <strong>Consistency Analysis:</strong>
    ${modulePerformanceMap[m.id].consistencyComment}
  </div>

  <h3>📚 Lessons</h3>
  <table>
  <tr><th>Lesson</th><th>Status</th><th>Time Spent</th><th>Completion Date</th></tr>
  ${lessons
    .filter((l) => l.module_id === m.id)
    .map(
      (l) => `
  <tr>
  <td>${l.title}</td>
  <td style="color: ${l.completed_at ? "#27ae60" : "#e74c3c"};">
    ${l.completed_at ? "Completed" : "Not Completed"}
  </td>
  <td>${l.timeSpent}</td>
  <td>${l.completed_at ? new Date(l.completed_at).toLocaleDateString() : "-"}</td>
  </tr>`,
    )
    .join("")}
  </table>

  <h3>📝 Quizzes</h3>
  <table>
  <tr><th>lesson</th><th>Quiz</th><th>Score</th><th>Date Taken</th></tr>
  ${quizzes
    .filter((q) => q.module_id === m.id)
    .map(
      (q) => `
  <tr>
  <td>${q.lesson_title}</td>
  <td>${q.quiz_title}</td>
  <td style="color: ${q.score !== null ? "#27ae60" : "#e74c3c"};">
    ${q.score ?? "N/A"}
  </td>
  <td>${q.taken_at ? new Date(q.taken_at).toLocaleDateString() : "Not Taken"}</td>
  </tr>`,
    )
    .join("")}
  </table>

  <h3>📑 Assignments</h3>
  <table>
  <tr><th>Assignment</th><th>Score</th><th>Grade</th><th>Feedback</th><th>Submitted</th></tr>
  ${assignments
    .filter((a) => a.module_id === m.id)
    .map(
      (a) => `
  <tr>
  <td>${a.title}</td>
  <td>${a.total ?? "Pending"}</td>
  <td>${a.grade ?? "-"}</td>
  <td>${a.ai_feedback ?? "No Feedback"}</td>
  <td>${a.submitted_at ? new Date(a.submitted_at).toLocaleDateString() : "Not Submitted"}</td>
  </tr>`,
    )
    .join("")}
  </table>
  </div>
  <div class="page-break"></div>
  `,
    )
    .join("")}


  <div class="footer">
    © ${new Date().getFullYear()} ${company.company_name || ""} |
    Confidential Academic Performance Report |
    Generated on ${new Date().toLocaleDateString()}
  </div>


  </body>
  </html>
  `;

      /* ==========================
        GENERATE PDF
      ========================== */

      // await browser.close();
      const pdf = await generatePdf(html);

      res.setHeader(
        "Content-Disposition",
        // `attachment; filename=${course.title.replace(/\s+/g, "_")}_Detailed_Report.pdf`,
        `attachment; filename=${student.fullname.replace(/\s+/g, "_")}_${course.title.replace(/\s+/g, "_")}_Detailed_Report.pdf`,
      );
      res.setHeader("Content-Type", "application/pdf");
      res.send(pdf);
    } catch (err) {
      console.error("PDF Error:", err);
      res.status(500).send("Error generating detailed course summary");
    }
  };

  exports.downloadModuleSummary = async (req, res) => {
    const { studentId, moduleId } = req.params;

    try {
      /* ================= FETCH DATA ================= */

      const studentRes = await pool.query(
        `SELECT fullname, email FROM users2 WHERE id = $1`,
        [studentId],
      );
      const student = studentRes.rows[0];

      const moduleRes = await pool.query(
        `SELECT m.id, m.title, c.title AS course_title
        FROM modules m
        JOIN courses c ON m.course_id = c.id
        WHERE m.id = $1`,
        [moduleId],
      );
      const module = moduleRes.rows[0];

      const lessonsRes = await pool.query(
        `SELECT l.id, l.title,
                ulp.completed_at
        FROM lessons l
        LEFT JOIN user_lesson_progress ulp
          ON ulp.lesson_id = l.id
          AND ulp.user_id = $1
        WHERE l.module_id = $2
        ORDER BY l.id`,
        [studentId, moduleId],
      );
      const lessons = lessonsRes.rows;

      /* ==========================
   LESSON TIME CALCULATION
========================== */

      function formatTimeReadable(seconds) {
        const sec = Math.floor(seconds % 60);
        const min = Math.floor((seconds / 60) % 60);
        const hr = Math.floor(seconds / 3600);

        let result = "";

        if (hr > 0) result += `${hr}hr `;
        if (min > 0) result += `${min}min `;
        if (sec > 0 || result === "") result += `${sec}sec`;

        return result.trim();
      }

      const lessonTimeMap = {};

      const activityRes = await pool.query(
        `
        SELECT action, details, created_at
        FROM activities
        WHERE user_id = $1
        ORDER BY created_at ASC
        `,
        [studentId],
      );

      const lessonStart = {};

      for (const log of activityRes.rows) {
        const time = new Date(log.created_at);

        const match = log.details?.match(/\d+/);
        const lessonId = match ? Number(match[0]) : null;

        if (log.action === "Viewed Lesson" && lessonId) {
          lessonStart[lessonId] = time;
        }

        if (log.action === "Student submitted Quiz" && lessonId) {
          if (lessonStart[lessonId]) {
            const duration = (time - lessonStart[lessonId]) / 1000;

            lessonTimeMap[lessonId] = (lessonTimeMap[lessonId] || 0) + duration;

            delete lessonStart[lessonId];
          }
        }
      }

      lessons.forEach((lesson) => {
        lesson.timeSpent = formatTimeReadable(lessonTimeMap[lesson.id] || 0);
      });

      /* ==========================
        MODULE TOTAL TIME
      ========================== */

      const moduleTotalSeconds = lessons.reduce(
        (sum, lesson) => sum + (lessonTimeMap[lesson.id] || 0),
        0,
      );

      const moduleTotalTime = formatTimeReadable(moduleTotalSeconds);

      const quizzesRes = await pool.query(
        `SELECT 
            q.title AS quiz_title,
            l.title AS lesson_title,
            qs.score,
            qs.created_at AS taken_at
        FROM quizzes q
        JOIN lessons l ON q.lesson_id = l.id
        LEFT JOIN quiz_submissions qs
          ON qs.quiz_id = q.id 
          AND qs.student_id = $1
        WHERE l.module_id = $2
        ORDER BY q.id`,
        [studentId, moduleId],
      );
      const quizzes = quizzesRes.rows;

      const assignmentsRes = await pool.query(
        `SELECT ma.title,
                s.total,
                s.grade,
                s.ai_feedback,
                s.created_at AS submitted_at
        FROM module_assignments ma
        LEFT JOIN assignment_submissions s
          ON s.assignment_id = ma.id
          AND s.student_id = $1
        WHERE ma.module_id = $2
        ORDER BY ma.id`,
        [studentId, moduleId],
      );
      const assignments = assignmentsRes.rows;

      const badgesRes = await pool.query(
        `
        SELECT
            ub.id,
            ub.badge_name,
            ub.badge_image,
            ub.awarded_at
        FROM user_badges ub
        WHERE ub.user_id = $1
        AND ub.module_id = $2
        ORDER BY ub.awarded_at
        `,
        [studentId, moduleId],
      );
      const badges = badgesRes.rows;
      const totalBadges = badges.length;

      const infoResult = await pool.query(
        "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
      );
      const company = infoResult.rows[0] || {};

      const COMPANY_LOGO = company.logo_url || "";

      /* ==========================
    CHECK IF STUDENT BELONGS TO A SCHOOL
  ========================== */

      const schoolRes = await pool.query(
        `SELECT s.name, s.logo_url
    FROM user_school us
    JOIN schools s ON us.school_id = s.id
    WHERE us.user_id = $1
    AND us.approved = true
    LIMIT 1`,
        [studentId],
      );

      const school = schoolRes.rows[0] || null;

      /* ================= CALCULATIONS ================= */

      const totalLessons = lessons.length;
      const completedLessons = lessons.filter((l) => l.completed_at).length;
      const percent = totalLessons
        ? Math.round((completedLessons / totalLessons) * 100)
        : 0;

      const quizScores = quizzes
        .filter((q) => q.score !== null)
        .map((q) => q.score);
      const quizAvg = quizScores.length
        ? Math.round(quizScores.reduce((a, b) => a + b, 0) / quizScores.length)
        : 0;

      const assignmentScores = assignments
        .filter((a) => a.total !== null)
        .map((a) => a.total);

      const assignmentAvg = assignmentScores.length
        ? Math.round(
            assignmentScores.reduce((a, b) => a + b, 0) /
              assignmentScores.length,
          )
        : 0;

      /* ==========================
      MODULE GRADE CALCULATION
      ========================== */

      // let moduleScore = Math.round((percent + quizAvg + assignmentAvg) / 3);

      /* ==========================
    SMART MODULE GRADE CALCULATION
  ========================== */

      let moduleParts = [];
      let moduleTotal = 0;

      // Always include lesson completion
      moduleParts.push(percent);
      moduleTotal += percent;

      // Include quiz if exists
      if (quizzes.length > 0) {
        moduleParts.push(quizAvg);
        moduleTotal += quizAvg;
      }

      // Include assignment if exists
      const hasModuleAssignments = assignments.length > 0;

      if (hasModuleAssignments) {
        moduleParts.push(assignmentAvg);
        moduleTotal += assignmentAvg;
      }

      let moduleScore = moduleParts.length
        ? Math.round(moduleTotal / moduleParts.length)
        : 0;

      let moduleGrade = "F";
      if (moduleScore >= 80) moduleGrade = "A";
      else if (moduleScore >= 70) moduleGrade = "B";
      else if (moduleScore >= 60) moduleGrade = "C";
      else if (moduleScore >= 50) moduleGrade = "D";

      /* ==========================
      CONSISTENCY CHECK
      ========================== */

      let consistencyComment = "";
      const completionDates = lessons
        .filter((l) => l.completed_at)
        .map((l) => new Date(l.completed_at))
        .sort((a, b) => a - b);

      if (completionDates.length > 1) {
        const first = completionDates[0];
        const last = completionDates[completionDates.length - 1];
        const daysDiff = Math.ceil((last - first) / (1000 * 60 * 60 * 24));

        if (daysDiff <= 7) {
          consistencyComment = "Excellent completion consistency.";
        } else if (daysDiff <= 30) {
          consistencyComment = "Moderate completion consistency.";
        } else {
          consistencyComment =
            "Completion interval is wide. Improvement recommended.";
        }
      }

      /* ================= BUILD HTML ================= */

      const html = `
      <html>
      <head>
      <link rel="stylesheet"
        href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css"/>

      <style>
      body { font-family: Arial; padding:40px; background:#f4f6f9; }
      
  /* WATERMARK */
  body::before {
    content: "";
    position: fixed;
    top: 30%;
    left: 20%;
    width: 60%;
    height: 60%;
    background-image: url('${COMPANY_LOGO}');
    background-repeat: no-repeat;
    background-size: contain;
    opacity: 0.05;
    z-index: 0;
  }

  /* CONTENT ABOVE WATERMARK */
  body > * {
    position: relative;
    z-index: 2;
  }


  /* HEADER */
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 30px;
  }

  .school-info {
    text-align: right;
  }

  .school-logo {
    max-height: 60px;
  }

  /* FOOTER */
  .footer {
    position: fixed;
    bottom: 10px;
    left: 0;
    right: 0;
    text-align: center;
    font-size: 11px;
    color: #666;
  }
      h1 { text-align:center; color:#1e2a38; }
      .grid { display:grid; grid-template-columns:repeat(3,1fr); gap:20px; margin-top:20px; }

      .card {
        background:white;
        padding:20px;
        border-radius:10px;
        text-align:center;
        box-shadow:0 4px 10px rgba(0,0,0,0.08);
      }
      
      .card-info {
        background:white;
        padding:20px;
        border-radius:10px;
        text-align:Left;
        box-shadow:0 4px 10px rgba(0,0,0,0.08);
      }

      table {
        width:100%;
        border-collapse:collapse;
        margin-top:15px;
        background:white;
        font-size:12px;
      }

      th {
        background:#1e2a38;
        color:white;
        padding:8px;
        text-align:left;
      }

      td {
        padding:8px;
        border:1px solid #ddd;
      }

      tr:nth-child(even) { background:#f9f9f9; }

      .section { margin-top:40px; }

      </style>
      </head>

      <body>
      <div class="header">
    <div>
      <h2>Student Course Report</h2>
    </div>

    ${
      school
        ? `
    <div class="school-info">
      <strong>${school.name}</strong><br/>
      ${school.logo_url ? `<img src="${school.logo_url}" class="school-logo"/>` : ""}
    </div>
    `
        : ""
    }
  </div>

      <h1><i class="fa-solid fa-box"></i> Module Performance Report</h1>

      <div class="card-info">
        <p><strong>Student:</strong> ${student.fullname}</p>
        <p><strong>Email:</strong> ${student.email}</p>
        <p><strong>Course:</strong> ${module.course_title}</p>
        <p><strong>Module:</strong> ${module.title}</p>
        <p><strong>Generated:</strong> ${new Date().toLocaleString()}</p>
      </div>

      <div class="grid">
        <div class="card" style="background-color: #bb1188; color: #ffffff">
          <h2>${percent}%</h2>
          <p>Completion</p>
        </div>
        <div class="card" style="background-color: #280dc2; color: #ffffff">
          <h2>${quizAvg}%</h2>
          <p>Quiz Average</p>
        </div>
        ${
          hasModuleAssignments
            ? `
        <div class="card" style="background-color: #d6a812;">
          <h2>${assignmentAvg}%</h2>
          <p>Assignment Average</p>
        </div>`
            : ""
        }

        <div class="card" style="background-color: #11b447; color: #ffffff">
          <h2>${moduleGrade}</h2>
          <p>Module Grade</p>
        </div>
        <div class="card" style="background-color: #9b59b6; color: #ffffff">
          <h2>${totalBadges}</h2>
          <p>Badges Earned</p>
        </div>
        <div class="card" style="background: #6b4303; color:  white;">
          <h2>${moduleTotalTime}</h2>
          <p>Total Learning Time</p>
        </div>
        <div class="card" style="background-color: #280dc2; color: #ffffff">
          <h2>${moduleScore}%</h2>
          <p>Module Score</p>
        </div>
      </div>

      <div class="section">
        <h2>Lessons</h2>
        <table>
        <tr><th>Lesson</th><th>Status</th><th>Time Spent</th><th>Date</th></tr>
        ${lessons
          .map(
            (l) => `
          <tr>
            <td>${l.title}</td>
            <td>${l.completed_at ? "Completed" : "Not Completed"}</td>
             <td>${l.timeSpent}</td>
            <td>${l.completed_at ? new Date(l.completed_at).toLocaleDateString() : "-"}</td>
          </tr>`,
          )
          .join("")}
        </table>
      </div>

      <div class="section">
        <h2>Quiz Results</h2>
        <table>
        <tr><th>Lesson</th><th>Quiz</th><th>Score</th><th>Date</th></tr>
        ${quizzes
          .map(
            (q) => `
          <tr>
            <td>${q.lesson_title}</td>
            <td>${q.quiz_title}</td>
            <td>${q.score ?? "N/A"}</td>
            <td>${q.taken_at ? new Date(q.taken_at).toLocaleDateString() : "-"}</td>
          </tr>`,
          )
          .join("")}
        </table>
      </div>

      <div class="section">
        <h2>Assignments</h2>
        <table>
        <tr><th>Assignment</th><th>Score</th><th>Grade</th><th>Feedback</th><th>Date</th></tr>
        ${assignments
          .map(
            (a) => `
          <tr>
            <td>${a.title}</td>
            <td>${a.total ?? "-"}</td>
            <td>${a.grade ?? "-"}</td>
            <td>${a.ai_feedback ?? "No Feedback"}</td>
            <td>${a.submitted_at ? new Date(a.submitted_at).toLocaleDateString() : "-"}</td>
          </tr>`,
          )
          .join("")}
        </table>

        <div class="section">
          <h2>🏅 Course Badges Earned</h2>

          ${
            badges.length === 0
              ? `
          <p>No badges earned yet.</p>
          `
              : `
          <div style="display:grid; grid-template-columns:repeat(2,1fr); gap:20px; margin-top:20px;">
          ${badges
            .map(
              (b) => `
            <div style="background:white;padding:15px;border-radius:10px;text-align:center;box-shadow:0 4px 10px rgba(0,0,0,0.08);">
              
              ${
                b.badge_image
                  ? `
                <img src="${b.badge_image}" 
                    style="width:200px;height:200px;object-fit:contain;margin-bottom:10px;">
              `
                  : ""
              }
                <hr><br>
              <small>Awarded: ${new Date(b.awarded_at).toLocaleDateString()}</small>

            </div>
          `,
            )
            .join("")}
          </div>
          `
          }
        </div>

        <div class="section">
          <h2>Evaluation</h2>
          <div class="card">
            Overall Score: ${moduleScore}% <br/><br/>
            ${consistencyComment}
          </div>
        </div>

      </div>

      <div class="footer">
        © ${new Date().getFullYear()} ${company.company_name || ""} |
        Confidential Academic Performance Report |
        Generated on ${new Date().toLocaleDateString()}
      </div>

      </body>
      </html>
      `;
      const pdf = await generatePdf(html);

      res.setHeader(
        "Content-Disposition",
        `attachment; filename=${student.fullname.replace(/\s+/g, "_")}_${module.title.replace(/\s+/g, "_")}_Module_Report.pdf`,
      );
      res.setHeader("Content-Type", "application/pdf");
      res.send(pdf);
    } catch (err) {
      console.error(err);
      res.status(500).send("Error generating module summary");
    }
  };

exports.getSchoolsApi = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        name
      FROM schools
      ORDER BY name ASC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error(err);

    res.status(500).json([]);
  }
};

exports.getSchoolClassrooms = async (req, res) => {
  const { schoolId } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT
        id,
        name
      FROM classrooms
      WHERE school_id = $1
      ORDER BY name ASC
    `,
      [schoolId],
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);

    res.status(500).json([]);
  }
};

exports.getSchools = async (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.redirect("/admin/login");
  }

  try {
    const result = await pool.query(`
      SELECT 
        s.id,
        s.name,
        s.email,
        s.phone,
        s.address,
        s.logo_url,
        s.created_at,
        COUNT(DISTINCT CASE WHEN us.role_in_school = 'student' THEN u.id END) AS student_count,
        COUNT(DISTINCT CASE WHEN us.role_in_school = 'teacher' THEN u.id END) AS teacher_count,
        COUNT(DISTINCT c.id) AS classroom_count
      FROM schools s
      LEFT JOIN user_school us ON s.id = us.school_id
      LEFT JOIN users2 u ON us.user_id = u.id   -- ✅ ensure actual users exist
      LEFT JOIN classrooms c ON c.school_id = s.id
      GROUP BY s.id
      ORDER BY s.created_at DESC
    `);

    res.render("admin/schools", {
      info: req.companyInfo || {},
      schools: result.rows,
      currentPage: "schools",
      role: "admin", // ✅ important
    });
  } catch (err) {
    console.error("Error fetching schools:", err);
    res.status(500).send("Error loading schools");
  }
};

exports.updateSchoolInfo = async (req, res) => {
  try {
    const { id, email, phone, address } = req.body;
    let logo_url = null;

    // ✅ Upload new logo to Cloudinary if provided
    if (req.file) {
      const result = await cloudinary.uploader.upload(req.file.path, {
        folder: "school_logos",
      });
      logo_url = result.secure_url;

      // delete local file after upload
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    }

    // ✅ Build dynamic SQL update
    const fields = [];
    const values = [];
    let index = 1;

    if (email) {
      fields.push(`email = $${index++}`);
      values.push(email);
    }
    if (phone) {
      fields.push(`phone = $${index++}`);
      values.push(phone);
    }
    if (address) {
      fields.push(`address = $${index++}`);
      values.push(address);
    }
    if (logo_url) {
      fields.push(`logo_url = $${index++}`);
      values.push(logo_url);
    }

    if (fields.length === 0)
      return res.json({ ok: false, error: "No information to update." });

    values.push(id);

    await pool.query(
      `UPDATE schools SET ${fields.join(", ")} WHERE id = $${index}`,
      values
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("❌ Error updating school info:", err);
    res.json({ ok: false, error: "Failed to update school info." });
  }
};


// 📌 GET: Single School Details
exports.getSchoolDetails = async (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.redirect("/admin/login");
  }

  try {
    const { id } = req.params;

    // Fetch school
    const schoolResult = await pool.query(
      "SELECT * FROM schools WHERE id = $1",
      [id]
    );
    const school = schoolResult.rows[0];
    if (!school) return res.status(404).send("School not found");

    // Fetch students
    const studentsResult = await pool.query(
      `
      SELECT u.id, u.fullname AS full_name, u.email, u.phone, u.dob, u.gender,
             u.role, u.wallet_balance, u.pin, u.avatar_url, u.avatar_seed, u.classroom_login_enabled,
             u.login_type, u.created_at,
             c.name AS classroom_name
      FROM user_school us
      JOIN users2 u ON us.user_id = u.id
      LEFT JOIN classrooms c ON us.classroom_id = c.id
      WHERE us.school_id = $1 AND us.role_in_school = 'student'
      `,
      [id]
    );

    // fetch courses offered by the school
    const schoolCoursesResult = await pool.query(
      `
      SELECT c.id, c.title, c.level
      FROM school_courses sc
      JOIN courses c ON sc.course_id = c.id
      WHERE sc.school_id = $1
      ORDER BY c.title ASC
      `,
      [id]
    );

    school.courses = schoolCoursesResult.rows; // attach school courses

    // Fetch teachers
    const teachersResult = await pool.query(
      `
      SELECT u.id, u.fullname AS full_name, u.email, u.phone, u.dob, u.gender,
             u.role, u.wallet_balance, u.created_at,
             c.name AS classroom_name
      FROM user_school us
      JOIN users2 u ON us.user_id = u.id
      LEFT JOIN classrooms c ON us.classroom_id = c.id
      WHERE us.school_id = $1 AND us.role_in_school = 'teacher'
      `,
      [id]
    );

    // Fetch instructors (restricted to this school’s classrooms)
    const instructorsResult = await pool.query(
      `
      SELECT 
        u.id,
        u.fullname AS full_name,
        u.email,
        COALESCE(
          string_agg(DISTINCT c.name, ', ' ORDER BY c.name), 
          'Not yet assigned'
        ) AS classrooms
      FROM users2 u
      LEFT JOIN classroom_instructors ci 
        ON ci.instructor_id = u.id
      LEFT JOIN classrooms c 
        ON ci.classroom_id = c.id AND c.school_id = $1   -- ✅ only restrict classrooms, not instructors
      WHERE u.role = 'instructor'
      GROUP BY u.id, u.fullname, u.email
      ORDER BY u.fullname;

      `,
      [id]
    );

    // Fetch classrooms + counts
    const classroomsResult = await pool.query(
      `
  SELECT 
    c.id,
    c.name,
    COUNT(DISTINCT CASE WHEN us.role_in_school = 'student' THEN u.id END) AS student_count,
    COUNT(DISTINCT CASE WHEN us.role_in_school = 'teacher' THEN u.id END) AS teacher_count,
    COUNT(DISTINCT ci.instructor_id) AS instructor_count
  FROM classrooms c
  LEFT JOIN user_school us ON c.id = us.classroom_id
  LEFT JOIN users2 u ON us.user_id = u.id
  LEFT JOIN classroom_instructors ci ON ci.classroom_id = c.id
  WHERE c.school_id = $1
  GROUP BY c.id, c.name
  ORDER BY c.created_at DESC
  `,
      [id]
    );

    // Fetch terms with students
    const termsResult = await pool.query(`
      SELECT
        t.id AS term_id,
        t.name AS term_name,
        t.start_date,
        t.end_date,
        t.is_ended,
        t.ended_at,
        t.report_generation_status,
        t.report_generation_total,
        t.report_generation_completed,
        COUNT(ts.student_id) AS student_count
      FROM academic_terms t
      LEFT JOIN student_term_enrollments ts ON ts.term_id = t.id
      WHERE t.school_id = $1
      GROUP BY t.id
      ORDER BY t.created_at DESC
    `, [id]);

    // school.terms = termsResult.rows;

    const today = new Date();

    school.terms = termsResult.rows.map(term => {
      const start = new Date(term.start_date);
      const end = new Date(term.end_date);

      let status = "past"; // default
      let label = "🔴 Past";

      if (today < start) {
        status = "upcoming";
        label = "🟡 Not yet resumed";
      } else if (today >= start && today <= end) {
        status = "active";
        label = "🟢 Active";
      }

      return {
        ...term,
        status,
        statusLabel: label
      };
    });

    const quotesResult = await pool.query(
      `SELECT 
        q.*, 
        t.name AS term_name
      FROM quotes q
      JOIN academic_terms t ON q.term_id = t.id
      WHERE q.school_id = $1
      ORDER BY q.created_at DESC`,
      [id]
    );

    const quotes = quotesResult.rows;

    // ✅ Ensure every term has a quote
    for (const term of school.terms) {
      const existingQuote = quotes.find(q => q.term_id === term.term_id);

      if (!existingQuote) {
        await pool.query(
          `INSERT INTO quotes 
          (school_id, term_id, price_per_student, total_students, total_amount, status)
          VALUES ($1, $2, $3, $4, $5, 'unpaid')`,
          [id, term.term_id, 0, 0, 0],
        );
      }
    }

    // 🔁 Re-fetch updated quotes
    const updatedQuotesResult = await pool.query(
      `SELECT 
        q.*, 
        t.name AS term_name
      FROM quotes q
      JOIN academic_terms t ON q.term_id = t.id
      WHERE q.school_id = $1`,
      [id]
    );

    const updatedQuotes = updatedQuotesResult.rows;

    school.terms = school.terms.map((term) => {
      const quote = updatedQuotes.find((q) => q.term_id === term.term_id);

      const totalStudents = term.student_count || 0;
      const price = quote?.price_per_student || 0;

      return {
        ...term,
        quote: quote
          ? {
              ...quote,
              total_amount: totalStudents * price,
            }
          : null,
      };
    });

    const totalsResult = await pool.query(
      `
  SELECT
    COUNT(DISTINCT CASE WHEN us.role_in_school = 'student' THEN u.id END) AS total_students,
    COUNT(DISTINCT CASE WHEN us.role_in_school = 'teacher' THEN u.id END) AS total_teachers,
    (
      SELECT COUNT(*) 
      FROM users2 u2
      WHERE u2.role = 'instructor'
    ) AS total_instructors
  FROM user_school us
  JOIN users2 u ON us.user_id = u.id
  WHERE us.school_id = $1
  `,
      [id]
    );

    // Attach
    school.students = studentsResult.rows;
    school.teachers = teachersResult.rows;
    school.instructors = instructorsResult.rows;
    school.classrooms = classroomsResult.rows;
    school.totals = totalsResult.rows[0];

    res.render("admin/school-details", {
      info: req.companyInfo || {},
      school,
      quotes: quotesResult.rows,
      currentPage: "schools",
      role: "admin",
    });
  } catch (err) {
    console.error("Error fetching school details:", err);
    res.status(500).send("Error loading school details");
  }
};

  exports.downloadSchoolProgressReport = async (req, res) => {
    const { schoolId } = req.params;

    try {
      // --- 1. Get school info
      const schoolRes = await pool.query(
        `SELECT id, name, address, email, phone, created_at 
        FROM schools WHERE id = $1`,
        [schoolId]
      );
      const school = schoolRes.rows[0];
      if (!school) return res.status(404).send("School not found");

      // --- 2. Get classrooms
      const classRes = await pool.query(
        `SELECT id, name FROM classrooms WHERE school_id = $1 ORDER BY name`,
        [schoolId]
      );
      const classrooms = classRes.rows;

      // --- 3. Get students
      const studentRes = await pool.query(
        `SELECT 
            u.id, 
            u.fullname AS full_name, 
            u.email, 
            c.name AS classroom_name
        FROM user_school us
        JOIN users2 u ON us.user_id = u.id
        LEFT JOIN classrooms c ON us.classroom_id = c.id
        WHERE us.role_in_school = 'student' 
          AND us.school_id = $1
        ORDER BY c.name, u.fullname`,
        [schoolId]
      );
      const students = studentRes.rows;

      // --- 4. Get teachers
      const teacherRes = await pool.query(
        `SELECT 
            u.id, 
            u.fullname AS full_name, 
            u.email
        FROM user_school us
        JOIN users2 u ON us.user_id = u.id
        WHERE us.role_in_school = 'teacher'
          AND us.school_id = $1
        ORDER BY u.fullname`,
        [schoolId]
      );
      const teachers = teacherRes.rows;

      // --- 5. Get progress data
  const progressRes = await pool.query(`
    SELECT 
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
      ON ulp.user_id = us.user_id 
      AND ulp.lesson_id = l.id 
      AND ulp.completed_at IS NOT NULL
    WHERE us.role_in_school = 'student'
    GROUP BY us.user_id
  `);



      const progressMap = Object.fromEntries(
        progressRes.rows.map((p) => [p.user_id, p])
      );

      const quizRes = await pool.query(
        `SELECT student_id, AVG(score) AS avg_quiz
        FROM quiz_submissions
        GROUP BY student_id`
      );
      const quizMap = Object.fromEntries(
        quizRes.rows.map((q) => [q.student_id, Math.round(q.avg_quiz)])
      );

      const assignmentRes = await pool.query(
        `SELECT student_id, AVG(total) AS avg_assignment
        FROM assignment_submissions
        GROUP BY student_id`
      );
      const assignmentMap = Object.fromEntries(
        assignmentRes.rows.map((a) => [
          a.student_id,
          Math.round(a.avg_assignment),
        ])
      );

      // --- 6. Build School Summary
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
            <tr><th>Date Created</th><td>${new Date(
              school.created_at
            ).toLocaleDateString()}</td></tr>
          </table>
        </div>
      `;

      // --- 7. Teacher List
      const teachersHTML = `
        <div class="teachers">
          <h2>👨‍🏫 Teachers</h2>
          ${
            teachers.length
              ? `
            <table>
              <thead><tr><th>Name</th><th>Email</th></tr></thead>
              <tbody>
                ${teachers
                  .map(
                    (t) => `<tr><td>${t.full_name}</td><td>${t.email}</td></tr>`
                  )
                  .join("")}
              </tbody>
            </table>`
              : "<p><em>No teachers registered.</em></p>"
          }
        </div>
      `;

      // --- 8. Class & Student Progress Section
      const classesHTML = classrooms
        .map((cls) => {
          const classStudents = students.filter(
            (s) => s.classroom_name === cls.name
          );

          if (classStudents.length === 0)
            return `<div class="class-block"><h2>${cls.name}</h2><p><em>No students enrolled.</em></p></div>`;

          return `
            <div class="class-block">
              <h2>📘 ${cls.name}</h2>
              <table>
                <thead>
                  <tr>
                    <th>Student Name</th>
                    <th>Email</th>
                    <th>Lessons Completed</th>
                    <th>Quiz Avg</th>
                    <th>Assignment Avg</th>
                    <th>Progress %</th>
                  </tr>
                </thead>
                <tbody>
                  ${classStudents
                    .map((stu) => {
                      const prog = progressMap[stu.id] || {
                        total_lessons: 0,
                        completed_lessons: 0,
                      };
                      const percent =
                        prog.total_lessons > 0
                          ? Math.round(
                              (prog.completed_lessons / prog.total_lessons) * 100
                            )
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

      // --- 9. Combine all HTML
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

      // --- 10. Puppeteer PDF generation
      // const browser = await puppeteer.launch({
      //   headless: true,
      //   args: ["--no-sandbox", "--disable-setuid-sandbox"],
      // });
      // const page = await browser.newPage();
      // await page.setContent(html, { waitUntil: "networkidle0" });
      // const pdf = await page.pdf({
      //   format: "A4",
      //   printBackground: true,
      //   margin: { top: "1cm", bottom: "1cm", left: "1cm", right: "1cm" },
      // });
      // await browser.close();

      const pdf = await generatePdf(html);

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=${school.name.replace(
          /\s+/g,
          "_"
        )}_Summary_Report.pdf`
      );
      res.send(pdf);
    } catch (err) {
      console.error("Error generating report:", err);
      res.status(500).send("Error generating report PDF");
    }
  };

// 📄 Download Student Login Cards (PDF with Logo)
exports.downloadStudentLoginCards = async (req, res) => {
  const { schoolId } = req.params;
  try {
    // 1️⃣ Fetch school info
    const schoolRes = await pool.query(
      `SELECT id, name, logo_url, email FROM schools WHERE id = $1`,
      [schoolId]
    );
    const school = schoolRes.rows[0];
    if (!school) return res.status(404).send("School not found");

    // 2️⃣ Fetch students
    const studentRes = await pool.query(
      `SELECT 
        u.fullname AS full_name, 
        u.email, u.pin, u.avatar_url, u.avatar_seed, 
        c.name AS classroom_name
      FROM user_school us
      JOIN users2 u ON us.user_id = u.id
      LEFT JOIN classrooms c ON us.classroom_id = c.id
      WHERE us.school_id = $1 AND us.role_in_school = 'student'
      ORDER BY c.name, u.fullname`,
      [schoolId]
    );
    const students = studentRes.rows;

    // 3️⃣ Build the HTML
    const html = `
      <html>
      <head>
        <style>
          body {
            font-family: 'Arial', sans-serif;
            padding: 30px;
            color: #2c3e50;
          }
          h1 {
            text-align: center;
            color: #2c3e50;
            margin-bottom: 25px;
          }
          .cards-container {
            display: flex;
            flex-wrap: wrap;
            gap: 18px;
            justify-content: center;
          }
          .card {
            border: 2px solid #c8b209ff;
            border-radius: 12px;
            padding: 14px;
            width: 300px;
            height: 270px;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            background: #f9f9f9;
            box-shadow: 0 3px 8px rgba(0,0,0,0.1);
            text-align: center;
            page-break-inside: avoid;
          }
          .card img {
            width: 50px;
            height: 50px;
            border-radius: 50%;
            object-fit: cover;
            margin-bottom: 6px;
          }
          .card h2 {
            font-size: 1.05em;
            color: #007bff;
            margin: 4px 0;
          }
          .card p {
            margin: 3px 0;
            font-size: 0.88em;
            color: #333;
          }
          .card .footer {
            font-size: 0.78em;
            color: #555;
            text-align: center;
            margin-top: 6px;
            border-top: 1px solid #ccc;
            padding-top: 4px;
          }
          .login-link {
            display: inline-block;
            margin-top: 3px;
            color: #007bff;
            font-weight: bold;
            text-decoration: none;
          }
          @media print {
            body { padding: 0; }
            .card { page-break-inside: avoid; }
          }
        </style>
      </head>
      <body>
        <h1>🎓 ${school.name} — Student Login Cards</h1>
        <div class="cards-container">
          ${students.map(s => `
            <div class="card">
              <div>
                ${
                  school.logo_url
                    ? `<img src="${school.logo_url}" alt="Logo" />`
                    : `<img src="https://via.placeholder.com/50x50.png?text=Logo" alt="Logo" />`
                }
                <h2>${s.full_name}</h2>
                <p><strong>Class:</strong> ${s.classroom_name || "—"}</p>
                <p><strong>Email:</strong> ${s.email}</p>
                <p><strong>Password:</strong> 12345678</p>
                <p style="font-size: 0.85em; color: #07af2b;">
                  You can also Login with your PIN by Select your school and class
                </p>
                <p><strong>PIN:</strong> ${s.pin || "N/A"}</p>
                <p><a class="login-link" href="https://acad.jkthub.com/admin/login">acad.jkthub.com/admin/login</a></p>
              </div>
              <div class="footer">
                <em>Keep this card safe ✨</em>
              </div>
            </div>
          `).join("")}
        </div>
      </body>
      </html>
    `;

    // 4️⃣ Generate PDF using Puppeteer
    // const browser = await puppeteer.launch({
    //   headless: true,
    //   args: ["--no-sandbox", "--disable-setuid-sandbox"],
    // });
    // const page = await browser.newPage();
    // await page.setContent(html, { waitUntil: "networkidle0" });
    // const pdf = await page.pdf({
    //   format: "A4",
    //   printBackground: true,
    //   margin: { top: "1cm", bottom: "1cm", left: "1cm", right: "1cm" },
    // });
    // await browser.close();

    const pdf = await generatePdf(html);

    // 5️⃣ Send file
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${school.name.replace(/\s+/g, "_")}_Login_Cards.pdf`
    );
    res.send(pdf);
  } catch (err) {
    console.error("Error generating login cards PDF:", err);
    res.status(500).send("Error generating student login cards PDF");
  }
};

exports.exportStudentsExcel = async (req, res) => {
  try {
    const { id } = req.params; // school id

    const { rows: students } = await pool.query(
      `
      SELECT 
        u.fullname AS full_name,
        u.email,
        u.phone,
        u.gender,
        u.dob,
        u.pin,
        c.name AS classroom
      FROM user_school us
      JOIN users2 u ON us.user_id = u.id
      LEFT JOIN classrooms c ON us.classroom_id = c.id
      WHERE us.school_id = $1 AND us.role_in_school = 'student'
      ORDER BY u.fullname ASC
    `,
      [id],
    );

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Students");

    sheet.columns = [
      { header: "Full Name", key: "full_name", width: 25 },
      { header: "Email", key: "email", width: 30 },
      { header: "Gender", key: "gender", width: 15 },
      { header: "Classroom", key: "classroom", width: 20 },
      { header: "PIN", key: "pin", width: 15 },
    ];

    students.forEach((s) => {
      sheet.addRow({
        ...s,
        dob: s.dob ? new Date(s.dob).toLocaleDateString() : "",
      });
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename=students.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).send("Excel export failed");
  }
};

exports.createClassroom = async (req, res) => {
  try {
    const { school_id, name, teacher_id } = req.body;

    const user = req.session?.user; // safer access

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Not authenticated: session missing",
      });
    }

    let schoolId;

    if (user.role === "admin") {
      schoolId = school_id;
    } else {
      schoolId = user.school_id;
    }

    if (!schoolId || !name) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: school_id or name",
      });
    }

    const result = await pool.query(
      `INSERT INTO classrooms (school_id, name) 
       VALUES ($1, $2) 
       RETURNING id, school_id`,
      [schoolId, name]
    );

    const classroomId = result.rows[0].id;

    let teacherCount = 0;
    if (teacher_id) {
      const teacherIds = Array.isArray(teacher_id) ? teacher_id : [teacher_id];
      teacherCount = teacherIds.length;

      for (const tid of teacherIds) {
        await pool.query(
          `INSERT INTO classroom_teachers (classroom_id, teacher_id)
           VALUES ($1, $2)
           ON CONFLICT (classroom_id, teacher_id) DO NOTHING`,
          [classroomId, tid]
        );
      }
    }

    return res.json({
      success: true,
      classroom: {
        id: classroomId,
        name,
        school_id: schoolId,
        teacher_count: teacherCount,
        student_count: 0,
        instructor_count: 0,
      },
    });

  } catch (err) {
    console.error("Error creating classroom:", err);
    return res.status(500).json({
      success: false,
      message: "Server error while creating classroom",
    });
  }
};

// ✅ UPDATE CLASSROOM
exports.updateClassroom = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, teacher_ids } = req.body;

    if (!id || !name) {
      return res
        .status(400)
        .json({ success: false, message: "Missing classroom ID or name" });
    }

    // Update classroom name
    await pool.query(`UPDATE classrooms SET name = $1 WHERE id = $2`, [
      name,
      id,
    ]);

    // Reassign teachers if provided
    if (teacher_ids) {
      const teacherIds = Array.isArray(teacher_ids)
        ? teacher_ids
        : [teacher_ids];

      // Remove old assignments
      await pool.query(
        `DELETE FROM classroom_teachers WHERE classroom_id = $1`,
        [id]
      );

      // Add new ones
      for (const tid of teacherIds) {
        await pool.query(
          `INSERT INTO classroom_teachers (classroom_id, teacher_id) VALUES ($1, $2)`,
          [id, parseInt(tid)]
        );
      }
    }

    return res.json({
      success: true,
      message: "Classroom updated successfully",
    });
  } catch (err) {
    console.error("Error updating classroom:", err);
    return res
      .status(500)
      .json({
        success: false,
        message: "Server error while updating classroom",
      });
  }
};

// 🗑️ DELETE CLASSROOM
exports.deleteClassroom = async (req, res) => {
  try {
    const { id } = req.params;

    // Clear related records
    await pool.query(`DELETE FROM classroom_teachers WHERE classroom_id = $1`, [
      id,
    ]);
    await pool.query(
      `DELETE FROM classroom_instructors WHERE classroom_id = $1`,
      [id]
    );
    // await pool.query(`DELETE FROM classroom_students WHERE classroom_id = $1`, [id]);

    // Delete classroom
    await pool.query(`DELETE FROM classrooms WHERE id = $1`, [id]);

    return res.json({
      success: true,
      message: "Classroom deleted successfully",
    });
  } catch (err) {
    console.error("Error deleting classroom:", err);
    return res
      .status(500)
      .json({
        success: false,
        message: "Server error while deleting classroom",
      });
  }
};

// 📌 GET: Students in a classroom (AJAX)
// exports.getClassroomStudents = async (req, res) => {
//   try {
//     const { id } = req.params; // classroom_id

//     const studentsResult = await pool.query(
//       `SELECT u.id, u.fullname, u.email, u.phone, u.gender, u.dob, u.created_at
//        FROM user_school us
//        JOIN users2 u ON us.user_id = u.id
//        WHERE us.classroom_id = $1 AND us.role_in_school = 'student'
//        ORDER BY u.fullname ASC`,
//       [id]
//     );

//     res.json(studentsResult.rows);
//   } catch (err) {
//     console.error("Error fetching classroom students:", err);
//     res.status(500).json({ error: "Error loading classroom students" });
//   }
// };

exports.getClassroomStudents = async (req, res) => {
  try {

    // supports both :id and :classroomId
    const classroomId =
      req.params.classroomId || req.params.id;

    const studentsResult = await pool.query(
      `
      SELECT
        u.id,
        u.fullname,
        u.email,
        u.phone,
        u.gender,
        u.dob,
        u.created_at,
        u.avatar_url,
        u.avatar_seed,
        u.pin,
        u.classroom_login_enabled
      FROM user_school us
      JOIN users2 u
        ON us.user_id = u.id
      WHERE us.classroom_id = $1
      AND u.role = 'student'
      ORDER BY u.fullname ASC
      `,
      [classroomId]
    );

    res.json(studentsResult.rows);

  } catch (err) {

    console.error("Error fetching classroom students:", err);

    res.status(500).json({
      error: "Error loading classroom students"
    });

  }
};

exports.assignCoursesToClassroom = async (req, res) => {
  try {
    const { id } = req.params; // classroom_id
    const { course_ids } = req.body; // array of selected course IDs

    if (!course_ids || course_ids.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "No courses selected" });
    }

    // Clear old assignments
    await pool.query("DELETE FROM classroom_courses WHERE classroom_id = $1", [
      id,
    ]);

    // Insert new ones
    const values = course_ids.map((cid) => `(${id}, ${cid})`).join(",");
    await pool.query(
      `INSERT INTO classroom_courses (classroom_id, course_id) VALUES ${values}`
    );

    res.json({
      success: true,
      message: "Courses assigned to classroom successfully",
    });
  } catch (err) {
    console.error("Error assigning courses to classroom:", err);
    res.status(500).json({
      success: false,
      message: "Server error while assigning courses",
    });
  }
};

exports.getClassroomCourses = async (req, res) => {
  try {
    const { id } = req.params; // classroom_id

    const result = await pool.query(
      `
      SELECT c.id, c.title, c.level
      FROM classroom_courses cc
      JOIN courses c ON cc.course_id = c.id
      WHERE cc.classroom_id = $1
      ORDER BY c.title ASC
      `,
      [id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching classroom courses:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.addPayment = async (req, res) => {
  try {
    const { quote_id, amount, school_id } = req.body;

    const amountValue = parseFloat(amount) || 0;

    // 1. Insert payment
    await pool.query(
      `INSERT INTO school_payments (school_id, quote_id, amount)
       VALUES ($1, $2, $3)`,
      [school_id, quote_id, amountValue],
    );

    // 2. Get updated total paid
    const paidRes = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS total_paid
       FROM school_payments
       WHERE quote_id = $1`,
      [quote_id],
    );

    const totalPaid = Number(paidRes.rows[0].total_paid);

    // 3. Get quote total
    const quoteRes = await pool.query(
      `SELECT total_amount FROM quotes WHERE id = $1`,
      [quote_id],
    );

    const totalAmount = Number(quoteRes.rows[0].total_amount);

    // 4. Calculate balance
    const balance = totalAmount - totalPaid;
    let status = "unpaid";

    if (totalPaid <= 0) {
      status = "unpaid";
    } else if (totalPaid < totalAmount) {
      status = "partial";
    } else if (totalPaid >= totalAmount) {
      status = "paid";
    }

    // ✅ 6. SAVE EVERYTHING INTO QUOTES
    await pool.query(
      `UPDATE quotes 
       SET total_paid = $1, balance = $2, status = $3
       WHERE id = $4`,
      [totalPaid, balance, status, quote_id],
    );

    res.redirect("/admin/quotes");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error adding payment");
  }
};

exports.getQuotes = async (req, res) => {
    if (!req.session.user || req.session.user.role !== "admin") {
      return res.redirect("/admin/login");
    }
  try {

    const result = await pool.query(`
     SELECT 
      q.id,
      q.school_id,
      s.name AS school_name,
      t.name AS term_name,
      q.price_per_student,

      COALESCE(st.total_students, 0) AS total_students,

      (COALESCE(st.total_students, 0) * COALESCE(q.price_per_student, 0)) AS total_amount,

      COALESCE(p.total_paid, 0) AS total_paid,

      (COALESCE(st.total_students, 0) * COALESCE(q.price_per_student, 0)) 
        - COALESCE(p.total_paid, 0) AS balance,

     CASE 
      -- FULLY PAID
      WHEN COALESCE(p.total_paid, 0) >= 
          (COALESCE(st.total_students, 0) * COALESCE(q.price_per_student, 0)) 
        THEN 'paid'

      -- OVERDUE (IMPORTANT FIX 🔥)
      WHEN COALESCE(p.total_paid, 0) < 
          (COALESCE(st.total_students, 0) * COALESCE(q.price_per_student, 0))
          AND t.end_date < CURRENT_DATE
        THEN 'overdue'

      -- PARTIAL (ONLY IF TERM STILL ONGOING)
      WHEN COALESCE(p.total_paid, 0) > 0 
          AND t.end_date >= CURRENT_DATE
        THEN 'partial'

      -- UPCOMING
      WHEN t.start_date > CURRENT_DATE 
        THEN 'upcoming'

      -- ONGOING BUT NO PAYMENT
      WHEN t.start_date <= CURRENT_DATE 
          AND t.end_date >= CURRENT_DATE 
          AND COALESCE(p.total_paid, 0) = 0
        THEN 'pending'

      ELSE 'unpaid'
    END AS status

    FROM quotes q
    JOIN schools s ON q.school_id = s.id
    JOIN academic_terms t ON q.term_id = t.id

    -- ✅ students counted separately
    LEFT JOIN (
      SELECT term_id, COUNT(*) AS total_students
      FROM student_term_enrollments
      GROUP BY term_id
    ) st ON st.term_id = q.term_id

    -- ✅ payments summed separately
    LEFT JOIN (
      SELECT quote_id, SUM(amount) AS total_paid
      FROM school_payments
      GROUP BY quote_id
    ) p ON p.quote_id = q.id

    ORDER BY q.created_at DESC;
      `);
    
    const quotes = result.rows;

    const summary = await pool.query(`
          SELECT 
            COALESCE(SUM(total_amount),0) AS total_expected,
            COALESCE(SUM(total_paid),0) AS total_paid,
            COALESCE(SUM(balance),0) AS outstanding,

            COUNT(*) FILTER (WHERE status = 'paid') AS paid_quotes,
            COUNT(*) FILTER (WHERE status = 'partial') AS partial_quotes,

            -- ✅ THIS IS YOUR REAL UNPAID
            COUNT(*) FILTER (WHERE status = 'overdue') AS unpaid_quotes,

            -- OPTIONAL (if you want later)
            COUNT(*) FILTER (WHERE status = 'pending') AS pending_quotes,
            COUNT(*) FILTER (WHERE status = 'upcoming') AS upcoming_quotes

          FROM (
            SELECT 
              q.id,

              -- reuse SAME calculation
              (COALESCE(st.total_students, 0) * COALESCE(q.price_per_student, 0)) AS total_amount,
              COALESCE(p.total_paid, 0) AS total_paid,

              (COALESCE(st.total_students, 0) * COALESCE(q.price_per_student, 0)) 
                - COALESCE(p.total_paid, 0) AS balance,

              CASE 
                -- FULLY PAID
                WHEN COALESCE(p.total_paid, 0) >= 
                    (COALESCE(st.total_students, 0) * COALESCE(q.price_per_student, 0)) 
                  THEN 'paid'

                -- OVERDUE (🔥 FIX)
                WHEN COALESCE(p.total_paid, 0) < 
                    (COALESCE(st.total_students, 0) * COALESCE(q.price_per_student, 0))
                    AND t.end_date < CURRENT_DATE
                  THEN 'overdue'

                -- PARTIAL (ONLY IF STILL ACTIVE)
                WHEN COALESCE(p.total_paid, 0) > 0 
                    AND t.end_date >= CURRENT_DATE
                  THEN 'partial'

                -- UPCOMING
                WHEN t.start_date > CURRENT_DATE 
                  THEN 'upcoming'

                -- ONGOING NO PAYMENT
                WHEN t.start_date <= CURRENT_DATE 
                    AND t.end_date >= CURRENT_DATE 
                    AND COALESCE(p.total_paid, 0) = 0
                  THEN 'pending'

                ELSE 'unpaid'
              END AS status

            FROM quotes q
            JOIN academic_terms t ON q.term_id = t.id

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

          ) sub;
    `);

    const trend = await pool.query(`
      SELECT 
        TO_CHAR(payment_date, 'FMMonth FMDD YYYY') as day,
        SUM(amount) as total
      FROM school_payments
      GROUP BY day
      ORDER BY MIN(payment_date) ASC;
    `);

    res.render("admin/quotes", {
      info: req.companyInfo || {},
      quotes,
      summary: summary.rows[0],
      trend: trend.rows,
      currentPage: "quotes",
      role: "admin", // ✅ important
    });
  } catch (err) {
    console.error("Error fetching quotes:", err);
    res.status(500).send("Error loading quotes");
  }
};

exports.downloadQuotePDF = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(`
      SELECT
          q.id,
          q.term_id,
          q.school_id,
          q.price_per_student,
          q.status,
          q.total_paid,
          q.balance,
          s.name AS school_name,
          s.email AS school_email,
          s.phone,
          s.address,
          t.name AS term_name,
          COUNT(ts.student_id) AS total_students,
          (COUNT(ts.student_id) * COALESCE(q.price_per_student,0)) AS total_amount
      FROM quotes q
      JOIN schools s
      ON q.school_id=s.id
      JOIN academic_terms t
      ON q.term_id=t.id
      LEFT JOIN student_term_enrollments ts
      ON ts.term_id=q.term_id
      WHERE q.id=$1
      GROUP BY
      q.id,
      q.term_id,
      q.school_id,
      q.price_per_student,
      q.status,
      q.total_paid,
      q.balance,
      s.name,
      s.email,
      s.phone,
      s.address,
      t.name;
    `, [id]);

    const q = result.rows[0];
    if (!q) {
      return res.status(404).send("Invoice not found");
    }

    const totalPaid = Number(q.total_paid || 0);
    const balance = Number(q.balance || 0);

    // If any payment has been made, generate a receipt instead
    if (totalPaid > 0) {
        return exports.generateSchoolReceipt(req, res, q);
    }

    const studentsResult = await pool.query(`
    SELECT
        u.fullname AS full_name,
        c.name AS class_name
    FROM student_term_enrollments ste
    JOIN users2 u
        ON u.id = ste.student_id
    LEFT JOIN classrooms c
        ON c.id = ste.classroom_id
    WHERE ste.term_id = $1
    ORDER BY c.name, u.fullname;
    `, [q.term_id]);

    const students = studentsResult.rows;
    // const totalPaid = Number(q.total_paid || 0);
    // const balance = Number(q.balance || 0);

    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const company = infoResult.rows[0] || {};

    const numberToWords = require('number-to-words');

    const total = Number(q.total_amount);
    const firstPayment = Math.round(total * 0.6);
    const secondPayment = total - firstPayment;

    // Convert to words
    const words = numberToWords.toWords(total).toUpperCase();

    const today = new Date().toDateString();

    const midTermDate = new Date();
    midTermDate.setDate(midTermDate.getDate() + 14);

    const examDate = new Date();
    examDate.setDate(examDate.getDate() + 30);

    const html = `
    <html>
    <head>
    <style>
      body{
          font-family:Calibri;
          margin:0;
          padding:0;
          background:#fff;
      }

      .container{
          width:80%;
          max-width:800px;
          margin:30px auto;
          background:#fff;
          padding:30px;
      }

      .header {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 20px;
      }

      .header img {
        width: 70px;
      }

      .header-text {
        text-align: center;
      }

      .title {
        font-weight: bold;
        font-size: 18px;
      }

      .sub {
        font-size: 12px;
      }

      .top {
        display: flex;
        justify-content: space-between;
        margin-top: 30px;
        font-size: 13px;
      }

      .bank {
        text-align: right;
        font-weight: bold;
      }

      .date {
        text-align: right;
        margin-top: 10px;
        font-size: 12px;
      }

      .section-title {
        text-align: right;
        margin-top: 15px;
        color: #b89b5e;
        font-weight: bold;
        font-size: 13px;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 10px;
      }

      th {
        background: #b89b5e;
        color: white;
        font-size: 11px;
        padding: 6px;
      }

      td {
        border: 1px solid #000;
        text-align: center;
        padding: 6px;
        font-size: 11px;
      }

      .total-row {
        background: #000;
        color: #fff;
        font-weight: bold;
      }

      .amount-words {
        margin-top: 10px;
        font-size: 12px;
      }

      .payments {
        margin-top: 10px;
        font-size: 12px;
      }

      .payments p {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .highlight {
        background: #b89b5e;
        padding: 5px 15px;
        font-weight: bold;
        width: 40px
      }

      .highlight2 {
        background: #000;
        color: #fff;
        padding: 5px 15px;
        width: 40px
      }

      .signatures {
        margin-top: 60px;
        display: flex;
        justify-content: space-between;
      }

      .sign {
        text-align: center;
        width: 45%;
      }

      .signature-box {
        position: relative;
        height: 0px; /* space for signature */
      }

      .signature-img {
        position: absolute;
        bottom: 10px;   /* sits just above the line */
        left: 20%;
        transform: translateX(-50%);
        height: 40px;   /* adjust size */
        z-index: 2;
      }

      .line {
        border-top: 1px solid #000;
        margin-top: 40px;
        position: relative;
        z-index: 1;
      }

      .sign-date {
        font-size: 11px;
        position: absolute;
        bottom: 10px;   /* sits just above the line */
        right: 20%;
      }

      .page-break{
          page-break-before:always;
          break-before:page;
      }

      .student-table{
          width:100%;
          border-collapse:collapse;
          margin-top:20px;
      }

      .student-table th{
          background:#b89b5e;
          color:#fff;
          padding:10px;
          border:1px solid #000;
          font-size:12px;
      }

      .student-table td{
          border:1px solid #000;
          padding:8px;
          font-size:11px;
      }

      .student-heading{
          text-align:center;
          margin-top:20px;
          font-size:22px;
          font-weight:bold;
      }

      .student-sub{
          text-align:center;
          margin-bottom:20px;
          color:#666;
      }

    </style>
    </head>

    <body>

    <div class="container">

      <div class="header">
        <img src="${company.logo_url || ""}" />
        <div class="header-text">
          <div class="title">${(company.company_name || "").toUpperCase()}</div>
          <div class="sub">18, Moshood Bakare Street, Gbagada Phase 1</div>
          <div class="sub">Tel: 09166767242, 07087522295</div>
        </div>
      </div>

      <div class="top">
        <div>
          <b>Invoice to:</b><br/>
          <p style="margin: 0; font-weight: bold; font-size: 25px;">${q.school_name}</p>
          <p style="margin: 5px 0; font-size: 12px;">${q.address || ""}</p>
          <br/><br/>
          <b>Payment for:</b><br/>
          ${q.term_name}
        </div>

        <div class="bank">
          <p style="font-size: 30px; color: #b89b5e; margin: 0;">Jaykirch Tech Hub</p>
          <p style="font-size: 18px;">Access Bank</p>
          <p style="font-size: 30px;">1582579748</p>
        </div>
      </div>

      <div class="date">Date: ${today}</div>

      <div class="section-title">CODING</div>
      <div class="section-title">CLASS INVOICE</div>

      <table>
        <tr>
          <th>S/N</th>
          <th>COURSE</th>
          <th>NO. OF STUDENTS</th>
          <th>AMOUNT PER STUDENT</th>
          <th>TOTAL (₦)</th>
        </tr>

        <tr>
          <td>1</td>
          <td>CODING</td>
          <td>${q.total_students}</td>
          <td>₦${Number(q.price_per_student).toLocaleString()}</td>
          <td>₦${total.toLocaleString()}</td>
        </tr>

        <tr class="total-row">
          <td colspan="4">TOTAL</td>
          <td>₦${total.toLocaleString()}</td>
        </tr>
      </table>

      <div class="amount-words">
        <b>AMOUNT IN WORDS:</b> ${words} NAIRA ONLY
      </div>

      <div class="payments">
        <p>
          <span>1st payment 60% (after midterm - ${midTermDate.toDateString()})</span>
          <span class="highlight">${firstPayment.toLocaleString()}</span>
        </p>

        <p>
          <span>Balance 40% (before exam - ${examDate.toDateString()})</span>
          <span class="highlight2">${secondPayment.toLocaleString()}</span>
        </p>
      </div>

      <p><b>Total Paid:</b> ₦${totalPaid}</p>
      <p><b>Balance:</b> ₦${balance}</p>

      <div class="signatures">

        <div class="sign">
          <div class="signature-box">
            <div class="line"></div>
          </div>
          School Director<br/>
          Signature & Date
        </div>

        <div class="sign">
          <div class="signature-box">
            <img src="https://acad.jkthub.com/images/Signature.jpg" class="signature-img" />
            <div class="sign-date">${today}</div>
            <div class="line"></div>
          </div>
          CEO<br/>
          Signature & Date
        </div>

      </div>

</div>

<!-- SECOND PAGE -->
<div class="page-break"></div>

<div class="container">

    <div class="student-heading">
        STUDENT LIST
    </div>

    <div class="student-sub">
        ${q.school_name}<br>
        ${q.term_name}
    </div>

    <table class="student-table">

        <tr>
            <th>S/N</th>
            <th>Student Name</th>
            <th>Class</th>
        </tr>

        ${students
          .map(
            (student, index) => `
            <tr>
                <td>${index + 1}</td>
                <td>${student.full_name}</td>
                <td>${student.class_name || "-"}</td>
            </tr>
        `,
          )
          .join("")}

    </table>

</div>

</body>
</html>
    `;

    const pdf = await generatePdf(html);

        const emailHtml = `
        <div style="
        background:#f4f4f4;
        padding:40px;
        font-family:Calibri,Arial;
        ">

        <div style="
        max-width:700px;
        margin:auto;
        background:white;
        border-radius:10px;
        overflow:hidden;
        ">

        <div style="
        background:#b89b5e;
        padding:35px;
        text-align:center;
        color:white;
        ">

        <img
        src="${company.logo_url || ""}"
        width="80">

        <h2 style="margin:15px 0 5px;">
        ${company.company_name || ""}
        </h2>

        <p style="margin:0;">
        Coding Class Invoice
        </p>

        </div>

        <div style="padding:35px;">

        <p>

        Dear <b>${q.school_name}</b>,

        </p>

        <p>

        Please find attached the invoice for the
        <b>${q.term_name}</b>
        coding programme.

        </p>

        <table
        style="
        width:100%;
        border-collapse:collapse;
        margin:25px 0;
        ">

        <tr>
        <td style="padding:10px;"><b>School</b></td>
        <td>${q.school_name}</td>
        </tr>

        <tr>
        <td style="padding:10px;"><b>Term</b></td>
        <td>${q.term_name}</td>
        </tr>

        <tr>
        <td style="padding:10px;"><b>No. of Students</b></td>
        <td>${q.total_students}</td>
        </tr>

        <tr>
        <td style="padding:10px;"><b>Amount</b></td>
        <td>₦${total.toLocaleString()}</td>
        </tr>

        <tr>
        <td style="padding:10px;"><b>Paid</b></td>
        <td>₦${totalPaid.toLocaleString()}</td>
        </tr>

        <tr>
        <td style="padding:10px;"><b>Balance</b></td>
        <td>₦${balance.toLocaleString()}</td>
        </tr>

        </table>

        <p>

        Kindly make payment according to the agreed payment schedule.

        </p>

        <div style="
        background:#faf8f1;
        padding:20px;
        border-left:5px solid #b89b5e;
        ">

        <b>Payment Details</b>

        <br><br>

        Access Bank

        <br>

        Account Name:
        <b>Jaykirch Tech Hub</b>

        <br>

        Account Number:
        <b>1582579748</b>

        </div>

        <br>

        For enquiries, kindly contact us.

        <br><br>

        Regards,

        <br>

        <b>${company.company_name || ""}</b>

        </div>

        <div style="
        background:#222;
        color:white;
        padding:20px;
        text-align:center;
        font-size:12px;
        ">

        © ${new Date().getFullYear()} ${company.company_name || ""}

        </div>

        </div>

        </div>
        `;

       if (q.school_email) {
              await sendEmailWithAttachment(
                  q.school_email,
                  `Coding Class Invoice - ${q.term_name}`,
                  emailHtml,
                  `${q.school_name.replace(/\s+/g, "_")}_Invoice.pdf`,
                  pdf,
                  ["jaykirchtechhub@gmail.com"]
              );
          }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${q.school_name.replace(/\s+/g, "_")}_Invoice.pdf`,
    );

    res.send(pdf);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error generating invoice");
  }
};

exports.generateSchoolReceipt = async (req, res, quote) => {
  try {
    // ===========================
    // GET STUDENTS
    // ===========================

    const studentsResult = await pool.query(
      `
        SELECT
            u.fullname AS full_name,
            c.name AS class_name
        FROM student_term_enrollments ste
        JOIN users2 u
            ON u.id = ste.student_id
        LEFT JOIN classrooms c
            ON c.id = ste.classroom_id
        WHERE ste.term_id = $1
        ORDER BY c.name,u.fullname
        `,
      [quote.term_id],
    );

    const students = studentsResult.rows;

    // ===========================
    // GET LATEST PAYMENT
    // ===========================

    const paymentResult = await pool.query(
      `
        SELECT *
        FROM school_payments
        WHERE quote_id=$1
        ORDER BY id DESC
        LIMIT 1
        `,
      [quote.id],
    );

    const payment = paymentResult.rows[0];

    // ===========================
    // CALCULATIONS
    // ===========================

    const totalAmount = Number(quote.total_amount || 0);
    const totalPaid = Number(quote.total_paid || 0);
    const balance = Number(quote.balance || 0);

    const paymentDate = payment
      ? new Date(
          payment.payment_date || payment.created_at || Date.now(),
        ).toDateString()
      : new Date().toDateString();

    const paymentMethod = payment?.payment_method || "Bank Transfer";

    const receiptNumber = `RCPT-${String(quote.id).padStart(6, "0")}`;

    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const company = infoResult.rows[0] || {};

    const invoiceNumber = `INV-${String(quote.id).padStart(6, "0")}`;

    const safeSchoolName = (quote.school_name || "School")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "_");

    const safeTermName = (quote.term_name || "Term")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "_");

    const receiptFileName = `${safeSchoolName}_${safeTermName}_${receiptNumber}.pdf`;

    const numberToWords = require("number-to-words");

    const amountWords = numberToWords
      .toWords(Math.round(totalPaid))
      .toUpperCase();

    const today = new Date().toDateString();

    // ===========================
    // STUDENT TABLE
    // ===========================

    const studentRows = students.length
      ? students
          .map(
            (student, index) => `

            <tr>

                <td>${index + 1}</td>

                <td>${student.full_name}</td>

                <td>${student.class_name || "-"}</td>

            </tr>

            `,
          )
          .join("")
      : `
            <tr>

                <td colspan="3">

                No students attached

                </td>

            </tr>
            `;

    // ===========================
    // RECEIPT HTML
    // ===========================

    const html = `

<!DOCTYPE html>

<html>

<head>

<style>

body{

    font-family:Calibri;

    margin:0;

    padding:0;

    background:#ffffff;

}

.container{

    width:80%;

    max-width:850px;

    margin:30px auto;

    padding:30px;

}

.header{

    display:flex;

    justify-content:center;

    align-items:center;

    gap:20px;

}

.header img{

    width:70px;

}

.header-text{

    text-align:center;

}

.title{

    font-size:20px;

    font-weight:bold;

}

.sub{

    font-size:12px;

}

.receipt-title{

    margin-top:25px;

    text-align:center;

    color:#198754;

    border:2px solid #198754;

    padding:12px;

    font-size:24px;

    font-weight:bold;

}

.top{

    display:flex;

    justify-content:space-between;

    margin-top:30px;

}

.bank{

    text-align:right;

}

.bank p{

    margin:4px;

}

.section{

    margin-top:25px;

}

table{

    width:100%;

    border-collapse:collapse;

    margin-top:10px;

}

th{

    background:#198754;

    color:white;

    padding:8px;

    font-size:12px;

}

td{

    border:1px solid #000;

    padding:8px;

    text-align:center;

    font-size:12px;

}

.total{

    background:#198754;

    color:#fff;

    font-weight:bold;

}

.words{

    margin-top:25px;

    font-size:13px;

}

.notice{

    margin-top:25px;

    background:#f8fff8;

    border-left:5px solid #198754;

    padding:20px;

    line-height:24px;

}

.signatures{

    margin-top:70px;

    display:flex;

    justify-content:space-between;

}

.sign{

    width:40%;

    text-align:center;

}

.line{

    margin-top:50px;

    border-top:1px solid black;

}

.signature-box{

    position:relative;

}

.signature-img{

    position:absolute;

    left:20%;

    bottom:10px;

    height:40px;

}

.sign-date{

    position:absolute;

    right:15%;

    bottom:10px;

    font-size:11px;

}

.footer{

    margin-top:40px;

    text-align:center;

    font-size:11px;

    color:#666;

}

.page-break{

    page-break-before:always;

}

.student-heading{

    text-align:center;

    font-size:22px;

    font-weight:bold;

}

.student-sub{

    text-align:center;

    margin-bottom:20px;

    color:#666;

}

</style>

</head>

<body>

<div class="container">

<div class="header">

<img src="${company.logo_url || ""}">

<div class="header-text">

<div class="title">

${(company.company_name || "").toUpperCase()}

</div>

<div class="sub">

18 Moshood Bakare Street, Gbagada Phase 1

</div>

<div class="sub">

09166767242 | 07087522295

</div>

</div>

</div>

<div class="receipt-title">

OFFICIAL SCHOOL PAYMENT RECEIPT

</div>

<div class="top">

<div>

<b>Received From</b>

<br><br>

<div style="font-size:24px;font-weight:bold;">

${quote.school_name}

</div>

<div>

${quote.school_email || ""}

</div>

<div>

${quote.phone || ""}

</div>

<div>

${quote.address || ""}

</div>

</div>

<div class="bank">

<p><b>Receipt No</b></p>

<p>${receiptNumber}</p>

<br>

<p><b>Invoice No</b></p>

<p>${invoiceNumber}</p>

<br>

<p><b>Payment Date</b></p>

<p>${paymentDate}</p>

</div>

</div>

<div class="section">

<h3>Receipt Summary</h3>

<table>

<tr>

<th>Description</th>

<th>Details</th>

</tr>

<tr>

<td>Programme</td>

<td>Coding Classes</td>

</tr>

<tr>

<td>Academic Term</td>

<td>${quote.term_name}</td>

</tr>

<tr>

<td>Number of Students</td>

<td>${quote.total_students}</td>

</tr>

<tr>

<td>Total Invoice</td>

<td>₦${totalAmount.toLocaleString()}</td>

</tr>

<tr class="total">

<td>Total Paid</td>

<td>₦${totalPaid.toLocaleString()}</td>

</tr>

<tr>

<td>Outstanding Balance</td>

<td>₦${balance.toLocaleString()}</td>

</tr>

<tr>

<td>Payment Method</td>

<td>${paymentMethod}</td>

</tr>

<tr>

<td>Payment Status</td>

<td style="font-weight:bold;color:${balance <= 0 ? "green" : "#f39c12"};">

${balance <= 0 ? "PAID IN FULL" : "PARTIAL PAYMENT"}

</td>

</tr>

</table>

</div>

<div class="words">

<b>AMOUNT RECEIVED IN WORDS</b>

<br><br>

${amountWords} NAIRA ONLY

</div>

<div class="notice">

<h3 style="margin-top:0;color:#198754;">

Payment Confirmation

</h3>

<p>

This receipt confirms that

<b>${quote.school_name}</b>

has made a payment of

<b>₦${totalPaid.toLocaleString()}</b>

towards the

<b>${quote.term_name}</b>

Coding Programme.

</p>

<p>

Remaining Balance:

<b>₦${balance.toLocaleString()}</b>

</p>

<p>

Thank you for your partnership with

<b>${company.company_name || ""}.</b>

</p>

</div>

<div class="signatures">

<div class="sign">

<div class="line"></div>

School Director

</div>

<div class="sign">

<div class="signature-box">

<img
src="https://acad.jkthub.com/images/Signature.jpg"
class="signature-img"
/>

<div class="sign-date">
${paymentDate}
</div>

<div class="line"></div>

</div>

Authorized Signature

</div>

</div>

<div class="footer">

This receipt serves as an official acknowledgement of payment made to
<b>${company.company_name || ""}</b>.

</div>

</div>

<div class="page-break"></div>

<div class="container">

<div class="student-heading">

STUDENT LIST

</div>

<div class="student-sub">

${quote.school_name}<br>

${quote.term_name}

</div>

<table>

<tr>

<th>S/N</th>

<th>Student Name</th>

<th>Class</th>

</tr>

${studentRows}

</table>

</div>

</body>

</html>
`;

    const pdf = await generatePdf(html);

    // ================= EMAIL RECEIPT ===================

    const emailHtml = `
<div style="
background:#f4f4f4;
padding:40px;
font-family:Calibri,Arial;
">

<div style="
max-width:700px;
margin:auto;
background:white;
border-radius:10px;
overflow:hidden;
">

<div style="
background:#198754;
padding:35px;
text-align:center;
color:white;
">

<img
src="${company.logo_url || ""}"
width="80">

<h2 style="margin:15px 0 5px;">
${company.company_name || ""}
</h2>

<p style="margin:0;">
Official Payment Receipt
</p>

</div>

<div style="padding:35px;">

<p>
Dear <b>${quote.school_name}</b>,
</p>

<p>

Thank you for your payment.

Please find attached your official payment receipt for the
<b>${quote.term_name}</b> Coding Programme.

</p>

<table
style="
width:100%;
border-collapse:collapse;
margin:25px 0;
">

<tr>
<td style="padding:10px;"><b>Receipt No</b></td>
<td>${receiptNumber}</td>
</tr>

<tr>
<td style="padding:10px;"><b>School</b></td>
<td>${quote.school_name}</td>
</tr>

<tr>
<td style="padding:10px;"><b>Academic Term</b></td>
<td>${quote.term_name}</td>
</tr>

<tr>
<td style="padding:10px;"><b>Students</b></td>
<td>${quote.total_students}</td>
</tr>

<tr>
<td style="padding:10px;"><b>Total Amount</b></td>
<td>₦${totalAmount.toLocaleString()}</td>
</tr>

<tr>
<td style="padding:10px;"><b>Amount Paid</b></td>
<td>₦${totalPaid.toLocaleString()}</td>
</tr>

<tr>
<td style="padding:10px;"><b>Balance</b></td>
<td>₦${balance.toLocaleString()}</td>
</tr>

<tr>
<td style="padding:10px;"><b>Status</b></td>
<td style="
font-weight:bold;
color:${balance <= 0 ? "green" : "#f39c12"};
">
${balance <= 0 ? "FULLY PAID" : "PARTIALLY PAID"}
</td>
</tr>

<tr>
<td style="padding:10px;"><b>Payment Date</b></td>
<td>${paymentDate}</td>
</tr>

</table>

<p>

Thank you for partnering with
<b>${company.company_name || ""}.</b>

</p>

<br>

Regards,

<br>

<b>${company.company_name || ""}</b>

</div>

<div style="
background:#222;
color:white;
padding:20px;
text-align:center;
font-size:12px;
">

© ${new Date().getFullYear()} ${company.company_name || ""}

</div>

</div>

</div>
`;

    if (quote.school_email) {
      await sendEmailWithAttachment(
          quote.school_email,
          `Payment Receipt - ${receiptNumber}`,
          emailHtml,
          receiptFileName,
          pdf,
          ["jaykirchtechhub@gmail.com"]
      );
    }

    //================ DOWNLOAD ===================

    res.setHeader("Content-Type", "application/pdf");

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${receiptFileName}"`,
    );

    res.send(pdf);
  } catch (err) {
    console.error("================================");
    console.error("GENERATE SCHOOL RECEIPT ERROR");
    console.error(err);

    res.status(500).json({
      message: err.message,
    });
  }
};

exports.updateQuoteStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ error: "Status is required" });
    }

    await pool.query("UPDATE quotes SET status = $1 WHERE id = $2", [
      status,
      id,
    ]);

    // ✅ If request is from fetch (AJAX)
    if (req.headers.accept && req.headers.accept.includes("application/json")) {
      return res.json({ success: true, status });
    }

    // ✅ If request is from form
    res.redirect("/admin/quotes");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error updating status");
  }
};

exports.addParentPayment = async (req, res) => {

    try{

        const {

            invoice_id,
            amount,
            payment_method,
            payment_note,
            payment_date

        } = req.body;

        const amountValue = Number(amount);

        const transactionReference =
            "PAY-" +
            Date.now() +
            "-" +
            Math.floor(Math.random()*100000);

        const receiptNumber =
            "RCT-" +
            Date.now();

        // Save payment

        await pool.query(

            `
            INSERT INTO parent_payments
            (
                invoice_id,
                amount,
                payment_method,
                transaction_reference,
                receipt_number,
                payment_note,
                payment_date,
                recorded_by
            )

            VALUES

            ($1,$2,$3,$4,$5,$6,$7,$8)
            `,

            [

                invoice_id,

                amountValue,

                payment_method,

                transactionReference,

                receiptNumber,

                payment_note || null,

                payment_date,

                req.session.user.id

            ]

        );

        // Total paid

        // const payment = await pool.query(

        //     `
        //     SELECT

        //         COALESCE(SUM(amount),0) total_paid

        //     FROM parent_payments

        //     WHERE invoice_id=$1
        //     `,

        //     [invoice_id]

        // );

        // const totalPaid =
        //     Number(payment.rows[0].total_paid);

        const payment = await pool.query(
        `
        SELECT
            COALESCE(SUM(amount),0) AS total_paid,
            MAX(payment_date) AS final_payment_date
        FROM parent_payments
        WHERE invoice_id=$1
        `,
        [invoice_id]
        );

        const totalPaid = Number(payment.rows[0].total_paid);
        const finalPaymentDate = payment.rows[0].final_payment_date;

        // Invoice

        const invoice = await pool.query(

            `
            SELECT

                agreed_amount,
                discount

            FROM parent_training_invoices

            WHERE id=$1
            `,

            [invoice_id]

        );

        const agreed =
            Number(invoice.rows[0].agreed_amount);

        const discount =
            Number(invoice.rows[0].discount);

        const payable =
            agreed - discount;

        const excessPayment = Math.max(0, totalPaid - payable);
        const balance = Math.max(0, payable - totalPaid);

        let status = "pending";

        if(totalPaid<=0){

            status="pending";

        }
        else if(totalPaid<payable){

            status="partial";

        }
        else{

            status="paid";

        }

        await pool.query(

            `
            UPDATE parent_training_invoices

            SET

                total_paid=$1,

                balance=$2,

                excess_payment =$3,

                status=$4,
                final_payment_date = $5
            WHERE id = $6
            `,

            [

                totalPaid,

                balance,

                excessPayment,

                status,

                finalPaymentDate,

                invoice_id

            ]

        );


        res.redirect("/admin/parent-invoices");

    }

    catch(err){

        console.log(err);

        res.status(500).send("Payment Error");

    }

};

exports.getParentInvoices = async (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.redirect("/admin/login");
  }
  try {
    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const info = infoResult.rows[0] || {};

    const invoices = await pool.query(`
      SELECT
          i.*,

          p.fullname AS parent_name,
          p.phone,
          p.email,

          (i.agreed_amount - i.discount) AS payable,

          COALESCE(
              STRING_AGG(DISTINCT s.fullname, ', '),
              'No Students'
          ) AS students

      FROM parent_training_invoices i

      JOIN users2 p
      ON p.id=i.parent_id

      LEFT JOIN invoice_students ins
      ON ins.invoice_id=i.id

      LEFT JOIN users2 s
      ON s.id=ins.student_id

      GROUP BY
          i.id,
          p.id,
          p.fullname,
          p.phone,
          p.email

      ORDER BY i.created_at DESC
      `);
    const summary = await pool.query(`
        SELECT

            COALESCE(SUM(agreed_amount-discount),0) total_expected,
            COALESCE(SUM(total_paid),0) total_paid,
            COALESCE(SUM(balance),0) outstanding,

            COUNT(*) FILTER (WHERE status='paid') paid_quotes,
            COUNT(*) FILTER (WHERE status='partial') partial_quotes,
            COUNT(*) FILTER (WHERE status='pending') pending_quotes

        FROM parent_training_invoices
    `);

    const trend = await pool.query(`
      SELECT
          DATE(payment_date) AS payment_day,
          TO_CHAR(DATE(payment_date), 'DD Mon') AS day,
          SUM(amount) AS total
      FROM parent_payments
      GROUP BY DATE(payment_date)
      ORDER BY DATE(payment_date)
  `);

    res.render("admin/parentInvoices", {
      invoices: invoices.rows,
      summary: summary.rows[0],
      trend: trend.rows,
      currentPage: "parentInvoices",
      role: "admin",
      info,
    });
  } catch (err) {
    console.log(err);

    res.status(500).send("Error loading invoices");
  }
};

exports.getInvoicePayments = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
        SELECT

            pp.id,
            pp.amount,
            pp.payment_method,
            pp.payment_date,
            pp.transaction_reference,
            pp.receipt_number,
            pp.payment_note,

            u.fullname recorded_by

        FROM parent_payments pp

        LEFT JOIN users2 u
        ON u.id=pp.recorded_by

        WHERE invoice_id=$1

        ORDER BY payment_date DESC
        `,
      [id],
    );

    res.json(result.rows);
  } catch (err) {
    console.log(err);

    res.status(500).json({
      message: "Unable to load payments",
    });
  }
};

exports.searchParents = async (req, res) => {
  try {
    const keyword = req.query.keyword || "";

    const parents = await pool.query(
      `
      SELECT
          id,
          fullname,
          email,
          phone
      FROM users2
      WHERE role='parent'
      AND (
            fullname ILIKE $1
            OR email ILIKE $1
            OR phone ILIKE $1
      )
      ORDER BY fullname
      LIMIT 10
      `,
      [`%${keyword}%`]
    );

    res.json(parents.rows);

  } catch (err) {
    console.log(err);
    res.status(500).json([]);
  }
};

exports.getParentStudents = async (req, res) => {
  try {
    const { parentId } = req.params;

    console.log("Parent ID:", parentId);

    const students = await pool.query(
      `
            SELECT
                u.id,
                u.fullname,
                u.email
            FROM parent_children pc
            JOIN users2 u
                ON u.id = pc.child_id
            WHERE pc.parent_id = $1
        `,
      [parentId],
    );

    console.log("Students:", students.rows);

    res.json(students.rows);
  } catch (err) {
    console.log(err);
    res.status(500).json([]);
  }
};

exports.createParentTrainingInvoice = async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const {
      parent_id,

      training_title,

      agreed_amount,

      discount,

      due_date,

      grace_days,

      notes,

      student_ids,
    } = req.body;

    const amount = Number(agreed_amount);

    const discountValue = Number(discount || 0);

    const balance = amount - discountValue;

    const invoiceNumber = "INV-" + Date.now();

    const invoice = await client.query(
      `
            INSERT INTO parent_training_invoices
            (
                parent_id,
                invoice_number,
                training_title,
                agreed_amount,
                discount,
                total_paid,
                balance,
                due_date,
                grace_days,
                notes,
                created_by
            )

            VALUES

            ($1,$2,$3,$4,$5,0,$6,$7,$8,$9,$10)

            RETURNING id
            `,

      [
        parent_id,

        invoiceNumber,

        training_title,

        amount,

        discountValue,

        balance,

        due_date || null,

        Number(grace_days || 0),

        notes,

        req.session.user.id,
      ],
    );

    const invoiceId = invoice.rows[0].id;

    if (student_ids) {
      const list = Array.isArray(student_ids) ? student_ids : [student_ids];

      for (const studentId of list) {
        await client.query(
          `
                    INSERT INTO invoice_students
                    (
                        invoice_id,
                        student_id
                    )

                    VALUES

                    ($1,$2)
                    `,

          [invoiceId, studentId],
        );
      }
    }

    await client.query("COMMIT");

    res.redirect("/admin/parent-invoices");
  } catch (err) {
    await client.query("ROLLBACK");

    console.log(err);

    res.status(500).send("Unable to create invoice");
  } finally {
    client.release();
  }
};

exports.downloadParentInvoicePDF = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT
          i.*,
          u.fullname AS parent_name,
          u.email AS parent_email,
          u.phone AS parent_phone
      FROM parent_training_invoices i
      JOIN users2 u
          ON i.parent_id = u.id
      WHERE i.id = $1
      `,
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Invoice not found",
      });
    }

    const invoice = result.rows[0];

    if (invoice.status === "paid") {
        return exports.generateParentReceipt(req, res, invoice);
    }

    // Fetch students attached to invoice
    const studentResult = await pool.query(
      `
      SELECT
          u.fullname
      FROM invoice_students s
      JOIN users2 u
          ON s.student_id = u.id
      WHERE s.invoice_id = $1
      ORDER BY u.fullname
      `,
      [id],
    );

    const students = studentResult.rows;

    const agreedAmount = Number(invoice.agreed_amount || 0);
    const discount = Number(invoice.discount || 0);
    const totalPaid = Number(invoice.total_paid || 0);
    const balance = Number(invoice.balance || 0);

    const netAmount = agreedAmount - discount;

    const numberToWords = require("number-to-words");

    const amountWords = numberToWords
      .toWords(Math.round(netAmount))
      .toUpperCase();

    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const company = infoResult.rows[0] || {};

    // const today = new Date().toDateString();
    const today = new Date();
    const todayString = today.toDateString();

    const dueDate = invoice.due_date
      ? new Date(invoice.due_date)
      : null;

    const isOverdue =
      dueDate &&
      today > dueDate &&
      balance > 0;

    // Calculate days remaining
    let dueMessage = "Not Specified";

    if (dueDate) {
      const diffDays = Math.ceil(
        (dueDate - today) / (1000 * 60 * 60 * 24)
      );

      if (balance <= 0) {
        dueMessage = "PAID";
      } else if (diffDays > 0) {
        dueMessage = `${diffDays} day${diffDays > 1 ? "s" : ""} remaining`;
      } else if (diffDays === 0) {
        dueMessage = "Due Today";
      } else {
        dueMessage = `${Math.abs(diffDays)} day${Math.abs(diffDays) > 1 ? "s" : ""} overdue`;
      }
    }

    const studentRows =
      students.length > 0
        ? students
            .map(
              (student, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${student.fullname}</td>
        </tr>
      `,
            )
            .join("")
        : `
      <tr>
        <td colspan="2">No students attached</td>
      </tr>
      `;

    const html = `
<!DOCTYPE html>
<html>

<head>

<style>

body{
    font-family:Calibri;
    margin:0;
    padding:0;
    background:#ffffff;
    display:flex;
    justify-content:center;
}

.container{
    width:80%;
    max-width:800px;
    padding:30px;
}

.header{
    display:flex;
    justify-content:center;
    align-items:center;
    gap:20px;
}

.header img{
    width:70px;
}

.header-text{
    text-align:center;
}

.title{
    font-size:20px;
    font-weight:bold;
}

.sub{
    font-size:12px;
}

.top{
    display:flex;
    justify-content:space-between;
    margin-top:35px;
}

.bank{
    text-align:right;
}

.bank p{
    margin:3px;
}

.date{
    margin-top:15px;
    text-align:right;
    font-size:12px;
}

.invoice-title{
    margin-top:15px;
    text-align:right;
    font-size:13px;
    font-weight:bold;
    color:#b89b5e;
}

.section{
    margin-top:20px;
}

.section h3{
    margin-bottom:8px;
}

table{
    width:100%;
    border-collapse:collapse;
    margin-top:10px;
}

th{
    background:#b89b5e;
    color:white;
    padding:7px;
    font-size:11px;
}

td{
    border:1px solid #000;
    padding:7px;
    font-size:11px;
    text-align:center;
}

.summary{
    margin-top:20px;
}

.summary table{
    width:100%;
}

.summary td{
    text-align:left;
    font-size:12px;
    padding:8px;
}

.total{
    background:black;
    color:white;
    font-weight:bold;
}

.words{
    margin-top:20px;
    font-size:12px;
}

.notes{
    margin-top:20px;
    font-size:12px;
    line-height:20px;
}

.signatures{
    margin-top:60px;
    display:flex;
    justify-content:space-between;
}

.sign{
    width:40%;
    text-align:center;
}

.line{
    margin-top:50px;
    border-top:1px solid black;
}

.signature-box{
    position:relative;
}

.signature-img{
    position:absolute;
    height:40px;
    left:20%;
    bottom:10px;
}

.sign-date{
    position:absolute;
    right:20%;
    bottom:10px;
    font-size:11px;
}

</style>

</head>

<body>

<div class="container">

<div class="header">

<img src="${company.logo_url || ""}">

<div class="header-text">

<div class="title">
${(company.company_name || "").toUpperCase()}
</div>

<div class="sub">
18 Moshood Bakare Street, Gbagada Phase 1
</div>

<div class="sub">
09166767242 | 07087522295
</div>

</div>

</div>

<div class="top">

<div>

<b>Invoice To</b><br><br>

<p style="font-size:24px;margin:0;font-weight:bold;">
${invoice.parent_name}
</p>

<p style="margin:4px 0;">
${invoice.parent_email}
</p>

<p style="margin:4px 0;">
${invoice.parent_phone || ""}
</p>

</div>

<div class="bank">

<p style="font-size:28px;color:#b89b5e;font-weight:bold;">
Jaykirch Tech Hub
</p>

<p style="font-size:18px;">
Access Bank
</p>

<p style="font-size:28px;">
1582579748
</p>

</div>

</div>

<div class="date">
Date: ${todayString}
</div>

<div class="invoice-title">
PARENT TRAINING INVOICE
</div>

<div class="section">

<h3>Students Covered</h3>

<table>

<tr>
<th>S/N</th>
<th>Student Name</th>
</tr>

${studentRows}

</table>

</div>


<div class="section">

<h3>Invoice Summary</h3>

<table>

<tr>
<th>Description</th>
<th>Amount (₦)</th>
</tr>

<tr>
<td>Training Title</td>
<td>${invoice.training_title}</td>
</tr>

<tr>
<td>Training Fee</td>
<td>₦${agreedAmount.toLocaleString()}</td>
</tr>

<tr>
<td>Discount</td>
<td>₦${discount.toLocaleString()}</td>
</tr>

<tr class="total">
<td>Net Amount</td>
<td>₦${netAmount.toLocaleString()}</td>
</tr>

<tr>
<td>Total Paid</td>
<td>₦${totalPaid.toLocaleString()}</td>
</tr>

<tr>
<td>Balance</td>
<td>₦${balance.toLocaleString()}</td>
</tr>

<tr>
<td>Payment Plan</td>
<td>${invoice.payment_plan}</td>
</tr>

<tr>
<td>Due Date</td>
<td>
${dueDate ? dueDate.toDateString() : "Not Specified"}
</td>
</tr>

<tr>
<td style="padding:10px;"><b>Grace Period</b></td>
<td>
${
  Number(invoice.grace_days) > 0
    ? `${invoice.grace_days} day${invoice.grace_days > 1 ? "s" : ""}`
    : "No Grace Period"
}
</td>
</tr>

<tr>
<td>Payment Timeline</td>
<td style="
font-weight:bold;
color:${isOverdue ? "red" : balance <= 0 ? "green" : "#b89b5e"};
">
${dueMessage}
</td>
</tr>

<tr>
<td>Status</td>

<td style="
font-weight:bold;
color:${
      balance <= 0
        ? "green"
        : isOverdue
          ? "red"
          : invoice.status === "partial"
            ? "orange"
            : "#b89b5e"
    };
">

${balance <= 0 ? "PAID" : isOverdue ? "OVERDUE" : invoice.status.toUpperCase()}

</td>

</tr>

</table>

</div>

<div class="words">

<b>AMOUNT IN WORDS:</b>

${amountWords} NAIRA ONLY

</div>

${
  invoice.notes
    ? `
<div class="notes">

<b>Notes</b>

<p>${invoice.notes}</p>

</div>
`
    : ""
}

<div class="notes">

<b>Payment Details</b>

<p>

Bank Name: <b>Access Bank</b><br>

Account Name: <b>Jaykirch Tech Hub</b><br>

Account Number: <b>1582579748</b>

</p>

</div>

<div class="signatures">

<div class="sign">

<div class="line"></div>

Parent Signature

</div>

<div class="sign">

<div class="signature-box">

<img
src="https://acad.jkthub.com/images/Signature.jpg"
class="signature-img"
/>

<div class="sign-date">

${todayString}

</div>

<div class="line"></div>

</div>

CEO Signature

</div>

</div>

</div>

</body>

</html>
`;

    const pdf = await generatePdf(html);
    console.log(Buffer.isBuffer(pdf));
    console.log(pdf.constructor.name);

    await sendEmailWithAttachment(
      invoice.parent_email,

      `Training Invoice - ${invoice.invoice_number}`,

      `
<div style="
background:#f4f4f4;
padding:40px;
font-family:Calibri,Arial;
">

<div style="
max-width:700px;
margin:auto;
background:white;
border-radius:10px;
overflow:hidden;
">

<div style="
background:#b89b5e;
padding:35px;
text-align:center;
color:white;
">

<img
src="${company.logo_url || ""}"
width="80">

<h2 style="margin:15px 0 5px;">
${company.company_name || ""}
</h2>

<p style="margin:0;">
Training Invoice
</p>

</div>

<div style="padding:35px;">

<p>

Dear <b>${invoice.parent_name}</b>,

</p>

<p>

Thank you for choosing
<b>${company.company_name || ""}.</b>

Please find attached your
training invoice.

</p>

<table
style="
width:100%;
border-collapse:collapse;
margin:25px 0;
">

<tr>

<td style="padding:10px;"><b>Invoice Number</b></td>

<td>${invoice.invoice_number}</td>

</tr>

<tr>

<td style="padding:10px;"><b>Training</b></td>

<td>${invoice.training_title}</td>

</tr>

<tr>

<td style="padding:10px;"><b>Students</b></td>

<td>${students.length}</td>

</tr>

<tr>

<td style="padding:10px;"><b>Amount</b></td>

<td>₦${netAmount.toLocaleString()}</td>

</tr>

<tr>

<td style="padding:10px;"><b>Paid</b></td>

<td>₦${totalPaid.toLocaleString()}</td>

</tr>

<tr>

<td style="padding:10px;"><b>Balance</b></td>

<td>₦${balance.toLocaleString()}</td>

</tr>

<tr>
<td style="padding:10px;" ><b>Due Date</b></td>
<td>
${
dueDate
? dueDate.toDateString()
: "Not Specified"
}
</td>
</tr>

<tr>
<td>Payment Timeline</td>
<td style="
font-weight:bold;
color:${
isOverdue
? "red"
: balance <= 0
? "green"
: "#b89b5e"
};
">
${dueMessage}
</td>
</tr>

</table>

<p>

Kindly make payment before the due date.

</p>

<div style="
background:#faf8f1;
padding:20px;
border-left:5px solid #b89b5e;
">

<b>Payment Details</b>

<br><br>

Access Bank

<br>

Account Name:
<b>Jaykirch Tech Hub</b>

<br>

Account Number:
<b>1582579748</b>

</div>

<br>

Kindly make payment on or before the due date.

For enquiries, contact our office.

<br><br>

Regards,

<br>

<b>${company.company_name || ""}</b>

</div>

<div style="
background:#222;
color:white;
padding:20px;
text-align:center;
font-size:12px;
">

© ${new Date().getFullYear()} ${company.company_name || ""}

</div>

</div>

</div>
`,

      `${invoice.invoice_number}.pdf`,

      pdf,
      ["jaykirchtechhub@gmail.com"]
    );

    await pool.query(
      `
      UPDATE parent_training_invoices
      SET status='sent'
      WHERE id=$1
      AND status='pending'
      `,
      [id],
    );

    res.setHeader("Content-Type", "application/pdf");

    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${invoice.parent_name.replace(/\s+/g, "_")}_Invoice.pdf`,
    );

    res.send(pdf);
    } catch (err) {
      console.error("================================");
      console.error("DOWNLOAD INVOICE ERROR");
      console.error(err);

      if (err.response) {
        console.error("Brevo Response:");
        console.error(err.response.body);
      }

      res.status(500).json({
        message: err.message,
        stack: err.stack,
      });
    }
};

exports.generateParentReceipt = async (req, res, invoice) => {

  try {

    const studentResult = await pool.query(
        `
        SELECT
            u.fullname
        FROM invoice_students s
        JOIN users2 u
            ON s.student_id = u.id
        WHERE s.invoice_id = $1
        ORDER BY u.fullname
        `,
        [invoice.id]
    );

    const students = studentResult.rows;

    const agreedAmount = Number(invoice.agreed_amount || 0);
    const discount = Number(invoice.discount || 0);
    const totalPaid = Number(invoice.total_paid || 0);

    const netAmount = agreedAmount - discount;

    const numberToWords = require("number-to-words");

    const amountWords = numberToWords
        .toWords(Math.round(totalPaid))
        .toUpperCase();

    const paymentResult = await pool.query(
      `
      SELECT payment_date, payment_method
      FROM parent_payments
      WHERE invoice_id = $1
      ORDER BY payment_date DESC
      LIMIT 1
      `,
      [invoice.id]
      );

      const payment = paymentResult.rows[0];

      const paymentDate = payment
          ? new Date(payment.payment_date).toDateString()
          : new Date().toDateString(); 

      // let paymentTimeline = "Not Fully Paid";

      // if (invoice.status === "paid" && payment && invoice.due_date) {

      //     const due = new Date(invoice.due_date);
      //     const paid = new Date(payment.payment_date);

      //     due.setHours(0,0,0,0);
      //     paid.setHours(0,0,0,0);

      //     const diff = Math.floor(
      //         (paid - due) / (1000 * 60 * 60 * 24)
      //     );

      //     if (diff < 0) {
      //         paymentTimeline = `${Math.abs(diff)} day${Math.abs(diff) > 1 ? "s" : ""} Early`;
      //     } else if (diff === 0) {
      //         paymentTimeline = "Paid On Time";
      //     } else {
      //         paymentTimeline = `${diff} day${diff > 1 ? "s" : ""} Late`;
      //     }
    // }
    
    let paymentTimeline = "Not Fully Paid";

    if (invoice.status === "paid" && payment && invoice.due_date) {
      const dueDate = new Date(invoice.due_date);
      dueDate.setHours(0, 0, 0, 0);

      const graceEnd = new Date(invoice.due_date);
      graceEnd.setDate(graceEnd.getDate() + Number(invoice.grace_days || 0));
      graceEnd.setHours(0, 0, 0, 0);

      const paid = new Date(payment.payment_date);
      paid.setHours(0, 0, 0, 0);

      if (paid <= dueDate) {
        paymentTimeline = "Paid On Time";
      } else if (paid <= graceEnd) {
        paymentTimeline = `Paid During ${invoice.grace_days}-Day Grace Period`;
      } else {
        const diff = Math.floor((paid - graceEnd) / (1000 * 60 * 60 * 24));

        paymentTimeline = `${diff} day${diff > 1 ? "s" : ""} Late (After Grace Period)`;
      }
    }
    const receiptNumber = invoice.invoice_number
      ? invoice.invoice_number.replace(/^INV/i, "RCPT")
      : `RCPT-${invoice.id}`;

    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const company = infoResult.rows[0] || {};

    const studentRows =
      students.length
      ? students.map((student,index)=>`

      <tr>
      <td>${index+1}</td>
      <td>${student.fullname}</td>
      </tr>

      `).join("")
      :
      `
      <tr>
      <td colspan="2">
      No students attached
      </td>
      </tr>
      `;

      const html = `
      <!DOCTYPE html>
      <html>

      <head>

      <style>

      body{
          font-family:Calibri;
          margin:0;
          padding:0;
          background:#fff;
          display:flex;
          justify-content:center;
      }

      .container{
          width:80%;
          max-width:800px;
          padding:30px;
      }

      .header{
          display:flex;
          justify-content:center;
          align-items:center;
          gap:20px;
      }

      .header img{
          width:70px;
      }

      .header-text{
          text-align:center;
      }

      .title{
          font-size:20px;
          font-weight:bold;
      }

      .sub{
          font-size:12px;
      }

      .receipt-title{
          margin-top:25px;
          text-align:center;
          font-size:24px;
          color:green;
          font-weight:bold;
          border:2px solid green;
          padding:10px;
      }

      .top{
          display:flex;
          justify-content:space-between;
          margin-top:35px;
      }

      .bank{
          text-align:right;
      }

      .bank p{
          margin:3px;
      }

      .section{
          margin-top:25px;
      }

      table{
          width:100%;
          border-collapse:collapse;
          margin-top:10px;
      }

      th{
          background:#b89b5e;
          color:white;
          padding:8px;
          font-size:12px;
      }

      td{
          border:1px solid #000;
          padding:8px;
          font-size:12px;
          text-align:center;
      }

      .words{
          margin-top:25px;
          font-size:13px;
      }

      .received{
          margin-top:25px;
          background: #fffcf3;
          border-left:5px solid #b89b5e;
          padding:15px;
          line-height:24px;
      }

      .signatures{
          margin-top:70px;
          display:flex;
          justify-content:space-between;
      }

      .sign{
          width:40%;
          text-align:center;
      }

      .line{
          margin-top:50px;
          border-top:1px solid #000;
      }

      .signature-box{
          position:relative;
      }

      .signature-img{
          position:absolute;
          left:20%;
          bottom:10px;
          height:40px;
      }

      .sign-date{
          position:absolute;
          right:15%;
          bottom:10px;
          font-size:11px;
      }

      .footer{
          margin-top:40px;
          text-align:center;
          font-size:11px;
          color:#555;
      }

      .total{
          background:#198754;
          color:white;
          font-weight:bold;
      }

      </style>

      </head>

      <body>

      <div class="container">

      <div class="header">

      <img src="${company.logo_url || ""}">

      <div class="header-text">

      <div class="title">
      ${(company.company_name || "").toUpperCase()}
      </div>

      <div class="sub">
      18 Moshood Bakare Street, Gbagada Phase 1
      </div>

      <div class="sub">
      09166767242 | 07087522295
      </div>

      </div>

      </div>

      <div class="receipt-title">

      OFFICIAL PAYMENT RECEIPT

      </div>

      <div class="top">

      <div>

      <b>Received From</b>

      <br><br>

      <div style="font-size:24px;font-weight:bold;">
      ${invoice.parent_name}
      </div>

      <div>
      ${invoice.parent_email}
      </div>

      <div>
      ${invoice.parent_phone || ""}
      </div>

      </div>

      <div class="bank">

      <p><b>Receipt No</b></p>

      <p>${receiptNumber}</p>

      <br>

      <p><b>Invoice No</b></p>

      <p>${invoice.invoice_number}</p>

      <br>

      <p><b>Final Payment Date</b></p>

      <p>${paymentDate}</p>

      </div>

      </div>

      <div class="section">

      <h3>Students Covered</h3>

      <table>

      <tr>
      <th>S/N</th>
      <th>Student Name</th>
      </tr>

      ${studentRows}

      </table>

      </div>

      <div class="section">

        <h3>Receipt Summary</h3>

        <table>

        <tr>
        <th>Description</th>
        <th>Details</th>
        </tr>

        <tr>
        <td>Training</td>
        <td>${invoice.training_title}</td>
        </tr>

        <tr>
        <td>Training Fee</td>
        <td>₦${agreedAmount.toLocaleString()}</td>
        </tr>

        <tr>
        <td>Discount</td>
        <td>₦${discount.toLocaleString()}</td>
        </tr>

        <tr>
        <td>Net Amount</td>
        <td>₦${netAmount.toLocaleString()}</td>
        </tr>

        <tr class="total">
        <td>Amount Paid</td>
        <td>₦${totalPaid.toLocaleString()}</td>
        </tr>

        ${
          Number(invoice.excess_payment) > 0
            ? `
        <tr>
            <td>Excess Payment</td>
            <td>₦${Number(invoice.excess_payment).toLocaleString()}</td>
        </tr>
        `
            : ""
        }

        <tr>
        <td>Payment Method</td>
        <td>${payment?.payment_method || "Bank Transfer"}</td>
        </tr>

        <tr>
        <td>Payment Performance</td>
          <td style="
          color:${
            paymentTimeline.includes("Late")
              ? "red"
              : paymentTimeline.includes("Early")
                ? "green"
                : "#198754"
          };
          font-weight:bold;
          ">
          ${paymentTimeline}
          </td>
          </tr>

          <tr>
              <td>Grace Period</td>
              <td>
                  ${
                    Number(invoice.grace_days) > 0
                      ? `${invoice.grace_days} day${invoice.grace_days > 1 ? "s" : ""}`
                      : "No Grace Period"
                  }
              </td>
          </tr>

        <tr>
        <td>Payment Status</td>
        <td style="
        color:green;
        font-weight:bold;
        font-size:14px;
        ">
        ${invoice.status.toUpperCase()}
        </td>
        </tr>

        </table>

        </div>
      <div class="words">

        <b>AMOUNT RECEIVED IN WORDS:</b>

        <br><br>

        ${amountWords} NAIRA ONLY

        </div>

        <div class="received">

        <h3 style="margin-top:0;color:green;">
        Payment Confirmation
        </h3>

        <p>

        This is to certify that payment has been successfully received from

        <b>${invoice.parent_name}</b>

        for the training programme

        <b>${invoice.training_title}</b>.

        </p>

        ${
          invoice.status === "paid"
            ? `
            <p>
            The total amount of
            <b>₦${totalPaid.toLocaleString()}</b>
            has been received and the invoice has been fully settled.
            </p>
            `
            : `
            <p>
            A payment of
            <b>₦${totalPaid.toLocaleString()}</b>
            has been received.
            The remaining balance is
            <b>₦${Number(invoice.balance).toLocaleString()}</b>.
            </p>
            `
        }

        <p>

        Thank you for choosing
        <b>${company.company_name || ""}.</b>

        </p>

        </div>
        <div class="signatures">

        <div class="sign">

        <div class="line"></div>

        Parent / Guardian

        </div>

        <div class="sign">

        <div class="signature-box">

        <img
        src="https://acad.jkthub.com/images/Signature.jpg"
        class="signature-img"
        />

        <div class="sign-date">

        ${paymentDate}

        </div>

        <div class="line"></div>

        </div>

        Authorized Signature

        </div>

        </div>

        <div class="footer">

        This receipt is computer generated and serves as an official acknowledgement
        of payment made to <b>${company.company_name || ""}</b>.

        <br><br>

        Thank you for your patronage.

        </div>

        </div>

        </body>

        </html>
        `;

        const pdf = await generatePdf(html);
        await sendEmailWithAttachment(

            invoice.parent_email,

            `Payment Receipt - ${receiptNumber}`,

            `
        <div style="
        background:#f4f4f4;
        padding:40px;
        font-family:Calibri,Arial;
        ">

        <div style="
        max-width:700px;
        margin:auto;
        background:white;
        border-radius:10px;
        overflow:hidden;
        ">

        <div style="
        background:#198754;
        padding:35px;
        text-align:center;
        color:white;
        ">

        <img
        src="${company.logo_url || ""}"
        width="80">

        <h2 style="margin:15px 0 5px;">
        ${company.company_name || ""}
        </h2>

        <p style="margin:0;">
        Official Payment Receipt
        </p>

        </div>

        <div style="padding:35px;">

        <p>

        Dear <b>${invoice.parent_name}</b>,

        </p>

        <p>

        Thank you for your payment.

        Your payment has been successfully received and processed.

        Please find your official payment receipt attached to this email.

        </p>

        <table
        style="
        width:100%;
        border-collapse:collapse;
        margin:25px 0;
        ">

        <tr>
        <td style="padding:10px;"><b>Receipt No</b></td>
        <td>${receiptNumber}</td>
        </tr>

        <tr>
        <td style="padding:10px;"><b>Invoice No</b></td>
        <td>${invoice.invoice_number}</td>
        </tr>

        <tr>
        <td style="padding:10px;"><b>Training</b></td>
        <td>${invoice.training_title}</td>
        </tr>

        <tr>
        <td style="padding:10px;"><b>Students</b></td>
        <td>${students.length}</td>
        </tr>

        <tr>
        <td style="padding:10px;"><b>Amount Paid</b></td>
        <td>₦${totalPaid.toLocaleString()}</td>
        </tr>

        <tr>
        <td style="padding:10px;"><b>Final Payment Date</b></td>
        <td>${paymentDate}</td>
        </tr>

        <tr>
        <td style="padding:10px;"><b>Status</b></td>
        <td
        style="
        font-weight:bold;
        color:${
            invoice.status === "paid"
                ? "green"
                : invoice.status === "partial"
                ? "#f39c12"
                : "red"
        };
        ">
        ${invoice.status.toUpperCase()}
        </td>
        </tr>

        </table>

        <p>

        We appreciate your trust in
        <b>${company.company_name || ""}</b>.

        We look forward to seeing you in class.

        </p>

        <br>

        Regards,

        <br>

        <b>${company.company_name || ""}</b>

        </div>

        <div style="
        background:#222;
        color:white;
        padding:20px;
        text-align:center;
        font-size:12px;
        ">

        © ${new Date().getFullYear()} ${company.company_name || ""}

        </div>

        </div>

        </div>
        `,

        `${receiptNumber}.pdf`,

        pdf,
        ["jaykirchtechhub@gmail.com"]

        );
    res.setHeader("Content-Type", "application/pdf");

    res.setHeader(
        "Content-Disposition",
        `attachment; filename=${receiptNumber}.pdf`
    );

    res.send(pdf);

    } catch(err){

        console.error("================================");
        console.error("GENERATE RECEIPT ERROR");
        console.error(err);

        res.status(500).json({
            message: err.message
        });

    }

};

// 📌 GET: School Courses (assignments)
exports.getSchoolCourses = async (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.redirect("/admin/login");
  }
  try {
    // Fetch all schools
    const schoolsResult = await pool.query(
      `SELECT * FROM schools ORDER BY name`
    );
    const schools = schoolsResult.rows;

    // Fetch all courses
    const coursesResult = await pool.query(
      `SELECT * FROM courses ORDER BY title`
    );
    const courses = coursesResult.rows;

    // Every school's terms, so each school's section can offer its own
    // term selector (schools don't share a term calendar).
    const termsResult = await pool.query(
      `SELECT id, school_id, name, is_active FROM academic_terms ORDER BY start_date DESC`
    );
    const schoolTermsMap = {};
    termsResult.rows.forEach((t) => {
      if (!schoolTermsMap[t.school_id]) schoolTermsMap[t.school_id] = [];
      schoolTermsMap[t.school_id].push(t);
    });

    // Fetch currently assigned courses, keyed by school -> term ("none"
    // for legacy/blanket assignments not tied to any term) -> course ids.
    // Also build a flat "by term" list per school for the summary table.
    const assignmentsResult = await pool.query(`
      SELECT sc.school_id, sc.course_id, sc.term_id, c.title AS course_title, t.name AS term_name
      FROM school_courses sc
      JOIN courses c ON c.id = sc.course_id
      LEFT JOIN academic_terms t ON t.id = sc.term_id
      ORDER BY t.start_date DESC NULLS LAST, c.title
    `);
    const schoolCoursesMap = {}; // schoolId -> termKey -> [courseId, ...]
    const schoolCoursesByTerm = {}; // schoolId -> [{termId, termName, courses: [title,...]}]
    assignmentsResult.rows.forEach((row) => {
      const termKey = row.term_id ? String(row.term_id) : "none";
      if (!schoolCoursesMap[row.school_id]) schoolCoursesMap[row.school_id] = {};
      if (!schoolCoursesMap[row.school_id][termKey]) schoolCoursesMap[row.school_id][termKey] = [];
      schoolCoursesMap[row.school_id][termKey].push(row.course_id);

      if (!schoolCoursesByTerm[row.school_id]) schoolCoursesByTerm[row.school_id] = {};
      if (!schoolCoursesByTerm[row.school_id][termKey]) {
        schoolCoursesByTerm[row.school_id][termKey] = {
          termId: row.term_id,
          termName: row.term_name || "General (no term)",
          courses: [],
        };
      }
      schoolCoursesByTerm[row.school_id][termKey].courses.push(row.course_title);
    });
    Object.keys(schoolCoursesByTerm).forEach((schoolId) => {
      schoolCoursesByTerm[schoolId] = Object.values(schoolCoursesByTerm[schoolId]);
    });

    // Confirmed activity (course_term_links) per school -> term -> course
    // ids — courses students actually engaged with during that term,
    // regardless of whether they were ever formally saved through this
    // page. Used to flag courses that look confirmed-but-unassigned.
    const confirmedResult = await pool.query(`
      SELECT DISTINCT school_id, term_id, course_id FROM course_term_links
    `);
    const schoolConfirmedCoursesMap = {}; // schoolId -> termId -> [courseId, ...]
    confirmedResult.rows.forEach((row) => {
      const termKey = String(row.term_id);
      if (!schoolConfirmedCoursesMap[row.school_id]) schoolConfirmedCoursesMap[row.school_id] = {};
      if (!schoolConfirmedCoursesMap[row.school_id][termKey]) schoolConfirmedCoursesMap[row.school_id][termKey] = [];
      schoolConfirmedCoursesMap[row.school_id][termKey].push(row.course_id);
    });

    res.render("admin/schoolCourses", {
      info: req.companyInfo || {},
      schools,
      courses,
      schoolCoursesMap,
      schoolTermsMap,
      schoolCoursesByTerm,
      schoolConfirmedCoursesMap,
      currentPage: "school-courses",
      role: "admin", // ✅ important
    });
  } catch (err) {
    console.error("Error fetching school courses:", err);
    res.status(500).send("Error loading school courses");
  }
};

exports.approveQuote = async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("UPDATE quotes SET status = 'approved' WHERE id = $1", [
      id,
    ]);
    await logActivityForUser(req, "Quote approved", `Quote ID: ${id}`);
    res.redirect("/admin/quotes");
  } catch (err) {
    console.error("Error approving quote:", err);
    res.status(500).send("Error approving quote");
  }
};

exports.rejectQuote = async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("UPDATE quotes SET status = 'rejected' WHERE id = $1", [
      id,
    ]);
    res.redirect("/admin/quotes");
  } catch (err) {
    console.error("Error rejecting quote:", err);
    res.status(500).send("Error rejecting quote");
  }
};

// Re-runs the course_term_links backfill on demand (it's also run once
// automatically as history; this lets the admin re-trigger it later —
// e.g. after old attendance/term data gets corrected, or a new school's
// history needs linking). Safe to run repeatedly: every write is an
// upsert (see services/courseTermLinkService.js).
exports.runCourseTermLinkBackfill = async (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }
  try {
    const { backfillAllSchools } = require("../services/courseTermLinkService");
    const result = await backfillAllSchools();
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("Error running course-term-link backfill:", err);
    res.status(500).json({ success: false, message: "Backfill failed" });
  }
};

// 📌 POST: Assign Courses to School (scoped to a term, or "general" /
// no-term if the school doesn't use one) — replaces just that term's
// assignment set, leaving other terms' assignments for this school
// untouched.
exports.assignSchoolCourses = async (req, res) => {
  try {
    const { school_id, term_id } = req.body;

    if (!school_id) return res.status(400).send("School ID is required");

    const schoolIdNum = Number(school_id);
    const termIdNum = term_id ? Number(term_id) : null;
    if (!Number.isInteger(schoolIdNum)) {
      return res.status(400).send("Invalid school ID");
    }

    if (termIdNum) {
      await pool.query(
        "DELETE FROM school_courses WHERE school_id = $1 AND term_id = $2",
        [schoolIdNum, termIdNum]
      );
    } else {
      await pool.query(
        "DELETE FROM school_courses WHERE school_id = $1 AND term_id IS NULL",
        [schoolIdNum]
      );
    }

    // Get selected courses
    const rawCourseIds = req.body[`school_${schoolIdNum}`] || [];
    const courseIds = (Array.isArray(rawCourseIds) ? rawCourseIds : [rawCourseIds])
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id));

    if (courseIds.length > 0) {
      const values = courseIds
        .map((_, i) => `($1, $${i + 2}, $${courseIds.length + 2})`)
        .join(",");
      await pool.query(
        `INSERT INTO school_courses (school_id, course_id, term_id) VALUES ${values}`,
        [schoolIdNum, ...courseIds, termIdNum]
      );
    }

    res.redirect("/admin/school-courses");
  } catch (err) {
    console.error("Error assigning courses:", err);
    res.status(500).send("Error assigning courses");
  }
};

exports.generateStudentAvatar = async (req, res) => {
  const { userId } = req.params;

  try {
    const seed = `student-${userId}-${Date.now()}`;

    // const avatarUrl =
    //   `https://api.dicebear.com/7.x/adventurer/svg?seed=${seed}`;

    const avatarUrl =
      `https://api.dicebear.com/7.x/adventurer/png?seed=${seed}`;

    await pool.query(`
      UPDATE users2
      SET avatar_seed = $1,
          avatar_url = $2
      WHERE id = $3
    `, [seed, avatarUrl, userId]);

    res.json({
      success: true,
      avatarUrl
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false
    });
  }
};

exports.bulkGenerateAvatars = async (req, res) => {
  const { schoolId } = req.params;

  try {
    const students = await pool.query(
      `
      SELECT u.id
      FROM users2 u
      JOIN user_school us
        ON us.user_id = u.id
      WHERE us.school_id = $1
      AND us.role_in_school = 'student'
    `,
      [schoolId],
    );

    let updated = 0;

    for (const student of students.rows) {
      const seed = `student-${student.id}-${Date.now()}`;

      // const avatarUrl = `https://api.dicebear.com/7.x/adventurer/svg?seed=${seed}`;y
      const avatarUrl = `https://api.dicebear.com/7.x/adventurer/png?seed=${seed}`;

      await pool.query(
        `
        UPDATE users2
        SET avatar_seed = $1,
            avatar_url = $2
        WHERE id = $3
      `,
        [seed, avatarUrl, student.id],
      );

      updated++;
    }

    res.json({
      success: true,
      message: `${updated} avatars generated`,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      message: "Bulk avatar generation failed",
    });
  }
};

exports.enableAvatarPinLogin = async (req, res) => {
  const { userId } = req.params;

  try {
    const pin = Math.floor(1000 + Math.random() * 9000).toString();
    const avatarSeed = `user-${userId}`;

    const result = await pool.query(
      `
      UPDATE users2
      SET 
        pin = $1,
        avatar_seed = $2,
        login_type = 'avatar_pin',
        classroom_login_enabled = true
      WHERE id = $3
      RETURNING id, fullname, pin, avatar_seed
    `,
      [pin, avatarSeed, userId],
    );

    return res.json({
      success: true,
      message: "Avatar login enabled",
      user: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to enable avatar login" });
  }
};

exports.toggleAvatarLogin = async (req, res) => {
  const { userId } = req.params;

  try {
    // get current state
    const userRes = await pool.query(
      `SELECT classroom_login_enabled FROM users2 WHERE id = $1`,
      [userId],
    );

    if (!userRes.rows.length) {
      return res.status(404).json({ message: "User not found" });
    }

    const current = userRes.rows[0].classroom_login_enabled;

    let newState = !current;
    let pin = null;
    let avatarSeed = null;

    // IF TURNING ON → generate credentials
    if (newState) {
      pin = Math.floor(1000 + Math.random() * 9000).toString();
      avatarSeed = `user-${userId}`;
    }

    const result = await pool.query(
      `
      UPDATE users2
      SET 
        classroom_login_enabled = $1,
        pin = COALESCE($2, pin),
        avatar_seed = COALESCE($3, avatar_seed),
        login_type = CASE 
          WHEN $1 = true THEN 'avatar_pin'
          ELSE 'email'
        END
      WHERE id = $4
      RETURNING id, fullname, classroom_login_enabled, pin
    `,
      [newState, pin, avatarSeed, userId],
    );

    res.json({
      success: true,
      enabled: newState,
      user: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Toggle failed" });
  }
};

exports.bulkEnableAvatarLogin = async (req, res) => {
  const { schoolId } = req.params;

  try {
    const students = await pool.query(`
      SELECT u.id
      FROM users2 u
      JOIN user_school us ON us.user_id = u.id
      WHERE us.school_id = $1
      AND us.role_in_school = 'student'
    `, [schoolId]);

    let updated = [];

    for (const s of students.rows) {
      const pin = Math.floor(1000 + Math.random() * 9000).toString();
      const avatarSeed = `user-${s.id}`;

      await pool.query(`
        UPDATE users2
        SET 
          pin = $1,
          avatar_seed = $2,
          login_type = 'avatar_pin',
          classroom_login_enabled = true
        WHERE id = $3
      `, [pin, avatarSeed, s.id]);

      updated.push(s.id);
    }

    res.json({
      success: true,
      message: `${updated.length} students enabled for avatar login`,
      updated
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Bulk enable failed" });
  }
};

exports.migrateStudentLoginFeatures = async (req, res) => {
  try {
    const result = await pool.query(`
      UPDATE users2
      SET 
        login_type = COALESCE(login_type, 'email'),
        classroom_login_enabled = COALESCE(classroom_login_enabled, false),
        login_method = COALESCE(login_method, 'email')
      WHERE role = 'student'
    `);

    return res.json({
      success: true,
      message: "Student login fields migrated successfully",
      rowsUpdated: result.rowCount,
    });
  } catch (err) {
    console.error("Migration error:", err);
    res.status(500).json({ message: "Migration failed" });
  }
};

exports.addUserToSchool = async (req, res) => {
  const { schoolId } = req.params;
  const { username, email, phone, gender, dob, role, password } = req.body;
  const dobValue = dob && dob.trim() !== "" ? dob : null;
  const file = req.file;

  try {
    // check school exists
    const schoolCheck = await pool.query(
      "SELECT * FROM schools WHERE id = $1",
      [schoolId]
    );
    if (schoolCheck.rowCount === 0) {
      return res.status(400).json({ message: "Invalid School ID" });
    }
    const school = schoolCheck.rows[0];

    // Handle profile picture
    const profile_picture = file ? file.path : "/profile.webp";
    const hashed = await bcrypt.hash(password || "12345678", 10); // default pw if missing
    const created_at = new Date();
    let finalEmail = email;

    // auto-generate email if student & none provided
    if (role === "student" && (!email || email.trim() === "")) {
      const fullNameClean = username.replace(/\s+/g, "");
      const schoolFirstWord = school.name.split(" ")[0].toLowerCase();
      finalEmail = `${fullNameClean.toLowerCase()}@${schoolFirstWord}school.com`;
    }

    // Insert into users2
    const newUser = await pool.query(
      `INSERT INTO users2 (fullname, email, phone, gender, password, profile_picture, role, created_at, dob) 
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        username,
        finalEmail,
        phone,
        gender,
        hashed,
        profile_picture,
        role,
        created_at,
        dobValue,
      ]
    );

    // Link to school
    await pool.query(
      `INSERT INTO user_school (user_id, school_id, role_in_school, approved) VALUES ($1,$2,$3,$4)`,
      [newUser.rows[0].id, school.id, role, true] // ✅ auto-approved since admin adds directly
    );

    return res
      .status(200)
      .json({ message: `${role} added successfully`, user: newUser.rows[0] });
  } catch (err) {
    console.error("❌ addUserToSchool error:", err.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

exports.platformBulkAddUsers = async (req, res) => {
  try {
    const { schoolId } = req.params;

    if (!req.file) {
      return res.json({ success: false, message: "No file uploaded" });
    }

    // ✅ Check school
    const schoolRes = await pool.query("SELECT * FROM schools WHERE id = $1", [
      schoolId,
    ]);

    if (!schoolRes.rows.length) {
      return res.json({ success: false, message: "Invalid school" });
    }

    const school = schoolRes.rows[0];
    const schoolFirstWord = school.name
      .split(" ")[0]
      .replace(/[^a-zA-Z]/g, "")
      .toLowerCase();

    const students = [];
    const errors = [];
    let successCount = 0;

    // ✅ Normalize keys (fix headers like " Full Name ", "GENDER", etc.)
    const normalize = (obj) => {
      const newObj = {};
      for (let key in obj) {
        newObj[key.trim().toLowerCase()] = obj[key]?.trim();
      }
      return newObj;
    };

    fs.createReadStream(req.file.path)
      .pipe(csv())
      .on("data", (row) => {
        const cleanRow = normalize(row);

        // ❌ Skip completely empty rows
        if (Object.values(cleanRow).every((v) => !v)) return;

        students.push(cleanRow);
      })
      .on("end", async () => {
        for (const [index, s] of students.entries()) {
          try {
            console.log("Processing row:", s);

            // ✅ Flexible fields
            const name = s.fullname || s.name || s["full name"];
            const genderRaw = s.gender;
            const role = s.role ? s.role.toLowerCase() : "student";

            if (!name || !genderRaw) {
              errors.push(`Row ${index + 1}: Missing fullname or gender`);
              continue;
            }

            // ✅ Normalize gender
            const genderLower = genderRaw.toLowerCase();
            const gender =
              genderLower === "male"
                ? "Male"
                : genderLower === "female"
                  ? "Female"
                  : "Not Specified";

            const cleanName = name.toLowerCase().replace(/\s+/g, "");

            let email = s.email;

            // ✅ Auto email
            if (!email && role === "student") {
              email = `${cleanName}@${schoolFirstWord}school.com`;
            }

            if (!email) {
              errors.push(`Row ${index + 1}: Email is required`);
              continue;
            }

            const hashedPassword = await bcrypt.hash("12345678", 10);

            const userRes = await pool.query(
              `INSERT INTO users2 (fullname, email, password, role, gender)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (email) DO NOTHING
               RETURNING id`,
              [name, email, hashedPassword, role, gender],
            );

            // ❌ Detect duplicate email
            if (userRes.rows.length === 0) {
              errors.push(`Row ${index + 1}: Email already exists (${email})`);
              continue;
            }

            const userId = userRes.rows[0].id;

            await pool.query(
              `INSERT INTO user_school (user_id, school_id, role_in_school, approved)
               VALUES ($1, $2, $3, true)
               ON CONFLICT DO NOTHING`,
              [userId, schoolId, role],
            );

            successCount++;
          } catch (err) {
            console.error(err);
            errors.push(`Row ${index + 1}: ${err.message}`);
          }
        }

        // ✅ Final response
        if (errors.length > 0) {
          return res.json({
            success: false,
            message: `${successCount} users uploaded, some failed`,
            errors,
          });
        }

        res.json({
          success: true,
          message: `${successCount} users uploaded successfully`,
        });
      });
  } catch (err) {
    console.error(err);
    res.json({ success: false, message: "Bulk upload failed" });
  }
};

exports.updateUserInSchool = async (req, res) => {
  const { userId } = req.params;
  const { username, phone, gender, dob, password } = req.body;
  const file = req.file;

  try {
    const updates = [];
    const values = [];
    let idx = 1;

    if (username) {
      updates.push(`fullname = $${idx++}`);
      values.push(username);
    }
    if (phone) {
      updates.push(`phone = $${idx++}`);
      values.push(phone);
    }
    if (gender) {
      updates.push(`gender = $${idx++}`);
      values.push(gender);
    }
    if (dob) {
      updates.push(`dob = $${idx++}`);
      values.push(dob);
    }
    if (password) {
      const hashed = await bcrypt.hash(password, 10);
      updates.push(`password = $${idx++}`);
      values.push(hashed);
    }
    if (file) {
      updates.push(`profile_picture = $${idx++}`);
      values.push(file.path);
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: "No fields to update" });
    }

    values.push(userId);

    const result = await pool.query(
      `UPDATE users2 SET ${updates.join(", ")} WHERE id = $${idx} RETURNING *`,
      values
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    return res
      .status(200)
      .json({ message: "User updated successfully", user: result.rows[0] });
  } catch (err) {
    console.error("❌ updateUserInSchool error:", err.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

exports.deleteUserFromSchool = async (req, res) => {
  const { userId } = req.params;

  try {
    // delete from user_school first
    await pool.query("DELETE FROM user_school WHERE user_id = $1", [userId]);
    // delete from users2
    const result = await pool.query(
      "DELETE FROM users2 WHERE id = $1 RETURNING *",
      [userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json({ message: "User deleted successfully" });
  } catch (err) {
    console.error("❌ deleteUserFromSchool error:", err.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

exports.addStudentsToClassroom = async (req, res) => {
  const classroomId = parseInt(req.params.id, 10);
  let { student_ids } = req.body;

  if (!student_ids) {
    return res
      .status(400)
      .json({ success: false, message: "No students selected." });
  }

  if (!Array.isArray(student_ids)) {
    student_ids = [student_ids];
  }

  student_ids = student_ids
    .map((id) => parseInt(id, 10))
    .filter((id) => !isNaN(id));

  if (student_ids.length === 0) {
    return res
      .status(400)
      .json({ success: false, message: "No valid students selected." });
  }

  try {
    // get school id from classroom
    const schoolResult = await pool.query(
      `SELECT school_id FROM classrooms WHERE id = $1`,
      [classroomId]
    );
    const schoolId = schoolResult.rows[0]?.school_id;

    if (!schoolId) {
      return res
        .status(404)
        .json({ success: false, message: "Classroom not found" });
    }

    // verify students belong to this school
    const studentResult = await pool.query(
      `SELECT u.id, u.fullname, u.email
       FROM users2 u
       JOIN user_school us ON u.id = us.user_id
       WHERE u.id = ANY($1::int[])
         AND us.school_id = $2
         AND us.role_in_school = 'student'`,
      [student_ids, schoolId]
    );

    if (studentResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No valid students found in this school.",
      });
    }

    // assign
    await pool.query(
      `UPDATE user_school
       SET classroom_id = $1
       WHERE user_id = ANY($2::int[])
         AND school_id = $3
         AND role_in_school = 'student'`,
      [classroomId, student_ids, schoolId]
    );

    // ✅ fetch unassigned students after update
    const unassignedResult = await pool.query(
      `SELECT u.id, u.fullname, u.email
       FROM users2 u
       JOIN user_school us ON u.id = us.user_id
       WHERE us.school_id = $1
         AND us.role_in_school = 'student'
         AND us.classroom_id IS NULL
       ORDER BY u.fullname`,
      [schoolId]
    );

    return res.json({
      success: true,
      message: "Students assigned successfully",
      assigned: studentResult.rows,
      unassigned: unassignedResult.rows, // 👈 send back fresh dropdown list
    });
  } catch (err) {
    console.error("Error assigning students to classroom:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.assignUsersToClassroom = async (req, res) => {
  const classroomId = parseInt(req.params.id, 10);
  let { user_ids, role } = req.body;

  if (!user_ids) {
    return res
      .status(400)
      .json({ success: false, message: "No users selected." });
  }

  if (!Array.isArray(user_ids)) user_ids = [user_ids];
  user_ids = user_ids.map((id) => parseInt(id, 10)).filter((id) => !isNaN(id));

  if (user_ids.length === 0) {
    return res
      .status(400)
      .json({ success: false, message: "No valid users selected." });
  }

  try {
    // ✅ 1. Get school id from classroom
    const schoolResult = await pool.query(
      `SELECT school_id FROM classrooms WHERE id = $1`,
      [classroomId]
    );
    const schoolId = schoolResult.rows[0]?.school_id;
    if (!schoolId) {
      return res
        .status(404)
        .json({ success: false, message: "Classroom not found" });
    }

    if (role === "instructor") {
      // Only assign instructors to classroom_instructors (no user_school insert)
      await pool.query(
        `
    INSERT INTO classroom_instructors (classroom_id, instructor_id)
    SELECT $1, u.id
    FROM users2 u
    WHERE u.id = ANY($2::int[])
    ON CONFLICT (classroom_id, instructor_id) DO NOTHING
    `,
        [classroomId, user_ids]
      );

      // Fetch all instructor users & their assigned classrooms (if any)
      const instructorsResult = await pool.query(
        `
    SELECT 
      u.id,
      u.fullname AS full_name,
      u.email,
      COALESCE(string_agg(DISTINCT c.name, ', '), 'Not yet assigned') AS classrooms
    FROM users2 u
    LEFT JOIN classroom_instructors ci ON ci.instructor_id = u.id
    LEFT JOIN classrooms c ON ci.classroom_id = c.id
    WHERE u.role = 'instructor'
    GROUP BY u.id, u.fullname, u.email
    ORDER BY u.fullname
    `
      );

      return res.json({
        success: true,
        message: "Instructors assigned successfully",
        instructors: instructorsResult.rows,
      });
    } else {
      // ✅ Students / Teachers (single classroom only)
      const userResult = await pool.query(
        `SELECT u.id, u.fullname, u.email
         FROM users2 u
         JOIN user_school us ON u.id = us.user_id
         WHERE u.id = ANY($1::int[])
           AND us.school_id = $2
           AND us.role_in_school = $3`,
        [user_ids, schoolId, role]
      );

      if (userResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: `No valid ${role}s found in this school.`,
        });
      }

      // Update their classroom_id (one per user)
      await pool.query(
        `UPDATE user_school
         SET classroom_id = $1
         WHERE user_id = ANY($2::int[])
           AND school_id = $3
           AND role_in_school = $4`,
        [classroomId, user_ids, schoolId, role]
      );

      // Fetch unassigned users of this role
      const unassignedResult = await pool.query(
        `SELECT u.id, u.fullname, u.email
         FROM users2 u
         JOIN user_school us ON u.id = us.user_id
         WHERE us.school_id = $1
           AND us.role_in_school = $2
           AND us.classroom_id IS NULL
         ORDER BY u.fullname`,
        [schoolId, role]
      );

      return res.json({
        success: true,
        message: `${role}s assigned successfully`,
        assigned: userResult.rows.map((r) => ({
          ...r,
          classroom_id: classroomId,
        })),
        unassigned: unassignedResult.rows,
      });
    }
  } catch (err) {
    console.error(`Error assigning ${role}s to classroom:`, err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.createTerm = async (req, res) => {
  try {
    const { school_id, name, start_date, end_date, price_per_student } =
      req.body;

    // deactivate old terms
    await pool.query(
      "UPDATE academic_terms SET is_active = false WHERE school_id = $1",
      [school_id],
    );

    // create term
    const termResult = await pool.query(
      `INSERT INTO academic_terms 
       (school_id, name, start_date, end_date, is_active)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id`,
      [school_id, name, start_date, end_date],
    );

    const termId = termResult.rows[0].id;

    // count students (initially 0)
    const studentCount = 0;

    const totalAmount = studentCount * price_per_student;

    // ✅ create quote automatically
    await pool.query(
      `INSERT INTO quotes 
       (school_id, term_id, price_per_student, total_students, total_amount, status)
       VALUES ($1, $2, $3, $4, $5, 'unpaid')`,
      [school_id, termId, price_per_student, studentCount, totalAmount],
    );

    res.redirect(`/admin/schools/${school_id}`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error creating term");
  }
};

exports.deleteTerm = async (req, res) => {
  const { id } = req.params;

  await pool.query("DELETE FROM academic_terms WHERE id=$1", [id]);

  res.sendStatus(200);
};

exports.updateTerm = async (req, res) => {
  const { id } = req.params;
  const { name, start_date, end_date, price_per_student } = req.body;

  const price = parseFloat(price_per_student) || 0;

  await pool.query(
    `UPDATE academic_terms
     SET name=$1, start_date=$2, end_date=$3
     WHERE id=$4`,
    [name, start_date, end_date, id],
  );

  await pool.query(
    `UPDATE quotes 
     SET price_per_student = $1::numeric,
         total_amount = total_students * $1::numeric
     WHERE term_id = $2`,
    [price, id],
  );

  res.sendStatus(200);
};

// Marking a term "ended" bulk-generates and persists every report for
// it — a full-class report per classroom, plus an individual report for
// every student enrolled in that term — so they're all ready for the
// school admin to view at once (see schoolAdminController.js's
// loadSection "terms" branch, which gates on academic_terms.is_ended).
//
// Runs as a detached background job rather than inside the triggering
// request: generating one report already takes tens of seconds
// (Puppeteer), and a school with several classrooms/dozens of students
// could take minutes total — long enough to risk the admin's browser
// timing out or them thinking it hung. The route below starts the job
// and responds immediately with "in_progress"; the admin UI polls
// getEndTermStatus for progress. There's no job queue in this codebase
// (no Redis/Bull), so progress lives on the academic_terms row itself —
// if the server process restarts mid-job, the row is left stuck at
// "in_progress" and the admin would need to press the button again
// (harmless: saveReport's upsert means re-running just overwrites
// whatever was already generated).
async function runEndTermJob(termId, schoolId, userId) {
  try {
    const classroomsRes = await pool.query(
      `SELECT DISTINCT c.id, c.name
       FROM student_term_enrollments ste
       JOIN classrooms c ON c.id = ste.classroom_id
       WHERE ste.term_id = $1`,
      [termId],
    );

    // Total unit of work = one class report per classroom + one report
    // per enrolled student, known up front so progress (x of y) is
    // meaningful from the first poll rather than growing as we go.
    const enrollmentCountRes = await pool.query(
      `SELECT COUNT(*) AS count FROM student_term_enrollments WHERE term_id = $1`,
      [termId],
    );
    const total = classroomsRes.rows.length + Number(enrollmentCountRes.rows[0].count);

    await pool.query(
      `UPDATE academic_terms
       SET report_generation_status = 'in_progress',
           report_generation_total = $1,
           report_generation_completed = 0,
           report_generation_errors = '{}'
       WHERE id = $2`,
      [total, termId],
    );

    const errors = [];
    let completed = 0;
    const bumpProgress = async () => {
      completed += 1;
      await pool.query(
        `UPDATE academic_terms SET report_generation_completed = $1 WHERE id = $2`,
        [completed, termId],
      );
    };

    for (const classroom of classroomsRes.rows) {
      try {
        const classReport = await generateClassReport(schoolId, classroom.id, termId);
        await saveReport({
          schoolId,
          classroomId: classroom.id,
          termId,
          studentId: null,
          pdfBuffer: fs.readFileSync(classReport.pdf),
          filename: path.basename(classReport.pdf),
          generatedByUserId: userId,
        });
      } catch (err) {
        console.error(`endTerm: failed to generate class report for classroom ${classroom.id}:`, err);
        errors.push(`Classroom "${classroom.name}": ${err.message}`);
      }
      await bumpProgress();

      const studentsRes = await pool.query(
        `SELECT student_id FROM student_term_enrollments WHERE term_id = $1 AND classroom_id = $2`,
        [termId, classroom.id],
      );

      for (const { student_id: studentId } of studentsRes.rows) {
        try {
          const studentReport = await generateStudentReport(schoolId, classroom.id, termId, studentId);
          await saveReport({
            schoolId,
            classroomId: classroom.id,
            termId,
            studentId,
            pdfBuffer: fs.readFileSync(studentReport.pdf),
            filename: path.basename(studentReport.pdf),
            generatedByUserId: userId,
          });
        } catch (err) {
          console.error(`endTerm: failed to generate student report for student ${studentId}:`, err);
          errors.push(`Student ID ${studentId}: ${err.message}`);
        }
        await bumpProgress();
      }
    }

    await pool.query(
      `UPDATE academic_terms
       SET is_ended = true, ended_at = NOW(), ended_by = $1,
           report_generation_status = 'done', report_generation_errors = $2
       WHERE id = $3`,
      [userId, errors, termId],
    );
  } catch (err) {
    console.error("endTerm background job failed:", err);
    await pool.query(
      `UPDATE academic_terms SET report_generation_status = 'failed', report_generation_errors = $1 WHERE id = $2`,
      [[err.message], termId],
    ).catch(() => {});
  }
}

exports.endTerm = async (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.status(403).json({ success: false, message: "Access denied" });
  }

  const { id: termId } = req.params;

  try {
    const termRes = await pool.query(
      "SELECT id, school_id, report_generation_status FROM academic_terms WHERE id = $1",
      [termId],
    );
    const term = termRes.rows[0];
    if (!term) {
      return res.status(404).json({ success: false, message: "Term not found" });
    }
    if (term.report_generation_status === "in_progress") {
      return res.status(409).json({ success: false, message: "Report generation is already in progress for this term" });
    }

    // Fire-and-forget — deliberately not awaited, see runEndTermJob's
    // comment above for why.
    runEndTermJob(termId, term.school_id, req.session.user.id);

    res.json({ success: true, status: "in_progress" });
  } catch (err) {
    console.error("Error starting endTerm job:", err);
    res.status(500).json({ success: false, message: "Error starting report generation" });
  }
};

exports.getEndTermStatus = async (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.status(403).json({ success: false, message: "Access denied" });
  }

  const { id: termId } = req.params;
  try {
    const result = await pool.query(
      `SELECT report_generation_status AS status, report_generation_total AS total,
              report_generation_completed AS completed, report_generation_errors AS errors,
              is_ended, ended_at
       FROM academic_terms WHERE id = $1`,
      [termId],
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: "Term not found" });
    }
    res.json({ success: true, ...result.rows[0] });
  } catch (err) {
    console.error("Error fetching endTerm status:", err);
    res.status(500).json({ success: false, message: "Error fetching status" });
  }
};

exports.removeStudentFromTerm = async (req, res) => {
  const { termId, studentId } = req.params;

  await pool.query(
    "DELETE FROM student_term_enrollments WHERE term_id=$1 AND student_id=$2",
    [termId, studentId]
  );

  res.sendStatus(200);
};

exports.getTermStudents = async (req, res) => {
  const { termId } = req.params;

  const result = await pool.query(
    `
    SELECT 
      u.id,
      u.fullname,
      u.email,
      c.name AS classroom,
      q.price_per_student,
      q.total_amount,
      q.status
    FROM student_term_enrollments ts
    JOIN users2 u ON ts.student_id = u.id
    LEFT JOIN classrooms c ON c.id = ts.classroom_id
    LEFT JOIN quotes q ON q.term_id = ts.term_id
    WHERE ts.term_id = $1
    ORDER BY u.fullname
  `,
    [termId],
  );

  res.json(result.rows);
};

exports.assignStudentsToTerm = async (req, res) => {
  try {
    const { school_id, student_ids, term_id } = req.body;

    if (!student_ids || student_ids.length === 0) {
      return res.status(400).send("No students selected");
    }

    // ✅ CORRECT: get classroom from user_school using user_id + school_id
    const studentRes = await pool.query(
      `
      SELECT us.user_id AS id, us.classroom_id
      FROM user_school us
      WHERE us.user_id = ANY($1)
      AND us.school_id = $2
      `,
      [student_ids, school_id],
    );

    const students = studentRes.rows;

    if (students.length === 0) {
      return res.status(400).send("No valid students found");
    }

    const values = students
      .map(
        (_, i) =>
          `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`,
      )
      .join(",");

    const params = students.flatMap((s) => [
      s.id,
      school_id,
      term_id,
      s.classroom_id || null,
    ]);

    await pool.query(
      `
      INSERT INTO student_term_enrollments
      (student_id, school_id, term_id, classroom_id)
      VALUES ${values}
      ON CONFLICT (student_id, term_id)
      DO UPDATE SET classroom_id = EXCLUDED.classroom_id
      `,
      params,
    );

    // count students in this term
    const countRes = await pool.query(
      `SELECT COUNT(*) FROM student_term_enrollments WHERE term_id = $1`,
      [term_id]
    );

    const studentCount = Number(countRes.rows[0].count);

    // get price
    const quoteRes = await pool.query(
      `SELECT price_per_student FROM quotes WHERE term_id = $1`,
      [term_id]
    );

    const price = quoteRes.rows[0].price_per_student;
    const total = studentCount * price;

    // update quote
    await pool.query(
      `UPDATE quotes 
      SET total_students = $1, total_amount = $2
      WHERE term_id = $3`,
      [studentCount, total, term_id]
    );

    res.redirect(`/admin/schools/${school_id}`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error assigning students");
  }
};

  exports.exportTermStudentsExcel = async (req, res) => {
    try {
      const { termId } = req.params;

      // ✅ Get term info
      const termRes = await pool.query(
        `SELECT name FROM academic_terms WHERE id = $1`,
        [termId]
      );

      const termName = termRes.rows[0]?.name || "Term";

      // ✅ Get students in that term

      const { rows: students } = await pool.query(
        `
        SELECT 
          u.fullname AS full_name,
          u.email,
          u.gender,
          u.pin,

          COALESCE(tc.name, uc.name) AS classroom

        FROM student_term_enrollments ts

        JOIN users2 u 
          ON ts.student_id = u.id

        -- classroom from term enrollment
        LEFT JOIN classrooms tc 
          ON ts.classroom_id = tc.id

        -- fallback classroom from user_school
        LEFT JOIN user_school us
          ON us.user_id = u.id

        LEFT JOIN classrooms uc
          ON us.classroom_id = uc.id

        WHERE ts.term_id = $1

        ORDER BY classroom, u.fullname
        `,
        [termId]
      );

      // ✅ Analytics: count per class
      const { rows: classStats } = await pool.query(
        `
        SELECT 
          COALESCE(tc.name, uc.name, 'Unassigned') AS classroom,
          COUNT(*) AS total

        FROM student_term_enrollments ts

        JOIN users2 u
          ON ts.student_id = u.id

        LEFT JOIN classrooms tc
          ON ts.classroom_id = tc.id

        LEFT JOIN user_school us
          ON us.user_id = u.id

        LEFT JOIN classrooms uc
          ON us.classroom_id = uc.id

        WHERE ts.term_id = $1

        GROUP BY COALESCE(tc.name, uc.name, 'Unassigned')

        ORDER BY classroom
        `,
        [termId],
      );

      const totalStudents = students.length;

      // =========================
      // CREATE EXCEL
      // =========================
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Term Students");

      const infoResult = await pool.query(
        "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
      );
      const company = infoResult.rows[0] || {};

      // 🔥 Fetch logo from URL
      if (company.logo_url) {
        const response = await axios.get(
          company.logo_url,
          { responseType: "arraybuffer" }
        );

        const imageId = workbook.addImage({
          buffer: response.data,
          extension: "png",
        });

        sheet.addImage(imageId, {
          tl: { col: 0, row: 1 },
          ext: { width: 80, height: 80 },
        });
      }

      // ✅ Title
      sheet.mergeCells("B2:D4");
      sheet.getCell("C2").value = `${termName} - Student Names`;
      sheet.getCell("C2").font = { size: 14, bold: true };
      sheet.getCell("C2").alignment = { horizontal: "center" };

      // ✅ Total count
      sheet.getCell("A5").value = `Total Students: ${totalStudents}`;
      sheet.getCell("A5").font = { bold: true };

      // =========================
      // TABLE HEADER
      // =========================
      sheet.columns = [
        {
          header: "Full Name",
          key: "full_name",
          width: 25,
          fill: {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFB0E0E6" },
          },
          font: { bold: true },
        },
        {
          header: "Email",
          key: "email",
          width: 30,
          fill: {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFB0E0E6" },
          },
          font: { bold: true },
        },
        { header: "Gender", key: "gender", width: 15, fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFB0E0E6" } }, font: { bold: true }  },
        { header: "Classroom", key: "classroom", width: 20, fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFB0E0E6" } }, font: { bold: true } },
        { header: "PIN", key: "pin", width: 10, fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFB0E0E6" } }, font: { bold: true } },
      ];

      const headerRow = sheet.getRow(0);
      headerRow.font = { bold: true };
      headerRow.eachCell(cell => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFD3D3D3" },
        };
      });

      // =========================
      // DATA
      // =========================
      students.forEach((s) => {
        sheet.addRow({
          ...s,
          classroom: s.classroom || "—",
        });
      });

      // =========================
      // ANALYTICS SECTION
      // =========================
      const startRow = sheet.rowCount + 6;

      sheet.getCell(`A${startRow}`).value = "Classroom Summary";
      sheet.getCell(`A${startRow}`).font = { bold: true };

      classStats.forEach((c, index) => {
        sheet.getCell(`A${startRow + index + 1}`).value = c.classroom || "Unassigned";
        sheet.getCell(`B${startRow + index + 1}`).value = c.total;
      });

      // =========================
      // RESPONSE
      // =========================
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );

      res.setHeader(
        "Content-Disposition",
        `attachment; filename=${termName}_students.xlsx`
      );

      await workbook.xlsx.write(res);
      res.end();

    } catch (err) {
      console.error(err);
      res.status(500).send("Excel export failed");
    }
  };

exports.getTermAnalytics = async (req, res) => {
  try {
    const { schoolId } = req.params;

    // 📊 1. Growth per term
    const growth = await pool.query(`
      SELECT 
        t.id,
        t.name,
        COUNT(e.student_id) as total_students
      FROM academic_terms t
      LEFT JOIN student_term_enrollments e ON e.term_id = t.id
      WHERE t.school_id = $1
      GROUP BY t.id
      ORDER BY t.start_date
    `, [schoolId]);

    // 🔁 2. Retention (students in multiple terms)
    const retention = await pool.query(`
      SELECT COUNT(*) as retained_students FROM (
        SELECT student_id
        FROM student_term_enrollments
        WHERE school_id = $1
        GROUP BY student_id
        HAVING COUNT(term_id) > 1
      ) sub
    `, [schoolId]);

    // 🧠 3. Total unique students
    const totals = await pool.query(`
      SELECT 
        COUNT(DISTINCT student_id) as total_unique_students,
        COUNT(*) as total_enrollments
      FROM student_term_enrollments
      WHERE school_id = $1
    `, [schoolId]);

    res.json({
      growth: growth.rows,
      retention: retention.rows[0],
      totals: totals.rows[0]
    });

  } catch (err) {
    console.error(err);
    res.status(500).send("Analytics error");
  }
};

exports.getAttendanceStudents = async (req, res) => {
  const { term_id, classroom_id } = req.query;

  try {
    if (!term_id || !classroom_id) {
      return res
        .status(400)
        .json({ error: "term_id and classroom_id are required" });
    }

    const result = await pool.query(
      `
      SELECT 
        u.id,
        u.fullname
      FROM student_term_enrollments ts
      JOIN users2 u ON ts.student_id = u.id
      JOIN user_school us ON us.user_id = u.id
      WHERE ts.term_id = $1 
      AND us.classroom_id = $2
      ORDER BY u.fullname ASC
    `,
      [term_id, classroom_id],
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching attendance students:", err);
    res.status(500).json({ error: "Server error" });
  }
};

exports.saveAttendance = async (req, res) => {
  // const { term_id, classroom_id, date, records, session_status, note } =
  //   req.body;
  const {
    term_id,
    classroom_id,
    date,
    records,
    session_status,
    note,
    week_number,
  } = req.body;
  const userId = req.session.user.id;

  try {
    // 1. Create session
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
        req.body.school_id,
        term_id,
        classroom_id,
        userId,
        date,
        session_status,
        note || null,
        week_number
      ],
    );

    const sessionId = sessionResult.rows[0].id;

    if (session_status !== "held") {

      // 🔥 CLEAR OLD RECORDS
      await pool.query(
        `DELETE FROM attendance_records WHERE session_id = $1`,
        [sessionId]
      );

      return res.json({
        success: true,
        message: "Session saved without attendance",
      });
    }

    // 2. Save student attendance
    for (const r of records) {
      await pool.query(
        `
        INSERT INTO attendance_records (session_id, student_id, status)
        VALUES ($1, $2, $3)
        ON CONFLICT (session_id, student_id)
        DO UPDATE SET status = EXCLUDED.status
      `,
        [sessionId, r.student_id, r.status],
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error saving attendance");
  }
};

exports.updateAttendanceSession = async (req, res) => {
  const { id } = req.params;
  const { session_status, note, week_number, date } = req.body;

  try {
    // 🔥 Get existing session first
    const existing = await pool.query(
      `SELECT term_id, classroom_id, session_status FROM attendance_sessions WHERE id = $1`,
      [id],
    );

    const session = existing.rows[0];

    await pool.query(
      `
      UPDATE attendance_sessions
      SET session_status = $1,
          note = $2,
          week_number = $3,
          date = $4
      WHERE id = $5
      `,
      [session_status, note, week_number, date, id],
    );

    // ✅ IF changed to "held" AND no records exist → recreate students
    if (session_status === "held") {
      const check = await pool.query(
        `SELECT COUNT(*) FROM attendance_records WHERE session_id = $1`,
        [id],
      );

      const count = Number(check.rows[0].count);

      // if (count === 0) {
      //   // 🔥 fetch students in that class + term
      //   const students = await pool.query(
      //     `
      //     SELECT student_id
      //     FROM student_term_enrollments
      //     WHERE term_id = $1 AND classroom_id = $2
      //     `,
      //     [session.term_id, session.classroom_id],
      //   );

      //   // insert default records
      //   for (const s of students.rows) {
      //     await pool.query(
      //       `
      //       INSERT INTO attendance_records (session_id, student_id, status)
      //       VALUES ($1, $2, 'present')
      //       ON CONFLICT DO NOTHING
      //       `,
      //       [id, s.student_id],
      //     );
      //   }
      // }

      if (session_status === "held") {
        // get all students in class
        const students = await pool.query(
          `
          SELECT student_id
          FROM student_term_enrollments
          WHERE term_id = $1 AND classroom_id = $2
          `,
          [session.term_id, session.classroom_id],
        );

        for (const s of students.rows) {
          await pool.query(
            `
      INSERT INTO attendance_records (session_id, student_id, status)
      VALUES ($1, $2, 'present')
      ON CONFLICT (session_id, student_id)
      DO NOTHING
      `,
            [id, s.student_id],
          );
        }
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).send("Update failed");
  }
};

exports.deleteAttendanceSession = async (req, res) => {
  const { id } = req.params;

  try {
    await pool.query(`DELETE FROM attendance_records WHERE session_id=$1`, [
      id,
    ]);
    await pool.query(`DELETE FROM attendance_sessions WHERE id=$1`, [id]);

    res.json({ success: true });
  } catch (err) {
    res.status(500).send("Delete failed");
  }
};

exports.updateAttendanceRecord = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  try {
    await pool.query(`
      UPDATE attendance_records
      SET status = $1
      WHERE id = $2
    `, [status, id]);

    res.json({ success: true });
  } catch (err) {
    res.status(500).send("Update failed");
  }
};

exports.getWeeklyAttendanceStats = async (req, res) => {
  const { term_id, classroom_id } = req.query;

  try {
    const result = await pool.query(
      `
      SELECT 
        s.week_number,

        COUNT(r.id) FILTER (WHERE r.status='present') AS present,
        COUNT(r.id) FILTER (WHERE r.status='absent') AS absent,
        COUNT(r.id) FILTER (WHERE r.status='late') AS late,
        COUNT(r.id) AS total,

        ROUND(
          (COUNT(r.id) FILTER (WHERE r.status='present') * 100.0) / NULLIF(COUNT(r.id),0),
          2
        ) AS attendance_percent

      FROM attendance_sessions s
      LEFT JOIN attendance_records r ON r.session_id = s.id
      WHERE s.term_id = $1
      ${classroom_id ? "AND s.classroom_id = $2" : ""}
      GROUP BY s.week_number
      ORDER BY s.week_number
      `,
      classroom_id ? [term_id, classroom_id] : [term_id],
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).send("Error");
  }
};

exports.getAttendanceHistory = async (req, res) => {
  const { term_id, classroom_id } = req.query;

  try {
    const result = await pool.query(
      `
      SELECT 
        s.id,
        s.date,
        s.session_status,
        s.week_number,
        c.name AS classroom,
        u.fullname AS taken_by,

        -- ✅ ADD THIS
        COUNT(ar.id) AS student_count

      FROM attendance_sessions s

      LEFT JOIN classrooms c ON s.classroom_id = c.id
      LEFT JOIN users2 u ON s.taken_by = u.id

      -- ✅ JOIN attendance records
      LEFT JOIN attendance_records ar ON ar.session_id = s.id

      WHERE s.term_id = $1
      ${classroom_id ? "AND s.classroom_id = $2" : ""}

      -- ✅ IMPORTANT for COUNT
      GROUP BY s.id, c.name, u.fullname

      ORDER BY s.date DESC
    `,
      classroom_id ? [term_id, classroom_id] : [term_id],
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error loading attendance history");
  }
};

exports.getAttendanceSessionDetails = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(`
      SELECT 
        u.fullname,
        ar.status
      FROM attendance_records ar
      JOIN users2 u ON ar.student_id = u.id
      WHERE ar.session_id = $1
      ORDER BY u.fullname
    `, [id]);

    res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).send("Error loading attendance details");
  }
};

exports.getAttendanceSession = async (req, res) => {
  const { id } = req.params;

  try {
    const session = await pool.query(
      `SELECT * FROM attendance_sessions WHERE id=$1`,
      [id]
    );

    const records = await pool.query(
      `SELECT id, student_id, status FROM attendance_records WHERE session_id=$1`,
      [id]
    );

    res.json({
      session: session.rows[0],
      records: records.rows
    });

  } catch (err) {
    res.status(500).send("Error");
  }
};

exports.exportAttendancePDF = async (req, res) => {
  const { sessionId } = req.params;

  try {
    const sessionRes = await pool.query(
      `
      SELECT
        a.*,
        c.name AS classroom,
        t.name AS term_name,
        s.name AS school_name,
        s.logo_url AS school_logo
      FROM attendance_sessions a
      JOIN classrooms c ON c.id = a.classroom_id
      JOIN academic_terms t ON t.id = a.term_id
      JOIN schools s ON s.id = t.school_id
      WHERE a.id = $1
      `,
      [sessionId],
    );

    const studentsRes = await pool.query(
      `
      SELECT u.fullname, r.status
      FROM attendance_records r
      JOIN users2 u ON r.student_id = u.id
      WHERE r.session_id = $1
      `,
      [sessionId],
    );

    const s = sessionRes.rows[0];

    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const company = infoResult.rows[0] || {};

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

        .title {
          text-align: center;
          flex: 1;
        }

        .title h2 {
          margin: 0;
          font-size: 22px;
          color: #1f4e79;
          text-transform: uppercase;
        }

        .title p {
          margin: 3px 0;
          font-size: 13px;
        }

        .info {
          margin-bottom: 20px;
          padding: 12px;
          background: #f4f6f8;
          border-radius: 6px;
          font-size: 14px;
        }

        table {
          width: 100%;
          border-collapse: collapse;
        }

        th {
          background: #1f4e79;
          color: white;
          padding: 10px;
          text-align: left;
        }

        td {
          padding: 10px;
          border-bottom: 1px solid #ddd;
        }

        .present { color: green; font-weight: bold; }
        .absent { color: red; font-weight: bold; }
        .late { color: orange; font-weight: bold; }

        .watermark {
          position: fixed;
          top: 40%;
          left: 25%;
          opacity: 0.06;
          font-size: 80px;
          transform: rotate(-30deg);
          color: #000;
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
          <p><b>Date Taken:</b> ${new Date(s.date).toDateString()}</p>
        </div>

        <img class="logo" src="${company.logo_url || ""}" />
      </div>

      <div class="info">
        <b>Classroom:</b> ${s.classroom} <br/>
        <b>Term:</b> ${s.term_name} <br/>
        <b>Total Students:</b> ${studentsRes.rows.length}
      </div>

      <div class="watermark">
        ${s.school_name}
      </div>

      <table>
        <tr>
          <th>Student Name</th>
          <th>Status</th>
        </tr>

        ${studentsRes.rows
          .map(
            (r) => `
          <tr>
            <td>${r.fullname}</td>
            <td class="${r.status === "present" ? "present" : r.status === "late" ? "late" : "absent"}">
              ${r.status}
            </td>
          </tr>
        `,
          )
          .join("")}
      </table>

      <div class="footer">
        Generated by School Management System • ${new Date().getFullYear()}
      </div>

    </body>
    </html>
    `;

        // const browser = await puppeteer.launch({
        //   headless: true,
        //   args: ["--no-sandbox"],
        // });

        // const page = await browser.newPage();
        // await page.setContent(html, { waitUntil: "networkidle0" });

        // const pdf = await page.pdf({
        //   format: "A4",
        //   printBackground: true,
        // });

        // await browser.close();

    const pdf = await generatePdf(html);
    
    // ✅ filename with class + date
    const safeClass = s.classroom.replace(/\s+/g, "_");
    const safeDate = new Date(s.date).toISOString().split("T")[0];

    const fileName = `attendance_${safeClass}_${safeDate}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=${fileName}`);

    res.send(pdf);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error exporting pdf");
  }
};

exports.exportAttendanceExcel = async (req, res) => {
  const { termId } = req.params;

  const ExcelJS = require("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Attendance");

  const data = await pool.query(
    `
    SELECT 
      s.week_number,
      s.date,
      c.name AS classroom,
      COUNT(r.id) FILTER (WHERE r.status='present') AS present,
      COUNT(r.id) FILTER (WHERE r.status='absent') AS absent
    FROM attendance_sessions s
    LEFT JOIN attendance_records r ON r.session_id=s.id
    LEFT JOIN classrooms c ON s.classroom_id=c.id
    WHERE s.term_id=$1
    GROUP BY s.id, c.name
    ORDER BY s.week_number
    `,
    [termId]
  );

  sheet.columns = [
    { header: "Week", key: "week" },
    { header: "Date", key: "date" },
    { header: "Class", key: "class" },
    { header: "Present", key: "present" },
    { header: "Absent", key: "absent" }
  ];

  data.rows.forEach(r => {
    sheet.addRow({
      week: r.week_number,
      date: r.date,
      class: r.classroom,
      present: r.present,
      absent: r.absent
    });
  });

  res.setHeader(
    "Content-Disposition",
    "attachment; filename=attendance.xlsx"
  );

  await workbook.xlsx.write(res);
  res.end();
};

exports.generateClassTermReport = async (req, res) => {
  const { schoolId, classId, termId } = req.params;
  const attendance = await pool.query(`
    SELECT
    COUNT(*) FILTER (WHERE ar.status='present') as present,
    COUNT(*) FILTER (WHERE ar.status='absent') as absent,
    COUNT(*) FILTER (WHERE ar.status='late') as late
    FROM attendance_records ar
    JOIN attendance_sessions s
    ON s.id = ar.session_id
    WHERE s.term_id=$1
    AND s.classroom_id=$2
    `,[termId,classId]);

  const weeklyTrend = await pool.query(`
    SELECT
    week_number,
    COUNT(*) FILTER (WHERE ar.status='present') as present
    FROM attendance_records ar
    JOIN attendance_sessions s
    ON s.id=ar.session_id
    WHERE s.term_id=$1
    AND s.classroom_id=$2
    GROUP BY week_number
    ORDER BY week_number
    `,[termId,classId]);

  const students = await pool.query(
    `
    SELECT COUNT(*)
    FROM student_term_enrollments
    WHERE term_id=$1
    AND classroom_id=$2
    `,
    [termId, classId],
  );

  const courses = await pool.query(`
    SELECT c.title
    FROM classroom_courses cc
    JOIN courses c
    ON c.id=cc.course_id
    WHERE cc.classroom_id=$1
    `,[classId]);
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

    res.json({ success: true, message: "Message sent successfully" });
  } catch (err) {
    console.error("Send chat message error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ✅ Get chat messages (conversation)
exports.getChatMessages = async (req, res) => {
  try {
    const receiverId = req.params.receiverId;
    const senderId = req.session.user?.id;

    if (!senderId) {
      return res.status(401).json({ success: false, message: "Not logged in" });
    }

    const { rows } = await pool.query(
      `
      SELECT 
        id, sender_id, receiver_id, message, created_at,
        CASE WHEN sender_id = $1 THEN 'self' ELSE 'other' END AS sender
      FROM messages
      WHERE (sender_id = $1 AND receiver_id = $2)
         OR (sender_id = $2 AND receiver_id = $1)
      ORDER BY created_at ASC
      `,
      [senderId, receiverId]
    );

    // Optionally mark messages as read
    await pool.query(
      `UPDATE messages SET is_read = TRUE WHERE receiver_id = $1 AND sender_id = $2`,
      [senderId, receiverId]
    );

    res.json(rows);
  } catch (err) {
    console.error("Get chat messages error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ✅ Get all chat conversations (students who have messaged instructor)
exports.getInstructorChats = async (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.redirect("/admin/login");
  }
  try {
    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const info = infoResult.rows[0] || {};
    const instructorId = req.user.id;

    const { rows } = await pool.query(
      `
      SELECT DISTINCT 
        u.id AS student_id,
        u.fullname AS student_name,
        u.email,
        MAX(m.created_at) AS last_message_time
      FROM messages m
      JOIN users2 u ON 
        (u.id = m.sender_id AND m.receiver_id = $1)
        OR (u.id = m.receiver_id AND m.sender_id = $1)
      WHERE u.role = 'student'
      GROUP BY u.id, u.fullname, u.email
      ORDER BY last_message_time DESC
      `,
      [instructorId]
    );

    const profilePic = req.session.user
      ? req.session.user.profile_picture
      : null;

    res.render("instructor/chatList", {
      chats: rows,
      info,
      profilePic,
      role: "instructor",
      user: req.session.user,
    });
  } catch (err) {
    console.error("Get instructor chats error:", err);
    res.status(500).send("Error loading chats");
  }
};

// ✅ Full chat conversation with one student
exports.getChatWithStudent = async (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.redirect("/admin/login");
  }
  try {
    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const info = infoResult.rows[0] || {};
    const instructorId = req.user.id;
    const studentId = req.params.studentId;

    const { rows } = await pool.query(
      `
      SELECT 
        m.id, m.sender_id, m.receiver_id, m.message, m.created_at,
        CASE WHEN m.sender_id = $1 THEN 'self' ELSE 'other' END AS sender
      FROM messages m
      WHERE (m.sender_id = $1 AND m.receiver_id = $2)
         OR (m.sender_id = $2 AND m.receiver_id = $1)
      ORDER BY m.created_at ASC
      `,
      [instructorId, studentId]
    );

    const studentResult = await pool.query(
      `SELECT fullname, email FROM users2 WHERE id = $1`,
      [studentId]
    );

    const profilePic = req.session.user
      ? req.session.user.profile_picture
      : null;

    res.render("instructor/chatView", {
      student: studentResult.rows[0],
      messages: rows,
      info,
      profilePic,
      role: "instructor",
      user: req.session.user,
    });
  } catch (err) {
    console.error("Get chat with student error:", err);
    res.status(500).send("Error loading chat conversation");
  }
};


exports.getParentChildren = async (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.redirect("/admin/login");
  }
  const { parentId } = req.params;

  try {
    // parent info
    const parentRes = await pool.query(
      `SELECT id, fullname, email
       FROM users2
       WHERE id = $1`,
      [parentId],
    );

    const infoResult = await pool.query("SELECT * FROM company_info ORDER BY id DESC LIMIT 1");
    const info = infoResult.rows[0] || {};

    // children
    const childrenRes = await pool.query(
      `SELECT
          u.id,
          u.fullname,
          u.email
       FROM parent_children pc
       JOIN users2 u
         ON u.id = pc.child_id
       WHERE pc.parent_id = $1`,
      [parentId],
    );

    res.render("admin/parentChildren", {
      parent: parentRes.rows[0],
      children: childrenRes.rows,
      info,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error loading children");
  }
};

exports.getParentChildrenJSON = async (req, res) => {
  const { parentId } = req.params;

  try {
    const childrenRes = await pool.query(
      `
      SELECT
        u.id,
        u.fullname,
        u.email
      FROM parent_children pc
      JOIN users2 u
        ON u.id = pc.child_id
      WHERE pc.parent_id = $1
      `,
      [parentId],
    );

    res.json(childrenRes.rows);
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Failed to load children",
    });
  }
};