function buildRankingSection(report) {
  const { rankings } = report;

  const topThree = rankings.slice(0, 3);

  return `

<div class="page">

<h1 class="page-title">

Student Rankings

</h1>

<div class="podium">

${topThree.map((student, index) => buildPodium(student, index + 1)).join("")}

</div>

<h2>

Overall Rankings

</h2>

<table class="report-table">

<tr>

<th>Rank</th>

<th>Student</th>

<th>Overall Score</th>

<th>XP</th>

<th>Attendance</th>

<th>Quiz Avg</th>

<th>Assignment Avg</th>

</tr>

${rankings
  .map(
    (student) => `

<tr>

<td>${student.rank}</td>

<td>${student.fullname}</td>

<td>${student.overallScore}</td>

<td>${student.xp}</td>

<td>${student.attendance.toFixed(1)}%</td>

<td>${student.quizAverage.toFixed(1)}%</td>

<td>${student.assignmentAverage.toFixed(1)}%</td>

</tr>

`,
  )
  .join("")}

</table>

</div>

<div class="page-break"></div>

`;
}

function buildPodium(student, position) {
  const medals = {
    1: "🥇",

    2: "🥈",

    3: "🥉",
  };

  return `

<div class="podium-card">

<div class="medal">

${medals[position]}

</div>

<h2>

${student.fullname}

</h2>

<p>

Overall Score

</p>

<h1>

${student.overallScore}

</h1>

</div>

`;
}

module.exports = {
  buildRankingSection,
};
