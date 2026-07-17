// services/reportAnalyticsService.js

const pool = require("../models/db");
const {
  generateAIReport,

  generateStudentComment,
} = require("./reportAIService");

/* ==========================================================
   SCHOOL INFORMATION
========================================================== */

async function getSchoolInfo(schoolId, classroomId, termId) {
  const school = await pool.query(
    `
    SELECT
      id,
      name,
      address,
      email,
      phone,
      logo_url
    FROM schools
    WHERE id = $1
    `,
    [schoolId],
  );

  const classroom = await pool.query(
    `
    SELECT
      id,
      name
    FROM classrooms
    WHERE id = $1
    `,
    [classroomId],
  );

  const term = await pool.query(
    `
    SELECT
        id,
        name,
        start_date,
        end_date
    FROM academic_terms
    WHERE id=$1
    AND school_id=$2
    `,
    [termId, schoolId],
  );

  return {
    school: school.rows[0] || null,
    classroom: classroom.rows[0] || null,
    term: term.rows[0] || null,
  };
}

/* ==========================================================
   ATTENDANCE ANALYTICS
========================================================== */

async function getAttendanceAnalytics(classroomId, termId) {
  // Fetch attendance sessions
  const sessionResult = await pool.query(
    `
    SELECT
      id,
      week_number,
      date,
      session_status
    FROM attendance_sessions
    WHERE classroom_id = $1
      AND term_id = $2
    ORDER BY date
    `,
    [classroomId, termId],
  );

  // Attendance totals
  const attendanceResult = await pool.query(
    `
    SELECT

      COUNT(*) FILTER (
        WHERE ar.status='present'
      ) AS present,

      COUNT(*) FILTER (
        WHERE ar.status='absent'
      ) AS absent,

      COUNT(*) FILTER (
        WHERE ar.status='late'
      ) AS late

    FROM attendance_records ar

    JOIN attendance_sessions s
      ON s.id = ar.session_id

    WHERE s.classroom_id = $1
      AND s.term_id = $2
    `,
    [classroomId, termId],
  );

  const heldSessions = sessionResult.rows.filter(
    (s) => s.session_status === "held",
  ).length;

  const holidaySessions = sessionResult.rows.filter(
    (s) => s.session_status === "holiday",
  ).length;

  const cancelledSessions = sessionResult.rows.filter(
    (s) => s.session_status === "cancelled",
  ).length;

  const noClassSessions = sessionResult.rows.filter(
    (s) => s.session_status === "no_class",
  ).length;

  const present = Number(attendanceResult.rows[0]?.present || 0);
  const absent = Number(attendanceResult.rows[0]?.absent || 0);
  const late = Number(attendanceResult.rows[0]?.late || 0);

  const totalMarked = present + absent + late;

  const attendanceRate = totalMarked > 0 ? (present / totalMarked) * 100 : 0;

  // Weekly attendance trend
  const weeklyTrend = await pool.query(
    `
    SELECT

      week_number,

      COUNT(*) FILTER (
        WHERE ar.status='present'
      ) AS present,

      COUNT(*) FILTER (
        WHERE ar.status='absent'
      ) AS absent,

      COUNT(*) FILTER (
        WHERE ar.status='late'
      ) AS late

    FROM attendance_records ar

    JOIN attendance_sessions s
      ON s.id = ar.session_id

    WHERE s.classroom_id = $1
      AND s.term_id = $2

    GROUP BY week_number

    ORDER BY week_number
    `,
    [classroomId, termId],
  );

  return {
    totalSessions: sessionResult.rows.length,
    heldSessions,
    holidaySessions,
    cancelledSessions,
    noClassSessions,
    present,
    absent,
    late,
    attendanceRate: Number(attendanceRate.toFixed(2)),
    weeklyTrend: weeklyTrend.rows,
  };
}

/* ==========================================================
   STUDENT ANALYTICS
========================================================== */

