const pool = require("../models/db");

// Classroom analytics, scoped to a specific term. Given a term, the
// roster/course breakdown are scoped to students actually enrolled in
// THIS classroom for THAT term (student_term_enrollments — a student's
// classroom can differ term to term). Shared by both the platform
// admin's classroom dashboard (classroomAnalyticsController.js) and the
// school admin's (schoolAdminController.js) so the two never drift.
//
// Lesson completion is cumulative up through the end of the selected
// term (not just that term's own window) — course_term_links is what
// decides whether a course counts as part of a term at all (confirmed
// activity for a past term, or simply assigned to the classroom for the
// active one); once it does, everything the student has ever completed
// on it, up to that term's end date, counts. This is what makes a
// reoccurring course behave as a running total across terms rather than
// either double-counting (crediting the same work in every term the
// course ever appeared in) or losing it (only counting activity that
// happened to fall inside that exact term's own window).
//
// Quiz average is deliberately all-time (not date-windowed at all) — it
// reflects the student's overall mastery of the course material, not
// whether a quiz attempt happened to land inside a particular term.
async function computeClassroomTermAnalytics(schoolId, classroomId, requestedTermId) {
  const classroomRes = await pool.query(
    `SELECT c.id, c.name, c.school_id,
            s.name AS school_name, s.email AS school_email, s.phone AS school_phone,
            s.address AS school_address, s.logo_url AS school_logo
     FROM classrooms c
     JOIN schools s ON s.id = c.school_id
     WHERE c.id = $1 AND c.school_id = $2`,
    [classroomId, schoolId]
  );
  if (!classroomRes.rows.length) return null;
  const classroom = classroomRes.rows[0];

  const termsRes = await pool.query(
    `SELECT id, name, start_date, end_date, is_active, is_ended
     FROM academic_terms
     WHERE school_id = $1
     ORDER BY start_date DESC`,
    [schoolId]
  );
  const terms = termsRes.rows;

  const empty = (selectedTerm) => ({
    classroom,
    terms,
    selectedTerm,
    totalStudents: 0,
    averageCompletion: 0,
    averageQuiz: 0,
    studentMetrics: [],
    leaderboard: [],
    atRiskStudents: [],
    courseBreakdown: [],
  });

  if (!terms.length) return empty(null);

  const selectedTerm =
    terms.find((t) => t.id === requestedTermId) ||
    terms.find((t) => t.is_active) ||
    terms[0];

  const studentsRes = await pool.query(
    `SELECT u.id, u.fullname
     FROM student_term_enrollments ste
     JOIN users2 u ON u.id = ste.student_id
     WHERE ste.term_id = $1 AND ste.classroom_id = $2
     ORDER BY u.fullname`,
    [selectedTerm.id, classroomId]
  );
  const students = studentsRes.rows;
  const studentIds = students.map((s) => s.id);

  // For the active/current term, show every course assigned to the
  // classroom AND still authorized for this term (school_courses, kept
  // term-scoped by the platform admin's School Courses page) — matches
  // what's actually available to work on right now, even before any
  // activity exists yet to confirm it.
  //
  // The school_courses join matters: classroom_courses has no term_id
  // column at all, and assigning a new course for a new term (via
  // "Assign") doesn't remove the classroom's old course row — nothing
  // ever did. Without this join, a classroom's analytics would keep
  // showing last term's course forever once a new one is assigned,
  // since classroom_courses just accumulates every course ever attached
  // to the classroom. school_courses IS properly term-scoped (or
  // term_id IS NULL for a standing/general authorization), so filtering
  // through it is what makes a stale prior-term course actually drop
  // off the active term's view once it's no longer authorized for it.
  //
  // For a past term, use the confirmed course_term_links record instead
  // — the real, evidence-backed list of what was actually worked on
  // that term, which can be a strict subset of everything ever assigned
  // to the classroom.
  const coursesRes = selectedTerm.is_active
    ? await pool.query(
        `SELECT DISTINCT c.id, c.title, c.level
         FROM classroom_courses cc
         JOIN courses c ON c.id = cc.course_id
         JOIN school_courses sc ON sc.course_id = cc.course_id AND sc.school_id = $2
         WHERE cc.classroom_id = $1
           AND (sc.term_id IS NULL OR sc.term_id = $3)
         ORDER BY c.title`,
        [classroomId, schoolId, selectedTerm.id]
      )
    : await pool.query(
        `SELECT DISTINCT c.id, c.title, c.level
         FROM course_term_links ctl
         JOIN courses c ON c.id = ctl.course_id
         WHERE ctl.classroom_id = $1 AND ctl.term_id = $2
         ORDER BY c.title`,
        [classroomId, selectedTerm.id]
      );
  const courses = coursesRes.rows;
  const courseIds = courses.map((c) => c.id);

  if (!studentIds.length || !courseIds.length) {
    const result = empty(selectedTerm);
    result.courseBreakdown = courses.map((c) => ({
      id: c.id,
      title: c.title,
      level: c.level,
      totalLessons: 0,
      studentsEngaged: 0,
      totalStudents: students.length,
      avgCompletion: 0,
      avgQuiz: 0,
    }));
    result.totalStudents = students.length;
    return result;
  }

  const lessonsRes = await pool.query(
    `SELECT l.id, m.course_id
     FROM lessons l
     JOIN modules m ON m.id = l.module_id
     WHERE m.course_id = ANY($1)`,
    [courseIds]
  );
  const lessonIds = lessonsRes.rows.map((l) => l.id);
  const lessonToCourse = new Map(lessonsRes.rows.map((l) => [l.id, l.course_id]));
  const totalLessonsByCourse = {};
  lessonsRes.rows.forEach((l) => {
    totalLessonsByCourse[l.course_id] = (totalLessonsByCourse[l.course_id] || 0) + 1;
  });

  // Lesson completions by these students, on these lessons — cumulative
  // up through the end of the selected term, not restricted to just
  // that term's own start/end window. user_lesson_progress only ever
  // holds ONE completed_at per (student, lesson), set the first time
  // they finish it and never moved (ON CONFLICT DO NOTHING in
  // completeLesson) — so if a course gets reassigned to a later term, a
  // student who already finished a lesson back when it was first taught
  // would show 0 progress on it here if we only looked inside that
  // later term's own date window.
  //
  // This is a running total, not a symmetric "credit it everywhere the
  // course ever appeared": completions are capped at this term's
  // end_date, so an EARLIER term in the same course's history still
  // only shows what existed by ITS OWN end — e.g. 4 lessons done in
  // Term 1, then 5 more done when the course reoccurs in Term 2, means
  // Term 1's leaderboard shows 4 and Term 2's shows 9, not both showing
  // 9. The "is this course part of this term" gate already happened
  // when `courses`/lessonIds was resolved (course_term_links for a past
  // term, classroom_courses for the active one).
  const progressRes = lessonIds.length
    ? await pool.query(
        `SELECT ulp.user_id AS student_id, ulp.lesson_id, ulp.completed_at
         FROM user_lesson_progress ulp
         WHERE ulp.user_id = ANY($1)
           AND ulp.lesson_id = ANY($2)
           AND ulp.completed_at IS NOT NULL
           AND ulp.completed_at::date <= $3`,
        [studentIds, lessonIds, selectedTerm.end_date]
      )
    : { rows: [] };

  const quizzesRes = lessonIds.length
    ? await pool.query(
        `SELECT q.id AS quiz_id, m.course_id
         FROM quizzes q
         JOIN lessons l ON l.id = q.lesson_id
         JOIN modules m ON m.id = l.module_id
         WHERE m.course_id = ANY($1)`,
        [courseIds]
      )
    : { rows: [] };
  const quizIdToCourse = new Map(quizzesRes.rows.map((q) => [q.quiz_id, q.course_id]));
  const quizIds = quizzesRes.rows.map((q) => q.quiz_id);

  const submissionsRes = quizIds.length
    ? await pool.query(
        `SELECT qs.student_id, qs.quiz_id, qs.score
         FROM quiz_submissions qs
         WHERE qs.student_id = ANY($1)
           AND qs.quiz_id = ANY($2)`,
        [studentIds, quizIds]
      )
    : { rows: [] };

  const completedByStudentCourse = {}; // "studentId-courseId" -> Set(lessonId)
  const completionTimestampsByStudent = {}; // studentId -> [completed_at, ...]
  progressRes.rows.forEach((p) => {
    const courseId = lessonToCourse.get(p.lesson_id);
    if (!courseId) return;
    const key = `${p.student_id}-${courseId}`;
    if (!completedByStudentCourse[key]) completedByStudentCourse[key] = new Set();
    completedByStudentCourse[key].add(p.lesson_id);

    if (!completionTimestampsByStudent[p.student_id]) completionTimestampsByStudent[p.student_id] = [];
    completionTimestampsByStudent[p.student_id].push(p.completed_at);
  });

  const quizScoresByStudentCourse = {}; // "studentId-courseId" -> [scores]
  submissionsRes.rows.forEach((s) => {
    const courseId = quizIdToCourse.get(s.quiz_id);
    if (!courseId) return;
    const key = `${s.student_id}-${courseId}`;
    if (!quizScoresByStudentCourse[key]) quizScoresByStudentCourse[key] = [];
    quizScoresByStudentCourse[key].push(Number(s.score));
  });

  // Per-course breakdown: what did students actually do in this
  // course, during this term (lessons), against their overall quiz
  // mastery of it (all-time).
  const courseBreakdown = courses.map((course) => {
    const totalLessons = totalLessonsByCourse[course.id] || 0;
    let studentsEngaged = 0;
    let completionSum = 0;
    let quizScores = [];
    students.forEach((stu) => {
      const key = `${stu.id}-${course.id}`;
      const completed = completedByStudentCourse[key] ? completedByStudentCourse[key].size : 0;
      if (completed > 0) studentsEngaged += 1;
      completionSum += totalLessons > 0 ? (completed / totalLessons) * 100 : 0;
      if (quizScoresByStudentCourse[key]) quizScores.push(...quizScoresByStudentCourse[key]);
    });
    return {
      id: course.id,
      title: course.title,
      level: course.level,
      totalLessons,
      studentsEngaged,
      totalStudents: students.length,
      avgCompletion: students.length ? Math.round(completionSum / students.length) : 0,
      avgQuiz: quizScores.length
        ? Math.round(quizScores.reduce((a, b) => a + b, 0) / quizScores.length)
        : 0,
    };
  });

  // Per-student metrics, averaged across all courses assigned to the
  // classroom: lesson completion uses this term's windowed activity,
  // quiz average uses all-time submissions.
  const studentMetrics = students.map((stu) => {
    let totalCompleted = 0;
    let totalLessonsAll = 0;
    let quizScoresAll = [];
    courses.forEach((course) => {
      const key = `${stu.id}-${course.id}`;
      const completed = completedByStudentCourse[key] ? completedByStudentCourse[key].size : 0;
      totalCompleted += completed;
      totalLessonsAll += totalLessonsByCourse[course.id] || 0;
      if (quizScoresByStudentCourse[key]) quizScoresAll.push(...quizScoresByStudentCourse[key]);
    });
    const completionPercent =
      totalLessonsAll > 0 ? Math.round((totalCompleted / totalLessonsAll) * 100) : 0;
    const quizAvg = quizScoresAll.length
      ? Math.round(quizScoresAll.reduce((a, b) => a + b, 0) / quizScoresAll.length)
      : 0;

    // Speed tiebreaker: average gap (in days) between the term's start
    // and when each of this student's lessons was completed — lower
    // means they got through their lessons sooner after the term began.
    // Clamped at 0: a carried-forward completion from an earlier term
    // (see progressRes above) can predate this term's start entirely —
    // treated as "already knew it coming in", i.e. the best possible
    // pace, not a negative number.
    const timestamps = completionTimestampsByStudent[stu.id] || [];
    const termStartMs = new Date(selectedTerm.start_date).getTime();
    const avgDaysToComplete = timestamps.length
      ? Math.max(
          0,
          timestamps.reduce((sum, t) => sum + (new Date(t).getTime() - termStartMs), 0) /
            timestamps.length /
            (1000 * 60 * 60 * 24)
        )
      : null;

    return {
      id: stu.id,
      fullname: stu.fullname,
      completedLessons: totalCompleted,
      totalLessons: totalLessonsAll,
      completionPercent,
      quizAvg,
      avgDaysToComplete: avgDaysToComplete !== null ? Math.round(avgDaysToComplete * 10) / 10 : null,
      overallScore: Math.round((completionPercent + quizAvg) / 2),
    };
  });

  // Leaderboard ranking, in order of precedence:
  // 1. Lesson completion — how much of the term's course material they
  //    actually got through, out of the whole.
  // 2. Quiz average — among students with similar completion, who
  //    understood the material better.
  // 3. Speed — among students tied on both, who worked through their
  //    lessons sooner after the term started (lower avgDaysToComplete
  //    wins; students with no completions at all sort last here too,
  //    though criterion 1 already puts them at the bottom).
  const leaderboard = [...studentMetrics]
    .sort((a, b) => {
      if (b.completionPercent !== a.completionPercent) return b.completionPercent - a.completionPercent;
      if (b.quizAvg !== a.quizAvg) return b.quizAvg - a.quizAvg;
      const aSpeed = a.avgDaysToComplete === null ? Infinity : a.avgDaysToComplete;
      const bSpeed = b.avgDaysToComplete === null ? Infinity : b.avgDaysToComplete;
      return aSpeed - bSpeed;
    })
    .slice(0, 10);
  const atRiskStudents = studentMetrics.filter(
    (s) => s.completionPercent < 40 || s.quizAvg < 50
  );

  const averageCompletion = studentMetrics.length
    ? Math.round(studentMetrics.reduce((sum, s) => sum + s.completionPercent, 0) / studentMetrics.length)
    : 0;
  const averageQuiz = studentMetrics.length
    ? Math.round(studentMetrics.reduce((sum, s) => sum + s.quizAvg, 0) / studentMetrics.length)
    : 0;

  return {
    classroom,
    terms,
    selectedTerm,
    totalStudents: students.length,
    averageCompletion,
    averageQuiz,
    studentMetrics,
    leaderboard,
    atRiskStudents,
    courseBreakdown,
  };
}

