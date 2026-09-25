// Shared archive/restore/permanent-delete logic for "Delete" across five
// entity types: users (every role), schools, courses, modules, lessons.
// "Delete" on any of these no longer runs an immediate, cascading DELETE
// — these tables' many ON DELETE CASCADE foreign keys (confirmed via a
// full audit of models/initTables.js) touch dozens of dependent tables:
// submissions, progress, attendance, payments, chat history, certificates.
// Instead "Delete" archives the row (archived_at set), and a separate,
// later, admin-only action from the /admin/archive screen
// (controllers/archiveController.js) runs the real destructive delete.
//
// Deliberately NOT the same mechanism as user_school.is_active, which is
// a lighter-weight "left this specific school" flag scoped to one school
// membership row, reversible with one click, and never blocks login.
// Archive here is account/record-wide: an archived user cannot log in at
// all (see adminController.login), and archiving is the deliberate first
// step toward permanent deletion, not a "hide from one list" toggle.
//
// ENTITY_CONFIG is the one place to extend this to another entity type
// (classrooms, quizzes, assignments, external projects, ...) later —
// everything else in this file is generic over it.
const pool = require("../models/db");

const ENTITY_CONFIG = {
  user: { table: "users2", label: "user" },
  school: { table: "schools", label: "school" },
  course: { table: "courses", label: "course" },
  module: { table: "modules", label: "module" },
  lesson: { table: "lessons", label: "lesson" },
  classroom: { table: "classrooms", label: "classroom" },
  term: { table: "academic_terms", label: "academic term" },
  external_project: { table: "external_projects", label: "external project" },
  event: { table: "events", label: "event" },
  quote: { table: "quotes", label: "quote" },
};

function assertEntity(entity) {
  const config = ENTITY_CONFIG[entity];
  if (!config) throw new Error(`Unknown archive entity: ${entity}`);
  return config;
}

async function archive(entity, id, byUserId) {
  const { table } = assertEntity(entity);
  const result = await pool.query(
    `UPDATE ${table} SET archived_at = NOW(), archived_by = $1
     WHERE id = $2 AND archived_at IS NULL
     RETURNING *`,
    [byUserId || null, id]
  );
  return result.rows[0] || null;
}

async function restore(entity, id) {
  const { table } = assertEntity(entity);
  const result = await pool.query(
    `UPDATE ${table} SET archived_at = NULL, archived_by = NULL
     WHERE id = $1
     RETURNING *`,
    [id]
  );
  return result.rows[0] || null;
}

// The literal DELETE FROM ... that used to run directly from the "Delete"
// button — behavior unchanged (same cascade as always), just relocated
// behind the Archive screen's confirm step. Most of these tables' real,
// FK-enforced ON DELETE CASCADE relationships (confirmed in
// models/initTables.js) already clean up everything a plain DELETE needs
// to, but quotes.term_id is a bare INT column with no FK at all — the
// old deleteTerm handlers deleted quotes manually first for exactly that
// reason, so "term" keeps doing the same thing here to match.
async function permanentlyDelete(entity, id) {
  const { table } = assertEntity(entity);
  if (entity === "term") {
    await pool.query(`DELETE FROM quotes WHERE term_id = $1`, [id]);
  }
  const result = await pool.query(`DELETE FROM ${table} WHERE id = $1 RETURNING id`, [id]);
  return result.rowCount > 0;
}

