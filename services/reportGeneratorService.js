const { getClassTermAnalytics } = require("./reportAnalyticsService");

const { generateAIReport } = require("./reportAIService");

const { generateCharts } = require("./chartService");

const { buildClassReportHTML } = require("./reportHtmlService");

const { generatePDF } = require("./reportPdfService");

const buildReport = require("./reportHtmlService");

async function generateClassReport(schoolId, classroomId, termId) {
    // STEP 1
    console.log("STEP 1");
  const analytics = await getClassTermAnalytics(schoolId, classroomId, termId);

    // STEP 2
    console.log("STEP 2");
  analytics.aiSummary = await generateAIReport(analytics);

    // STEP 3
    console.log("STEP 3");
  analytics.charts = await generateCharts(analytics);

    // STEP 4
    console.log("STEP 4");
  const html = await buildClassReportHTML(analytics);

    // STEP 5
    console.log("STEP 5");
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

module.exports = {
  generateClassReport,
};
