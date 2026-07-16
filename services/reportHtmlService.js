

const { buildCoverPage } = require("./sections/coverPage");

const {
  buildExecutiveSummary,
} = require("./sections/executiveSummary");

const {
  buildAttendanceSection,
} = require("./sections/attendanceSection");

const { buildCourseSection } = require("./sections/courseSection");

const { buildRankingSection } = require("./sections/rankingSection");

const {
  buildInterventionSection,
} = require("./sections/interventionSection");

const { buildStudentPages } = require("./sections/studentPages");

const {
  buildRecommendationSection,
} = require("./sections/recommendationSection");

const fs = require("fs");
const path = require("path");

const css = fs.readFileSync(
  path.join(__dirname, "sections", "report.css"),
  "utf8",
);

async function buildClassReportHTML(report) {
  return `

<!DOCTYPE html>

<html>

<head>

<meta charset="UTF-8">

<title>Class Report</title>

<style>

${css}

</style>

</head>

<body>

${buildCoverPage(report)}

${buildExecutiveSummary(report)}

${buildAttendanceSection(report)}

${buildCourseSection(report)}

${buildRankingSection(report)}

${buildInterventionSection(report)}

${buildStudentPages(report)}

${buildRecommendationSection(report)}



</body>

</html>

`;
}

module.exports = {
  buildClassReportHTML,
};