// Each entity's own query — different tables need different label/context
// columns and joins, so this isn't fully generic over ENTITY_CONFIG.
const LIST_QUERIES = {
  user: (search, role) => ({
    text: `
      SELECT u.id, u.fullname AS label, u.email AS extra, u.role AS context,
             s.name AS parent_label, u.archived_at, ab.fullname AS archived_by_name
      FROM users2 u
      LEFT JOIN user_school us ON us.user_id = u.id
      LEFT JOIN schools s ON s.id = us.school_id
      LEFT JOIN users2 ab ON ab.id = u.archived_by
      WHERE u.archived_at IS NOT NULL
        AND ($1::text IS NULL OR u.role = $1)
        AND ($2::text IS NULL OR u.fullname ILIKE '%' || $2 || '%' OR u.email ILIKE '%' || $2 || '%')
      ORDER BY u.archived_at DESC
    `,
    params: [role || null, search || null],
  }),
  school: (search) => ({
    text: `
      SELECT s.id, s.name AS label, s.email AS extra, NULL::text AS context,
             NULL::text AS parent_label, s.archived_at, ab.fullname AS archived_by_name
      FROM schools s
      LEFT JOIN users2 ab ON ab.id = s.archived_by
      WHERE s.archived_at IS NOT NULL
        AND ($1::text IS NULL OR s.name ILIKE '%' || $1 || '%')
      ORDER BY s.archived_at DESC
    `,
    params: [search || null],
  }),
  course: (search) => ({
    text: `
      SELECT c.id, c.title AS label, NULL::text AS extra, NULL::text AS context,
             p.title AS parent_label, c.archived_at, ab.fullname AS archived_by_name
      FROM courses c
      LEFT JOIN career_pathways p ON p.id = c.career_pathway_id
      LEFT JOIN users2 ab ON ab.id = c.archived_by
      WHERE c.archived_at IS NOT NULL
        AND ($1::text IS NULL OR c.title ILIKE '%' || $1 || '%')
      ORDER BY c.archived_at DESC
    `,
    params: [search || null],
  }),
  module: (search) => ({
    text: `
      SELECT m.id, m.title AS label, NULL::text AS extra, NULL::text AS context,
             c.title AS parent_label, m.archived_at, ab.fullname AS archived_by_name
      FROM modules m
      JOIN courses c ON c.id = m.course_id
      LEFT JOIN users2 ab ON ab.id = m.archived_by
      WHERE m.archived_at IS NOT NULL
        AND ($1::text IS NULL OR m.title ILIKE '%' || $1 || '%')
      ORDER BY m.archived_at DESC
    `,
    params: [search || null],
  }),
  lesson: (search) => ({
    text: `
      SELECT l.id, l.title AS label, NULL::text AS extra, NULL::text AS context,
             c.title AS parent_label, l.archived_at, ab.fullname AS archived_by_name
      FROM lessons l
      JOIN modules m ON m.id = l.module_id
      JOIN courses c ON c.id = m.course_id
      LEFT JOIN users2 ab ON ab.id = l.archived_by
      WHERE l.archived_at IS NOT NULL
        AND ($1::text IS NULL OR l.title ILIKE '%' || $1 || '%')
      ORDER BY l.archived_at DESC
    `,
    params: [search || null],
  }),
  classroom: (search) => ({
    text: `
      SELECT c.id, c.name AS label, NULL::text AS extra, NULL::text AS context,
             s.name AS parent_label, c.archived_at, ab.fullname AS archived_by_name
      FROM classrooms c
      LEFT JOIN schools s ON s.id = c.school_id
      LEFT JOIN users2 ab ON ab.id = c.archived_by
      WHERE c.archived_at IS NOT NULL
        AND ($1::text IS NULL OR c.name ILIKE '%' || $1 || '%')
      ORDER BY c.archived_at DESC
    `,
    params: [search || null],
  }),
  term: (search) => ({
    text: `
      SELECT t.id, t.name AS label, NULL::text AS extra, NULL::text AS context,
             s.name AS parent_label, t.archived_at, ab.fullname AS archived_by_name
      FROM academic_terms t
      LEFT JOIN schools s ON s.id = t.school_id
      LEFT JOIN users2 ab ON ab.id = t.archived_by
      WHERE t.archived_at IS NOT NULL
        AND ($1::text IS NULL OR t.name ILIKE '%' || $1 || '%')
      ORDER BY t.archived_at DESC
    `,
    params: [search || null],
  }),
  external_project: (search) => ({
    text: `
      SELECT ep.id, ep.title AS label, NULL::text AS extra,
             CASE WHEN ep.lesson_id IS NOT NULL THEN 'lesson'
                  WHEN ep.module_id IS NOT NULL THEN 'module'
                  ELSE 'course' END AS context,
             co.title AS parent_label, ep.archived_at, ab.fullname AS archived_by_name
      FROM external_projects ep
      LEFT JOIN modules m ON m.id = ep.module_id
      LEFT JOIN lessons l ON l.id = ep.lesson_id
      LEFT JOIN modules lm ON lm.id = l.module_id
      LEFT JOIN courses co ON co.id = COALESCE(ep.course_id, m.course_id, lm.course_id)
      LEFT JOIN users2 ab ON ab.id = ep.archived_by
      WHERE ep.archived_at IS NOT NULL
        AND ($1::text IS NULL OR ep.title ILIKE '%' || $1 || '%')
      ORDER BY ep.archived_at DESC
    `,
    params: [search || null],
  }),
  event: (search) => ({
    text: `
      SELECT e.id, e.title AS label, TO_CHAR(e.event_date, 'YYYY-MM-DD') AS extra,
             NULL::text AS context, NULL::text AS parent_label,
             e.archived_at, ab.fullname AS archived_by_name
      FROM events e
      LEFT JOIN users2 ab ON ab.id = e.archived_by
      WHERE e.archived_at IS NOT NULL
        AND ($1::text IS NULL OR e.title ILIKE '%' || $1 || '%')
      ORDER BY e.archived_at DESC
    `,
    params: [search || null],
  }),
  quote: (search) => ({
    text: `
      SELECT q.id, ('Quote #' || q.id || ' — ' || COALESCE(t.name, 'no term')) AS label,
             q.status AS extra, NULL::text AS context,
             s.name AS parent_label, q.archived_at, ab.fullname AS archived_by_name
      FROM quotes q
      LEFT JOIN schools s ON s.id = q.school_id
      LEFT JOIN academic_terms t ON t.id = q.term_id
      LEFT JOIN users2 ab ON ab.id = q.archived_by
      WHERE q.archived_at IS NOT NULL
        AND ($1::text IS NULL OR s.name ILIKE '%' || $1 || '%' OR t.name ILIKE '%' || $1 || '%')
      ORDER BY q.archived_at DESC
    `,
    params: [search || null],
  }),
};

