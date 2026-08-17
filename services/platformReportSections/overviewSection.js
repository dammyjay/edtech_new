const { renderMetricGrid, renderAiBlock, formatNaira } = require("./sectionHelpers");

function buildOverviewSection(overview, ai) {
  return `
<div class="page">

<h1 class="page-title">Platform Overview</h1>

${renderMetricGrid([
  { label: "Total Users", value: overview.totalUsers.toLocaleString() },
  { label: "Total Courses", value: overview.totalCourses.toLocaleString() },
  { label: "Total Modules", value: overview.totalModules.toLocaleString() },
  { label: "Total Lessons", value: overview.totalLessons.toLocaleString() },
  { label: "Enrollments", value: overview.totalEnrollments.toLocaleString() },
  { label: "Schools", value: overview.totalSchools.toLocaleString() },
  { label: "Certificates Issued", value: overview.certificatesIssued.toLocaleString() },
  { label: "Total Revenue", value: formatNaira(overview.revenue) },
  { label: "Avg Quiz Score", value: `${overview.avgQuizScore}%` },
])}

${renderAiBlock(ai)}

</div>

<div class="page-break"></div>
`;
}

module.exports = { buildOverviewSection };
