const pool = require("../models/db");

// Term-end locking: once a term a student was enrolled in has ended
// (academic_terms.is_ended = true), any lesson they haven't completed
// yet in that term's courses becomes locked — no new completions/quiz
// submissions — until they pay to reactivate (wallet) or a school admin
// reactivates it for free. Already-completed lessons stay viewable
// forever, unaffected by any of this.
//
// This is a SEPARATE gate from services/studentCourseAccessService.js,
// which locks a course when a student has left the classroom that had
// it. Both gates run independently in completeLesson/submitLessonQuiz.

// Courses that counted as "belonging to" classroomId for termId — same
// convention as classroomTermAnalyticsService.computeClassroomTermAnalytics
// (lines 84-100): the active term's courses are read live off
// classroom_courses (current assignment, even before any activity
// exists), any other term (ended, or superseded-but-never-ended) uses
// the confirmed course_term_links evidence, since classroom_courses only
// reflects "right now" and would misrepresent a stale term.
async function resolveTermCourseIds(classroomId, termId, isActive) {
  if (!classroomId) return new Set();
  const result = isActive
    ? await pool.query(
        "SELECT course_id FROM classroom_courses WHERE classroom_id = $1",
        [classroomId]
      )
    : await pool.query(
        "SELECT DISTINCT course_id FROM course_term_links WHERE classroom_id = $1 AND term_id = $2",
        [classroomId, termId]
      );
  return new Set(result.rows.map((r) => r.course_id));
}

// Union of course ids reachable through the student's genuinely ACTIVE
// term enrollment(s) — i.e. their live, current access right now. A
// course that recurs in both an ended term and the current active term
// is never considered locked.
//
// Deliberately keyed on is_active, not "not ended": a term that's been
// superseded by a newer one (is_active=false) but never explicitly
// ended (is_ended=false) is NOT "open" — it's just a term nobody
// clicked "End Term" on yet. classroom_courses isn't cleared when a
// term ends, so if this counted any non-ended term as open, a course
// that recurred in that stale prior term would stay "open" forever and
// never lock, even after the term actually being checked has ended.
async function getOpenCourseIds(studentId, excludeTermId) {
  const enrollmentsRes = await pool.query(
    `SELECT ste.term_id, ste.classroom_id
     FROM student_term_enrollments ste
     JOIN academic_terms at ON at.id = ste.term_id
     WHERE ste.student_id = $1 AND at.is_active = true
       AND ste.term_id IS DISTINCT FROM $2`,
    [studentId, excludeTermId || null]
  );

  const openCourseIds = new Set();
  for (const ste of enrollmentsRes.rows) {
    const courseIds = await resolveTermCourseIds(ste.classroom_id, ste.term_id, true);
    courseIds.forEach((id) => openCourseIds.add(id));
  }
  return openCourseIds;
}

