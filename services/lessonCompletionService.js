// services/lessonCompletionService.js
//
// The generic "a student just made progress on a lesson" pipeline. Two
// separate concerns, deliberately split:
//
//   - awardXp: a reward for finishing ONE part of a lesson (the quiz, or
//     a lesson-attached lab task). Lands immediately, gated by the CALLER
//     on that part's own first-time-ness (quiz: first quiz_submissions row;
//     lab: lab_projects.status transitioning to 'submitted' — see
//     controllers/studentController.js:submitLessonQuiz and
//     controllers/labController.js:submitProject).
//
//   - maybeUnlockNextLesson: unlocking the NEXT lesson (+ module/assignment
//     unlock, module badge check, first-ever-completion referral bonus)
//     only happens once every part a lesson actually has is done — both
//     the quiz (if one exists) AND the lab task (if one exists). Whichever
//     finishes last is the one that reports the unlock; the other gets
//     `pendingLab` back so its caller can point the student at what's
//     still needed instead of the next lesson.
//
// Before this split, both were bundled into one function gated on
// user_lesson_progress, so a lesson with both a quiz and a lab unlocked
// the next lesson on whichever finished FIRST — not what's wanted once a
// lab task is meant to be a required step, not an optional alternative.

const pool = require("../models/db");
const { getLevelForXp } = require("../utils/xpLevels");
const { maybeAwardReferralBonus } = require("./referralService");
const { recordActivityForLesson } = require("./courseTermLinkService");
const { checkAndCompleteModule } = require("./moduleCompletionService");

/**
 * Awards XP for finishing one part of a lesson (quiz or lab). Callers are
 * responsible for only calling this on that part's genuine first
 * completion — resubmitting a quiz or a lab doesn't grind XP.
 *
 * @param {number} studentId
 * @param {number} xpAmount
 * @param {string} activityLabel - xp_history.activity text
 */
async function awardXp(studentId, xpAmount, activityLabel) {
  if (!xpAmount || xpAmount <= 0) {
    return { xpGained: 0, levelUp: false, levelAfter: null };
  }

  const xpBeforeRes = await pool.query(
    "SELECT COALESCE(xp, 0) AS xp FROM users2 WHERE id = $1",
    [studentId]
  );
  const xpBefore = xpBeforeRes.rows[0].xp;
  const levelBefore = getLevelForXp(xpBefore);
  const levelAfter = getLevelForXp(xpBefore + xpAmount);
  const levelUp = levelAfter.level > levelBefore.level;

  await pool.query(
    "UPDATE users2 SET xp = COALESCE(xp, 0) + $1, redeemable_xp = COALESCE(redeemable_xp, 0) + $1 WHERE id = $2",
    [xpAmount, studentId]
  );
  await pool.query(
    `INSERT INTO xp_history (user_id, xp, activity) VALUES ($1, $2, $3)`,
    [studentId, xpAmount, activityLabel]
  );

  return { xpGained: xpAmount, levelUp, levelAfter };
}

/**
 * Checks whether every part a lesson actually has (quiz, lab) is done for
 * this student, and if so, unlocks the next lesson/module and runs every
 * downstream effect that used to run unconditionally: first-ever-completion
 * referral bonus, term activity recording, module completion/badge check.
 * Idempotent (ON CONFLICT DO NOTHING on user_lesson_progress) — safe to
 * call from both the quiz path and the lab path every time either
 * completes, in either order.
 *
 * @param {number} studentId
 * @param {number} lessonId
 */
