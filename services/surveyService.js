// services/surveyService.js
//
// The compulsory module feedback survey: one global, admin-editable
// question bank (survey_questions) reused for every module, answered
// once per student per module (survey_submissions/survey_answers).
//
// Gating, per the product decision behind this feature: finishing a
// module's last lesson does NOT lock that module or the next one's
// unlock/badge/assignment chain — it only queues a "you owe feedback for
// module X" flag that controllers/studentController.js surfaces at two
// points: immediately after the quiz/lab that finished the module, and
// again every time the student opens ANY lesson afterwards (viewLesson),
// until they submit it. getPendingFeedbackModule is the single source of
// truth both call sites check.
//
// Backlog catch-up: a student who finished several modules before ever
// being asked (either this feature just shipped, or they ignored the
// prompt across modules for a while) would otherwise face one full
// survey per backlogged module back-to-back — tedious and not worth the
// data. getPendingFeedbackModules (plural) exposes the WHOLE queue so
// submitSurveyAnswers can detect "more than one owed at once" and treat
// it as a single catch-up ask that clears the entire backlog in one go
// (see the is_backlog_catchup branch below) instead of looping the
// per-module modal N times. Once caught up, a student only ever
// accumulates at most one pending module at a time (the gate fires
// right after each module's last lesson), so this condition naturally
// only ever fires for genuine backlogs, with no separate cutoff date to
// track.

const pool = require("../models/db");
const { awardCoins } = require("./coinService");

const QUESTIONS_PER_SURVEY = 3;
const FEEDBACK_COIN_REWARD = 10;

// A module counts as "finished" once every one of its lessons has a
// user_lesson_progress row for this student — independent of whether it
// also has a quiz/assignment/badge, so a module made of plain
// video/notes lessons still triggers feedback once read through.
// Returns EVERY finished-but-unanswered module, oldest-finished-first.
async function getPendingFeedbackModules(studentId) {
  const r = await pool.query(
    `SELECT m.id AS module_id, m.title AS module_title
     FROM modules m
     JOIN lessons l ON l.module_id = m.id AND l.archived_at IS NULL
     LEFT JOIN user_lesson_progress ulp ON ulp.lesson_id = l.id AND ulp.user_id = $1
     LEFT JOIN survey_submissions ss ON ss.module_id = m.id AND ss.student_id = $1
     WHERE ss.id IS NULL
     GROUP BY m.id, m.title
     HAVING COUNT(l.id) > 0 AND COUNT(l.id) = COUNT(ulp.id)
     ORDER BY MAX(ulp.completed_at) ASC`,
    [studentId]
  );
  return r.rows.map((row) => ({ moduleId: row.module_id, moduleTitle: row.module_title }));
}

// Back-compat single-module accessor — controllers/studentController.js
// and controllers/labController.js only need a truthy "is anything
// pending" check to decide whether to surface the modal at all, so they
// keep using this; only submitSurveyAnswers/getActiveSurveyForStudent
// need the full backlog list.
async function getPendingFeedbackModule(studentId) {
  const pending = await getPendingFeedbackModules(studentId);
  return pending[0] || null;
}

async function getActiveQuestions() {
  const r = await pool.query(
    `SELECT id, question_text, question_type, options, category, order_number
     FROM survey_questions
     WHERE is_active = true
     ORDER BY order_number ASC, id ASC`
  );
  return r.rows;
}

// Deterministic pseudo-random shuffle keyed on `seed` — same seed always
// produces the same order, so a GET (what to show) and the later POST
// (what to validate against) agree on which QUESTIONS_PER_SURVEY-sized
// subset is "this survey", without persisting any new state. seed is the
// oldest pending module's id, so the same student sees a different
// subset for their next module too.
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

// A random QUESTIONS_PER_SURVEY-sized subset of the active bank, not the
// whole thing every time — keeps each ask short (~15s) and means a
// student who's completed a dozen modules never sees the exact same
// form twice in a row, even with a small question bank.
async function getQuestionsForSurvey(seed) {
  const active = await getActiveQuestions();
  if (active.length <= QUESTIONS_PER_SURVEY) return active;
  return seededShuffle(active, seed).slice(0, QUESTIONS_PER_SURVEY);
}

// Re-derives the pending module(s) server-side (never trusts a client-
// supplied moduleId) and validates every active question got a non-empty
// answer before writing anything. answersByQuestionId: { [questionId]: "text" }.
async function submitSurveyAnswers(studentId, answersByQuestionId) {
  const pending = await getPendingFeedbackModules(studentId);
  if (!pending.length) {
    // Nothing outstanding (already submitted, or raced with another
    // submit) — treat as a harmless no-op rather than an error.
    return { success: true, alreadyDone: true };
  }

  const questions = await getQuestionsForSurvey(pending[0].moduleId);
  for (const q of questions) {
    const answer = (answersByQuestionId?.[q.id] ?? "").toString().trim();
    if (!answer) {
      return { success: false, message: `Please answer: "${q.question_text}"` };
    }
    if (q.question_type === "multiple_choice" && Array.isArray(q.options) && !q.options.includes(answer)) {
      return { success: false, message: `Invalid answer for: "${q.question_text}"` };
    }
  }

  const isBacklogCatchup = pending.length > 1;

  // One submission row per owed module either way (so none of them can
  // ever re-trigger the prompt) — but in catch-up mode, the real answers
  // attach to only the first (oldest) one; the rest are bare exemption
  // markers with no survey_answers rows, so admin's response tallies
  // (controllers/surveyController.js's getResponses, which reads from
  // survey_answers) are never inflated by duplicate catch-up answers.
  let answeredSubmissionId = null;
  for (const mod of pending) {
    const submissionRes = await pool.query(
      `INSERT INTO survey_submissions (student_id, module_id, is_backlog_catchup) VALUES ($1, $2, $3)
       ON CONFLICT (student_id, module_id) DO NOTHING
       RETURNING id`,
      [studentId, mod.moduleId, isBacklogCatchup]
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
  // piece of effort just given, not multiplied by how many modules a
  // catch-up happens to clear, which would reward letting feedback pile
  // up instead of answering promptly.
  await awardCoins(studentId, FEEDBACK_COIN_REWARD, "Module feedback survey");
  const balanceRes = await pool.query(`SELECT coins FROM users2 WHERE id = $1`, [studentId]);
  const newCoinBalance = balanceRes.rows[0]?.coins ?? null;

  return isBacklogCatchup
    ? { success: true, backlogCatchup: true, moduleCount: pending.length, coinsAwarded: FEEDBACK_COIN_REWARD, newCoinBalance }
    : { success: true, moduleTitle: pending[0].moduleTitle, coinsAwarded: FEEDBACK_COIN_REWARD, newCoinBalance };
}

module.exports = {
  getPendingFeedbackModule,
  getPendingFeedbackModules,
  getActiveQuestions,
  getQuestionsForSurvey,
  submitSurveyAnswers,
};
