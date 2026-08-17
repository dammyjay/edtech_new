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

function renderMetricGrid(metrics) {
  return `
<div class="summary-grid">
${metrics
  .map(
    (m) => `
<div class="summary-card">
  <div class="card-title">${escapeHtml(m.label)}</div>
  <div class="card-value">${escapeHtml(m.value)}</div>
</div>`
  )
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

module.exports = {
  escapeHtml,
  renderMetricGrid,
  renderAiBlock,
  renderDataTable,
  formatNaira,
};
