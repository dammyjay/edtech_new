// services/analyticsAggregationService.js
//
// Single source of truth for platform analytics SQL. The six exported
// getXAnalytics() functions back both the live admin dashboard AJAX
// endpoints (controllers/adminController.js) and the report/pitch-deck
// generators (services/reportOrchestratorService.js, pitchDeckGeneratorService.js).
//
// Each getXAnalytics(bounds) accepts an optional {startDate, endDate} from
// getPeriodBounds() below. When bounds is null, queries run all-time —
// this preserves the exact behavior the live dashboard tabs had before
// this file existed.

const pool = require("../models/db");

function getPeriodBounds(scope, year, month) {
  if (!scope || scope === "all") return null;

  const y = Number(year);
  if (!y) return null;

  if (scope === "year") {
    const startDate = new Date(Date.UTC(y, 0, 1));
    const endDate = new Date(Date.UTC(y + 1, 0, 1));
    return { startDate, endDate, label: String(y) };
  }

  if (scope === "month") {
    const m = Number(month);
    if (!m || m < 1 || m > 12) return null;
    const startDate = new Date(Date.UTC(y, m - 1, 1));
    const endDate = new Date(Date.UTC(y, m, 1));
    const monthName = startDate.toLocaleString("en-US", {
      month: "long",
      timeZone: "UTC",
    });
    return { startDate, endDate, label: `${monthName} ${y}` };
  }

  return null;
}

// A user counts as "enrolled" in a course if they have an explicit
// course_enrollments row, OR have made any lesson-progress or quiz-submission
// activity tied to that course — school students in particular are commonly
// assigned into courses through their school without ever getting an
// explicit enrollment row, so relying on course_enrollments alone
// undercounts real usage. first_activity (earliest of the three signals)
// stands in for "enrolled_at" for period-bounding purposes.
const EFFECTIVE_ENROLLMENTS_CTE = `
  effective_enrollments AS (
    SELECT user_id, course_id, MIN(activity_date) AS first_activity
    FROM (
      SELECT user_id, course_id, enrolled_at AS activity_date
      FROM course_enrollments

      UNION ALL

      SELECT ulp.user_id, m.course_id, ulp.completed_at AS activity_date
      FROM user_lesson_progress ulp
      JOIN lessons l ON l.id = ulp.lesson_id
      JOIN modules m ON m.id = l.module_id

      UNION ALL

      SELECT qs.student_id AS user_id, m.course_id, qs.created_at AS activity_date
      FROM quiz_submissions qs
      JOIN quizzes q ON q.id = qs.quiz_id
      JOIN lessons l ON l.id = q.lesson_id
      JOIN modules m ON m.id = l.module_id
    ) combined
    GROUP BY user_id, course_id
  )
`;

