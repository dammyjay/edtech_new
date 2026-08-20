const pool = require("../models/db");

// Term-end locking: once a term a student was enrolled in has ended
// (academic_terms.is_ended = true), any lesson they haven't completed
// yet in that term's courses becomes locked — no new completions/quiz
// submissions — until they pay to reactivate (wallet) or a school admin
// reactivates it for free. Already-completed lessons stay viewable
// forever, unaffected by any of this.
//
// The lock is permanent-until-reactivated, full stop — it is NOT
// cleared just because the same course later gets reassigned to a new
// active term the student is also enrolled in. Since a school only ever
// has one active term at a time, "also open elsewhere" can only mean "a
// newer term now offers this course" — silently treating that as an
// unlock would let creating Term N+1 wipe out every student's Term N
// lock for free, with no payment and no admin action.
//
// A course CAN legitimately be confirmed (via course_term_links) under
// more than one ended term — e.g. it was taught again the following
// term, before anyone ever reactivated the first one. That's still ONE
// underlying set of remaining lessons (there's only one
// user_lesson_progress row per (user, lesson), not one per term), so a
// student must never be asked to pay for it twice, and reactivating
// EITHER confirming term is sufficient to unlock it everywhere. All the
// "is this locked" logic below is built around that: it always resolves
// every ended term that confirms a given course before deciding, rather
// than checking one term in isolation.
//
// This is a SEPARATE gate from services/studentCourseAccessService.js,
// which locks a course when a student has left the classroom that had
// it. Both gates run independently in completeLesson/submitLessonQuiz.

// Courses confirmed (via course_term_links) as having belonged to
// classroomId for termId — the same evidence source
// classroomTermAnalyticsService.computeClassroomTermAnalytics uses for
// any non-active term, since classroom_courses only reflects the
// classroom's CURRENT assignment and would misrepresent a past term.
async function resolveTermCourseIds(classroomId, termId) {
  if (!classroomId) return new Set();
  const result = await pool.query(
    "SELECT DISTINCT course_id FROM course_term_links WHERE classroom_id = $1 AND term_id = $2",
    [classroomId, termId]
  );
  return new Set(result.rows.map((r) => r.course_id));
}

async function isTermReactivated(studentId, termId) {
  const r = await pool.query(
    "SELECT 1 FROM student_term_reactivations WHERE student_id = $1 AND term_id = $2",
    [studentId, termId]
  );
  return r.rows.length > 0;
}

// The core primitive: every course confirmed under ANY of this
// student's ended term enrollments, each with the full set of ended
// term ids that confirm it (ordered most-recently-ended first) and
// whether it's still locked (true only if NONE of those confirming
// terms have been reactivated). Computed once per student and reused by
// every function below, so "reactivating term X unlocks a course
// everywhere it recurred" and "never list/charge the same course twice"
// both fall out of a single source of truth instead of being
// re-derived (and potentially drifting) in each caller.
async function getStudentLockedCourseMap(studentId) {
  const enrollmentsRes = await pool.query(
    `SELECT ste.term_id, ste.classroom_id, at.end_date
     FROM student_term_enrollments ste
     JOIN academic_terms at ON at.id = ste.term_id
     WHERE ste.student_id = $1 AND at.is_ended = true
     ORDER BY at.end_date DESC`,
    [studentId]
  );

  const map = new Map(); // courseId -> { confirmingTermIds: number[] (most-recent first), locked: bool }
  for (const ste of enrollmentsRes.rows) {
    const courseIds = await resolveTermCourseIds(ste.classroom_id, ste.term_id);
    for (const courseId of courseIds) {
      if (!map.has(courseId)) map.set(courseId, { confirmingTermIds: [], locked: true });
      map.get(courseId).confirmingTermIds.push(ste.term_id);
    }
  }

  for (const [, entry] of map) {
    for (const termId of entry.confirmingTermIds) {
      if (await isTermReactivated(studentId, termId)) {
        entry.locked = false;
        break;
      }
    }
  }

  return map;
}