// For one ended student_term_enrollments row: the courses that are
// actually locked (belonged to that term, not also open elsewhere),
// each annotated with lesson counts and the prorated reactivation price.
// Courses with zero lessons, or already fully completed, are excluded —
// nothing to lock, nothing to charge.
async function getLockedCoursesForEnrollment(studentId, ste) {
  if (!ste.classroom_id) return [];

  const termCourseIds = await resolveTermCourseIds(ste.classroom_id, ste.term_id, false);
  if (!termCourseIds.size) return [];

  const openCourseIds = await getOpenCourseIds(studentId, ste.term_id);
  const lockedCourseIds = [...termCourseIds].filter((id) => !openCourseIds.has(id));
  if (!lockedCourseIds.length) return [];

  const coursesRes = await pool.query(
    `SELECT c.id, c.title, c.amount FROM courses c WHERE c.id = ANY($1) ORDER BY c.title`,
    [lockedCourseIds]
  );

  const progressRes = await pool.query(
    `SELECT m.course_id,
            COUNT(DISTINCT l.id) AS total_lessons,
            COUNT(DISTINCT ulp.lesson_id) AS completed_lessons
     FROM modules m
     JOIN lessons l ON l.module_id = m.id
     LEFT JOIN user_lesson_progress ulp ON ulp.lesson_id = l.id AND ulp.user_id = $2
     WHERE m.course_id = ANY($1)
     GROUP BY m.course_id`,
    [lockedCourseIds, studentId]
  );
  const progressByCourseId = {};
  progressRes.rows.forEach((r) => {
    progressByCourseId[r.course_id] = {
      totalLessons: Number(r.total_lessons),
      completedLessons: Number(r.completed_lessons),
    };
  });

  const locked = [];
  for (const course of coursesRes.rows) {
    const progress = progressByCourseId[course.id] || { totalLessons: 0, completedLessons: 0 };
    const remainingLessons = progress.totalLessons - progress.completedLessons;
    if (progress.totalLessons === 0 || remainingLessons <= 0) continue;

    const proratedPrice = Math.round(
      Number(course.amount) * (remainingLessons / progress.totalLessons)
    );

    locked.push({
      id: course.id,
      title: course.title,
      totalLessons: progress.totalLessons,
      completedLessons: progress.completedLessons,
      remainingLessons,
      proratedPrice,
    });
  }
  return locked;
}

async function isTermReactivated(studentId, termId) {
  const r = await pool.query(
    "SELECT 1 FROM student_term_reactivations WHERE student_id = $1 AND term_id = $2",
    [studentId, termId]
  );
  return r.rows.length > 0;
}

// The single price authority — used by the price-display page AND the
// payment handler (recomputed live at charge time, never trust a
// client-submitted amount).
async function computeReactivationPrice(studentId, termId) {
  const steRes = await pool.query(
    `SELECT term_id, classroom_id FROM student_term_enrollments
     WHERE student_id = $1 AND term_id = $2`,
    [studentId, termId]
  );
  const ste = steRes.rows[0];
  if (!ste) return { termId, classroomId: null, courses: [], totalPrice: 0, alreadyReactivated: false };

  const alreadyReactivated = await isTermReactivated(studentId, termId);
  const courses = await getLockedCoursesForEnrollment(studentId, ste);
  const totalPrice = courses.reduce((sum, c) => sum + c.proratedPrice, 0);

  return { termId, classroomId: ste.classroom_id, courses, totalPrice, alreadyReactivated };
}

// Every ended, not-yet-reactivated term with locked courses, for this
// student — used to render the dashboard's locked-terms summary.
async function getLockedEndedTermsForStudent(studentId) {
  const enrollmentsRes = await pool.query(
    `SELECT ste.term_id, ste.classroom_id, at.name AS term_name,
            at.start_date, at.end_date, at.school_id
     FROM student_term_enrollments ste
     JOIN academic_terms at ON at.id = ste.term_id
     WHERE ste.student_id = $1 AND at.is_ended = true
     ORDER BY at.end_date DESC`,
    [studentId]
  );

  const lockedTerms = [];
  for (const ste of enrollmentsRes.rows) {
    if (await isTermReactivated(studentId, ste.term_id)) continue;
    const courses = await getLockedCoursesForEnrollment(studentId, ste);
    if (!courses.length) continue;
    lockedTerms.push({
      termId: ste.term_id,
      termName: ste.term_name,
      startDate: ste.start_date,
      endDate: ste.end_date,
      schoolId: ste.school_id,
      courses,
      totalPrice: courses.reduce((sum, c) => sum + c.proratedPrice, 0),
    });
  }
  return lockedTerms;
}