async function listArchived(entity, { search = null, role = null } = {}) {
  assertEntity(entity);
  const build = LIST_QUERIES[entity];
  const { text, params } = entity === "user" ? build(search, role) : build(search);
  const result = await pool.query(text, params);
  return result.rows;
}

// Small, curated (not exhaustive) headline counts for the permanent-delete
// confirmation — enough for an admin to not be surprised, not a full
// dependency audit of every one of these tables' many foreign keys.
async function getDependencyCounts(entity, id) {
  assertEntity(entity);
  switch (entity) {
    case "user": {
      const result = await pool.query(
        `SELECT
          (SELECT COUNT(*) FROM user_school WHERE user_id = $1) AS school_memberships,
          (SELECT COUNT(*) FROM courses WHERE instructor_id = $1) AS courses_authored,
          (SELECT COUNT(*) FROM assignment_submissions WHERE student_id = $1) AS assignment_submissions,
          (SELECT COUNT(*) FROM lab_submissions WHERE submitted_by = $1) AS lab_submissions,
          (SELECT COUNT(*) FROM external_project_submissions WHERE student_id = $1) AS external_project_submissions
        `,
        [id]
      );
      return result.rows[0];
    }
    case "school": {
      const result = await pool.query(
        `SELECT
          (SELECT COUNT(*) FROM classrooms WHERE school_id = $1) AS classrooms,
          (SELECT COUNT(*) FROM academic_terms WHERE school_id = $1) AS terms,
          (SELECT COUNT(*) FROM user_school WHERE school_id = $1) AS memberships
        `,
        [id]
      );
      return result.rows[0];
    }
    case "course": {
      const result = await pool.query(
        `SELECT
          (SELECT COUNT(*) FROM modules WHERE course_id = $1) AS modules,
          (SELECT COUNT(*) FROM lessons l JOIN modules m ON m.id = l.module_id WHERE m.course_id = $1) AS lessons,
          (SELECT COUNT(*) FROM course_enrollments WHERE course_id = $1) AS enrolled_students,
          (SELECT COUNT(*) FROM external_projects WHERE course_id = $1) AS external_projects
        `,
        [id]
      );
      return result.rows[0];
    }
    case "module": {
      const result = await pool.query(
        `SELECT
          (SELECT COUNT(*) FROM lessons WHERE module_id = $1) AS lessons,
          (SELECT COUNT(*) FROM module_assignments WHERE module_id = $1) AS assignments
        `,
        [id]
      );
      return result.rows[0];
    }
    case "lesson": {
      const result = await pool.query(
        `SELECT
          (SELECT COUNT(*) FROM quiz_questions qq JOIN quizzes q ON q.id = qq.quiz_id WHERE q.lesson_id = $1) AS quiz_questions,
          (SELECT COUNT(*) FROM lesson_assignments WHERE lesson_id = $1) AS assignments
        `,
        [id]
      );
      return result.rows[0];
    }
    case "classroom": {
      const result = await pool.query(
        `SELECT
          (SELECT COUNT(*) FROM user_school WHERE classroom_id = $1) AS student_memberships,
          (SELECT COUNT(*) FROM classroom_teachers WHERE classroom_id = $1) AS teachers,
          (SELECT COUNT(*) FROM classroom_instructors WHERE classroom_id = $1) AS instructors,
          (SELECT COUNT(*) FROM classroom_courses WHERE classroom_id = $1) AS assigned_courses,
          (SELECT COUNT(*) FROM attendance_sessions WHERE classroom_id = $1) AS attendance_sessions
        `,
        [id]
      );
      return result.rows[0];
    }
    case "term": {
      const result = await pool.query(
        `SELECT
          (SELECT COUNT(*) FROM student_term_enrollments WHERE term_id = $1) AS student_enrollments,
          (SELECT COUNT(*) FROM quotes WHERE term_id = $1) AS quotes,
          (SELECT COUNT(*) FROM attendance_sessions WHERE term_id = $1) AS attendance_sessions
        `,
        [id]
      );
      return result.rows[0];
    }
    case "external_project": {
      const result = await pool.query(
        `SELECT (SELECT COUNT(*) FROM external_project_submissions WHERE external_project_id = $1) AS submissions`,
        [id]
      );
      return result.rows[0];
    }
    case "event": {
      const result = await pool.query(
        `SELECT (SELECT COUNT(*) FROM event_registrations WHERE event_id = $1) AS registrations`,
        [id]
      );
      return result.rows[0];
    }
    case "quote": {
      const result = await pool.query(
        `SELECT (SELECT COUNT(*) FROM school_payments WHERE quote_id = $1) AS payments`,
        [id]
      );
      return result.rows[0];
    }
    default:
      return {};
  }
}

module.exports = {
  ENTITY_CONFIG,
  archive,
  restore,
  permanentlyDelete,
  listArchived,
  getDependencyCounts,
};