async function getStudentAnalytics(classroomId, termId) {
  const result = await pool.query(
    `
    SELECT
        u.id,
        u.fullname,

        COUNT(*) FILTER (
            WHERE ar.status = 'present'
        ) AS present,

        COUNT(*) FILTER (
            WHERE ar.status = 'absent'
        ) AS absent,

        COUNT(*) FILTER (
            WHERE ar.status = 'late'
        ) AS late

    FROM student_term_enrollments ste

    JOIN users2 u
      ON u.id = ste.student_id

    LEFT JOIN attendance_records ar
      ON ar.student_id = u.id

    LEFT JOIN attendance_sessions s
      ON s.id = ar.session_id
      AND s.term_id = ste.term_id
      AND s.classroom_id = ste.classroom_id

    WHERE
      ste.classroom_id = $1
      AND ste.term_id = $2

    GROUP BY
      u.id,
      u.fullname

    ORDER BY
      u.fullname
    `,
    [classroomId, termId],
  );

  const students = result.rows.map((student) => {
    const present = Number(student.present || 0);
    const absent = Number(student.absent || 0);
    const late = Number(student.late || 0);

    const total = present + absent + late;

    const attendanceRate =
      total > 0 ? Number(((present / total) * 100).toFixed(2)) : 0;

    return {
      id: student.id,
      fullname: student.fullname,
      present,
      absent,
      late,
      totalSessions: total,
      attendanceRate,
    };
  });

  const totalStudents = students.length;

  const averageAttendance =
    totalStudents > 0
      ? Number(
          (
            students.reduce((sum, s) => sum + s.attendanceRate, 0) /
            totalStudents
          ).toFixed(2),
        )
      : 0;

  const perfectAttendance = students.filter(
    (s) => s.attendanceRate === 100,
  ).length;

  const lowAttendance = students.filter((s) => s.attendanceRate < 75).length;

  return {
    totalStudents,
    averageAttendance,
    perfectAttendance,
    lowAttendance,
    students,
  };
}

/* ==========================================================
   STUDENT DATASET
========================================================== */

async function buildStudentDataset(schoolId,classroomId, termId) {
  /* ---------------------------------------------------------
      STUDENTS
  ---------------------------------------------------------- */

  const studentsResult = await pool.query(
    `
      SELECT
    u.id,
    u.fullname,
    u.gender,
    u.email,
    ste.classroom_id
FROM student_term_enrollments ste

JOIN users2 u
    ON u.id = ste.student_id

WHERE
    ste.school_id = $1
AND ste.classroom_id = $2
AND ste.term_id = $3

ORDER BY u.fullname;
    `,
    [schoolId, classroomId, termId],
  );

  const students = studentsResult.rows.map((student) => ({
    id: student.id,
    fullname: student.fullname,
    gender: student.gender,
    email: student.email,

    attendance: {},

    courses: {},

    assignments: {},

    quizzes: {},

    xp: {},

    badges: {},

    certificates: {},
  }));

  /* ---------------------------------------------------------
      FAST LOOKUP MAP
  ---------------------------------------------------------- */

  const studentMap = {};

  students.forEach((student) => {
    studentMap[student.id] = student;
  });

  return {
    classroomId,

    termId,

    totalStudents: students.length,

    students,

    studentMap,
  };
}

/* ==========================================================
   COURSE ANALYTICS
========================================================== */

