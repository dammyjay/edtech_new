function buildCoverPage({ periodLabel, companyName, logoUrl, scope }) {
  const scopeLabel = scope === "year" ? "Annual" : scope === "month" ? "Monthly" : "Platform";

  return `
<div class="cover-page">

  <div class="logo-row">
    ${logoUrl ? `<img class="company-logo" src="${logoUrl}">` : ""}
  </div>

  <h1 class="school-name">${companyName}</h1>
  <h2 class="report-title">${scopeLabel} Analytics Report</h2>

  <table class="cover-table">
    <tr>
      <td><strong>Reporting Period</strong></td>
      <td>${periodLabel}</td>
    </tr>
    <tr>
      <td><strong>Prepared On</strong></td>
      <td>${new Date().toLocaleDateString()}</td>
    </tr>
  </table>

</div>

<div class="page-break"></div>
`;
}

module.exports = { buildCoverPage };
