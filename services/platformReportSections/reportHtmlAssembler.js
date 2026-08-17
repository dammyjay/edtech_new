const fs = require("fs");
const path = require("path");

const { buildCoverPage } = require("./coverPage");
const { buildExecutiveSummarySection } = require("./executiveSummarySection");
const { buildOverviewSection } = require("./overviewSection");
const { buildBusinessSection } = require("./businessSection");
const { buildLearningSection } = require("./learningSection");
const { buildSchoolsSection } = require("./schoolsSection");
const { buildFinanceSection } = require("./financeSection");
const { buildEngagementSection } = require("./engagementSection");

// Reuse the existing brand stylesheet (gold #A17807) directly rather than
// forking it — services/sections/report.css already backs the class/student
// term-report pipeline.
const baseCss = fs.readFileSync(
  path.join(__dirname, "..", "sections", "report.css"),
  "utf8"
);

// A small platform-report-specific addendum: the class report never needed
// a 3-column KPI grid or a page subtitle style, so these are additive, not
// a fork of the shared stylesheet.
const extraCss = `
.page-title { font-size: 26px; color: #A17807; border-bottom: 2px solid #A17807; padding-bottom: 10px; margin-bottom: 20px; }
.ai-summary h3 { margin-top: 0; color: #A17807; }
.ai-summary h4 { margin-bottom: 6px; }
`;

// analytics: output of analyticsAggregationService.getReportAnalytics()
// aiCommentary: { executiveSummary, overview, business, learning, schools, finance, engagement }
// options.companyInfo: { company_name, logo_url } from company_info (the admin's branding)
function buildPlatformReportHTML(analytics, aiCommentary, options = {}) {
  const companyInfo = options.companyInfo || {};
  const companyName = companyInfo.company_name || "";
  const logoUrl = companyInfo.logo_url || null;

  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Platform Analytics Report</title>
<style>
${baseCss}
${extraCss}
</style>
</head>
<body>

${buildCoverPage({ periodLabel: analytics.periodLabel, companyName, logoUrl, scope: analytics.scope })}

${buildExecutiveSummarySection(analytics, aiCommentary.executiveSummary)}

${buildOverviewSection(analytics.overview, aiCommentary.overview)}

${buildBusinessSection(analytics.business, aiCommentary.business)}

${buildLearningSection(analytics.learning, aiCommentary.learning)}

${buildSchoolsSection(analytics.schools, aiCommentary.schools)}

${buildFinanceSection(analytics.finance, aiCommentary.finance)}

${buildEngagementSection(analytics.engagement, aiCommentary.engagement)}

</body>
</html>
`;
}

module.exports = { buildPlatformReportHTML };