async function getCourseAnalytics(studentDataset) {

  const courseResult = await pool.query(
    `
    SELECT

    c.id,
    c.title,
    c.level,

    COUNT(DISTINCT m.id) modules,

    COUNT(DISTINCT l.id) lessons

    FROM classroom_courses cc

    JOIN courses c
    ON c.id=cc.course_id

    LEFT JOIN modules m
    ON m.course_id=c.id

    LEFT JOIN lessons l
    ON l.module_id=m.id

    WHERE cc.classroom_id=$1

    GROUP BY
    c.id,
    c.title,
    c.level

    ORDER BY c.title
    `,
    [studentDataset.classroomId],
  );

  const progressResult = await pool.query(
    `
      SELECT

      ste.student_id,

      m.course_id,

      COUNT(DISTINCT ulp.lesson_id) completed_lessons

      FROM student_term_enrollments ste

      LEFT JOIN user_lesson_progress ulp

      ON ulp.user_id=ste.student_id

      LEFT JOIN lessons l

      ON l.id=ulp.lesson_id

      LEFT JOIN modules m

      ON m.id=l.module_id

      WHERE

      ste.classroom_id=$1

      AND ste.term_id=$2

      GROUP BY

      ste.student_id,

      m.course_id
      `,
    [studentDataset.classroomId, studentDataset.termId],
  );

  const certificateResult = await pool.query(
    `
      SELECT

      uc.course_id,

      COUNT(*) certificates

      FROM user_certificates uc

      JOIN student_term_enrollments ste

      ON ste.student_id=uc.user_id

      WHERE

      ste.classroom_id=$1

      AND ste.term_id=$2

      GROUP BY uc.course_id
      `,
    [studentDataset.classroomId, studentDataset.termId],
  );

  // studentDataset.students;

  const progressMap = {};

  for (const row of progressResult.rows) {
    const key = `${row.course_id}_${row.student_id}`;

    progressMap[key] = Number(row.completed_lessons);
  }

  const certificateMap = {};

  certificateResult.rows.forEach((r) => {
    certificateMap[r.course_id] = Number(r.certificates);
  });

  const courses = courseResult.rows.map((course) => {
    const totalLessons = Number(course.lessons);

    let totalCompletion = 0;

    let completedStudents = 0;

    const studentProgress = [];

    // students.forEach((student) => {
    //   const completedLessons = progressMap[`${course.id}_${student.id}`] || 0;

    //   const progress =
    //     totalLessons === 0
    //       ? 0
    //       : Number((completedLessons / totalLessons) * 100);

    //   totalCompletion += progress;

    //   if (progress >= 100) completedStudents++;

    //   studentProgress.push({
    //     studentId: student.student_id,

    //     completedLessons,

    //     progress: Number(progress.toFixed(2)),
    //   });
    // });

    studentDataset.students.forEach((student) => {
      const completedLessons = progressMap[`${course.id}_${student.id}`] || 0;

      const progress =
        totalLessons === 0 ? 0 : (completedLessons / totalLessons) * 100;

      totalCompletion += progress;

      if (progress >= 100) completedStudents++;

      student.courses[course.id] = {
        completedLessons,
        progress: Number(progress.toFixed(2)),
      };

      studentProgress.push({
        studentId: student.id,
        completedLessons,
        progress: Number(progress.toFixed(2)),
      });
    });

    const averageCompletion =
      studentDataset.students.length === 0
        ? 0
        : Number((totalCompletion / studentDataset.students.length).toFixed(2));

    return {
      id: course.id,

      title: course.title,

      level: course.level,

      modules: Number(course.modules),

      lessons: totalLessons,

      studentsEnrolled: studentDataset.students.length,

      completedStudents,

      averageCompletion,

      certificates: certificateMap[course.id] || 0,

      studentProgress,
    };
  });

  const totalCourses = courses.length;

  const averageCompletion =
    totalCourses === 0
      ? 0
      : Number(
          (
            courses.reduce((sum, c) => sum + c.averageCompletion, 0) /
            totalCourses
          ).toFixed(2),
        );

  const completedCourses = courses.filter(
    (c) => c.averageCompletion >= 100,
  ).length;

  return {
    totalCourses,
    averageCompletion,
    completedCourses,
    courses,
  };
}

/* ==========================================================
   ASSIGNMENT ANALYTICS
========================================================== */

