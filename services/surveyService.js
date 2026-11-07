// services/surveyService.js
//
// Two independent, admin-editable feedback tracks sharing one question
// bank (survey_questions.scope distinguishes them):
//
//  - COURSE feedback ('course' scope): compulsory, fires once a student
//    finishes an entire course — reusing the same completion signal
//    that already issues a certificate (user_certificates), rather than
//    re-deriving "100% + every assignment submitted" a second time.
//    Originally this fired per-MODULE; moved to per-COURSE (far less
//    frequent) after that proved too tiring. Backlog catch-up (a
//    student with more than one course owed at once answers ONE survey
//    covering all of them) carries over unchanged, just at course grain.
//
//  - PLATFORM feedback ('platform' scope): compulsory too, but NOT tied
//    to finishing anything — it's asked periodically about the platform
//    itself. isEligibleForPlatformFeedback enforces "at least ~14 days
//    since they last answered (or since they joined, if never)"; on top
//    of that, rollPlatformFeedback only actually shows it on ~15% of
//    eligible page loads, so the exact moment isn't predictable. Shares
//    survey_submissions with the course track (course_id stays NULL,
//    scope='platform') rather than a separate table — a student answers
//    this many times over their lifetime, so it's read as a log via
//    MAX(submitted_at), not a once-per-entity existence check.
//
// Both tracks reuse the same non-dismissible modal on the client
// (views/student/dashboard.ejs's showFeedbackSurveyModal) and the same
// "finished the course gate takes priority" check order in
// controllers/studentController.js's viewLesson/submitLessonQuiz: a
// platform-feedback roll is only even attempted when no course feedback
// is owed, so a student is never shown both at once.

const pool = require("../models/db");
const { awardCoins } = require("./coinService");

const QUESTIONS_PER_SURVEY = 3;
const FEEDBACK_COIN_REWARD = 10;
const PLATFORM_FEEDBACK_ELIGIBLE_DAYS = 14;
const PLATFORM_FEEDBACK_CHANCE = 0.15;

// ===================== Course feedback =====================

// A course counts as "finished" once it has issued a certificate for
// this student — the platform's own existing definition (100% lesson
// progress, plus every module assignment submitted if any exist; see
// controllers/studentController.js's canAwardCertificate), so this
// doesn't re-derive that logic a second time. Returns EVERY
// finished-but-unanswered course, oldest-finished-first.
async function getPendingFeedbackCourses(studentId) {
  const r = await pool.query(
    `SELECT c.id AS course_id, c.title AS course_title
     FROM courses c
     JOIN user_certificates uc ON uc.course_id = c.id AND uc.user_id = $1
     LEFT JOIN survey_submissions ss ON ss.course_id = c.id AND ss.student_id = $1
     WHERE ss.id IS NULL
     ORDER BY uc.issued_at ASC`,
    [studentId]
  );
  return r.rows.map((row) => ({ courseId: row.course_id, courseTitle: row.course_title }));
}

// Back-compat single-course accessor — controllers/studentController.js
// and controllers/labController.js only need a truthy "is anything
// pending" check to decide whether to surface the modal at all, so they
// keep using this; only submitSurveyAnswers/getActiveSurveyForStudent
// need the full backlog list.
async function getPendingFeedbackCourse(studentId) {
  const pending = await getPendingFeedbackCourses(studentId);
  return pending[0] || null;
}

async function getActiveQuestions(scope) {
  const r = await pool.query(
    `SELECT id, question_text, question_type, options, category, order_number, scope
     FROM survey_questions
     WHERE is_active = true AND scope = $1
     ORDER BY order_number ASC, id ASC`,
    [scope]
  );
  return r.rows;
}

