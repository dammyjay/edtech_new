

const { getClassTermAnalytics } = require("./reportAnalyticsService");

const { generateCharts, generateStudentCharts } = require("./chartService");

const { buildClassReportHTML } = require("./reportHtmlService");
const { buildStudentReportHTML } = require("./reportStudentHtmlService");

const { generatePDF } = require("./reportPdfService");

async function generateClassReport(schoolId, classroomId, termId) {
  console.log("STEP 1");
  const analytics = await getClassTermAnalytics(
    schoolId,
    classroomId,
    termId,
  );

  console.log("STEP 2");
  analytics.charts = await generateCharts(analytics);
  console.log("Charts:");
  console.dir(analytics.charts, { depth: null });

  console.log("STEP 3");
  const html = await buildClassReportHTML(analytics);

  console.log("STEP 4");
  const pdf = await generatePDF(
    html,
    `ClassReport-${classroomId}-${termId}.pdf`,
  );

  return {
    html,
    pdf,
    analytics,
  };
}

async function generateStudentReport(schoolId, classroomId, termId, studentId) {
  console.log("Generating student report...");

  const analytics = await getClassTermAnalytics(
    schoolId,
    classroomId,
    termId,
    studentId,
  );

  // Keep this if your charts are used in the student page.
  // analytics.charts = await generateCharts(analytics);
  const student = analytics.students.students[0];

  analytics.charts = await generateStudentCharts(student);
  console.log(analytics.charts);

  const html = await buildStudentReportHTML(analytics, studentId);

  const fs = require("fs");
  fs.writeFileSync("student-test.html", html);

  console.log(html);

  // const student = analytics.students.students[0];

  const studentName = student.fullname
    .replace(/[<>:"/\\|?*]/g, "") // Remove invalid filename characters
    .replace(/\s+/g, "_"); // Replace spaces with underscores

  const pdf = await generatePDF(html, `${studentName}_Report.pdf`);

  return {
    html,
    pdf,
    analytics,
  };
}

module.exports = {
  generateClassReport,
  generateStudentReport,
};