// Finds the ended, not-yet-reactivated term (if any) that is currently
// locking this course for this student — i.e. the term a "pay/ask to
// reactivate" prompt should point at. Returns the term id, or null if
// the course isn't locked. Used by completeLesson/submitLessonQuiz/
// getLessonQuiz so their 403/locked responses can carry a termId the
// client can link straight to /student/terms/:termId/reactivate.
async function findLockingTermId(studentId, courseId) {
  if (!courseId) return null;

  const enrollmentsRes = await pool.query(
    `SELECT ste.term_id, ste.classroom_id
     FROM student_term_enrollments ste
     JOIN academic_terms at ON at.id = ste.term_id
     WHERE ste.student_id = $1 AND at.is_ended = true`,
    [studentId]
  );
  if (!enrollmentsRes.rows.length) return null;

  for (const ste of enrollmentsRes.rows) {
    if (await isTermReactivated(studentId, ste.term_id)) continue;
    const termCourseIds = await resolveTermCourseIds(ste.classroom_id, ste.term_id, false);
    if (!termCourseIds.has(courseId)) continue;

    const openCourseIds = await getOpenCourseIds(studentId, ste.term_id);
    if (!openCourseIds.has(courseId)) return ste.term_id;
  }
  return null;
}

// The boolean gate used by completeLesson/submitLessonQuiz.
async function isLockedByEndedTerm(studentId, courseId) {
  return (await findLockingTermId(studentId, courseId)) !== null;
}