// ---------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------
async function getOverviewAnalytics(bounds) {
  const dateFilter = bounds ? "WHERE created_at >= $1 AND created_at < $2" : "";
  const params = bounds ? [bounds.startDate, bounds.endDate] : [];

  const [
    users,
    courses,
    modules,
    lessons,
    enrollments,
    schools,
    certificates,
    revenue,
    avgQuiz,
  ] = await Promise.all([
    pool.query(`SELECT COUNT(*) total FROM users2 ${dateFilter}`, params),
    pool.query(`SELECT COUNT(*) total FROM courses`),
    pool.query(`SELECT COUNT(*) total FROM modules`),
    pool.query(`SELECT COUNT(*) total FROM lessons`),
    pool.query(
      `
      WITH ${EFFECTIVE_ENROLLMENTS_CTE}
      SELECT COUNT(*) total FROM effective_enrollments
      ${bounds ? "WHERE first_activity >= $1 AND first_activity < $2" : ""}
      `,
      params
    ),
    pool.query(`SELECT COUNT(*) total FROM schools ${dateFilter}`, params),
    pool.query(
      `SELECT COUNT(*) total FROM user_certificates ${
        bounds ? "WHERE issued_at >= $1 AND issued_at < $2" : ""
      }`,
      params
    ),
    pool.query(
      `
      SELECT
        COALESCE((SELECT SUM(amount) FROM transactions WHERE status = 'success' ${
          bounds ? "AND created_at >= $1 AND created_at < $2" : ""
        }), 0)
        + COALESCE((SELECT SUM(amount) FROM school_payments ${
          bounds ? "WHERE payment_date >= $1 AND payment_date < $2" : ""
        }), 0)
        + COALESCE((SELECT SUM(amount) FROM parent_payments ${
          bounds ? "WHERE payment_date >= $1 AND payment_date < $2" : ""
        }), 0)
        + COALESCE((SELECT SUM(amount_paid) FROM event_registrations ${
          bounds ? "WHERE created_at >= $1 AND created_at < $2" : ""
        }), 0)
        AS total
      `,
      params
    ),
    pool.query(
      `SELECT ROUND(AVG(score),1) avg FROM quiz_submissions ${
        bounds ? "WHERE created_at >= $1 AND created_at < $2" : ""
      }`,
      params
    ),
  ]);

  return {
    totalUsers: Number(users.rows[0].total),
    totalCourses: Number(courses.rows[0].total),
    totalModules: Number(modules.rows[0].total),
    totalLessons: Number(lessons.rows[0].total),
    totalEnrollments: Number(enrollments.rows[0].total),
    totalSchools: Number(schools.rows[0].total),
    certificatesIssued: Number(certificates.rows[0].total),
    revenue: Number(revenue.rows[0].total),
    avgQuizScore: avgQuiz.rows[0].avg || 0,
  };
}

