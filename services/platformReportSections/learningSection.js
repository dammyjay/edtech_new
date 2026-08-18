const { renderMetricGrid, renderAiBlock, renderDataTable, renderPageHeader } = require("./sectionHelpers");

function buildLearningSection(learning, ai, periodLabel) {
  const metrics = [
    { label: "Total Courses", value: learning.totalCourses.toLocaleString() },
    { label: "Total Modules", value: learning.totalModules.toLocaleString() },
    { label: "Total Lessons", value: learning.totalLessons.toLocaleString() },
  ];

  if (learning.periodEnrollments !== undefined) {
    metrics.push({ label: "Enrollments (Period)", value: learning.periodEnrollments.toLocaleString() });
  }
  if (learning.periodCompletions !== undefined) {
    metrics.push({ label: "Lesson Completions (Period)", value: learning.periodCompletions.toLocaleString() });
  }

  return `
<div class="page">

${renderPageHeader("Learning", periodLabel)}

${renderMetricGrid(metrics)}

<h2>Top Courses by Enrollment</h2>
${renderDataTable(
  ["Course", "Enrollments", "School Learners", "Modules", "Lessons", "Completion %"],
  (learning.courses || [])
    .slice(0, 10)
    .map((c) => [c.title, c.enrollments, c.school_learners, c.modules, c.lessons, `${c.moduleCompletion}%`])
)}

${renderAiBlock(ai)}

</div>

<div class="page-break"></div>
`;
}

module.exports = { buildLearningSection };
