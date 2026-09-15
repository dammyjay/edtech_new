const pool = require("../models/db");
const { getStudentStreak } = require("./streakService");
const { getLevelForXp } = require("../utils/xpLevels");

// All the scoping-agnostic computation behind the rich "view student
// progress" page (originally adminController.viewStudentProgress,
// rendered as admin/studentProgress.ejs and used by admin/parent/
// school_admin today). Extracted so instructorController (and any
// future caller) can get the exact same engagement/mastery/risk/
// heatmap/percentile/predicted-completion math without duplicating it
// a third time — the caller is responsible for its OWN authorization
// and for scoping which courses/modules/lessons/quizzes/assignments
// rows it hands in (e.g. an instructor only passes rows for courses
// they actually teach this student); this service never queries
// courses/modules/lessons/quizzes/assignments itself, only the
// genuinely student-scoped tables below (activities, streak, xp,
// badges, certificates, classroom membership) which carry no
// per-caller leak risk since they aren't course-specific.
//
// Input row shapes must match adminController.viewStudentProgress's
// queries exactly:
//   courseRows:     { id, course_title, thumbnail_url, enrolled_at }
//   moduleRows:      { id, module_title, course_id }
//   lessonRows:      { id, lesson_title, module_id, completed_at }
//   quizRows:        { id, title, module_id, score, taken_at, lesson_title, passed }
//   assignmentRows:  { id, title, module_id, total, grade, ai_feedback, submitted_at }
async function computeStudentProgressAnalytics(studentId, { courseRows, moduleRows, lessonRows, quizRows, assignmentRows }) {
  const lessonsByModule = new Map();
  lessonRows.forEach((l) => {
    if (!lessonsByModule.has(l.module_id)) lessonsByModule.set(l.module_id, []);
    lessonsByModule.get(l.module_id).push(l);
  });

  const quizzesByModule = new Map();
  quizRows.forEach((q) => {
    if (!quizzesByModule.has(q.module_id)) quizzesByModule.set(q.module_id, []);
    quizzesByModule.get(q.module_id).push(q);
  });

  const assignmentsByModule = new Map();
  assignmentRows.forEach((a) => {
    if (!assignmentsByModule.has(a.module_id)) assignmentsByModule.set(a.module_id, []);
    assignmentsByModule.get(a.module_id).push(a);
  });

  const modulesByCourse = new Map();
  moduleRows.forEach((m) => {
    if (!modulesByCourse.has(m.course_id)) modulesByCourse.set(m.course_id, []);
    modulesByCourse.get(m.course_id).push(m);
  });

  // Time-on-task, reconstructed from the activity log (Viewed Lesson ->
  // Student submitted Quiz, Viewed Assignment -> Submitted Assignment
  // pairs) — identical to the admin page's logic, purely user-scoped
  // (activities has no course/classroom column at all), so safe to
  // reuse as-is for any caller.
  const lessonTimeMap = {};
  const activityRes = await pool.query(
    `SELECT action, details, created_at, duration_seconds
     FROM activities
     WHERE user_id = $1
     ORDER BY created_at ASC`,
    [studentId]
  );
  const logs = activityRes.rows;

  let totalLessonTime = 0;
  let totalAssignmentTime = 0;
  const lessonStart = {};
  const assignmentStart = {};

  for (const log of logs) {
    const time = new Date(log.created_at);
    const match = log.details?.match(/\d+/);
    const lessonId = match ? Number(match[0]) : null;

    if (log.action === "Viewed Lesson" && lessonId) {
      lessonStart[lessonId] = time;
    }
    if (log.action === "Student submitted Quiz" && lessonId) {
      if (lessonStart[lessonId]) {
        const duration = (time - lessonStart[lessonId]) / 1000;
        totalLessonTime += duration;
        lessonTimeMap[lessonId] = (lessonTimeMap[lessonId] || 0) + duration;
        delete lessonStart[lessonId];
      }
    }
    if (log.action === "Viewed Assignment" && lessonId) {
      assignmentStart[lessonId] = time;
    }
    if (log.action === "Submitted Assignment" && lessonId) {
      if (assignmentStart[lessonId]) {
        totalAssignmentTime += (time - assignmentStart[lessonId]) / 1000;
        delete assignmentStart[lessonId];
      }
    }
  }

  function formatTimeReadable(seconds) {
    const sec = Math.floor(seconds % 60);
    const min = Math.floor((seconds / 60) % 60);
    const hr = Math.floor(seconds / 3600);
    let result = "";
    if (hr > 0) result += `${hr}hr `;
    if (min > 0) result += `${min}min `;
    if (sec > 0 || result === "") result += `${sec}sec`;
    return result.trim();
  }

  function formatDuration(startDate) {
    const now = new Date();
    const start = new Date(startDate);
    const diffMs = now - start;
    const seconds = Math.floor(diffMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const weeks = Math.floor(days / 7);
    const months = Math.floor(days / 30);
    const years = Math.floor(days / 365);
    return {
      seconds, minutes, hours, days, weeks, months, years,
      readable:
        years > 0 ? `${years} year(s)` :
        months > 0 ? `${months} month(s)` :
        weeks > 0 ? `${weeks} week(s)` :
        days > 0 ? `${days} day(s)` :
        hours > 0 ? `${hours} hour(s)` :
        `${minutes} minute(s)`,
    };
  }

  // Course structure with per-module/per-course completion + time spent
  const courses = courseRows.map((course) => {
    const modules = modulesByCourse.get(course.id) || [];

    const enrichedModules = modules.map((module) => {
      const rawLessons = lessonsByModule.get(module.id) || [];
      const moduleLessons = rawLessons.map((l) => {
        const seconds = lessonTimeMap[l.id] || 0;
        return { ...l, timeSpent: formatTimeReadable(seconds), rawTime: seconds };
      });

      const moduleTimeSeconds = moduleLessons.reduce((sum, l) => sum + (l.rawTime || 0), 0);
      const moduleTime = formatTimeReadable(moduleTimeSeconds);
      const moduleQuizzes = quizzesByModule.get(module.id) || [];
      const moduleAssignments = assignmentsByModule.get(module.id) || [];

      const totalLessons = moduleLessons.length;
      const completedLessons = moduleLessons.filter((l) => l.completed_at).length;
      const percent = totalLessons ? Math.round((completedLessons / totalLessons) * 100) : 0;

      const quizAvg = moduleQuizzes.length
        ? Math.round(moduleQuizzes.reduce((a, b) => a + b.score, 0) / moduleQuizzes.length)
        : null;
      const assignmentAvg = moduleAssignments.length
        ? Math.round(moduleAssignments.reduce((a, b) => a + (b.total || 0), 0) / moduleAssignments.length)
        : null;

      return {
        ...module,
        lessons: moduleLessons,
        quizzes: moduleQuizzes,
        assignments: moduleAssignments,
        totalLessons,
        completedLessons,
        percent,
        quizAvg,
        assignmentAvg,
        moduleTime,
      };
    });

    const totalLessons = enrichedModules.reduce((a, b) => a + b.totalLessons, 0);
    const completedLessons = enrichedModules.reduce((a, b) => a + b.completedLessons, 0);
    const percent = totalLessons ? Math.round((completedLessons / totalLessons) * 100) : 0;

    return { ...course, modules: enrichedModules, totalLessons, completedLessons, percent };
  });

  const allQuizzes = quizRows;
  const allAssignments = assignmentRows;

  const quizAvg = allQuizzes.length
    ? Math.round(allQuizzes.reduce((a, b) => a + b.score, 0) / allQuizzes.length)
    : null;
  const assignmentAvg = allAssignments.length
    ? Math.round(allAssignments.reduce((a, b) => a + (b.total || 0), 0) / allAssignments.length)
    : null;

  const membershipDuration = null; // caller fills this in from student.created_at if it wants to show it

  // Engagement
  const engagementRes = await pool.query(
    `SELECT COUNT(*) AS total_activities, MAX(created_at) AS last_active
     FROM activities WHERE user_id = $1`,
    [studentId]
  );
  const engagementBase = engagementRes.rows[0];

  async function getActiveDaysWithDates(userId, interval = null) {
    let query = `SELECT DATE(created_at) AS date, COUNT(*) AS count FROM activities WHERE user_id = $1`;
    const params = [userId];
    if (interval) query += ` AND created_at > NOW() - INTERVAL '${interval}'`;
    query += ` GROUP BY DATE(created_at) ORDER BY date DESC`;
    const result = await pool.query(query, params);
    return result.rows.map((r) => ({ date: r.date.toISOString().split("T")[0], count: Number(r.count) }));
  }

  const activeDaysWeek = await getActiveDaysWithDates(studentId, "7 days");
  const activeDaysMonth = await getActiveDaysWithDates(studentId, "1 month");
  const activeDaysYear = await getActiveDaysWithDates(studentId, "1 year");
  const activeDaysAll = await getActiveDaysWithDates(studentId, null);

  const totalTime = totalLessonTime + totalAssignmentTime;

  function summarizeDays(data) {
    return { count: data.length, dates: data };
  }

  const engagement = {
    totalActivities: Number(engagementBase.total_activities || 0),
    lessonTime: formatTimeReadable(totalLessonTime),
    assignmentTime: formatTimeReadable(totalAssignmentTime),
    totalTimeSpent: formatTimeReadable(totalTime),
    lastActive: engagementBase.last_active || null,
    activeDays: {
      week: summarizeDays(activeDaysWeek),
      month: summarizeDays(activeDaysMonth),
      year: summarizeDays(activeDaysYear),
      all: summarizeDays(activeDaysAll),
    },
    consistencyScore: Math.min(100, ((activeDaysWeek.length + activeDaysMonth.length) / 2) * 15),
  };

  const quizScores = allQuizzes.map((q) => q.score);
  const assignmentScores = allAssignments.map((a) => a.total || 0);

  const quizAvgMetric = quizScores.length
    ? Math.round(quizScores.reduce((a, b) => a + b, 0) / quizScores.length) : 0;
  const assignmentAvgMetric = assignmentScores.length
    ? Math.round(assignmentScores.reduce((a, b) => a + b, 0) / assignmentScores.length) : 0;
  const passRate = allQuizzes.length
    ? Math.round((allQuizzes.filter((q) => q.passed).length / allQuizzes.length) * 100) : 0;

  const totalLessonsCount = courses.reduce((a, c) => a + c.totalLessons, 0);
  const completedLessonsCount = courses.reduce((a, c) => a + c.completedLessons, 0);
  const progressPercent = totalLessonsCount ? Math.round((completedLessonsCount / totalLessonsCount) * 100) : 0;

  const inactivityDays = engagement.lastActive
    ? Math.floor((Date.now() - new Date(engagement.lastActive)) / (1000 * 60 * 60 * 24))
    : 999;
  const isInactive = inactivityDays > 3;

  const masteryScore = Math.round(quizAvgMetric * 0.5 + assignmentAvgMetric * 0.3 + passRate * 0.2);

  const riskFlags = [];
  if (quizAvgMetric < 50) riskFlags.push("Low quiz performance");
  if (assignmentAvgMetric < 50) riskFlags.push("Low assignment performance");
  if (isInactive) riskFlags.push("Inactive student");
  if (progressPercent < 30) riskFlags.push("Low progress");

  const riskLevel =
    riskFlags.length >= 3 ? "High Risk" :
    riskFlags.length === 2 ? "Medium Risk" :
    riskFlags.length === 1 ? "Low Risk" : "Healthy";

  const platformScore = Math.round(
    progressPercent * 0.25 +
    quizAvgMetric * 0.2 +
    assignmentAvgMetric * 0.15 +
    engagement.consistencyScore * 0.15 +
    masteryScore * 0.25
  );

  const metrics = {
    engagement,
    performance: { quizAvg: quizAvgMetric, assignmentAvg: assignmentAvgMetric, passRate },
    progress: { totalLessons: totalLessonsCount, completedLessons: completedLessonsCount, progressPercent },
    completion: { completionRate: progressPercent, assignmentSubmissionRate: allAssignments.length },
    mastery: { masteryScore },
    behavior: { inactivityDays, isInactive },
    risk: { riskLevel, flags: riskFlags },
    overall: { platformScore },
  };

  // Gamification — user-scoped, no course leak risk.
  const streak = await getStudentStreak(studentId);
  const xpTotalRes = await pool.query(
    `SELECT COALESCE(SUM(xp), 0) AS total FROM xp_history WHERE user_id = $1`,
    [studentId]
  );
  const levelInfo = getLevelForXp(xpTotalRes.rows[0].total);

  const progBadgesRes = await pool.query(
    `SELECT ub.id, ub.badge_name, ub.badge_image, ub.awarded_at, ub.module_id, m.title AS module_title, c.title AS course_title
     FROM user_badges ub
     JOIN modules m ON ub.module_id = m.id
     JOIN courses c ON m.course_id = c.id
     WHERE ub.user_id = $1
     ORDER BY ub.awarded_at DESC`,
    [studentId]
  );
  const badges = progBadgesRes.rows;

  const certificatesRes = await pool.query(
    `SELECT uc.id, uc.certificate_url, uc.issued_at, c.title AS course_title
     FROM user_certificates uc
     JOIN courses c ON uc.course_id = c.id
     WHERE uc.user_id = $1
     ORDER BY uc.issued_at DESC`,
    [studentId]
  );
  const certificates = certificatesRes.rows;

  // Activity heatmap
  const activeDaysMap = new Map(activeDaysAll.map((d) => [d.date, d.count]));
  const heatmapWeeks = [];
  {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const totalDays = 371;
    const start = new Date(today);
    start.setDate(start.getDate() - (totalDays - 1));
    start.setDate(start.getDate() - start.getDay());

    let cursor = new Date(start);
    while (cursor <= today) {
      const week = [];
      for (let d = 0; d < 7; d++) {
        const iso = cursor.toISOString().split("T")[0];
        const inFuture = cursor > today;
        const count = inFuture ? null : activeDaysMap.get(iso) || 0;
        let level = 0;
        if (count >= 8) level = 4;
        else if (count >= 5) level = 3;
        else if (count >= 3) level = 2;
        else if (count >= 1) level = 1;
        week.push({ date: iso, count, level });
        cursor.setDate(cursor.getDate() + 1);
      }
      heatmapWeeks.push(week);
    }
  }

  // Classroom percentile
  let classroomPercentile = null;
  {
    const classroomRes = await pool.query(
      `SELECT classroom_id FROM user_school WHERE user_id = $1 AND role_in_school = 'student' AND approved = true LIMIT 1`,
      [studentId]
    );
    const classroomId = classroomRes.rows[0]?.classroom_id || null;
    if (classroomId) {
      const classmatesRes = await pool.query(
        `SELECT us.user_id, COALESCE(ROUND(AVG(qs.score)), 0) AS quiz_avg
         FROM user_school us
         LEFT JOIN quiz_submissions qs ON qs.student_id = us.user_id
         WHERE us.classroom_id = $1 AND us.role_in_school = 'student' AND us.approved = true
         GROUP BY us.user_id`,
        [classroomId]
      );
      const classSize = classmatesRes.rows.length;
      if (classSize > 1) {
        const belowOrEqual = classmatesRes.rows.filter((r) => Number(r.quiz_avg) <= quizAvgMetric).length;
        classroomPercentile = {
          percentile: Math.round((belowOrEqual / classSize) * 100),
          classSize,
          quizAvg: quizAvgMetric,
        };
      }
    }
  }

  // Predicted completion pace
  let predictedCompletion = null;
  {
    const completionDates = lessonRows.filter((l) => l.completed_at).map((l) => new Date(l.completed_at));
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const recentCompletions = completionDates.filter((d) => d.getTime() >= thirtyDaysAgo).length;
    const velocityPerDay = recentCompletions / 30;
    const remainingLessons = totalLessonsCount - completedLessonsCount;

    if (remainingLessons === 0 && totalLessonsCount > 0) {
      predictedCompletion = { remainingLessons: 0 };
    } else if (remainingLessons > 0 && velocityPerDay > 0) {
      const daysToFinish = Math.ceil(remainingLessons / velocityPerDay);
      predictedCompletion = {
        remainingLessons,
        velocityPerWeek: Math.round(velocityPerDay * 7 * 10) / 10,
        estimatedDate: new Date(now + daysToFinish * 24 * 60 * 60 * 1000),
      };
    }
  }

  // Strengths / weaknesses by module quiz average
  const moduleQuizRankings = [];
  courses.forEach((c) => {
    c.modules.forEach((m) => {
      if (m.quizAvg !== null && m.quizAvg !== undefined) {
        moduleQuizRankings.push({ moduleTitle: m.module_title, courseTitle: c.course_title, quizAvg: m.quizAvg });
      }
    });
  });
  const strengths = [...moduleQuizRankings].sort((a, b) => b.quizAvg - a.quizAvg).slice(0, 3);
  const weaknesses = moduleQuizRankings.length > 3
    ? [...moduleQuizRankings].sort((a, b) => a.quizAvg - b.quizAvg).slice(0, 3)
    : [];

  return {
    courses,
    quizzes: allQuizzes,
    assignments: allAssignments,
    quizAvg,
    assignmentAvg,
    metrics,
    formatDuration,
    streak,
    levelInfo,
    badges,
    certificates,
    heatmapWeeks,
    classroomPercentile,
    predictedCompletion,
    strengths,
    weaknesses,
  };
}

module.exports = { computeStudentProgressAnalytics };