// ---------------------------------------------------------------------
// Business
// ---------------------------------------------------------------------
async function getBusinessAnalytics({ year, month } = {}) {
  let schoolWhere = "";
  let parentWhere = "";
  let eventWhere = "";
  let eventAliasWhere = "";
  const params = [];

  if (year && year !== "all") {
    params.push(year);
    schoolWhere += ` WHERE EXTRACT(YEAR FROM payment_date) = $${params.length}`;
    parentWhere += ` WHERE EXTRACT(YEAR FROM p.payment_date) = $${params.length}`;
    eventWhere += ` WHERE EXTRACT(YEAR FROM created_at) = $${params.length}`;
    eventAliasWhere += ` WHERE EXTRACT(YEAR FROM r.created_at) = $${params.length}`;
  }

  if (month && month !== "all") {
    params.push(month);
    schoolWhere += schoolWhere ? " AND " : " WHERE ";
    parentWhere += parentWhere ? " AND " : " WHERE ";
    eventWhere += eventWhere ? " AND " : " WHERE ";
    eventAliasWhere += eventAliasWhere ? " AND " : " WHERE ";

    schoolWhere += `EXTRACT(MONTH FROM payment_date) = $${params.length}`;
    parentWhere += `EXTRACT(MONTH FROM p.payment_date) = $${params.length}`;
    eventWhere += `EXTRACT(MONTH FROM created_at) = $${params.length}`;
    eventAliasWhere += `EXTRACT(MONTH FROM r.created_at) = $${params.length}`;
  }

  const incomeBreakdown = await pool.query(
    `
    SELECT * FROM (
      SELECT 'School Payments' AS source, COALESCE(SUM(amount),0) total
      FROM school_payments
      ${schoolWhere}

      UNION ALL

      SELECT 'Parent Training', COALESCE(SUM(p.amount),0)
      FROM parent_payments p
      ${parentWhere}

      UNION ALL

      SELECT 'Events', COALESCE(SUM(amount_paid),0)
      FROM event_registrations
      ${eventWhere}
      ${eventWhere ? " AND " : " WHERE "}
      payment_status IN ('success','completed')
    )x
    ORDER BY total DESC;
    `,
    params
  );

  const parentPayments = await pool.query(
    `
    SELECT
      u.fullname AS parent_name, u.email, i.training_title, p.amount, i.status,
      p.payment_method, p.transaction_reference, p.payment_date,
      STRING_AGG(s.fullname, ', ') AS students
    FROM parent_payments p
    JOIN parent_training_invoices i ON i.id = p.invoice_id
    JOIN users2 u ON u.id = i.parent_id
    LEFT JOIN invoice_students inv ON inv.invoice_id = i.id
    LEFT JOIN users2 s ON s.id = inv.student_id
    ${parentWhere}
    GROUP BY u.fullname, u.email, i.training_title, p.amount, i.status,
             p.payment_method, p.transaction_reference, p.payment_date
    ORDER BY p.payment_date DESC;
    `,
    params
  );

  const eventPayments = await pool.query(
    `
    SELECT e.title, r.registrant_name, r.registrant_email, r.amount_paid,
           r.payment_status, r.created_at
    FROM event_registrations r
    JOIN events e ON e.id = r.event_id
    ${eventAliasWhere}
    ORDER BY r.created_at DESC;
    `,
    params
  );

  const schoolRevenue = await pool.query(
    `SELECT COALESCE(SUM(amount),0) total FROM school_payments ${schoolWhere}`,
    params
  );
  const parentRevenue = await pool.query(
    `SELECT COALESCE(SUM(p.amount),0) total FROM parent_payments p ${parentWhere}`,
    params
  );
  const eventRevenue = await pool.query(
    `
    SELECT COALESCE(SUM(amount_paid),0) total FROM event_registrations
    ${eventWhere}
    ${eventWhere ? " AND " : " WHERE "}
    payment_status IN ('success','completed')
    `,
    params
  );
  const eventRegistrations = await pool.query(
    `SELECT COUNT(*) total FROM event_registrations ${eventWhere}`,
    params
  );

  const totalRevenue =
    Number(schoolRevenue.rows[0].total) +
    Number(parentRevenue.rows[0].total) +
    Number(eventRevenue.rows[0].total);

  const schoolPaymentsResult = await pool.query(
    `
    SELECT
      s.name AS school_name,
      COALESCE(st.total_students,0) * COALESCE(q.price_per_student,0) AS total_amount,
      COALESCE(p.total_paid,0) AS total_paid,
      (COALESCE(st.total_students,0) * COALESCE(q.price_per_student,0)) - COALESCE(p.total_paid,0) AS balance
    FROM quotes q
    JOIN schools s ON s.id = q.school_id
    LEFT JOIN (
      SELECT term_id, COUNT(*) total_students
      FROM student_term_enrollments
      GROUP BY term_id
    ) st ON st.term_id = q.term_id
    LEFT JOIN (
      SELECT quote_id, SUM(amount) total_paid
      FROM school_payments
      ${schoolWhere}
      GROUP BY quote_id
    ) p ON p.quote_id = q.id
    `,
    params
  );

  const paidSchools = schoolPaymentsResult.rows.filter(
    (x) => Number(x.balance) <= 0
  ).length;

  const outstandingBalance = schoolPaymentsResult.rows.reduce(
    (sum, row) => sum + Number(row.balance || 0),
    0
  );

  return {
    totalRevenue,
    filteredRevenue: totalRevenue,
    schoolRevenue: Number(schoolRevenue.rows[0].total),
    parentRevenue: Number(parentRevenue.rows[0].total),
    eventRevenue: Number(eventRevenue.rows[0].total),
    eventRegistrations: Number(eventRegistrations.rows[0].total),
    paidSchools,
    outstandingBalance,
    schools: schoolPaymentsResult.rows,
    incomeBreakdown: incomeBreakdown.rows,
    parentPayments: parentPayments.rows,
    eventPayments: eventPayments.rows,
  };
}