// Batched equivalent of calling computeReactivationPrice once per
// roster student — used by the admin/school-admin classroom dashboards,
// which need this for every student in a classroom+term at once.
// computeReactivationPrice's per-student query chain is fine for a
// single student (one lock check, one price page), but this DB has real
// network latency per round-trip (measured ~300ms even warm), and
// running that chain sequentially per student turns a 21-student roster
// into 100+ sequential round-trips — tens of seconds for one page load.
// This does the same "locked courses + prorated price" computation in a
// fixed handful of batched queries, regardless of roster size.
//
// Returns a Map<studentId, {courses, totalPrice}> containing ONLY
// students who actually have locked, unreactivated content — students
// with nothing locked (or already reactivated) simply aren't in the map.
async function getLockedStudentsForRoster(studentIds, classroomId, termId) {
  const result = new Map();
  if (!studentIds.length) return result;

  const termCourseIds = [...(await resolveTermCourseIds(classroomId, termId, false))];
  if (!termCourseIds.length) return result;

  const reactivatedRes = await pool.query(
    `SELECT student_id FROM student_term_reactivations
     WHERE term_id = $1 AND student_id = ANY($2)`,
    [termId, studentIds]
  );
  const reactivatedSet = new Set(reactivatedRes.rows.map((r) => r.student_id));
  const candidateIds = studentIds.filter((id) => !reactivatedSet.has(id));
  if (!candidateIds.length) return result;

  // Every OTHER active-term enrollment these students have, batched into
  // one query — mirrors getOpenCourseIds' is_active-only definition of
  // "open", just for many students at once.
  const openEnrollmentsRes = await pool.query(
    `SELECT ste.student_id, ste.classroom_id
     FROM student_term_enrollments ste
     JOIN academic_terms at ON at.id = ste.term_id
     WHERE ste.student_id = ANY($1) AND at.is_active = true
       AND ste.term_id IS DISTINCT FROM $2`,
    [candidateIds, termId]
  );
  const activeClassroomIds = [...new Set(openEnrollmentsRes.rows.map((r) => r.classroom_id))];
  const activeClassroomCourses = new Map(); // classroomId -> Set(courseIds)
  if (activeClassroomIds.length) {
    const r = await pool.query(
      "SELECT classroom_id, course_id FROM classroom_courses WHERE classroom_id = ANY($1)",
      [activeClassroomIds]
    );
    r.rows.forEach((row) => {
      if (!activeClassroomCourses.has(row.classroom_id)) activeClassroomCourses.set(row.classroom_id, new Set());
      activeClassroomCourses.get(row.classroom_id).add(row.course_id);
    });
  }
  const openCourseIdsByStudent = new Map(); // studentId -> Set(courseIds)
  openEnrollmentsRes.rows.forEach((row) => {
    const courses = activeClassroomCourses.get(row.classroom_id);
    if (!courses) return;
    if (!openCourseIdsByStudent.has(row.student_id)) openCourseIdsByStudent.set(row.student_id, new Set());
    const set = openCourseIdsByStudent.get(row.student_id);
    courses.forEach((c) => set.add(c));
  });

  const lockedCourseIdsByStudent = new Map(); // studentId -> [courseId, ...]
  const allLockedCourseIds = new Set();
  for (const studentId of candidateIds) {
    const open = openCourseIdsByStudent.get(studentId);
    const locked = open ? termCourseIds.filter((id) => !open.has(id)) : termCourseIds;
    if (locked.length) {
      lockedCourseIdsByStudent.set(studentId, locked);
      locked.forEach((id) => allLockedCourseIds.add(id));
    }
  }
  if (!allLockedCourseIds.size) return result;

  const lockedCourseIdsArr = [...allLockedCourseIds];
  const coursesRes = await pool.query(
    "SELECT id, title, amount FROM courses WHERE id = ANY($1)",
    [lockedCourseIdsArr]
  );
  const courseById = new Map(coursesRes.rows.map((c) => [c.id, c]));

  const totalLessonsRes = await pool.query(
    `SELECT m.course_id, COUNT(DISTINCT l.id) AS total_lessons
     FROM modules m
     JOIN lessons l ON l.module_id = m.id
     WHERE m.course_id = ANY($1)
     GROUP BY m.course_id`,
    [lockedCourseIdsArr]
  );
  const totalLessonsByCourse = new Map(
    totalLessonsRes.rows.map((r) => [r.course_id, Number(r.total_lessons)])
  );

  const studentIdsWithLocks = [...lockedCourseIdsByStudent.keys()];
  const completedRes = await pool.query(
    `SELECT ulp.user_id AS student_id, m.course_id, COUNT(DISTINCT ulp.lesson_id) AS completed_lessons
     FROM user_lesson_progress ulp
     JOIN lessons l ON l.id = ulp.lesson_id
     JOIN modules m ON m.id = l.module_id
     WHERE ulp.user_id = ANY($1) AND m.course_id = ANY($2)
     GROUP BY ulp.user_id, m.course_id`,
    [studentIdsWithLocks, lockedCourseIdsArr]
  );
  const completedByStudentCourse = new Map(
    completedRes.rows.map((r) => [`${r.student_id}-${r.course_id}`, Number(r.completed_lessons)])
  );

  for (const studentId of studentIdsWithLocks) {
    const courses = [];
    for (const courseId of lockedCourseIdsByStudent.get(studentId)) {
      const course = courseById.get(courseId);
      const totalLessons = totalLessonsByCourse.get(courseId) || 0;
      const completedLessons = completedByStudentCourse.get(`${studentId}-${courseId}`) || 0;
      const remainingLessons = totalLessons - completedLessons;
      if (totalLessons === 0 || remainingLessons <= 0) continue;

      courses.push({
        id: courseId,
        title: course ? course.title : `Course ${courseId}`,
        totalLessons,
        completedLessons,
        remainingLessons,
        proratedPrice: Math.round(Number(course ? course.amount : 0) * (remainingLessons / totalLessons)),
      });
    }
    if (courses.length) {
      result.set(studentId, { courses, totalPrice: courses.reduce((sum, c) => sum + c.proratedPrice, 0) });
    }
  }

  return result;
}

async function reactivateTerm(
  studentId,
  schoolId,
  termId,
  { reactivatedBy, reactivatedByUserId = null, amountPaid = 0, transactionReference = null }
) {
  const result = await pool.query(
    `INSERT INTO student_term_reactivations
       (student_id, school_id, term_id, amount_paid, reactivated_by, reactivated_by_user_id, transaction_reference)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (student_id, term_id) DO NOTHING
     RETURNING id`,
    [studentId, schoolId, termId, amountPaid, reactivatedBy, reactivatedByUserId, transactionReference]
  );
  return result.rows[0] || null;
}

module.exports = {
  isLockedByEndedTerm,
  findLockingTermId,
  getLockedEndedTermsForStudent,
  computeReactivationPrice,
  getLockedStudentsForRoster,
  isTermReactivated,
  reactivateTerm,
};