// Deterministic pseudo-random shuffle keyed on `seed` — same seed always
// produces the same order, so a GET (what to show) and the later POST
// (what to validate against) agree on which QUESTIONS_PER_SURVEY-sized
// subset is "this survey", without persisting any new state.
function seededShuffle(arr, seed) {
  let state = 0;
  const seedStr = String(seed);
  for (let i = 0; i < seedStr.length; i++) state = (state * 31 + seedStr.charCodeAt(i)) >>> 0;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// A random QUESTIONS_PER_SURVEY-sized subset of the given scope's active
// bank, not the whole thing every time — keeps each ask short (~15s) and
// means a student doesn't see the exact same form twice in a row, even
// with a small question bank.
async function getQuestionsForSurvey(scope, seed) {
  const active = await getActiveQuestions(scope);
  if (active.length <= QUESTIONS_PER_SURVEY) return active;
  return seededShuffle(active, seed).slice(0, QUESTIONS_PER_SURVEY);
}

function validateAnswers(questions, answersByQuestionId) {
  for (const q of questions) {
    const answer = (answersByQuestionId?.[q.id] ?? "").toString().trim();
    if (!answer) return `Please answer: "${q.question_text}"`;
    if (q.question_type === "multiple_choice" && Array.isArray(q.options) && !q.options.includes(answer)) {
      return `Invalid answer for: "${q.question_text}"`;
    }
  }
  return null;
}

async function awardFeedbackCoins(studentId) {
  await awardCoins(studentId, FEEDBACK_COIN_REWARD, "Feedback survey");
  const balanceRes = await pool.query(`SELECT coins FROM users2 WHERE id = $1`, [studentId]);
  return { coinsAwarded: FEEDBACK_COIN_REWARD, newCoinBalance: balanceRes.rows[0]?.coins ?? null };
}

// Re-derives the pending course(s) server-side (never trusts a client-
// supplied courseId) and validates every sampled question got a
// non-empty answer before writing anything. answersByQuestionId:
// { [questionId]: "text" }.
async function submitSurveyAnswers(studentId, answersByQuestionId) {
  const pending = await getPendingFeedbackCourses(studentId);
  if (!pending.length) {
    // Nothing outstanding (already submitted, or raced with another
    // submit) — treat as a harmless no-op rather than an error.
    return { success: true, alreadyDone: true };
  }

  const questions = await getQuestionsForSurvey("course", pending[0].courseId);
  const validationError = validateAnswers(questions, answersByQuestionId);
  if (validationError) return { success: false, message: validationError };

  const isBacklogCatchup = pending.length > 1;

  // One submission row per owed course either way (so none of them can
  // ever re-trigger the prompt) — but in catch-up mode, the real answers
  // attach to only the first (oldest) one; the rest are bare exemption
  // markers with no survey_answers rows, so admin's response tallies
  // (controllers/surveyController.js's getResponses, which reads from
  // survey_answers) are never inflated by duplicate catch-up answers.
  let answeredSubmissionId = null;
  for (const course of pending) {
    const submissionRes = await pool.query(
      `INSERT INTO survey_submissions (student_id, course_id, is_backlog_catchup) VALUES ($1, $2, $3)
       ON CONFLICT (student_id, course_id) DO NOTHING
       RETURNING id`,
      [studentId, course.courseId, isBacklogCatchup]
    );
    if (submissionRes.rows.length && answeredSubmissionId === null) {
      answeredSubmissionId = submissionRes.rows[0].id;
    }
  }
  if (answeredSubmissionId === null) {
    // Every row already existed (raced with another submit) — nothing left to do.
    return { success: true, alreadyDone: true };
  }

  for (const q of questions) {
    const answer = answersByQuestionId[q.id].toString().trim();
    await pool.query(
      `INSERT INTO survey_answers (submission_id, question_id, question_text_snapshot, answer_text)
       VALUES ($1, $2, $3, $4)`,
      [answeredSubmissionId, q.id, q.question_text, answer]
    );
  }

  // A flat reward regardless of backlog size — it's paid for the one
  // piece of effort just given, not multiplied by how many courses a
  // catch-up happens to clear, which would reward letting feedback pile
  // up instead of answering promptly.
  const reward = await awardFeedbackCoins(studentId);

  return isBacklogCatchup
    ? { success: true, backlogCatchup: true, courseCount: pending.length, ...reward }
    : { success: true, courseTitle: pending[0].courseTitle, ...reward };
}

// ===================== Platform feedback =====================

// "Eligible" once ~14 days have passed since this student last answered
// the platform survey, or since they joined if they never have — NOT
// the same as "will be shown"; rollPlatformFeedback below layers the
// random per-page-load chance on top of this floor. Reads from
// survey_submissions WHERE scope='platform' (course_id stays NULL for
// these rows) rather than a separate table — see the schema comment in
// models/initTables.js for why.
async function isEligibleForPlatformFeedback(studentId) {
  const r = await pool.query(
    `SELECT GREATEST(
       COALESCE((SELECT MAX(submitted_at) FROM survey_submissions WHERE student_id = $1 AND scope = 'platform'), u.created_at)
     ) AS since
     FROM users2 u WHERE u.id = $1`,
    [studentId]
  );
  const since = r.rows[0]?.since;
  if (!since) return false;
  const daysSince = (Date.now() - new Date(since).getTime()) / (1000 * 60 * 60 * 24);
  return daysSince >= PLATFORM_FEEDBACK_ELIGIBLE_DAYS;
}

// The actual per-page-load decision — only called when no course
// feedback is already owed (controllers/studentController.js), so the
// two tracks never both show up in the same visit.
async function rollPlatformFeedback(studentId) {
  const eligible = await isEligibleForPlatformFeedback(studentId);
  if (!eligible) return false;
  return Math.random() < PLATFORM_FEEDBACK_CHANCE;
}

// Same day -> same seed -> same sampled subset, so a GET (show) and the
// POST moments later agree on which questions are "this survey" even
// though, unlike course feedback, there's no stable entity id to seed
// from; a different day naturally means a different subset next time.
function platformSurveySeed(studentId) {
  return `${studentId}:${new Date().toISOString().slice(0, 10)}`;
}

async function submitPlatformFeedback(studentId, answersByQuestionId) {
  // Re-derives eligibility server-side (never trusts that the client's
  // earlier GET was legitimate) — also what makes a double-submit (e.g.
  // a double-click) harmless: the first submit's INSERT immediately
  // makes isEligibleForPlatformFeedback false again.
  if (!(await isEligibleForPlatformFeedback(studentId))) {
    return { success: true, alreadyDone: true };
  }

  const questions = await getQuestionsForSurvey("platform", platformSurveySeed(studentId));
  if (!questions.length) return { success: true, alreadyDone: true };

  const validationError = validateAnswers(questions, answersByQuestionId);
  if (validationError) return { success: false, message: validationError };

  const submissionRes = await pool.query(
    `INSERT INTO survey_submissions (student_id, scope) VALUES ($1, 'platform') RETURNING id`,
    [studentId]
  );
  const submissionId = submissionRes.rows[0].id;

  for (const q of questions) {
    const answer = answersByQuestionId[q.id].toString().trim();
    await pool.query(
      `INSERT INTO survey_answers (submission_id, question_id, question_text_snapshot, answer_text)
       VALUES ($1, $2, $3, $4)`,
      [submissionId, q.id, q.question_text, answer]
    );
  }

  const reward = await awardFeedbackCoins(studentId);
  return { success: true, ...reward };
}

module.exports = {
  getPendingFeedbackCourse,
  getPendingFeedbackCourses,
  getActiveQuestions,
  getQuestionsForSurvey,
  submitSurveyAnswers,
  isEligibleForPlatformFeedback,
  rollPlatformFeedback,
  submitPlatformFeedback,
  platformSurveySeed,
};
