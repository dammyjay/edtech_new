// services/platformReportSections/sectionHelpers.js
//
// Shared HTML fragments reused across every platform report section —
// avoids repeating the AI-commentary/table/metric-grid markup 8 times.
// Reuses the same CSS classes as services/sections/report.css
// (.summary-grid, .summary-card, .ai-summary, .report-table) so platform
// reports stay visually consistent with the existing class/student reports.

function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Complementary accent palette — brand gold stays the default/neutral
// color for most values, with a small set of semantic accents (teal for
// informational counts, green for a good/settled status, amber for
// something that needs attention) so a page of otherwise-identical gold
// numbers doesn't read as flat. Pass m.accent as one of these keys.
const METRIC_ACCENTS = {
  gold: "A17807",
  teal: "0F6E6E",
  green: "2E7D4F",
  amber: "C0762A",
  red: "B23B3B",
};

function renderMetricGrid(metrics) {
  return `
<div class="summary-grid">
${metrics
  .map((m) => {
    const color = METRIC_ACCENTS[m.accent] || METRIC_ACCENTS.gold;
    return `
<div class="summary-card" style="border-top-color:#${color};">
  <div class="card-title">${escapeHtml(m.label)}</div>
  <div class="card-value" style="color:#${color};">${escapeHtml(m.value)}</div>
</div>`;
  })
  .join("")}
</div>
`;
}

function renderList(items) {
  if (!items || !items.length) {
    return `<p><em>None identified for this period.</em></p>`;
  }
  return `
<ul>
${items
  .map(
    (i) => `
  <li>${
    typeof i === "string" ? escapeHtml(i) : escapeHtml(JSON.stringify(i))
  }</li>`
  )
  .join("")}
</ul>
`;
}

function renderAiBlock(ai) {
  if (!ai) return "";
  return `
<div class="ai-summary">
  <h3>AI Analysis</h3>
  <p>${escapeHtml(ai.summary)}</p>

  <h4>Key Insights</h4>
  ${renderList(ai.insights)}

  <h4>Risks</h4>
  ${renderList(ai.risks)}

  <h4>Recommendations</h4>
  ${renderList(ai.recommendations)}
</div>
`;
}

function renderDataTable(headers, rows) {
  if (!rows || !rows.length) {
    return `<p><em>No data for this period.</em></p>`;
  }
  return `
<table class="report-table">
  <thead>
    <tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr>
  </thead>
  <tbody>
    ${rows
      .map(
        (row) =>
          `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`
      )
      .join("")}
  </tbody>
</table>
`;
}

function formatNaira(amount) {
  return "₦" + Number(amount || 0).toLocaleString();
}

// Every section page shows its title plus the report's period as a
// subtitle — a reader looking at any single page later (not just the
// cover) needs an unambiguous answer to "what period is this data for?"
// without having to flip back. This matters in particular for periods
// with little/no activity (e.g. an early year before revenue started) —
// without this, a ₦0 revenue figure reads as a bug rather than "this
// period genuinely had none."
function renderPageHeader(title, periodLabel) {
  return `
<h1 class="page-title">${escapeHtml(title)}</h1>
${periodLabel ? `<p class="period-subtitle">Reporting period: <strong>${escapeHtml(periodLabel)}</strong></p>` : ""}
`;
}

module.exports = {
  escapeHtml,
  renderMetricGrid,
  renderAiBlock,
  renderDataTable,
  renderPageHeader,
  formatNaira,
};
