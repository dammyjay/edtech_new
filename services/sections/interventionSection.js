function buildInterventionSection(report) {
  const students = report.interventionStudents;

  return `

<div class="page">

<h1 class="page-title">

Students Requiring Intervention

</h1>

<p>

<b>Total Students Identified:</b>

${students.length}

</p>

<table class="report-table">

<tr>

<th>Student</th>

<th>Attendance</th>

<th>Quiz Avg</th>

<th>Assignment Avg</th>

<th>XP</th>

<th>Reason</th>

</tr>

${students.map(buildStudentRow).join("")}

</table>

<div class="ai-summary">

<h2>

Recommended Intervention Strategy

</h2>

<p>

${buildRecommendation(students)}

</p>

</div>

</div>

<div class="page-break"></div>

`;
}

function buildStudentRow(student) {
  const quizzes = Object.values(student.quizzes);

  const assignments = Object.values(student.assignments);

  const quizAverage = quizzes.length
    ? quizzes.reduce((s, q) => s + q.score, 0) / quizzes.length
    : 0;

  const assignmentAverage = assignments.length
    ? assignments.reduce((s, a) => s + a.percentage, 0) / assignments.length
    : 0;

  const reasons = [];

  if (student.attendance < 75) reasons.push("Low attendance");

  if (quizAverage < 50) reasons.push("Weak quiz performance");

  if (assignmentAverage < 50) reasons.push("Incomplete assignments");

  if (student.xp < 100) reasons.push("Low classroom engagement");

  return `

<tr>

<td>

${student.fullname}

</td>

<td>

${Number(student.attendance ?? 0).toFixed(1)}%

</td>

<td>

${Number(quizAverage ?? 0).toFixed(1)}%

</td>

<td>

${Number(assignmentAverage ?? 0).toFixed(1)}%

</td>

<td>

${student.xp ?? 0}

</td>

<td>

${reasons.join(", ")}

</td>

</tr>

`;
}

function buildRecommendation(students) {
  if (students.length === 0) {
    return "No students require academic intervention. Overall class performance and engagement are satisfactory.";
  }

  if (students.length <= 3) {
    return "A small number of learners require targeted academic support. Weekly monitoring, additional practice activities, and parent engagement are recommended.";
  }

  return "Several learners require intervention. Consider remedial sessions, closer attendance monitoring, differentiated instruction, and regular communication with parents or guardians.";
}

module.exports = {
  buildInterventionSection,
};