// Attaches lesson-progress/pricing detail to a set of course ids —
// shared tail end of the "what's locked and what does it cost" queries.
async function buildLockedCourseDetails(studentId, courseIds) {
  if (!courseIds.length) return [];

  const coursesRes = await pool.query(
    `SELECT c.id, c.title, c.amount FROM courses c WHERE c.id = ANY($1) ORDER BY c.title`,
    [courseIds]
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
    [courseIds, studentId]
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

    locked.push({
      id: course.id,
      title: course.title,
      totalLessons: progress.totalLessons,
      completedLessons: progress.completedLessons,
      remainingLessons,
      proratedPrice: Math.round(Number(course.amount) * (remainingLessons / progress.totalLessons)),
    });
  }
  return locked;
}

// The single price authority for reactivating one specific term — used
// by the price-display page AND the payment handler (recomputed live at
// charge time, never trust a client-submitted amount). Courses this
// term confirms that are already unlocked via a different, already-
// reactivated confirming term are excluded — nothing left to charge for
// them here.
async function computeReactivationPrice(studentId, termId) {
  const steRes = await pool.query(
    `SELECT term_id, classroom_id FROM student_term_enrollments
     WHERE student_id = $1 AND term_id = $2`,
    [studentId, termId]
  );
  const ste = steRes.rows[0];
  if (!ste) return { termId, classroomId: null, courses: [], totalPrice: 0, alreadyReactivated: false };

  const alreadyReactivated = await isTermReactivated(studentId, termId);
  const termCourseIds = await resolveTermCourseIds(ste.classroom_id, termId);

  let courses = [];
  if (!alreadyReactivated && termCourseIds.size) {
    const lockedMap = await getStudentLockedCourseMap(studentId);
    const stillLockedIds = [...termCourseIds].filter((id) => lockedMap.get(id)?.locked);
    courses = await buildLockedCourseDetails(studentId, stillLockedIds);
  }
  const totalPrice = courses.reduce((sum, c) => sum + c.proratedPrice, 0);

  return { termId, classroomId: ste.classroom_id, courses, totalPrice, alreadyReactivated };
}

// Every ended term with still-locked courses, for this student's
// dashboard summary — grouped so each locked course appears under
// exactly ONE term card (its most-recently-ended confirming term,
// courtesy of getStudentLockedCourseMap's ordering), never duplicated
// across cards just because it recurred.
async function getLockedEndedTermsForStudent(studentId) {
  const lockedMap = await getStudentLockedCourseMap(studentId);

  const courseIdsByPrimaryTerm = new Map(); // termId -> [courseId, ...]
  for (const [courseId, entry] of lockedMap) {
    if (!entry.locked) continue;
    const primaryTermId = entry.confirmingTermIds[0]; // most-recently-ended, per the map's ordering
    if (!courseIdsByPrimaryTerm.has(primaryTermId)) courseIdsByPrimaryTerm.set(primaryTermId, []);
    courseIdsByPrimaryTerm.get(primaryTermId).push(courseId);
  }
  if (!courseIdsByPrimaryTerm.size) return [];

  const termIds = [...courseIdsByPrimaryTerm.keys()];
  const termsRes = await pool.query(
    `SELECT id, name, start_date, end_date, school_id FROM academic_terms
     WHERE id = ANY($1) ORDER BY end_date DESC`,
    [termIds]
  );

  const lockedTerms = [];
  for (const term of termsRes.rows) {
    const courses = await buildLockedCourseDetails(studentId, courseIdsByPrimaryTerm.get(term.id));
    if (!courses.length) continue;
    lockedTerms.push({
      termId: term.id,
      termName: term.name,
      startDate: term.start_date,
      endDate: term.end_date,
      schoolId: term.school_id,
      courses,
      totalPrice: courses.reduce((sum, c) => sum + c.proratedPrice, 0),
    });
  }
  return lockedTerms;
}

// Finds the ended term (if any) currently locking this course for this
// student — i.e. the term a "pay/ask to reactivate" prompt should point
// at. Reactivating it is guaranteed sufficient to unlock the course
// (getStudentLockedCourseMap already only calls a course "locked" when
// NONE of its confirming terms are reactivated, so this just needs to
// name one of them — the most-recently-ended). Returns null if the
// course isn't locked. Used by completeLesson/submitLessonQuiz/
// getLessonQuiz so their 403/locked responses can carry a termId the
// client can link straight to /student/terms/:termId/reactivate.
async function findLockingTermId(studentId, courseId) {
  if (!courseId) return null;
  const lockedMap = await getStudentLockedCourseMap(studentId);
  const entry = lockedMap.get(courseId);
  if (!entry || !entry.locked) return null;
  return entry.confirmingTermIds[0];
}