async function getAssignmentAnalytics(studentDataset, classroomId, termId) {

  // const result = await pool.query(
  //   `
  //     SELECT

  //         ste.student_id,

  //         a.id AS assignment_id,

  //         a.title,

  //         s.score,

  //         s.total,

  //         s.grade,

  //         s.created_at

  //     FROM student_term_enrollments ste

  //     JOIN classroom_courses cc
  //       ON cc.classroom_id = ste.classroom_id

  //     JOIN module_assignments a
  //       ON a.module_id = cc.course_id

  //     LEFT JOIN assignment_submissions s
  //       ON s.assignment_id = a.id
  //     AND s.student_id = ste.student_id

  //     WHERE

  //         ste.classroom_id = $1
  //         AND ste.term_id = $2

  //     ORDER BY
  //         ste.student_id,
  //         a.title
  //     `,
  //   [classroomId, termId],
  // );

  const result = await pool.query(
    `
  SELECT
      ste.student_id,
      ma.id AS assignment_id,
      ma.title,
      m.id AS module_id,
      m.title AS module_title,
      s.score,
      s.total,
      s.grade,
      s.created_at

  FROM student_term_enrollments ste

  JOIN classroom_courses cc
      ON cc.classroom_id = ste.classroom_id

  JOIN modules m
      ON m.course_id = cc.course_id

  JOIN module_assignments ma
      ON ma.module_id = m.id

  LEFT JOIN assignment_submissions s
      ON s.assignment_id = ma.id
     AND s.student_id = ste.student_id

  WHERE
      ste.classroom_id = $1
      AND ste.term_id = $2

  ORDER BY
      ste.student_id,
      m.order_number,
      ma.title
  `,
    [classroomId, termId],
  );

  const studentMap = {};

  studentDataset.students.forEach((student) => {
    studentMap[student.id] = student;
  });

  result.rows.forEach((row) => {
    const student = studentMap[row.student_id];

    if (!student) return;

    const score = Number(row.score || 0);

    const total = Number(row.total || 0);

    const percentage =
      total === 0 ? 0 : Number(((score / total) * 100).toFixed(2));

    student.assignments[row.assignment_id] = {
      assignmentId: row.assignment_id,

      title: row.title,

      score,

      total,

      grade: row.grade,

      percentage,

      submitted: row.score !== null,

      submittedAt: row.created_at,
    };
  });

  const assignments = [];

  let totalSubmissions = 0;

  let totalScore = 0;

  let totalPossible = 0;

  studentDataset.students.forEach((student) => {
    Object.values(student.assignments).forEach((a) => {
      assignments.push(a);

      if (a.submitted) {
        totalSubmissions++;

        totalScore += a.score;

        totalPossible += a.total;
      }
    });
  });

  const averageScore =
    totalPossible === 0
      ? 0
      : Number(((totalScore / totalPossible) * 100).toFixed(2));

  return {
    totalAssignments: assignments.length,

    submissions: totalSubmissions,

    averageScore,

    assignments,
  };
}

/* ==========================================================
   QUIZ ANALYTICS
========================================================== */

