const { renderMetricGrid, renderAiBlock, renderDataTable, renderPageHeader } = require("./sectionHelpers");

function buildEngagementSection(engagement, ai, periodLabel) {
  return `
<div class="page">

${renderPageHeader("Engagement", periodLabel)}

${renderMetricGrid([
  { label: "Daily Active Users", value: engagement.dailyUsers.toLocaleString() },
  { label: "Weekly Active Users", value: engagement.weeklyUsers.toLocaleString() },
  { label: "Completed Lessons", value: engagement.completedLessons.toLocaleString() },
  { label: "AI Tutor Questions", value: engagement.aiQuestions.toLocaleString() },
  { label: "Total Activities", value: engagement.totalActivities.toLocaleString() },
])}

<h2>Recent Activity</h2>
${renderDataTable(
  ["User", "Action", "Course", "Date"],
  (engagement.activities || [])
    .slice(0, 15)
    .map((a) => [a.fullname, a.action, a.course_title || "-", new Date(a.created_at).toLocaleDateString()])
)}

${renderAiBlock(ai)}

</div>
`;
}

module.exports = { buildEngagementSection };