// The boolean gate used by completeLesson/submitLessonQuiz.
async function isLockedByEndedTerm(studentId, courseId) {
  return (await findLockingTermId(studentId, courseId)) !== null;
}

// Batched equivalent of calling computeReactivationPrice once per
// roster student — used by the admin/school-admin classroom dashboards,
// which need this for every student in a classroom+term at once.
// Doing that sequentially, one full lock-check chain per student, is
// fine for a single student but this DB has real per-round-trip network
// latency (measured ~300ms even warm), so a 21-student roster turned
// into 100+ sequential round-trips — tens of seconds for one page load.
// This computes the same "locked courses + prorated price" in a fixed
// handful of batched queries, cross-term-aware (a course a student
// already unlocked by reactivating a DIFFERENT confirming term is
// correctly excluded here too, not just in the student-facing paths).
//
// Returns a Map<studentId, {courses, totalPrice}> containing ONLY
// students who actually have locked, unreactivated content — students
// with nothing locked (or already covered) simply aren't in the map.
async function getLockedStudentsForRoster(studentIds, classroomId, termId) {
  const result = new Map();
  if (!studentIds.length) return result;

  const termCourseIds = [...(await resolveTermCourseIds(classroomId, termId))];
  if (!termCourseIds.length) return result;

  // Every ended enrollment these students have, across ANY classroom —
  // needed to know every term that confirms each course, not just termId.
  const allEndedRes = await pool.query(
    `SELECT ste.student_id, ste.term_id, ste.classroom_id
     FROM student_term_enrollments ste
     JOIN academic_terms at ON at.id = ste.term_id
     WHERE ste.student_id = ANY($1) AND at.is_ended = true`,
    [studentIds]
  );
  if (!allEndedRes.rows.length) return result;

  const classroomTermPairs = [...new Set(allEndedRes.rows.map((r) => `${r.classroom_id}:${r.term_id}`))]
    .map((key) => key.split(":").map(Number));
  const pairClassroomIds = classroomTermPairs.map((p) => p[0]);
  const pairTermIds = classroomTermPairs.map((p) => p[1]);

  const linksRes = pairClassroomIds.length
    ? await pool.query(
        `SELECT classroom_id, term_id, course_id FROM course_term_links
         WHERE classroom_id = ANY($1) AND term_id = ANY($2)`,
        [pairClassroomIds, pairTermIds]
      )
    : { rows: [] };
  const confirmedCourses = new Map(); // "classroomId:termId" -> Set(courseId)
  linksRes.rows.forEach((r) => {
    const key = `${r.classroom_id}:${r.term_id}`;
    if (!confirmedCourses.has(key)) confirmedCourses.set(key, new Set());
    confirmedCourses.get(key).add(r.course_id);
  });

  const reactivatedRes = await pool.query(
    "SELECT student_id, term_id FROM student_term_reactivations WHERE student_id = ANY($1)",
    [studentIds]
  );
  const reactivatedPairs = new Set(reactivatedRes.rows.map((r) => `${r.student_id}:${r.term_id}`));

  // Per student: courseId -> [confirming term ids]
  const courseTermsByStudent = new Map();
  allEndedRes.rows.forEach((row) => {
    const courses = confirmedCourses.get(`${row.classroom_id}:${row.term_id}`);
    if (!courses) return;
    if (!courseTermsByStudent.has(row.student_id)) courseTermsByStudent.set(row.student_id, new Map());
    const byCourse = courseTermsByStudent.get(row.student_id);
    courses.forEach((courseId) => {
      if (!byCourse.has(courseId)) byCourse.set(courseId, []);
      byCourse.get(courseId).push(row.term_id);
    });
  });

  const lockedCourseIdsByStudent = new Map(); // studentId -> [courseId, ...]
  const allLockedCourseIds = new Set();
  for (const studentId of studentIds) {
    const byCourse = courseTermsByStudent.get(studentId);
    if (!byCourse) continue;
    const locked = termCourseIds.filter((courseId) => {
      const confirmingTermIds = byCourse.get(courseId);
      if (!confirmingTermIds) return false; // this term doesn't actually confirm it for this student
      return !confirmingTermIds.some((tId) => reactivatedPairs.has(`${studentId}:${tId}`));
    });
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