async function getQuizAnalytics(studentDataset, classroomId, termId) {
  // const result = await pool.query(
  //   `
  //   SELECT

  //       ste.student_id,

  //       q.id AS quiz_id,

  //       q.title,

  //       qs.score,

  //       q.pass_mark,

  //       qs.passed,

  //       qs.created_at

  //   FROM student_term_enrollments ste

  //   JOIN classroom_courses cc
  //     ON cc.classroom_id = ste.classroom_id

  //   JOIN modules m
  //     ON m.course_id = cc.course_id

  //   JOIN quizzes q
  //     ON q.module_id = m.id

  //   LEFT JOIN quiz_submissions qs
  //     ON qs.quiz_id = q.id
  //    AND qs.student_id = ste.student_id

  //   WHERE

  //       ste.classroom_id = $1
  //       AND ste.term_id = $2

  //   ORDER BY

  //       ste.student_id,
  //       q.title
  //   `,
  //   [classroomId, termId],
  // );

  const result = await pool.query(
  `
  SELECT
      ste.student_id,

      q.id AS quiz_id,
      q.title AS quiz_title,

      l.id AS lesson_id,
      l.title AS lesson_title,

      m.id AS module_id,
      m.title AS module_title,

      qs.score,
      qs.passed,
      qs.created_at

  FROM student_term_enrollments ste

  JOIN classroom_courses cc
      ON cc.classroom_id = ste.classroom_id

  JOIN modules m
      ON m.course_id = cc.course_id

  JOIN lessons l
      ON l.module_id = m.id

  JOIN quizzes q
      ON q.lesson_id = l.id

  LEFT JOIN quiz_submissions qs
      ON qs.quiz_id = q.id
     AND qs.student_id = ste.student_id

  WHERE
      ste.classroom_id = $1
      AND ste.term_id = $2

  ORDER BY
      ste.student_id,
      m.order_number,
      l.order_number,
      q.title
  `,
  [classroomId, termId]
);

  const studentMap = {};

  studentDataset.students.forEach((student) => {
    studentMap[student.id] = student;
  });

  result.rows.forEach((row) => {
    const student = studentMap[row.student_id];

    if (!student) return;

    student.quizzes[row.quiz_id] = {
      quizId: row.quiz_id,

      title: row.quiz_title,

      score: Number(row.score || 0),

      passed: row.passed === true,

      attempted: row.score !== null,

      submittedAt: row.created_at,
    };
  });

  const quizzes = [];

  let attempts = 0;

  let passed = 0;

  let totalScore = 0;

  studentDataset.students.forEach((student) => {
    Object.values(student.quizzes).forEach((quiz) => {
      quizzes.push(quiz);

      if (quiz.attempted) {
        attempts++;

        totalScore += quiz.score;

        if (quiz.passed) {
          passed++;
        }
      }
    });
  });

  const averageScore =
    attempts === 0 ? 0 : Number((totalScore / attempts).toFixed(2));

  const passRate =
    attempts === 0 ? 0 : Number(((passed / attempts) * 100).toFixed(2));

  return {
    totalQuizzes: quizzes.length,

    attempts,

    passed,

    failed: attempts - passed,

    passRate,

    averageScore,

    quizzes,
  };
}

/* ==========================================================
   XP ANALYTICS
========================================================== */

async function getXPAnalytics(studentDataset, classroomId, termId) {
  const result = await pool.query(
    `
    SELECT

        ste.student_id,

        COALESCE(sxp.xp,0) AS total_xp,

        COALESCE(sxp.level,1) AS level,

        COUNT(xh.id) activities,

        COALESCE(SUM(xh.xp),0) earned_xp

    FROM student_term_enrollments ste

    LEFT JOIN student_xp sxp
      ON sxp.user_id = ste.student_id

    LEFT JOIN xp_history xh
      ON xh.user_id = ste.student_id

    WHERE

        ste.classroom_id = $1
        AND ste.term_id = $2

    GROUP BY

        ste.student_id,
        sxp.xp,
        sxp.level

    ORDER BY total_xp DESC
    `,
    [classroomId, termId],
  );

  const studentMap = {};

  studentDataset.students.forEach((student) => {
    studentMap[student.id] = student;
  });

  result.rows.forEach((row) => {
    const student = studentMap[row.student_id];

    if (!student) return;

    student.xp = {
      totalXP: Number(row.total_xp),

      level: Number(row.level),

      activities: Number(row.activities),

      earnedThisTerm: Number(row.earned_term_xp),
    };
  });

  const rankings = [...studentDataset.students]
    .sort((a, b) => b.xp.totalXP - a.xp.totalXP)
    .map((student, index) => ({
      rank: index + 1,

      studentId: student.id,

      fullname: student.fullname,

      xp: student.xp.totalXP,

      level: student.xp.level,
    }));

  const totalXP = studentDataset.students.reduce(
    (sum, student) => sum + student.xp.totalXP,
    0,
  );

  const averageXP =
    studentDataset.students.length === 0
      ? 0
      : Number((totalXP / studentDataset.students.length).toFixed(2));

  const highestXP = rankings.length > 0 ? rankings[0].xp : 0;

  return {
    totalXP,

    averageXP,

    highestXP,

    rankings,

    students: studentDataset.students,
  };
}

/* ==========================================================
   BADGE ANALYTICS
========================================================== */

