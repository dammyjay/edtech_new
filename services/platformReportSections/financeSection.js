const { renderMetricGrid, renderAiBlock, renderDataTable, renderPageHeader, formatNaira } = require("./sectionHelpers");

function buildFinanceSection(finance, ai, periodLabel) {
  return `
<div class="page">

${renderPageHeader("Finance", periodLabel)}

${renderMetricGrid([
  { label: "Wallet/Course Revenue", value: formatNaira(finance.revenue) },
  { label: "Total Transactions", value: finance.totalTransactions.toLocaleString() },
  { label: "Failed Transactions", value: finance.failedTransactions.toLocaleString() },
])}

<p><em>Note: this section covers wallet/course transactions only. See the Business KPIs section for the platform's full multi-source revenue picture (schools, parents, events).</em></p>

<h2>Recent Transactions</h2>
${renderDataTable(
  ["Name", "Email", "Amount", "Status", "Date"],
  (finance.transactions || [])
    .slice(0, 15)
    .map((t) => [t.fullname, t.email, formatNaira(t.amount), t.status, new Date(t.created_at).toLocaleDateString()])
)}

${renderAiBlock(ai)}

</div>

<div class="page-break"></div>
`;
}

module.exports = { buildFinanceSection };
