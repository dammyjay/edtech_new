function buildExecutiveSummary(report) {
  const {
    attendance,
    courses,
    assignments,
    quizzes,
    xp,
    badges,
    certificates,
    aiSummary,
  } = report;

  return `

<div class="page">

<h1 class="page-title">
Executive Summary
</h1>

<div class="summary-grid">

${buildCard("Overall Attendance", `${attendance.attendanceRate}%`)}

${buildCard("Course Completion", `${courses.averageCompletion}%`)}

${buildCard("Average Quiz", `${quizzes.averageScore}%`)}

${buildCard("Average Assignment", `${assignments.averageScore}%`)}

${buildCard("Certificates", certificates.totalCertificates)}

${buildCard("Badges", badges.totalBadges)}

${buildCard("Total XP", xp.totalXP.toLocaleString())}

${buildCard("Students", report.students.totalStudents)}

</div>

<div class="ai-summary">

<h2>AI Executive Summary</h2>

<p>

${aiSummary.summary}

</p>

<h3>Key Insights</h3>

<ul>
${report.aiSummary.insights
  .map(
    (i) => `
    <li>
      ${
        typeof i === "string"
          ? i
          : i.title
            ? `<b>${i.title}</b><br>${i.description || ""}`
            : JSON.stringify(i)
      }
    </li>
  `,
  )
  .join("")}
</ul> 

<h3>Potential Risks</h3>

<ul>
${report.aiSummary.risk
  .map(
    (i) => `
    <li>
      ${
        typeof i === "string"
          ? i
          : i.title
            ? `<b>${i.title}</b><br>${i.description || ""}`
            : JSON.stringify(i)
      }
    </li>
  `,
  )
  .join("")}
</ul>

<h3>Recommendations</h3>

<ul>
${report.aiSummary.recommendations
  .map(
    (i) => `
    <li>
      ${
        typeof i === "string"
          ? i
          : i.title
            ? `<b>${i.title}</b><br>${i.description || ""}`
            : JSON.stringify(i)
      }
    </li>
  `,
  )
  .join("")}
</ul>

</div>

</div>

<div class="page-break"></div>

`;
}

function buildCard(title, value) {
  return `

<div class="summary-card">

<div class="card-title">

${title}

</div>

<div class="card-value">

${value}

</div>

</div>

`;
}

module.exports = {
  buildExecutiveSummary,
};
