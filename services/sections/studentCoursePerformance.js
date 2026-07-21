

function buildStudentCoursePerformance(student) {
  return `
   <div class="page">

      <div class="page-title">
         <h1>Course Performance</h1>
         <h3>${student.fullname}</h3>
      </div>


      ${student.reportCourses.map((course) => buildCourse(course)).join("")}

   </div>

   <div class="page-break"></div>
   `;
}

// function buildAttendanceTable(student) {
//   return `

// <h2>Attendance Record</h2>

// <table class="lesson-table">

// <thead>

// <tr>

// <th>Week</th>

// <th>Date</th>

// <th>Status</th>

// </tr>

// </thead>

// <tbody>

// ${student.attendanceTable
//   .map(
//     (row) => `

// <tr>

// <td>${row.week_number}</td>

// <td>${formatDate(row.date)}</td>

// <td>${attendanceStatus(row.status)}</td>

// </tr>

// `,
//   )
//   .join("")}

// </tbody>

// </table>

// <br>

// `;
// }

// function attendanceStatus(status) {
//   switch (status) {
//     case "present":
//       return "Present";

//     case "late":
//       return "Late";

//     case "absent":
//       return "Absent";

//     default:
//       return "Not Yet Taken";
//   }
// }

// function formatDate(date) {
//   return new Date(date).toLocaleDateString();
// }

function buildCourse(course) {
  const quizAverage = average(course.modules.map((m) => m.quizAverage));

  const assignmentAverage = average(
    course.modules.map((m) => m.assignmentAverage),
  );

  return `

<div class="course-card">

<h2>${course.title}</h2>

<div class="course-summary">

<div>
<b>Overall Progress</b><br>
${course.progress}%
</div>

<div>
<b>Certificate Earned</b><br>
${course.certificate ? "✅ Yes" : "❌ No"}
</div>

<div>
<b>Average Quiz</b><br>
${quizAverage.toFixed(1)}%
</div>

<div>
<b>Average Assignment</b><br>
${assignmentAverage.toFixed(1)}%
</div>

</div>

${course.modules.map(buildModule).join("")}

</div>

`;
}

function buildModule(module) {
  return `

<div class="module-card">

<h3>${module.title}</h3>

<div class="module-progress">

Completion:
<b>${module.completion}%</b>

</div>

<table class="lesson-table">

<thead>

<tr>

<th>Lesson</th>

<th>Quiz</th>

</tr>

</thead>

<tbody>

${module.lessons.map(buildLesson).join("")}

</tbody>

</table>

<h4 style="margin-top:20px;">Module Assignments</h4>

<table class="lesson-table">

<thead>

<tr>
<th>Assignment</th>
<th>Score</th>
<th>Total</th>
<th>Percentage</th>
<th>Status</th>
</tr>

</thead>

<tbody>

${
  module.assignments.length
    ? module.assignments.map(buildAssignment).join("")
    : `
<tr>
<td colspan="5" style="text-align:center;">
No Assignment
</td>
</tr>`
}

</tbody>

</table>

<div class="module-average">

<b>Module Average</b>

<span>Quiz: ${module.quizAverage}%</span>

<span>Assignment: ${module.assignmentAverage}%</span>

</div>

</div>

`;
}

function buildLesson(lesson) {
  return `

<tr>

<td>${lesson.lessonTitle}</td>

<td>${lesson.quizScore}%</td>

</tr>

`;
}

function buildAssignment(assignment) {
  return `
<tr>

<td>${assignment.title}</td>

<td>${assignment.score}</td>

<td>${assignment.total}</td>

<td>${assignment.percentage}%</td>

<td>${assignment.submitted ? "Submitted" : "Not Submitted"}</td>

</tr>
`;
}

function average(values) {
  if (values.length === 0) return 0;

  return values.reduce((a, b) => a + b, 0) / values.length;
}

module.exports = {
  buildStudentCoursePerformance,
};
