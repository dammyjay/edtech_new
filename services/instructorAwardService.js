// services/instructorAwardService.js
//
// Lets an instructor manually award a student real, spendable coins
// (services/coinService.js#awardCoins — the same currency the student
// shop/leaderboard/coin_history already use) as a gamified recognition
// tool, with real anti-bias limits enforced here, server-side, not just
// hidden in the UI:
//
//  1. The instructor never types an arbitrary amount — they pick from a
//     small, fixed set of categories, each with its own fixed coin
//     value (AWARD_CATEGORIES below). That's the actual bias-resistance
//     mechanism; the caps below are a second, independent layer on top
//     of it.
//  2. Per student, per instructor, per calendar day: at most
//     MAX_AWARDS_PER_STUDENT_PER_DAY awards, and never the same
//     category twice — an instructor can't empty every category onto
//     one favorite student in one sitting.
//  3. Per instructor, per calendar day, across every student combined:
//     a MAX_COINS_PER_INSTRUCTOR_PER_DAY coin budget — once spent,
//     every further award is rejected until the next day.
//
// Both caps are computed live from instructor_point_awards via
// COUNT(*)/SUM(...) WHERE created_at::date = CURRENT_DATE — the same
// rate-limit idiom already used for the AI tutor's daily free-question
// cap (controllers/studentController.js) rather than a stored
// "remaining" counter column, so it's correct even under concurrent
// requests and never needs a daily reset job.
const pool = require("../models/db");
const { awardCoins } = require("./coinService");
const { logActivityForUser } = require("../utils/activityLogger");

const AWARD_CATEGORIES = {
  participation: { label: "Great Participation", emoji: "🌟", amount: 5 },
  homework: { label: "Homework Excellence", emoji: "📚", amount: 10 },
  helper: { label: "Helping a Classmate", emoji: "🤝", amount: 5 },
  improved: { label: "Most Improved", emoji: "📈", amount: 10 },
  attendance: { label: "Perfect Attendance (week)", emoji: "🎯", amount: 8 },
  creativity: { label: "Creative Thinking", emoji: "💡", amount: 7 },
};

const MAX_AWARDS_PER_STUDENT_PER_DAY = 3;
const MAX_COINS_PER_INSTRUCTOR_PER_DAY = 100;

function getCategoryList() {
  return Object.entries(AWARD_CATEGORIES).map(([key, c]) => ({ key, ...c }));
}

async function getRemainingBudget(instructorId) {
  const result = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS spent
     FROM instructor_point_awards
     WHERE instructor_id = $1 AND created_at::date = CURRENT_DATE`,
    [instructorId]
  );
  const spentToday = Number(result.rows[0].spent);
  return {
    spentToday,
    remaining: Math.max(0, MAX_COINS_PER_INSTRUCTOR_PER_DAY - spentToday),
    budget: MAX_COINS_PER_INSTRUCTOR_PER_DAY,
  };
}

// req is optional (only used to feed the shared activities feed via
// logActivityForUser, which reads role/school off req.session) — every
// other check runs off the explicit args so this stays testable/callable
// outside a request too.
async function awardPoints({ req, instructorId, studentId, classroomId, category, note }) {
  const cat = AWARD_CATEGORIES[category];
  if (!instructorId || !studentId || !classroomId || !cat) {
    return { ok: false, reason: "invalid_request" };
  }

  // Authorization: this instructor must actually teach this student in
  // this specific classroom — same join shape as viewStudentProgress's
  // accessCheck elsewhere in instructorController.js.
  const accessCheck = await pool.query(
    `SELECT c.school_id
     FROM user_school us
     JOIN classrooms c ON c.id = us.classroom_id
     JOIN classroom_instructors ci ON ci.classroom_id = c.id
     WHERE us.user_id = $1
       AND us.classroom_id = $2
       AND ci.instructor_id = $3
       AND us.role_in_school = 'student'
       AND us.approved = true`,
    [studentId, classroomId, instructorId]
  );
  if (!accessCheck.rowCount) {
    return { ok: false, reason: "not_authorized" };
  }
  const schoolId = accessCheck.rows[0].school_id;

  const studentTodayRes = await pool.query(
    `SELECT category, COUNT(*)::int AS count
     FROM instructor_point_awards
     WHERE instructor_id = $1 AND student_id = $2 AND created_at::date = CURRENT_DATE
     GROUP BY category`,
    [instructorId, studentId]
  );
  const studentTodayTotal = studentTodayRes.rows.reduce((sum, r) => sum + r.count, 0);
  if (studentTodayTotal >= MAX_AWARDS_PER_STUDENT_PER_DAY) {
    return { ok: false, reason: "student_daily_limit", limit: MAX_AWARDS_PER_STUDENT_PER_DAY };
  }
  if (studentTodayRes.rows.some((r) => r.category === category)) {
    return { ok: false, reason: "category_already_used_today" };
  }

  const { remaining } = await getRemainingBudget(instructorId);
  if (remaining < cat.amount) {
    return { ok: false, reason: "daily_budget_exhausted", remaining };
  }

  await awardCoins(studentId, cat.amount, `Instructor award: ${cat.emoji} ${cat.label}`);

  const insertRes = await pool.query(
    `INSERT INTO instructor_point_awards
       (instructor_id, student_id, classroom_id, school_id, category, amount, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, created_at`,
    [instructorId, studentId, classroomId, schoolId, category, cat.amount, (note || "").trim() || null]
  );

  if (req) {
    await logActivityForUser(
      req,
      "Awarded student points",
      `${cat.emoji} ${cat.label} (+${cat.amount} coins)`,
      schoolId
    );
  }

  return {
    ok: true,
    awardId: insertRes.rows[0].id,
    amount: cat.amount,
    category: cat.label,
    remainingBudget: remaining - cat.amount,
  };
}

async function getRecentAwards({ instructorId, classroomId, limit = 20 }) {
  const params = [instructorId];
  let query = `
    SELECT ipa.id, ipa.category, ipa.amount, ipa.note, ipa.created_at,
           s.fullname AS student_name, s.id AS student_id,
           c.name AS classroom_name
    FROM instructor_point_awards ipa
    JOIN users2 s ON s.id = ipa.student_id
    LEFT JOIN classrooms c ON c.id = ipa.classroom_id
    WHERE ipa.instructor_id = $1
  `;
  if (classroomId) {
    params.push(classroomId);
    query += ` AND ipa.classroom_id = $${params.length}`;
  }
  params.push(Math.min(Number(limit) || 20, 100));
  query += ` ORDER BY ipa.created_at DESC LIMIT $${params.length}`;

  const result = await pool.query(query, params);
  return result.rows.map((r) => {
    const cat = AWARD_CATEGORIES[r.category];
    return { ...r, categoryLabel: cat ? `${cat.emoji} ${cat.label}` : r.category };
  });
}

module.exports = {
  AWARD_CATEGORIES,
  MAX_AWARDS_PER_STUDENT_PER_DAY,
  MAX_COINS_PER_INSTRUCTOR_PER_DAY,
  getCategoryList,
  getRemainingBudget,
  awardPoints,
  getRecentAwards,
};
