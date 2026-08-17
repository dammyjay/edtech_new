// services/reportOrchestratorService.js
//
// Single entry point for generating a platform analytics report. Both the
// on-demand admin controller and the scheduled cron job call this exact
// function, guaranteeing a report for a given period is identical
// regardless of how it was triggered.

const pool = require("../models/db");
const analyticsAggregationService = require("./analyticsAggregationService");
const platformReportAIService = require("./platformReportAIService");
const { buildPlatformReportHTML } = require("./platformReportSections/reportHtmlAssembler");
const generatePdf = require("../utils/generatePdf");
const { buildAnalyticsWorkbook } = require("./reportExcelService");
const { buildAnalyticsDeck } = require("./reportPptxService");
const { getCompanyInfo } = require("../utils/companyInfo");

async function logReportGeneration({
  scope,
  periodLabel,
  formats,
  triggeredBy,
  triggeredByUserId,
  status,
  errorMessage,
}) {
  try {
    await pool.query(
      `
      INSERT INTO report_generation_log
        (report_type, scope, period_label, formats_generated, triggered_by, triggered_by_user_id, status, error_message)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        "platform_analytics",
        scope || "all",
        periodLabel,
        formats,
        triggeredBy,
        triggeredByUserId || null,
        status,
        errorMessage || null,
      ]
    );
  } catch (err) {
    // Logging must never take down report generation itself.
    console.error("Failed to write report_generation_log:", err.message);
  }
}

function fileNameFor(periodLabel, format) {
  const safePeriod = periodLabel.replace(/\s+/g, "-");
  const ext = { pdf: "pdf", excel: "xlsx", pptx: "pptx" }[format];
  return `platform-report-${safePeriod}.${ext}`;
}

const MIME_TYPES = {
  pdf: "application/pdf",
  excel: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

/**
 * @param {Object} opts
 * @param {'month'|'year'} opts.scope
 * @param {number} opts.year
 * @param {number} [opts.month]
 * @param {('pdf'|'excel'|'pptx')[]} opts.formats
 * @param {'cron'|'admin'} opts.triggeredBy
 * @param {number} [opts.triggeredByUserId]
 * @returns {Promise<{periodLabel: string, files: {format: string, filename: string, mimeType: string, buffer: Buffer}[]}>}
 */
async function generatePlatformReport({
  scope,
  year,
  month,
  formats = ["pdf", "excel", "pptx"],
  triggeredBy = "admin",
  triggeredByUserId = null,
}) {
  try {
    const analytics = await analyticsAggregationService.getReportAnalytics(scope, year, month);
    const companyInfo = await getCompanyInfo();

    const [executiveSummary, overview, business, learning, schools, finance, engagement] =
      await Promise.all([
        platformReportAIService.generateExecutiveSummary(analytics, analytics.periodLabel),
        platformReportAIService.generateSectionCommentary("overview", analytics.overview, analytics.periodLabel),
        platformReportAIService.generateSectionCommentary("business", analytics.business, analytics.periodLabel),
        platformReportAIService.generateSectionCommentary("learning", analytics.learning, analytics.periodLabel),
        platformReportAIService.generateSectionCommentary("schools", analytics.schools, analytics.periodLabel),
        platformReportAIService.generateSectionCommentary("finance", analytics.finance, analytics.periodLabel),
        platformReportAIService.generateSectionCommentary("engagement", analytics.engagement, analytics.periodLabel),
      ]);

    const aiCommentary = { executiveSummary, overview, business, learning, schools, finance, engagement };

    const files = [];

    if (formats.includes("pdf")) {
      const html = buildPlatformReportHTML(analytics, aiCommentary, { companyInfo });
      const buffer = await generatePdf(html);
      files.push({
        format: "pdf",
        filename: fileNameFor(analytics.periodLabel, "pdf"),
        mimeType: MIME_TYPES.pdf,
        buffer,
      });
    }

    if (formats.includes("excel")) {
      const buffer = await buildAnalyticsWorkbook(analytics, aiCommentary, companyInfo);
      files.push({
        format: "excel",
        filename: fileNameFor(analytics.periodLabel, "excel"),
        mimeType: MIME_TYPES.excel,
        buffer,
      });
    }

    if (formats.includes("pptx")) {
      const buffer = await buildAnalyticsDeck(analytics, aiCommentary, companyInfo);
      files.push({
        format: "pptx",
        filename: fileNameFor(analytics.periodLabel, "pptx"),
        mimeType: MIME_TYPES.pptx,
        buffer,
      });
    }

    await logReportGeneration({
      scope,
      periodLabel: analytics.periodLabel,
      formats,
      triggeredBy,
      triggeredByUserId,
      status: "success",
    });

    return { periodLabel: analytics.periodLabel, files };
  } catch (err) {
    await logReportGeneration({
      scope,
      periodLabel: scope ? `${scope} ${year}${month ? "-" + month : ""}` : "all",
      formats,
      triggeredBy,
      triggeredByUserId,
      status: "error",
      errorMessage: err.message,
    });
    throw err;
  }
}

module.exports = { generatePlatformReport };