// ---------------------------------------------------------------------
// Learning
// ---------------------------------------------------------------------
async function getLearningAnalytics(bounds) {
  const totals = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM courses) total_courses,
      (SELECT COUNT(*) FROM modules) total_modules,
      (SELECT COUNT(*) FROM lessons) total_lessons
  `);

  const courseStats = await pool.query(`
    WITH ${EFFECTIVE_ENROLLMENTS_CTE}
    SELECT
      c.id, c.title,
      COUNT(DISTINCT ee.user_id) AS enrollments,
      COUNT(DISTINCT CASE WHEN us.role_in_school = 'student' THEN us.user_id END) AS school_learners,
      COUNT(DISTINCT sc.school_id) AS schools,
      COUNT(DISTINCT m.id) AS modules,
      COUNT(DISTINCT l.id) AS lessons,
      COUNT(DISTINCT ulp.id) AS lesson_completions,
      COUNT(DISTINCT uc.id) AS certificates
    FROM courses c
    LEFT JOIN effective_enrollments ee ON ee.course_id = c.id
    LEFT JOIN school_courses sc ON sc.course_id = c.id
    LEFT JOIN user_school us ON us.school_id = sc.school_id
    LEFT JOIN modules m ON m.course_id = c.id
    LEFT JOIN lessons l ON l.module_id = m.id
    LEFT JOIN user_lesson_progress ulp ON ulp.lesson_id = l.id
    LEFT JOIN user_certificates uc ON uc.course_id = c.id
    GROUP BY c.id
    ORDER BY enrollments DESC
  `);

  const courses = courseStats.rows.map((course) => {
    const totalLearners =
      Number(course.enrollments || 0) + Number(course.school_learners || 0);

    const moduleCompletion =
      course.enrollments > 0
        ? Math.round(
            (course.lesson_completions /
              (course.enrollments * Math.max(course.lessons, 1))) *
              100
          )
        : 0;

    return { ...course, totalLearners, moduleCompletion };
  });

  const result = {
    totalCourses: Number(totals.rows[0].total_courses),
    totalModules: Number(totals.rows[0].total_modules),
    totalLessons: Number(totals.rows[0].total_lessons),
    courses,
  };

  if (bounds) {
    const periodEnrollments = await pool.query(
      `
      WITH ${EFFECTIVE_ENROLLMENTS_CTE}
      SELECT COUNT(*) total FROM effective_enrollments
      WHERE first_activity >= $1 AND first_activity < $2
      `,
      [bounds.startDate, bounds.endDate]
    );
    const periodCompletions = await pool.query(
      `SELECT COUNT(*) total FROM user_lesson_progress WHERE completed_at >= $1 AND completed_at < $2`,
      [bounds.startDate, bounds.endDate]
    );
    result.periodEnrollments = Number(periodEnrollments.rows[0].total);
    result.periodCompletions = Number(periodCompletions.rows[0].total);
  }

  return result;
}

// ---------------------------------------------------------------------
// Schools
// ---------------------------------------------------------------------
async function getSchoolsAnalytics(bounds) {
  const summary = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM schools) AS schools,
      (SELECT COUNT(*) FROM user_school WHERE role_in_school = 'student') AS students,
      (SELECT COUNT(*) FROM user_school WHERE role_in_school = 'teacher') AS teachers,
      (SELECT COUNT(*) FROM classrooms) AS classrooms
  `);

  const schools = await pool.query(`
    SELECT
      s.id, s.name,
      COUNT(DISTINCT CASE WHEN us.role_in_school = 'student' THEN us.user_id END) AS students,
      COUNT(DISTINCT CASE WHEN us.role_in_school = 'teacher' THEN us.user_id END) AS teachers,
      COUNT(DISTINCT c.id) AS classrooms,
      COUNT(DISTINCT sc.course_id) AS courses,
      MAX(us.joined_at) AS last_activity
    FROM schools s
    LEFT JOIN user_school us ON us.school_id = s.id
    LEFT JOIN classrooms c ON c.school_id = s.id
    LEFT JOIN school_courses sc ON sc.school_id = s.id
    GROUP BY s.id, s.name
    ORDER BY s.name
  `);

  const result = {
    totalSchools: Number(summary.rows[0].schools),
    totalStudents: Number(summary.rows[0].students),
    totalTeachers: Number(summary.rows[0].teachers),
    totalClassrooms: Number(summary.rows[0].classrooms),
    schools: schools.rows,
  };

  if (bounds) {
    const onboarded = await pool.query(
      `SELECT COUNT(*) total FROM schools WHERE created_at >= $1 AND created_at < $2`,
      [bounds.startDate, bounds.endDate]
    );
    result.schoolsOnboardedInPeriod = Number(onboarded.rows[0].total);
  }

  result.termTrends = await getSchoolTermTrends();

  return result;
}

