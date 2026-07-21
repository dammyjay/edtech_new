const { buildCoverPage } = require("./sections/coverPage");
const { buildStudentPages } = require("./sections/studentPages");
const {
  buildStudentCoursePerformance,
} = require("./sections/studentCoursePerformance");

const fs = require("fs");
const path = require("path");

const css = fs.readFileSync(
  path.join(__dirname, "sections", "report.css"),
  "utf8",
);


async function buildStudentReportHTML(report, studentId) {
    console.log("======= STUDENT REPORT HTML =======");
  return `
<!DOCTYPE html>

<html>

<head>

<meta charset="UTF-8">

<style>

${css}

</style>

</head>

<body>

${buildCoverPage(report)}

${buildStudentPages(report, { studentId })}

${report.students.students
  .filter((s) => String(s.id) === String(studentId))
  .map(buildStudentCoursePerformance)
  .join("")}

</body>

</html>
`;
}

module.exports = {
  buildStudentReportHTML,
};