async function maybeUnlockNextLesson(studentId, lessonId) {
  const quizRes = await pool.query(
    "SELECT id FROM quizzes WHERE lesson_id = $1",
    [lessonId]
  );
  const quiz = quizRes.rows[0];
  let quizDone = true;
  if (quiz) {
    const r = await pool.query(
      "SELECT 1 FROM quiz_submissions WHERE quiz_id = $1 AND student_id = $2 LIMIT 1",
      [quiz.id, studentId]
    );
    quizDone = r.rows.length > 0;
  }

  const labRes = await pool.query(
    "SELECT id, title, lab_type FROM lesson_labs WHERE lesson_id = $1 ORDER BY id DESC LIMIT 1",
    [lessonId]
  );
  const lab = labRes.rows[0];
  let labDone = true;
  if (lab) {
    const r = await pool.query(
      "SELECT 1 FROM lab_projects WHERE lab_id = $1 AND student_id = $2 AND status = 'submitted' LIMIT 1",
      [lab.id, studentId]
    );
    labDone = r.rows.length > 0;
  }

  if (!(quizDone && labDone)) {
    return {
      unlocked: false,
      pendingLab: !labDone ? lab : null,
      nextLessonId: null,
      nextLessonModuleId: null,
      nextModuleUnlocked: false,
      nextModuleId: null,
      badgeAwarded: false,
      badgeName: null,
      badgeImage: null,
    };
  }

  const priorCompletionsRes = await pool.query(
    "SELECT COUNT(*) FROM user_lesson_progress WHERE user_id = $1",
    [studentId]
  );
  const isFirstEverCompletion = parseInt(priorCompletionsRes.rows[0].count, 10) === 0;

  const progressInsert = await pool.query(
    `INSERT INTO user_lesson_progress (user_id, lesson_id, completed_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id, lesson_id) DO NOTHING
     RETURNING id`,
    [studentId, lessonId]
  );
  const isNewCompletion = progressInsert.rows.length > 0;

  if (isFirstEverCompletion && isNewCompletion) {
    maybeAwardReferralBonus(studentId).catch((err) =>
      console.error("Referral bonus check failed:", err.message)
    );
  }

  recordActivityForLesson(studentId, lessonId);

  // Unlock next lesson OR next module + assignments (pass/fail doesn't matter).
  let nextLessonId = null;
  let nextModuleUnlocked = false;
  let nextModuleId = null;

  const nextLessonRes = await pool.query(
    `SELECT id FROM lessons
     WHERE module_id = (SELECT module_id FROM lessons WHERE id=$1)
       AND id > $1
     ORDER BY id ASC
     LIMIT 1`,
    [lessonId]
  );

  if (nextLessonRes.rows.length > 0) {
    nextLessonId = nextLessonRes.rows[0].id;
    await pool.query(
      `INSERT INTO unlocked_lessons (student_id, lesson_id)
       VALUES ($1, $2)
       ON CONFLICT (student_id, lesson_id) DO NOTHING`,
      [studentId, nextLessonId]
    );
  } else {
    const moduleIdRes = await pool.query(
      `SELECT module_id FROM lessons WHERE id=$1`,
      [lessonId]
    );
    const moduleId = moduleIdRes.rows[0].module_id;

    await pool.query(
      `INSERT INTO unlocked_assignments (student_id, assignment_id)
       SELECT $1, id
       FROM module_assignments
       WHERE module_id=$2
       ON CONFLICT (student_id, assignment_id) DO NOTHING`,
      [studentId, moduleId]
    );

    const nextModuleRes = await pool.query(
      `SELECT id
       FROM modules
       WHERE course_id = (SELECT course_id FROM modules WHERE id = $1)
         AND id > $1
       ORDER BY id ASC
       LIMIT 1`,
      [moduleId]
    );

    if (nextModuleRes.rows.length > 0) {
      nextModuleId = nextModuleRes.rows[0].id;
      nextModuleUnlocked = true;

      await pool.query(
        `INSERT INTO unlocked_modules (student_id, module_id)
         VALUES ($1, $2)
         ON CONFLICT (student_id, module_id) DO NOTHING`,
        [studentId, nextModuleId]
      );

      const firstLessonRes = await pool.query(
        `SELECT id FROM lessons WHERE module_id = $1 ORDER BY id ASC LIMIT 1`,
        [nextModuleId]
      );
      if (firstLessonRes.rows.length > 0) {
        nextLessonId = firstLessonRes.rows[0].id;
        await pool.query(
          `INSERT INTO unlocked_lessons (student_id, lesson_id)
           VALUES ($1, $2)
           ON CONFLICT (student_id, lesson_id) DO NOTHING`,
          [studentId, nextLessonId]
        );
      }
    }
  }

  const moduleIdForBadgeRes = await pool.query(
    `SELECT module_id FROM lessons WHERE id=$1`,
    [lessonId]
  );
  const moduleIdForBadge = moduleIdForBadgeRes.rows[0]?.module_id;
  const moduleResult = moduleIdForBadge
    ? await checkAndCompleteModule(studentId, moduleIdForBadge)
    : { completed: false, badgeAwarded: false };

  // Which module nextLessonId itself lives in — same query regardless of
  // which branch above set it (same module vs. first lesson of the next
  // one), so the caller can build a working deep link
  // (/student/dashboard?section=module&moduleId=&openLesson=) without
  // needing to know which case it was.
  let nextLessonModuleId = null;
  if (nextLessonId) {
    const nextLessonModuleRes = await pool.query(
      `SELECT module_id FROM lessons WHERE id = $1`,
      [nextLessonId]
    );
    nextLessonModuleId = nextLessonModuleRes.rows[0]?.module_id || null;
  }

  return {
    unlocked: isNewCompletion,
    pendingLab: null,
    nextLessonId,
    nextLessonModuleId,
    nextModuleUnlocked,
    nextModuleId,
    badgeAwarded: moduleResult?.badgeAwarded || false,
    badgeName: moduleResult?.badgeName || null,
    badgeImage: moduleResult?.badgeImage || null,
  };
}

module.exports = { awardXp, maybeUnlockNextLesson };