// School enrollment is per-term (student_term_enrollments), not a single
// running total — a school's "students" count on its own doesn't say
// whether that school is growing, shrinking, or just retaining the same
// students term after term. This walks each school's terms in order and
// compares each term to the one before it: student count, the change
// (count and %), and retention (how many students from the prior term
// are still enrolled in the current one).
async function getSchoolTermTrends() {
  const termCounts = await pool.query(`
    WITH term_counts AS (
      SELECT
        t.school_id, s.name AS school_name, t.id AS term_id, t.name AS term_name,
        t.start_date, t.is_active,
        COUNT(DISTINCT ste.student_id) AS students
      FROM academic_terms t
      JOIN schools s ON s.id = t.school_id
      LEFT JOIN student_term_enrollments ste ON ste.term_id = t.id
      GROUP BY t.school_id, s.name, t.id, t.name, t.start_date, t.is_active
    )
    SELECT
      *,
      LAG(term_id) OVER (PARTITION BY school_id ORDER BY start_date) AS prev_term_id,
      LAG(term_name) OVER (PARTITION BY school_id ORDER BY start_date) AS prev_term_name,
      LAG(students) OVER (PARTITION BY school_id ORDER BY start_date) AS prev_students
    FROM term_counts
    ORDER BY school_name, start_date
  `);

  // Retention counts for every pair of terms within the same school where
  // one term precedes the other — looked up below by exact (term_id,
  // prev_term_id) pair rather than filtered here, since a parameterized
  // list of pairs is awkward in plain SQL and this table is small.
  const retentionPairs = await pool.query(`
    SELECT
      cur.term_id, prev.term_id AS prev_term_id,
      COUNT(DISTINCT cur.student_id) AS retained
    FROM student_term_enrollments cur
    JOIN academic_terms ct ON ct.id = cur.term_id
    JOIN student_term_enrollments prev
      ON prev.student_id = cur.student_id AND prev.school_id = cur.school_id
    JOIN academic_terms pt ON pt.id = prev.term_id AND pt.school_id = ct.school_id
    WHERE pt.start_date < ct.start_date
    GROUP BY cur.term_id, prev.term_id
  `);

  const retentionMap = new Map();
  retentionPairs.rows.forEach((r) => {
    retentionMap.set(`${r.term_id}:${r.prev_term_id}`, Number(r.retained));
  });

  return termCounts.rows.map((row) => {
    const students = Number(row.students);
    const hasPrev = row.prev_term_id !== null;
    const prevStudents = hasPrev ? Number(row.prev_students) : null;
    const change = hasPrev ? students - prevStudents : null;
    const changePct = hasPrev && prevStudents > 0 ? Math.round((change / prevStudents) * 1000) / 10 : null;
    const retained = hasPrev ? retentionMap.get(`${row.term_id}:${row.prev_term_id}`) || 0 : null;
    const retentionRate = hasPrev && prevStudents > 0 ? Math.round((retained / prevStudents) * 1000) / 10 : null;

    return {
      schoolId: row.school_id,
      schoolName: row.school_name,
      termId: row.term_id,
      termName: row.term_name,
      startDate: row.start_date,
      isActive: row.is_active,
      students,
      prevTermName: row.prev_term_name || null,
      prevStudents,
      change,
      changePct,
      retained,
      retentionRate,
    };
  });
}

