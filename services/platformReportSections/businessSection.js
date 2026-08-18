const { renderMetricGrid, renderAiBlock, renderDataTable, renderPageHeader, formatNaira } = require("./sectionHelpers");

function buildBusinessSection(business, ai, periodLabel) {
  return `
<div class="page">

${renderPageHeader("Business KPIs", periodLabel)}

${renderMetricGrid([
  { label: "Total Revenue", value: formatNaira(business.totalRevenue), accent: "gold" },
  { label: "School Revenue", value: formatNaira(business.schoolRevenue), accent: "teal" },
  { label: "Parent Revenue", value: formatNaira(business.parentRevenue), accent: "teal" },
  { label: "Event Revenue", value: formatNaira(business.eventRevenue), accent: "teal" },
  { label: "Schools Fully Paid", value: `${business.paidSchools} / ${business.totalSchoolsWithQuotes}`, accent: "green" },
  { label: "Terms Paid", value: business.paidTermsCount.toLocaleString(), accent: "green" },
  { label: "Outstanding Balance", value: formatNaira(business.outstandingBalance), accent: business.outstandingBalance > 0 ? "amber" : "green" },
])}

${business.totalRevenue === 0 ? `<p><em>No revenue was recorded for ${periodLabel || "this period"} — the figures above cover only money received within this specific period. This does not necessarily mean the platform has no activity overall; check a more recent period for current totals.</em></p>` : ""}

<h2>Income Breakdown</h2>
<p><em>Revenue actually received during ${periodLabel || "this period"} only.</em></p>
${renderDataTable(
  ["Source", "Total"],
  (business.incomeBreakdown || []).map((row) => [row.source, formatNaira(row.total)])
)}

<h2>Top Outstanding School Balances</h2>
<p><em>Reflects each school's real-time payment status as of today (not limited to ${periodLabel || "this period"}) — "Total Paid" and "Balance" answer "have they settled their quote yet," which doesn't reset by report period.</em></p>
${renderDataTable(
  ["School", "Total Amount", "Total Paid", "Balance"],
  (business.schools || [])
    .slice()
    .sort((a, b) => Number(b.balance) - Number(a.balance))
    .slice(0, 10)
    .map((s) => [s.school_name, formatNaira(s.total_amount), formatNaira(s.total_paid), formatNaira(s.balance)])
)}

${renderAiBlock(ai)}

</div>

<div class="page-break"></div>
`;
}

module.exports = { buildBusinessSection };
