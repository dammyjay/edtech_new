// services/lessonTaskService.js
//
// An instructor-assigned task bundling one or more lessons (quiz and/or
// lab) for a classroom to complete. No submission table of its own —
// completion is derived live from user_lesson_progress.completed_at,
// the same boolean every other dashboard in this app already reads
// (see services/lessonCompletionService.js). due_class_date is purely
// informational/reminder-timing, never a hard lock on submission.

const pool = require("../models/db");
const { computeNextClassDate } = require("./classDayService");

/**
 * Creates a classroom lesson task, verifying the instructor actually
 * teaches that classroom first. Throws with a short message on any
 * authorization/validation failure — callers map that to a 4xx.
 */
async function createLessonTask(instructorId, classroomId, lessonIds, title, instructions) {
  if (!Array.isArray(lessonIds) || lessonIds.length === 0) {
    throw new Error("At least one lesson must be selected.");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const ownershipRes = await client.query(
      `SELECT c.school_id, s.class_days
       FROM classroom_instructors ci
       JOIN classrooms c ON c.id = ci.classroom_id
       JOIN schools s ON s.id = c.school_id
       WHERE ci.instructor_id = $1 AND ci.classroom_id = $2`,
      [instructorId, classroomId]
    );
    if (ownershipRes.rows.length === 0) {
      throw new Error("You don't teach this classroom.");
    }
    const { class_days } = ownershipRes.rows[0];

    const dueClassDate = computeNextClassDate(class_days || []);

    const taskRes = await client.query(
      `INSERT INTO classroom_lesson_tasks (classroom_id, instructor_id, title, instructions, due_class_date)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, classroom_id, title, instructions, created_at, due_class_date`,
      [classroomId, instructorId, title, instructions || null, dueClassDate]
    );
    const task = taskRes.rows[0];

    for (const lessonId of lessonIds) {
      await client.query(
        `INSERT INTO classroom_lesson_task_lessons (task_id, lesson_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [task.id, lessonId]
      );
    }

    await client.query("COMMIT");
    return task;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * A single task's own metadata (no completion status) — used by
 * one-off pages that already know the task id (the parent-facing
 * status view) rather than listing every task for a role.
 */
async function getLessonTaskById(taskId) {
  const res = await pool.query(
    `SELECT t.id, t.classroom_id, c.name AS classroom_name, t.title, t.instructions,
            t.created_at, t.due_class_date
     FROM classroom_lesson_tasks t
     JOIN classrooms c ON c.id = t.classroom_id
     WHERE t.id = $1`,
    [taskId]
  );
  return res.rows[0] || null;
}

/**
 * Every task an instructor has created, across their own classrooms,
 * each with its lesson titles and a per-student completion summary.
 */
async function getLessonTasksForInstructor(instructorId) {
  const tasksRes = await pool.query(
    `SELECT t.id, t.classroom_id, c.name AS classroom_name, t.title, t.instructions,
            t.created_at, t.due_class_date
     FROM classroom_lesson_tasks t
     JOIN classrooms c ON c.id = t.classroom_id
     WHERE t.instructor_id = $1
     ORDER BY t.created_at DESC`,
    [instructorId]
  );

  return Promise.all(
    tasksRes.rows.map(async (task) => ({
      ...task,
      ...(await getTaskCompletionStatus(task.id)),
    }))
  );
}

/**
 * Every task across every classroom in a school — the school admin's
 * read-only view (full roster visibility, matching their existing
 * access everywhere else in this codebase).
 */
async function getLessonTasksForSchool(schoolId) {
  const tasksRes = await pool.query(
    `SELECT t.id, t.classroom_id, c.name AS classroom_name, t.title, t.instructions,
            t.created_at, t.due_class_date
     FROM classroom_lesson_tasks t
     JOIN classrooms c ON c.id = t.classroom_id
     WHERE c.school_id = $1 AND c.archived_at IS NULL
     ORDER BY t.created_at DESC`,
    [schoolId]
  );

  return Promise.all(
    tasksRes.rows.map(async (task) => ({
      ...task,
      ...(await getTaskCompletionStatus(task.id)),
    }))
  );
}

/**
 * Every task across the classrooms a teacher is assigned to — same
 * classroom_teachers join used throughout teacherController.js.
 */
async function getLessonTasksForTeacher(teacherId) {
  const tasksRes = await pool.query(
    `SELECT t.id, t.classroom_id, c.name AS classroom_name, t.title, t.instructions,
            t.created_at, t.due_class_date
     FROM classroom_lesson_tasks t
     JOIN classrooms c ON c.id = t.classroom_id
     JOIN classroom_teachers ct ON ct.classroom_id = c.id
     WHERE ct.teacher_id = $1 AND c.archived_at IS NULL
     ORDER BY t.created_at DESC`,
    [teacherId]
  );

  return Promise.all(
    tasksRes.rows.map(async (task) => ({
      ...task,
      ...(await getTaskCompletionStatus(task.id)),
    }))
  );
}

/**
 * For every current student in the task's classroom, whether they've
 * completed ALL of the task's bundled lessons (user_lesson_progress
 * has a completed_at row for each one).
 */
async function getTaskCompletionStatus(taskId) {
  const lessonsRes = await pool.query(
    `SELECT l.id, l.title
     FROM classroom_lesson_task_lessons tl
     JOIN lessons l ON l.id = tl.lesson_id
     WHERE tl.task_id = $1
     ORDER BY l.order_number`,
    [taskId]
  );
  const lessons = lessonsRes.rows;
  const lessonIds = lessons.map((l) => l.id);

  const studentsRes = await pool.query(
    `SELECT u.id, u.fullname
     FROM classroom_lesson_tasks t
     JOIN user_school us ON us.classroom_id = t.classroom_id
     JOIN users2 u ON u.id = us.user_id
     WHERE t.id = $1 AND us.role_in_school = 'student' AND us.approved = true
     ORDER BY u.fullname`,
    [taskId]
  );

  let perStudentDone = [];
  if (lessonIds.length > 0 && studentsRes.rows.length > 0) {
    const progressRes = await pool.query(
      `SELECT user_id, lesson_id
       FROM user_lesson_progress
       WHERE lesson_id = ANY($1) AND completed_at IS NOT NULL`,
      [lessonIds]
    );
    const doneSet = new Set(progressRes.rows.map((r) => `${r.user_id}:${r.lesson_id}`));

    perStudentDone = studentsRes.rows.map((student) => {
      const lessonStatus = lessonIds.map((lid) => doneSet.has(`${student.id}:${lid}`));
      return {
        id: student.id,
        fullname: student.fullname,
        completedAll: lessonStatus.every(Boolean),
        completedCount: lessonStatus.filter(Boolean).length,
      };
    });
  }

  const totalStudents = perStudentDone.length;
  const completedStudents = perStudentDone.filter((s) => s.completedAll).length;

  return {
    lessons,
    students: perStudentDone,
    totalStudents,
    completedStudents,
    allComplete: totalStudents > 0 && completedStudents === totalStudents,
  };
}

/**
 * Tasks belonging to classrooms in this school that aren't fully
 * complete yet and haven't already been reminded-for on
 * upcomingClassDate — exactly what the reminder cron needs.
 */
async function getPendingTasksForSchool(schoolId, upcomingClassDate) {
  const tasksRes = await pool.query(
    `SELECT t.id, t.classroom_id, c.name AS classroom_name, t.title, t.due_class_date
     FROM classroom_lesson_tasks t
     JOIN classrooms c ON c.id = t.classroom_id
     WHERE c.school_id = $1
       AND (t.last_reminder_sent_for_date IS NULL OR t.last_reminder_sent_for_date <> $2)`,
    [schoolId, upcomingClassDate]
  );

  const pending = [];
  for (const task of tasksRes.rows) {
    const status = await getTaskCompletionStatus(task.id);
    if (!status.allComplete) {
      pending.push({ ...task, ...status });
    }
  }
  return pending;
}

async function markTasksReminded(taskIds, upcomingClassDate) {
  if (!taskIds || taskIds.length === 0) return;
  await pool.query(
    `UPDATE classroom_lesson_tasks SET last_reminder_sent_for_date = $2 WHERE id = ANY($1)`,
    [taskIds, upcomingClassDate]
  );
}

module.exports = {
  createLessonTask,
  getLessonTaskById,
  getLessonTasksForInstructor,
  getLessonTasksForSchool,
  getLessonTasksForTeacher,
  getTaskCompletionStatus,
  getPendingTasksForSchool,
  markTasksReminded,
};