// ---------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------
async function getFinanceAnalytics(bounds) {
  const dateFilter = bounds ? "AND created_at >= $1 AND created_at < $2" : "";
  const params = bounds ? [bounds.startDate, bounds.endDate] : [];

  const revenue = await pool.query(
    `SELECT COALESCE(SUM(amount),0) total FROM transactions WHERE status='success' ${dateFilter}`,
    params
  );

  const totalTransactions = await pool.query(
    `SELECT COUNT(*) total FROM transactions ${bounds ? "WHERE created_at >= $1 AND created_at < $2" : ""}`,
    params
  );

  const failedTransactions = await pool.query(
    `SELECT COUNT(*) total FROM transactions WHERE status='failed' ${dateFilter}`,
    params
  );

  const recentTransactions = await pool.query(
    `
    SELECT * FROM transactions
    ${bounds ? "WHERE created_at >= $1 AND created_at < $2" : ""}
    ORDER BY created_at DESC LIMIT 20
    `,
    params
  );

  return {
    revenue: Number(revenue.rows[0].total),
    totalTransactions: Number(totalTransactions.rows[0].total),
    failedTransactions: Number(failedTransactions.rows[0].total),
    transactions: recentTransactions.rows,
  };
}

// ---------------------------------------------------------------------
// Engagement
// ---------------------------------------------------------------------
async function getEngagementAnalytics(bounds, { page = 1, limit = 50, action } = {}) {
  let whereClause = "WHERE 1=1";
  const params = [];
  let paramCount = 1;

  if (action) {
    whereClause += ` AND a.action ILIKE $${paramCount}`;
    params.push(`%${action}%`);
    paramCount++;
  }

  if (bounds) {
    whereClause += ` AND a.created_at >= $${paramCount}`;
    params.push(bounds.startDate);
    paramCount++;
    whereClause += ` AND a.created_at < $${paramCount}`;
    params.push(bounds.endDate);
    paramCount++;
  }

  const offset = (page - 1) * limit;
  const listParams = [...params, limit, offset];

  const activities = await pool.query(
    `
    SELECT
      a.id, a.user_id, a.role, a.action, a.details, a.created_at,
      u.fullname,
      COALESCE(s.name, 'Private Tutor') AS school_name,
      l.id AS lesson_id, l.title AS lesson_title,
      c.id AS course_id, c.title AS course_title
    FROM activities a
    LEFT JOIN users2 u ON u.id = a.user_id
    LEFT JOIN user_school us ON us.user_id = u.id
    LEFT JOIN schools s ON s.id = us.school_id
    LEFT JOIN lessons l ON l.id = COALESCE(a.lesson_id, NULLIF(substring(a.details FROM '([0-9]+)'), '')::INT)
    LEFT JOIN modules m ON m.id = l.module_id
    LEFT JOIN courses c ON c.id = m.course_id
    ${whereClause}
    ORDER BY a.created_at DESC
    LIMIT $${paramCount}
    OFFSET $${paramCount + 1}
    `,
    listParams
  );

  const totalResult = await pool.query(
    `SELECT COUNT(*) total FROM activities a ${whereClause}`,
    params
  );

  // dailyUsers/weeklyUsers/completedLessons/aiQuestions intentionally ignore
  // an ad-hoc startDate/endDate filter (that's the live Engagement tab's
  // list filter, `bounds` above) — they only become period-scoped when the
  // report generator explicitly passes `bounds.scoped = true` for a
  // month/year report. This preserves the live dashboard's original
  // behavior (always current rolling 1-day/7-day windows) exactly.
  const scoped = bounds && bounds.scoped;

  const dailyUsers = await pool.query(
    `SELECT COUNT(DISTINCT user_id) FROM activities WHERE ${
      scoped ? "created_at >= $1 AND created_at < $2" : "created_at >= NOW() - INTERVAL '1 day'"
    }`,
    scoped ? [bounds.startDate, bounds.endDate] : []
  );

  const weeklyUsers = await pool.query(
    `SELECT COUNT(DISTINCT user_id) FROM activities WHERE ${
      scoped ? "created_at >= $1 AND created_at < $2" : "created_at >= NOW() - INTERVAL '7 days'"
    }`,
    scoped ? [bounds.startDate, bounds.endDate] : []
  );

  const completedLessons = await pool.query(
    `SELECT COUNT(*) FROM user_lesson_progress ${
      scoped ? "WHERE completed_at >= $1 AND completed_at < $2" : ""
    }`,
    scoped ? [bounds.startDate, bounds.endDate] : []
  );

  const aiQuestions = await pool.query(
    `SELECT COUNT(*) FROM ai_tutor_logs ${
      scoped ? "WHERE created_at >= $1 AND created_at < $2" : ""
    }`,
    scoped ? [bounds.startDate, bounds.endDate] : []
  );

  return {
    dailyUsers: Number(dailyUsers.rows[0].count),
    weeklyUsers: Number(weeklyUsers.rows[0].count),
    completedLessons: Number(completedLessons.rows[0].count),
    aiQuestions: Number(aiQuestions.rows[0].count),
    totalActivities: Number(totalResult.rows[0].total),
    activities: activities.rows,
  };
}

