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

const pool = require("../models/db");

// A module counts as "finished" once every one of its lessons has a
// user_lesson_progress row for this student — independent of whether it
// also has a quiz/assignment/badge, so a module made of plain
// video/notes lessons still triggers feedback once read through.
// Picks the OLDEST finished-but-unanswered module first (not the most
// recent) so a student who stacked up several without answering clears
// them in the order they finished them, rather than always being asked
// about whichever they completed last.
async function getPendingFeedbackModule(studentId) {
  const r = await pool.query(
    `SELECT m.id AS module_id, m.title AS module_title
     FROM modules m
     JOIN lessons l ON l.module_id = m.id AND l.archived_at IS NULL
     LEFT JOIN user_lesson_progress ulp ON ulp.lesson_id = l.id AND ulp.user_id = $1
     LEFT JOIN survey_submissions ss ON ss.module_id = m.id AND ss.student_id = $1
     WHERE ss.id IS NULL
     GROUP BY m.id, m.title
     HAVING COUNT(l.id) > 0 AND COUNT(l.id) = COUNT(ulp.id)
     ORDER BY MAX(ulp.completed_at) ASC
     LIMIT 1`,
    [studentId]
  );
  const row = r.rows[0];
  return row ? { moduleId: row.module_id, moduleTitle: row.module_title } : null;
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

// Re-derives the pending module server-side (never trusts a client-
// supplied moduleId) and validates every active question got a non-empty
// answer before writing anything. answersByQuestionId: { [questionId]: "text" }.
async function submitSurveyAnswers(studentId, answersByQuestionId) {
  const pending = await getPendingFeedbackModule(studentId);
  if (!pending) {
    // Nothing outstanding (already submitted, or raced with another
    // submit) — treat as a harmless no-op rather than an error.
    return { success: true, alreadyDone: true };
  }

  const questions = await getActiveQuestions();
  for (const q of questions) {
    const answer = (answersByQuestionId?.[q.id] ?? "").toString().trim();
    if (!answer) {
      return { success: false, message: `Please answer: "${q.question_text}"` };
    }
    if (q.question_type === "multiple_choice" && Array.isArray(q.options) && !q.options.includes(answer)) {
      return { success: false, message: `Invalid answer for: "${q.question_text}"` };
    }
  }

  const submissionRes = await pool.query(
    `INSERT INTO survey_submissions (student_id, module_id) VALUES ($1, $2)
     ON CONFLICT (student_id, module_id) DO NOTHING
     RETURNING id`,
    [studentId, pending.moduleId]
  );
  if (submissionRes.rows.length === 0) {
    return { success: true, alreadyDone: true };
  }
  const submissionId = submissionRes.rows[0].id;

  for (const q of questions) {
    const answer = answersByQuestionId[q.id].toString().trim();
    await pool.query(
      `INSERT INTO survey_answers (submission_id, question_id, question_text_snapshot, answer_text)
       VALUES ($1, $2, $3, $4)`,
      [submissionId, q.id, q.question_text, answer]
    );
  }

  return { success: true, moduleTitle: pending.moduleTitle };
}

module.exports = { getPendingFeedbackModule, getActiveQuestions, submitSurveyAnswers };
