// services/flashcardProgressService.js
//
// Gates a module's assignment(s) on its flashcard deck being watched
// all the way through, when one exists: lessons done -> flashcards
// unlock -> flashcards watched -> assignment unlocks. A module with no
// flashcard set behaves exactly as before (assignment unlocks the
// moment its lessons are done) — this is additive, not a new
// requirement for every module.
//
// Deliberately NOT retroactive: this only ever INSERTs into
// unlocked_assignments, never deletes from it, so a student who already
// had an assignment unlocked before this feature existed keeps it
// unlocked regardless of whether they've "watched" a flashcard deck
// that may not have even existed yet when they got there.

const pool = require("../models/db");

async function hasFlashcards(moduleId) {
  const r = await pool.query(`SELECT 1 FROM flashcards WHERE module_id = $1 LIMIT 1`, [moduleId]);
  return r.rows.length > 0;
}

async function hasCompletedFlashcards(studentId, moduleId) {
  const r = await pool.query(
    `SELECT 1 FROM student_flashcard_progress WHERE student_id = $1 AND module_id = $2`,
    [studentId, moduleId]
  );
  return r.rows.length > 0;
}

// Whether this student has finished every lesson in this module — the
// gate flashcards themselves wait on (they're not freely available from
// lesson 1; they open once the module's lessons are actually done, the
// same point that used to unlock the assignment directly).
async function hasCompletedAllLessons(studentId, moduleId) {
  const r = await pool.query(
    `SELECT 1 FROM lessons l
     WHERE l.module_id = $1 AND l.archived_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM user_lesson_progress ulp
         WHERE ulp.user_id = $2 AND ulp.lesson_id = l.id
       )
     LIMIT 1`,
    [moduleId, studentId]
  );
  return r.rows.length === 0; // no lesson found "not yet done" = all done
}

// Unlocks a module's assignment(s) for this student IF they're allowed
// to be right now — called both from the lesson-completion flow (where
// this used to be an unconditional INSERT) and from markFlashcardsCompleted
// below (once the deck's just been watched). Idempotent either way via
// ON CONFLICT, same as the call site it replaced.
async function unlockModuleAssignmentsIfReady(studentId, moduleId) {
  const needsFlashcards = (await hasFlashcards(moduleId)) && !(await hasCompletedFlashcards(studentId, moduleId));
  if (needsFlashcards) {
    return { unlocked: false, pendingFlashcards: moduleId };
  }
  await pool.query(
    `INSERT INTO unlocked_assignments (student_id, assignment_id)
     SELECT $1, id FROM module_assignments WHERE module_id = $2
     ON CONFLICT (student_id, assignment_id) DO NOTHING`,
    [studentId, moduleId]
  );
  return { unlocked: true, pendingFlashcards: null };
}

// Called once the student has watched every card in the deck (client
// enforces the per-card timing; this just records completion and tries
// to unlock whatever was waiting on it).
async function markFlashcardsCompleted(studentId, moduleId) {
  await pool.query(
    `INSERT INTO student_flashcard_progress (student_id, module_id) VALUES ($1, $2)
     ON CONFLICT (student_id, module_id) DO NOTHING`,
    [studentId, moduleId]
  );
  return unlockModuleAssignmentsIfReady(studentId, moduleId);
}

module.exports = {
  hasFlashcards,
  hasCompletedFlashcards,
  hasCompletedAllLessons,
  unlockModuleAssignmentsIfReady,
  markFlashcardsCompleted,
};
