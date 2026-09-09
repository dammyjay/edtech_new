// services/masteryPathService.js
//
// Adaptive mastery signals — an additive personalization layer on top of
// the existing linear unlock system (services/lessonCompletionService.js),
// which is deliberately left untouched here: certificates, badges, and
// term reports all assume that fixed module/lesson sequence, so this
// doesn't gate or reorder anything. Instead, after a quiz or lab is
// graded, a low score gets an AI-personalized remedial tip (and alerts
// the student's teacher in real time) and a very high score gets an
// optional stretch challenge — both surfaced immediately in the grading
// response and later in the student's "Recommended for you" dashboard
// widget until dismissed.

const pool = require("../models/db");
const { askTutor } = require("../utils/ai");
const { notifyUser } = require("../utils/notify");

// Matches the existing at-risk convention already used for the teacher
// analytics/report pipeline (services/classroomTermAnalyticsService.js:
// `s.completionPercent < 40 || s.quizAvg < 50`) — reusing the same 50%
// line here instead of inventing a second threshold.
const REMEDIAL_MAX_SCORE = 50;
// Deliberately higher than the existing "🌟 Excellent" tier (80%, see
// studentController.js's canned quiz feedback) — a bonus/stretch prompt
// is meant to be rarer and feel special, not fire on every solid score.
const BONUS_MIN_SCORE = 90;

function signalTypeForScore(score) {
  if (score == null) return null;
  if (score < REMEDIAL_MAX_SCORE) return "remedial";
  if (score >= BONUS_MIN_SCORE) return "bonus";
  return null;
}

async function buildMessage({ signalType, lessonTitle, lessonContext, score, wrongAnswersSummary }) {
  const cleanContext = (lessonContext || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 2500);

  const prompt =
    signalType === "remedial"
      ? `A student just scored ${score}% on "${lessonTitle}".
${wrongAnswersSummary ? `What they got wrong:\n${wrongAnswersSummary}\n` : ""}
Lesson content (for context, don't restate it):
${cleanContext}

Write a short (2-3 sentences), warm, specific tip for what to review before trying again. Talk directly to the student. No preamble, no "Sure, here's...".`
      : `A student just scored ${score}% on "${lessonTitle}" — they've clearly mastered it.

Lesson content (for context, don't restate it):
${cleanContext}

Give them one short (2-3 sentence), fun, optional "stretch challenge" — something a little harder related to this topic to try if they want to go further. Talk directly to the student, upbeat tone. No preamble.`;

  try {
    const answer = await askTutor({ question: prompt, maxTokens: 220 });
    return answer.trim();
  } catch (err) {
    console.error("masteryPathService buildMessage error:", err.message);
    return signalType === "remedial"
      ? "Take another look at this lesson before your next attempt — you've got this!"
      : "Great work! Try applying what you learned here to something a bit trickier.";
  }
}

// Only fires for a genuinely NEW open signal — retaking a quiz a few
// times shouldn't re-alert the teacher every time. An existing open
// (undismissed) signal of the same type for this (student, lesson) just
// gets its score/message refreshed instead.
async function notifyTeachers(studentId, lessonId, lessonTitle, score) {
  try {
    const studentRes = await pool.query(`SELECT fullname FROM users2 WHERE id = $1`, [studentId]);
    const studentName = studentRes.rows[0]?.fullname || "A student";

    const teachersRes = await pool.query(
      `SELECT DISTINCT ct.teacher_id
       FROM user_school us
       JOIN classroom_teachers ct ON ct.classroom_id = us.classroom_id
       WHERE us.user_id = $1 AND us.role_in_school = 'student' AND us.approved = true`,
      [studentId]
    );

    for (const row of teachersRes.rows) {
      notifyUser(row.teacher_id, {
        type: "mastery_alert",
        title: "A student might need help",
        message: `${studentName} scored ${score}% on "${lessonTitle}" — might be worth checking in.`,
        url: "/teacher/dashboard",
      }).catch((err) => console.error("Mastery alert notification failed:", err.message));
    }
  } catch (err) {
    console.error("notifyTeachers error:", err.message);
  }
}

/**
 * Called right after a quiz or lab task is graded. Returns
 * `{ id, signalType, message }` for a remedial/bonus signal, or `null`
 * when the score doesn't cross either threshold (most scores — this is
 * deliberately rare, not a comment on every submission).
 *
 * @param {object} params
 * @param {number} params.studentId
 * @param {number} params.lessonId
 * @param {'quiz'|'lab'} params.source
 * @param {number} params.sourceId - quiz_submissions.id or lab_submissions.id
 * @param {number} params.score - 0-100
 * @param {string} params.lessonTitle
 * @param {string} [params.lessonContext] - lesson content / lab instructions, for the AI prompt
 * @param {string} [params.wrongAnswersSummary] - plain-text summary of what was missed (quiz only)
 */
async function generateMasterySignal({ studentId, lessonId, source, sourceId, score, lessonTitle, lessonContext, wrongAnswersSummary }) {
  const signalType = signalTypeForScore(score);
  if (!signalType || !lessonId) return null;

  const existingRes = await pool.query(
    `SELECT id FROM mastery_signals
     WHERE student_id = $1 AND lesson_id = $2 AND signal_type = $3 AND dismissed = false
     ORDER BY created_at DESC LIMIT 1`,
    [studentId, lessonId, signalType]
  );
  const isNewSignal = existingRes.rows.length === 0;

  const message = await buildMessage({ signalType, lessonTitle, lessonContext, score, wrongAnswersSummary });

  let signalId;
  if (isNewSignal) {
    const insertRes = await pool.query(
      `INSERT INTO mastery_signals (student_id, lesson_id, source, source_id, signal_type, score, message)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [studentId, lessonId, source, sourceId, signalType, score, message]
    );
    signalId = insertRes.rows[0].id;
  } else {
    signalId = existingRes.rows[0].id;
    await pool.query(
      `UPDATE mastery_signals SET source = $1, source_id = $2, score = $3, message = $4, updated_at = NOW() WHERE id = $5`,
      [source, sourceId, score, message, signalId]
    );
  }

  if (signalType === "remedial" && isNewSignal) {
    notifyTeachers(studentId, lessonId, lessonTitle, score);
  }

  return { id: signalId, signalType, message };
}

// For the student dashboard's "Recommended for you" widget.
async function getOpenMasterySignals(studentId) {
  const result = await pool.query(
    `SELECT ms.id, ms.lesson_id, ms.signal_type, ms.score, ms.message, ms.created_at,
            l.title AS lesson_title, l.module_id
     FROM mastery_signals ms
     JOIN lessons l ON l.id = ms.lesson_id
     WHERE ms.student_id = $1 AND ms.dismissed = false
     ORDER BY ms.created_at DESC
     LIMIT 20`,
    [studentId]
  );
  return result.rows;
}

async function dismissMasterySignal(studentId, signalId) {
  const result = await pool.query(
    `UPDATE mastery_signals SET dismissed = true WHERE id = $1 AND student_id = $2 RETURNING id`,
    [signalId, studentId]
  );
  return result.rows.length > 0;
}

module.exports = { generateMasterySignal, getOpenMasterySignals, dismissMasterySignal };