async function getBadgeAnalytics(studentDataset, classroomId, termId) {
  const result = await pool.query(
    `
    SELECT

        ste.student_id,

        ub.id,

        ub.badge_name,

        ub.badge_image,

        ub.awarded_at,

        ub.module_id

    FROM student_term_enrollments ste

    LEFT JOIN user_badges ub
      ON ub.user_id = ste.student_id

    WHERE

        ste.classroom_id = $1
        AND ste.term_id = $2

    ORDER BY

        ste.student_id,
        ub.awarded_at
    `,
    [classroomId, termId],
  );

  const studentMap = {};

  studentDataset.students.forEach((student) => {
    studentMap[student.id] = student;
  });

  result.rows.forEach((row) => {
    if (!row.id) return;

    const student = studentMap[row.student_id];

    if (!student) return;

    student.badges[row.id] = {
      id: row.id,

      badgeName: row.badge_name,

      badgeImage: row.badge_image,

      moduleId: row.module_id,

      awardedAt: row.awarded_at,
    };
  });

  const badges = [];

  studentDataset.students.forEach((student) => {
    badges.push(...Object.values(student.badges));
  });

  const badgeCounts = {};

  badges.forEach((badge) => {
    badgeCounts[badge.badgeName] = (badgeCounts[badge.badgeName] || 0) + 1;
  });

  const mostAwardedBadge =
    Object.entries(badgeCounts).sort((a, b) => b[1] - a[1])[0] || null;

  return {
    totalBadges: badges.length,

    uniqueBadges: Object.keys(badgeCounts).length,

    badgeCounts,

    mostAwardedBadge,

    badges,
  };
}

/* ==========================================================
   CERTIFICATE ANALYTICS
========================================================== */

async function getCertificateAnalytics(studentDataset, classroomId, termId) {
  const result = await pool.query(
    `
    SELECT

        ste.student_id,

        uc.id,

        uc.course_id,

        c.title AS course_name,

        uc.certificate_code,

        uc.certificate_url,

        uc.issued_at

    FROM student_term_enrollments ste

    LEFT JOIN user_certificates uc
      ON uc.user_id = ste.student_id

    LEFT JOIN courses c
      ON c.id = uc.course_id

    WHERE

        ste.classroom_id = $1
        AND ste.term_id = $2

    ORDER BY

        ste.student_id,
        uc.issued_at
    `,
    [classroomId, termId],
  );

  const studentMap = {};

  studentDataset.students.forEach((student) => {
    studentMap[student.id] = student;
  });

  result.rows.forEach((row) => {
    if (!row.id) return;

    const student = studentMap[row.student_id];

    if (!student) return;

    student.certificates[row.id] = {
      id: row.id,

      courseId: row.course_id,

      courseName: row.course_name,

      certificateCode: row.certificate_code,

      certificateUrl: row.certificate_url,

      issuedAt: row.issued_at,
    };
  });

  const certificates = [];

  studentDataset.students.forEach((student) => {
    certificates.push(...Object.values(student.certificates));
  });

  const courseSummary = {};

  certificates.forEach((cert) => {
    if (!courseSummary[cert.courseId]) {
      courseSummary[cert.courseId] = {
        courseId: cert.courseId,

        courseName: cert.courseName,

        totalIssued: 0,
      };
    }

    courseSummary[cert.courseId].totalIssued++;
  });

  return {
    totalCertificates: certificates.length,

    certifiedStudents: studentDataset.students.filter(
      (s) => Object.keys(s.certificates).length > 0,
    ).length,

    certificates,

    byCourse: Object.values(courseSummary),
  };
}

/* ==========================================================
   STUDENT RANKINGS
========================================================== */

