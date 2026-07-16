function buildStudentPages(report) {
  return report.students.students
    .map((student) => buildStudentPage(student, report))
    .join("");
}

function buildStudentPage(student, report) {
  const attendance = student.attendance.attendanceRate || 0;

  const quizAverage = average(
    Object.values(student.quizzes).map((q) => q.score),
  );

  const assignmentAverage = average(
    Object.values(student.assignments).map((a) => a.percentage),
  );

  const courseAverage = average(
    Object.values(student.courses).map((c) => c.progress),
  );

  return `

<div class="page">

<div class="student-header">

${
  student.photo
    ? `<img class="student-photo" src="${student.photo}">`
    : `<div class="student-photo placeholder">No Photo</div>`
}

<div class="student-info">

<h1>

${student.fullname}

</h1>

<p><b>Gender:</b> ${student.gender || "-"}</p>

<p><b>Email:</b> ${student.email || "-"}</p>

<p><b>Class:</b> ${report.classroom.name}</p>

<p><b>Term:</b> ${report.term.name}</p>

</div>

</div>

<div class="summary-grid">

${metricCard("Attendance", attendance + "%")}

${metricCard("XP", student.xp.totalXP)}

${metricCard("Badges", Object.keys(student.badges).length)}

${metricCard("Certificates", Object.keys(student.certificates).length)}

${metricCard("Quiz Average", quizAverage.toFixed(1) + "%")}

${metricCard("Assignment Avg", assignmentAverage.toFixed(1) + "%")}

${metricCard("Course Progress", courseAverage.toFixed(1) + "%")}

${metricCard("Level", student.xp.level)}

</div>

<div class="teacher-comment">

<h2>

Teacher Comment

</h2>

<p>

${student.ai.teacherComment}

</p>

</div>

<div class="two-column">

<div>

<h2>

Strengths

</h2>

<ul>

${student.ai.strengths.map((x) => `<li>${x}</li>`).join("")}

</ul>

</div>

<div>

<h2>

Areas for Improvement

</h2>

<ul>

${student.ai.improvements.map((x) => `<li>${x}</li>`).join("")}

</ul>

</div>

</div>

<div class="goals">

<h2>

Goals Next Term

</h2>

<ul>

${student.ai.nextTermGoals.map((x) => `<li>${x}</li>`).join("")}

</ul>

</div>

</div>

<div class="page-break"></div>

`;
}

function metricCard(title, value) {
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

function average(values) {
  if (values.length === 0) return 0;

  return values.reduce((a, b) => a + b, 0) / values.length;
}

module.exports = {
  buildStudentPages,
};
