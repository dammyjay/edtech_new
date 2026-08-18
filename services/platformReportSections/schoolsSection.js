const { renderMetricGrid, renderAiBlock, renderDataTable, renderPageHeader } = require("./sectionHelpers");

function buildSchoolsSection(schools, ai, periodLabel) {
  const metrics = [
    { label: "Total Schools", value: schools.totalSchools.toLocaleString() },
    { label: "Total Students", value: schools.totalStudents.toLocaleString() },
    { label: "Total Teachers", value: schools.totalTeachers.toLocaleString() },
    { label: "Total Classrooms", value: schools.totalClassrooms.toLocaleString() },
  ];

  if (schools.schoolsOnboardedInPeriod !== undefined) {
    metrics.push({ label: "Schools Onboarded (Period)", value: schools.schoolsOnboardedInPeriod.toLocaleString() });
  }

  return `
<div class="page">

${renderPageHeader("Schools", periodLabel)}

${renderMetricGrid(metrics)}

<h2>Schools by Enrollment</h2>
${renderDataTable(
  ["School", "Students", "Teachers", "Classrooms", "Courses"],
  (schools.schools || [])
    .slice()
    .sort((a, b) => Number(b.students) - Number(a.students))
    .slice(0, 15)
    .map((s) => [s.name, s.students, s.teachers, s.classrooms, s.courses])
)}

<h2>Term-over-Term Enrollment Trends</h2>
<p><em>School enrollment is tracked per academic term. Each row compares a term to the one immediately before it at the same school — showing growth/decline and what share of the prior term's students carried over (retention).</em></p>
${renderDataTable(
  ["School", "Term", "Students", "vs Prior Term", "Change", "Retention"],
  (schools.termTrends || [])
    .filter((t) => t.prevStudents !== null)
    .map((t) => [
      t.schoolName,
      t.termName,
      t.students,
      t.prevTermName,
      `${t.change > 0 ? "+" : ""}${t.change} (${t.changePct > 0 ? "+" : ""}${t.changePct}%)`,
      `${t.retentionRate}%`,
    ])
)}

${renderAiBlock(ai)}

</div>

<div class="page-break"></div>
`;
}

module.exports = { buildSchoolsSection };