// Builds the printable HTML for the classroom analytics PDF export,
// from a computeClassroomTermAnalytics() result — shared so the
// admin's and school admin's exports never drift apart either.
function buildClassroomAnalyticsPdfHtml(result) {
  const { classroom, selectedTerm, totalStudents, averageCompletion, averageQuiz,
    leaderboard, atRiskStudents, courseBreakdown } = result;

  return `
  <html>
  <head>
  <style>
  body { font-family: Arial; padding:40px; }
  .card { display:inline-block; width:25%; padding:20px; color:white; border-radius:8px; margin-right:10px;}
  .blue{background:#3498db;}
  .green{background:#2ecc71;}
  .orange{background:#f39c12;}
  table{width:100%; border-collapse:collapse; margin-top:20px;}
  th{background:#34495e;color:white;padding:8px;}
  td{padding:8px;border-bottom:1px solid #ddd;}
  .risk{background:#fdecea;}
  </style>
  </head>
  <body>
  <div style="background-color:#ffffff; display:flex;align-items:center;gap:20px; justify-content:space-between; border-bottom:2px solid #b19915; padding-bottom:15px; margin-bottom:30px; box-shadow:0 2px 5px rgba(0,0,0,0.1);">
    <div style="margin-top:10px;">
      <h1>Classroom Analytics Report</h1>
      <p><strong>School:</strong> ${classroom.school_name}</p>
      <p><strong>Classroom:</strong> ${classroom.name}</p>
      <p><strong>Term:</strong> ${selectedTerm ? selectedTerm.name : "N/A"}</p>
      <p><strong>Date:</strong> ${new Date().toDateString()}</p>
    </div>
    <div>${classroom.school_logo ? `<img src="${classroom.school_logo}" style="width:80px;height:80px;object-fit:contain;">` : ""}</div>
  </div>

  <div>
    <div class="card blue">
      <h2>${totalStudents}</h2>
      <p>Total Students (this term)</p>
    </div>

    <div class="card green">
      <h2>${averageCompletion}%</h2>
      <p>Average Completion</p>
    </div>

    <div class="card orange">
      <h2>${averageQuiz}%</h2>
      <p>Average Quiz</p>
    </div>
  </div>

  <h3>Courses This Term</h3>
  <table>
  <tr>
    <th>Course</th>
    <th>Level</th>
    <th>Lessons</th>
    <th>Students Engaged</th>
    <th>Avg Completion</th>
    <th>Avg Quiz Score</th>
  </tr>
  ${courseBreakdown.length
    ? courseBreakdown.map((c) => `
      <tr>
        <td>${c.title}</td>
        <td>${c.level || "-"}</td>
        <td>${c.totalLessons}</td>
        <td>${c.studentsEngaged} / ${c.totalStudents}</td>
        <td>${c.avgCompletion}%</td>
        <td>${c.avgQuiz}%</td>
      </tr>
    `).join("")
    : `<tr><td colspan="6">No courses assigned to this classroom</td></tr>`
  }
  </table>

  <h3>Leaderboard</h3>
  <table>
  <tr>
    <th>Rank</th>
    <th>Name</th>
    <th>Lessons</th>
    <th>Completion %</th>
    <th>Quiz Avg</th>
    <th>Pace</th>
    <th>Overall</th>
  </tr>

  ${leaderboard.map((s,i)=>`
    <tr>
      <td>${i+1}</td>
      <td>${s.fullname}</td>
      <td>${s.completedLessons} / ${s.totalLessons}</td>
      <td>${s.completionPercent}%</td>
      <td>${s.quizAvg}%</td>
      <td>${s.avgDaysToComplete !== null ? s.avgDaysToComplete + "d avg" : "-"}</td>
      <td><strong>${s.overallScore}%</strong></td>
    </tr>
  `).join("")}
  </table>

  <h3>At Risk Students</h3>
  <table>
  <tr>
    <th>Name</th>
    <th>Lessons</th>
    <th>Completion %</th>
    <th>Quiz Avg</th>
    <th>Overall</th>
  </tr>

  ${atRiskStudents.length > 0
    ? atRiskStudents.map(s=>`
      <tr class="risk">
        <td>${s.fullname}</td>
        <td>${s.completedLessons} / ${s.totalLessons}</td>
        <td>${s.completionPercent}%</td>
        <td>${s.quizAvg}%</td>
        <td><strong>${s.overallScore}%</strong></td>
      </tr>
    `).join("")
    : `<tr><td colspan="5">No students at risk</td></tr>`
  }
  </table>

  </body>
  </html>
  `;
}

module.exports = { computeClassroomTermAnalytics, buildClassroomAnalyticsPdfHtml };
