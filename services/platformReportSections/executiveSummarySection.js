const { renderMetricGrid, renderAiBlock, formatNaira } = require("./sectionHelpers");

function buildExecutiveSummarySection(analytics, executiveSummaryAI) {
  const { overview } = analytics;

  return `
<div class="page">

<h1 class="page-title">Executive Summary</h1>

${renderMetricGrid([
  { label: "Total Users", value: overview.totalUsers.toLocaleString() },
  { label: "Total Courses", value: overview.totalCourses.toLocaleString() },
  { label: "Enrollments", value: overview.totalEnrollments.toLocaleString() },
  { label: "Schools", value: overview.totalSchools.toLocaleString() },
  { label: "Certificates Issued", value: overview.certificatesIssued.toLocaleString() },
  { label: "Total Revenue", value: formatNaira(overview.revenue) },
  { label: "Avg Quiz Score", value: `${overview.avgQuizScore}%` },
])}

${renderAiBlock(executiveSummaryAI)}

</div>

<div class="page-break"></div>
`;
}

module.exports = { buildExecutiveSummarySection };
