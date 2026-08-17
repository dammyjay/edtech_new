// services/reportExcelService.js
//
// Builds the Excel export of a platform analytics report. Uses exceljs the
// same way controllers/adminController.js::exportAttendanceExcel does
// (addWorksheet / sheet.columns / sheet.addRow), but returns a Buffer via
// workbook.xlsx.writeBuffer() instead of streaming to res — this file's
// output needs to be both emailed and downloaded from the same request.

const ExcelJS = require("exceljs");

const BRAND_GOLD = "FFA17807";

function styleHeaderRow(sheet) {
  const headerRow = sheet.getRow(1);
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND_GOLD } };
    cell.font = { color: { argb: "FFFFFFFF" }, bold: true };
  });
}

function addMetricsSheet(workbook, name, metrics) {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = [
    { header: "Metric", key: "metric", width: 30 },
    { header: "Value", key: "value", width: 20 },
  ];
  metrics.forEach((m) => sheet.addRow(m));
  styleHeaderRow(sheet);
  return sheet;
}

function addTableSheet(workbook, name, columns, rows) {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = columns;
  rows.forEach((row) => sheet.addRow(row));
  styleHeaderRow(sheet);
  return sheet;
}

function addCommentaryToSummary(sheet, sectionTitle, ai) {
  if (!ai) return;
  sheet.addRow([]);
  sheet.addRow([sectionTitle]).font = { bold: true, color: { argb: BRAND_GOLD } };
  sheet.addRow(["Summary", ai.summary || ""]);
  sheet.addRow(["Insights", (ai.insights || []).join(" | ")]);
  sheet.addRow(["Risks", (ai.risks || []).join(" | ")]);
  sheet.addRow(["Recommendations", (ai.recommendations || []).join(" | ")]);
}

// analytics: output of analyticsAggregationService.getReportAnalytics()
// aiCommentary: { executiveSummary, overview, business, learning, schools, finance, engagement }
// companyInfo: { company_name, logo_url } from company_info (the admin's branding)
async function buildAnalyticsWorkbook(analytics, aiCommentary, companyInfo = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = companyInfo.company_name || "";
  workbook.created = new Date();

  // --- Summary sheet ---
  const summarySheet = workbook.addWorksheet("Summary");
  summarySheet.columns = [
    { header: "Field", key: "field", width: 25 },
    { header: "Value", key: "value", width: 80 },
  ];
  summarySheet.addRow(["Report Period", analytics.periodLabel]);
  summarySheet.addRow(["Generated On", new Date().toLocaleString()]);
  styleHeaderRow(summarySheet);
  addCommentaryToSummary(summarySheet, "Executive Summary", aiCommentary.executiveSummary);
  addCommentaryToSummary(summarySheet, "Overview", aiCommentary.overview);
  addCommentaryToSummary(summarySheet, "Business", aiCommentary.business);
  addCommentaryToSummary(summarySheet, "Learning", aiCommentary.learning);
  addCommentaryToSummary(summarySheet, "Schools", aiCommentary.schools);
  addCommentaryToSummary(summarySheet, "Finance", aiCommentary.finance);
  addCommentaryToSummary(summarySheet, "Engagement", aiCommentary.engagement);
  summarySheet.getColumn(2).alignment = { wrapText: true, vertical: "top" };

  // --- Overview sheet ---
  const { overview } = analytics;
  addMetricsSheet(workbook, "Overview", [
    { metric: "Total Users", value: overview.totalUsers },
    { metric: "Total Courses", value: overview.totalCourses },
    { metric: "Total Modules", value: overview.totalModules },
    { metric: "Total Lessons", value: overview.totalLessons },
    { metric: "Total Enrollments", value: overview.totalEnrollments },
    { metric: "Total Schools", value: overview.totalSchools },
    { metric: "Certificates Issued", value: overview.certificatesIssued },
    { metric: "Revenue (NGN)", value: overview.revenue },
    { metric: "Avg Quiz Score", value: overview.avgQuizScore },
  ]);

  // --- Business sheet ---
  const { business } = analytics;
  const businessSheet = addTableSheet(
    workbook,
    "Business",
    [
      { header: "Source", key: "source", width: 25 },
      { header: "Total (NGN)", key: "total", width: 20 },
    ],
    (business.incomeBreakdown || []).map((r) => ({ source: r.source, total: r.total }))
  );
  businessSheet.addRow([]);
  businessSheet.addRow(["Total Revenue", business.totalRevenue]);
  businessSheet.addRow(["Paid Schools", business.paidSchools]);
  businessSheet.addRow(["Outstanding Balance", business.outstandingBalance]);

  addTableSheet(
    workbook,
    "School Balances",
    [
      { header: "School", key: "school_name", width: 30 },
      { header: "Total Amount", key: "total_amount", width: 18 },
      { header: "Total Paid", key: "total_paid", width: 18 },
      { header: "Balance", key: "balance", width: 18 },
    ],
    business.schools || []
  );

  // --- Learning sheet ---
  addTableSheet(
    workbook,
    "Learning",
    [
      { header: "Course", key: "title", width: 40 },
      { header: "Enrollments", key: "enrollments", width: 14 },
      { header: "School Learners", key: "school_learners", width: 16 },
      { header: "Modules", key: "modules", width: 12 },
      { header: "Lessons", key: "lessons", width: 12 },
      { header: "Completion %", key: "moduleCompletion", width: 16 },
    ],
    analytics.learning.courses || []
  );

  // --- Schools sheet ---
  addTableSheet(
    workbook,
    "Schools",
    [
      { header: "School", key: "name", width: 30 },
      { header: "Students", key: "students", width: 12 },
      { header: "Teachers", key: "teachers", width: 12 },
      { header: "Classrooms", key: "classrooms", width: 14 },
      { header: "Courses", key: "courses", width: 12 },
    ],
    analytics.schools.schools || []
  );

  // --- School term trends sheet ---
  addTableSheet(
    workbook,
    "School Term Trends",
    [
      { header: "School", key: "schoolName", width: 28 },
      { header: "Term", key: "termName", width: 22 },
      { header: "Students", key: "students", width: 12 },
      { header: "Prior Term", key: "prevTermName", width: 22 },
      { header: "Prior Students", key: "prevStudents", width: 14 },
      { header: "Change", key: "change", width: 12 },
      { header: "Change %", key: "changePct", width: 12 },
      { header: "Retained", key: "retained", width: 12 },
      { header: "Retention %", key: "retentionRate", width: 14 },
    ],
    (analytics.schools.termTrends || []).filter((t) => t.prevStudents !== null)
  );

  // --- Finance sheet ---
  addTableSheet(
    workbook,
    "Finance",
    [
      { header: "Name", key: "fullname", width: 25 },
      { header: "Email", key: "email", width: 28 },
      { header: "Amount (NGN)", key: "amount", width: 16 },
      { header: "Status", key: "status", width: 14 },
      { header: "Date", key: "created_at", width: 20 },
    ],
    analytics.finance.transactions || []
  );

  // --- Engagement sheet ---
  addTableSheet(
    workbook,
    "Engagement",
    [
      { header: "User", key: "fullname", width: 25 },
      { header: "Action", key: "action", width: 20 },
      { header: "Course", key: "course_title", width: 35 },
      { header: "Date", key: "created_at", width: 20 },
    ],
    analytics.engagement.activities || []
  );

  return workbook.xlsx.writeBuffer();
}

module.exports = { buildAnalyticsWorkbook };
