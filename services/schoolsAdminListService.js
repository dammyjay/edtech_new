// Backs the platform admin's "All Schools" list (controllers/adminController.js's
// getSchools) and its Excel/PDF exports — one shared query so all three stay
// in sync instead of drifting copies of the same SQL.
const pool = require("../models/db");

// "Last term" figures, not all-time: student_count and total_paid are both
// scoped to each school's most recently started academic_terms row, not a
// running platform-wide total. Terms are per-school (academic_terms.school_id
// — schools don't share a term calendar), so this is a per-school lookup.
//
// academic_terms.is_active isn't a reliable "current term" flag — it's only
// ever set by the platform-admin createTerm path (controllers/adminController.js),
// not the school-admin one (controllers/schoolAdminController.js), so a
// school can legitimately have zero active terms. ORDER BY start_date DESC
// is the recency convention already trusted elsewhere for this
// (controllers/adminController.js's terms list, schoolAdminController.js's
// quotes-by-term), so it's reused here instead of is_active.
//
// Total paid is summed directly from school_payments (via quotes.term_id),
// not read off quotes.total_paid — there's no DB constraint enforcing one
// quote per (school_id, term_id), so trusting a single quote row's running
// total isn't safe even though in practice there's usually only one.
//
// student_count comes from student_term_enrollments, which has
// UNIQUE(student_id, term_id) — a plain COUNT(*) per term is already a
// distinct-student count, no COUNT(DISTINCT ...) needed.
//
// teacher_count/classroom_count stay all-time (approved=true) — teachers
// and classrooms aren't per-term concepts in this schema the way student
// enrollment and quotes are.
async function getAllSchoolsWithPaymentSummary() {
  const result = await pool.query(`
    SELECT
      s.id,
      s.name,
      s.email,
      s.phone,
      s.address,
      s.logo_url,
      s.created_at,
      COUNT(DISTINCT CASE WHEN us.role_in_school = 'teacher' AND us.approved = true THEN u.id END) AS teacher_count,
      COUNT(DISTINCT c.id) AS classroom_count,
      lt.id AS last_term_id,
      lt.name AS last_term_name,
      COALESCE(sc.student_count_last_term, 0) AS student_count,
      COALESCE(tp.total_paid_last_term, 0) AS last_payment_amount
    FROM schools s
    LEFT JOIN user_school us ON s.id = us.school_id
    LEFT JOIN users2 u ON us.user_id = u.id
    LEFT JOIN classrooms c ON c.school_id = s.id
    LEFT JOIN LATERAL (
      SELECT t.id, t.name
      FROM academic_terms t
      WHERE t.school_id = s.id
      ORDER BY t.start_date DESC NULLS LAST, t.created_at DESC, t.id DESC
      LIMIT 1
    ) lt ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS student_count_last_term
      FROM student_term_enrollments ste
      WHERE ste.term_id = lt.id
    ) sc ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(sp.amount), 0) AS total_paid_last_term
      FROM school_payments sp
      JOIN quotes q ON q.id = sp.quote_id
      WHERE q.term_id = lt.id AND q.school_id = s.id
    ) tp ON true
    GROUP BY s.id, lt.id, lt.name, sc.student_count_last_term, tp.total_paid_last_term
    ORDER BY s.created_at DESC
  `);
  return result.rows;
}

module.exports = { getAllSchoolsWithPaymentSummary };