async function getStudentRanking(studentDataset) {
  const rankings = studentDataset.students.map((student) => {
    const attendance = student.attendance?.attendanceRate || 0;

    const courseAverage =
      Object.values(student.courses).reduce((s, c) => s + c.progress, 0) /
      Math.max(Object.keys(student.courses).length, 1);

    const assignmentAverage =
      Object.values(student.assignments).reduce((s, a) => s + a.percentage, 0) /
      Math.max(Object.keys(student.assignments).length, 1);

    const quizAverage =
      Object.values(student.quizzes).reduce((s, q) => s + q.score, 0) /
      Math.max(Object.keys(student.quizzes).length, 1);

    const xp = student.xp.totalXP || 0;

    const badgeScore = Object.keys(student.badges).length * 2;

    const certificateScore = Object.keys(student.certificates).length * 5;

    const overallScore =
      attendance * 0.05 +
      courseAverage * 0.2 +
      assignmentAverage * 0.2 +
      quizAverage * 0.25 +
      xp * 0.2 +
      badgeScore +
      certificateScore;

    return {
      studentId: student.id,

      fullname: student.fullname,

      attendance,

      courseAverage,

      assignmentAverage,

      quizAverage,

      xp,

      overallScore: Number(overallScore.toFixed(2)),
    };
  });

  rankings.sort((a, b) => b.overallScore - a.overallScore);

  rankings.forEach((r, i) => (r.rank = i + 1));

  return rankings;
}

/* ==========================================================
   INTERVENTION LIST
========================================================== */

async function getInterventionStudents(studentDataset) {
  return studentDataset.students

    .filter((student) => {
      const attendance = student.attendance.attendanceRate;

      const quizzes = Object.values(student.quizzes);

      const assignments = Object.values(student.assignments);

      const quizAverage = quizzes.length
        ? quizzes.reduce((s, q) => s + q.score, 0) / quizzes.length
        : 0;

      const assignmentAverage = assignments.length
        ? assignments.reduce((s, a) => s + a.percentage, 0) / assignments.length
        : 0;

      return (
        attendance < 75 ||
        quizAverage < 50 ||
        assignmentAverage < 50 ||
        student.xp.totalXP < 100
      );
    })

    .map((student) => ({
      studentId: student.id,

      fullname: student.fullname,

      attendance: student.attendance.attendanceRate,

      xp: student.xp.totalXP,

      quizzes: student.quizzes,

      assignments: student.assignments,
    }));
}



/* ==========================================================
   GENERATE AI COMMENTS FOR ALL STUDENTS
========================================================== */

async function generateStudentComments(studentDataset) {
  for (const student of studentDataset.students) {
    try {
      student.ai = await generateStudentComment(student);
    } catch (err) {
      console.error(
        `AI comment failed for ${student.fullname}:`,
        err.message,
      );

      student.ai = {
        teacherComment: "No AI comment available.",
        strengths: [],
        improvements: [],
        nextTermGoals: [],
      };
    }
  }

  return studentDataset;
}

/* ==========================================================
   MAIN REPORT ANALYTICS
========================================================== */