// ---------------------------------------------------------------------
// Combined report analytics
// ---------------------------------------------------------------------
async function getReportAnalytics(scope, year, month) {
  const bounds = getPeriodBounds(scope, year, month);

  const [overview, business, learning, schools, finance, engagement] =
    await Promise.all([
      getOverviewAnalytics(bounds),
      getBusinessAnalytics({ year, month }),
      getLearningAnalytics(bounds),
      getSchoolsAnalytics(bounds),
      getFinanceAnalytics(bounds),
      getEngagementAnalytics(bounds ? { ...bounds, scoped: true } : null),
    ]);

  return {
    periodLabel: bounds ? bounds.label : "All Time",
    scope: scope || "all",
    bounds,
    overview,
    business,
    learning,
    schools,
    finance,
    engagement,
  };
}

// Month-by-month revenue across all 4 payment sources, for the investor
// pitch deck's traction chart. Nothing else in the dashboard exposes a
// time series — every other revenue figure is a single period total.
async function getMonthlyRevenueTrend(monthsBack = 12) {
  const result = await pool.query(
    `
    SELECT
      TO_CHAR(month, 'Mon YYYY') AS label,
      COALESCE(t.total, 0) + COALESCE(sp.total, 0) + COALESCE(pp.total, 0) + COALESCE(er.total, 0) AS total
    FROM generate_series(
      date_trunc('month', NOW()) - ($1::int - 1 || ' months')::interval,
      date_trunc('month', NOW()),
      '1 month'
    ) AS month
    LEFT JOIN (
      SELECT date_trunc('month', created_at) m, SUM(amount) total
      FROM transactions WHERE status = 'success'
      GROUP BY 1
    ) t ON t.m = month
    LEFT JOIN (
      SELECT date_trunc('month', payment_date) m, SUM(amount) total
      FROM school_payments
      GROUP BY 1
    ) sp ON sp.m = month
    LEFT JOIN (
      SELECT date_trunc('month', payment_date) m, SUM(amount) total
      FROM parent_payments
      GROUP BY 1
    ) pp ON pp.m = month
    LEFT JOIN (
      SELECT date_trunc('month', created_at) m, SUM(amount_paid) total
      FROM event_registrations
      GROUP BY 1
    ) er ON er.m = month
    ORDER BY month
    `,
    [monthsBack]
  );

  return result.rows.map((r) => ({ label: r.label, total: Number(r.total) }));
}

module.exports = {
  getPeriodBounds,
  getMonthlyRevenueTrend,
  getOverviewAnalytics,
  getBusinessAnalytics,
  getLearningAnalytics,
  getSchoolsAnalytics,
  getSchoolTermTrends,
  getFinanceAnalytics,
  getEngagementAnalytics,
  getReportAnalytics,
};
