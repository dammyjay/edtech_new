function buildCourseSection(report) {
  const { courses, charts } = report;

  return `

<div class="page">

<h1 class="page-title">

Course Analytics

</h1>

<div class="summary-grid">

${buildCard("Average Completion", `${courses.averageCompletion}%`)}

${buildCard("Courses", courses.totalCourses)}

${buildCard("Completed", courses.completedCourses)}

${buildCard(
  "Certificates",
  courses.courses.reduce((sum, c) => sum + c.certificates, 0),
)}

</div>

<div class="chart">

<h2>

Course Completion

</h2>

<img
class="chart-image"
src="${report.charts?.courseCompletion || ""}"
/>

</div>

<h2>

Course Performance

</h2>

<table class="report-table">

<tr>

<th>Course</th>

<th>Students</th>

<th>Completion</th>

<th>Certificates</th>

</tr>

${courses.courses
  .map(
    (course) => `

<tr>

<td>${course.title}</td>

<td>${course.studentsEnrolled}</td>

<td>${course.averageCompletion}%</td>

<td>${course.certificates}</td>

</tr>

`,
  )
  .join("")}

</table>

<div class="ai-summary">

<h2>

AI Insight

</h2>

<p>

${buildCourseInsight(courses)}

</p>

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

function buildCourseInsight(courses) {
  if (courses.averageCompletion >= 85) {
    return "Course completion across the classroom was excellent. Students consistently completed lessons and earned certificates across multiple learning pathways.";
  }

  if (courses.averageCompletion >= 70) {
    return "Course completion was satisfactory. A few courses would benefit from additional classroom reinforcement to improve completion rates.";
  }

  return "Overall course completion is below expectations. Extra instructional support and targeted interventions are recommended for learners with incomplete coursework.";
}

module.exports = {
  buildCourseSection,
};