async function getClassTermAnalytics(schoolId, classroomId, termId) {
  // const [
  //   schoolInfo,
  //   attendance,
  //   studentAnalytics,
  //   courseAnalytics,
  //   assignmentAnalytics,
  //   quizAnalytics,
  //   xpAnalytics,
  //   badgeAnalytics,
  //   certificateAnalytics,
  //   rankings,
  //   interventionStudents,
  // ] = await Promise.all([
  //   getSchoolInfo(schoolId, classroomId, termId),
  //   getAttendanceAnalytics(classroomId, termId),
  //   getStudentAnalytics(classroomId, termId),
  //   getCourseAnalytics(classroomId, termId),
  //   getAssignmentAnalytics(classroomId, termId),
  //   getQuizAnalytics(classroomId, termId),
  //   getXPAnalytics(classroomId, termId),
  //   getBadgeAnalytics(classroomId, termId),
  //   getCertificateAnalytics(classroomId, termId),
  //   getStudentRanking(classroomId, termId),
  //   getInterventionStudents(studentAnalytics),
  // ]);

  const schoolInfo = await getSchoolInfo(schoolId, classroomId, termId);

  const studentDataset = await buildStudentDataset(schoolId, classroomId, termId);

  console.log("========== STUDENT DATASET ==========");
  console.log("Classroom:", classroomId);
  console.log("Term:", termId);
  console.log("Students:", studentDataset.students.length);
  console.table(studentDataset.students);

  // const attendance = await getAttendanceAnalytics(classroomId, termId);
  const attendance = await getAttendanceAnalytics(classroomId, termId);

  const studentAttendance = await getStudentAnalytics(classroomId, termId);

  const attendanceMap = {};

  studentAttendance.students.forEach((s) => {
    attendanceMap[s.id] = s;
  });

  studentDataset.students.forEach((student) => {
    student.attendance = attendanceMap[student.id] || {
      attendanceRate: 0,
      present: 0,
      absent: 0,
      late: 0,
      totalSessions: 0,
    };
  });
  console.log("========== ATTENDANCE ==========");
  console.log(attendance);

  // await getAttendanceAnalytics(studentDataset, classroomId, termId);

  const courses = await getCourseAnalytics(studentDataset, classroomId, termId);
  console.log("========== COURSES ==========");
  console.dir(courses, { depth: null });

  const assignments = await getAssignmentAnalytics(
    studentDataset,
    classroomId,
    termId,
  );
  console.log("========== ASSIGNMENTS ==========");
  console.dir(assignments, { depth: null });

  const quizzes = await getQuizAnalytics(studentDataset, classroomId, termId);
  console.log("========== QUIZZES ==========");
  console.dir(quizzes, { depth: null });

  const xp = await getXPAnalytics(studentDataset, classroomId, termId);

  const badges = await getBadgeAnalytics(studentDataset, classroomId, termId);

  const certificates = await getCertificateAnalytics(
    studentDataset,
    classroomId,
    termId,
  );

  const rankings = await getStudentRanking(studentDataset);

  const intervention = await getInterventionStudents(studentDataset);

  await generateStudentComments(studentDataset);

  const aiSummary = await generateAIReport({
    school: schoolInfo,
    attendance,
    courses,
    assignments,
    quizzes,
    xp,
    badges,
    certificates,
    rankings,
    interventionStudents: intervention,
  });

  return {
    ...schoolInfo,
    attendance,
    students: studentDataset,
    courses,
    assignments,
    quizzes,
    xp,
    badges,

    certificates,

    rankings,

    interventionStudents: intervention,
    aiSummary,
  };
}

// function buildStudentComment(student) {
//   const attendance = student.attendance.attendanceRate;

//   const quizzes = Object.values(student.quizzes);

//   const assignments = Object.values(student.assignments);

//   const courseProgress = Object.values(student.courses);

//   const avgQuiz = quizzes.length
//     ? quizzes.reduce((s, q) => s + q.score, 0) / quizzes.length
//     : 0;

//   const avgAssignment = assignments.length
//     ? assignments.reduce((s, a) => s + a.percentage, 0) / assignments.length
//     : 0;

//   const avgCourse = courseProgress.length
//     ? courseProgress.reduce((s, c) => s + c.progress, 0) / courseProgress.length
//     : 0;

//   const xp = student.xp.totalXP || 0;

//   let strengths = [];

//   let improvements = [];

//   if (attendance >= 90) strengths.push("excellent attendance");
//   else if (attendance < 75) improvements.push("improve attendance");

//   if (avgQuiz >= 70) strengths.push("good quiz performance");
//   else if (avgQuiz < 50) improvements.push("practice for quizzes");

//   if (avgAssignment >= 70) strengths.push("submits quality assignments");
//   else if (avgAssignment < 50)
//     improvements.push("complete assignments carefully");

//   if (avgCourse >= 80) strengths.push("excellent course progress");
//   else if (avgCourse < 50) improvements.push("complete more lessons");

//   if (xp >= 300) strengths.push("high classroom engagement");
//   else if (xp < 100) improvements.push("participate more actively");

//   return {
//     strengths,

//     improvements,

//     overall:
//       strengths.length >= 4
//         ? "Outstanding performance throughout the term."
//         : strengths.length >= 2
//           ? "Good performance with opportunities for further improvement."
//           : "Needs additional academic support and close monitoring.",
//   };
// }

module.exports = {
  getClassTermAnalytics,
};
