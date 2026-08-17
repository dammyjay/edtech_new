const { renderMetricGrid, renderAiBlock, renderDataTable, formatNaira } = require("./sectionHelpers");

function buildBusinessSection(business, ai) {
  return `
<div class="page">

<h1 class="page-title">Business KPIs</h1>

${renderMetricGrid([
  { label: "Total Revenue", value: formatNaira(business.totalRevenue) },
  { label: "School Revenue", value: formatNaira(business.schoolRevenue) },
  { label: "Parent Revenue", value: formatNaira(business.parentRevenue) },
  { label: "Event Revenue", value: formatNaira(business.eventRevenue) },
  { label: "Paid Schools", value: business.paidSchools.toLocaleString() },
  { label: "Outstanding Balance", value: formatNaira(business.outstandingBalance) },
])}

<h2>Income Breakdown</h2>
${renderDataTable(
  ["Source", "Total"],
  (business.incomeBreakdown || []).map((row) => [row.source, formatNaira(row.total)])
)}

<h2>Top Outstanding School Balances</h2>
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
