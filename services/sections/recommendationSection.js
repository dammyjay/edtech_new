function buildRecommendationSection(report) {
  const ai = report.aiSummary;

  return `

<div class="page">

<h1 class="page-title">

Overall Recommendations

</h1>

<div class="ai-summary">

<h2>

Executive Summary

</h2>

<p>

${ai.summary}

</p>

</div>

<div class="two-column">

<div>

<h2>

Key Insights

</h2>

<ul>

${ai.insights
  .map(
    (i) => `

<li>${i}</li>

`,
  )
  .join("")}

</ul>

</div>

<div>

<h2>

Potential Risks

</h2>

<ul>

${ai.risks
  .map(
    (r) => `

<li>${r}</li>

`,
  )
  .join("")}

</ul>

</div>

</div>

<div class="goals">

<h2>

Recommendations

</h2>

<ul>

${ai.recommendations
  .map(
    (r) => `

<li>${r}</li>

`,
  )
  .join("")}

</ul>

</div>

<div class="report-footer">

<hr>

<p>

<strong>${report.school.name}</strong>

</p>

<p>

Powered by JayKirch Tech Hub School Management System

</p>

<p>

AI Academic Analytics Report

</p>

<p>

Generated:

${new Date().toLocaleString()}

</p>

</div>

</div>

`;
}

/* ==========================================================
   AI RECOMMENDATIONS
========================================================== */

// function buildRecommendationSection(aiSummary = {}) {
//   return `

// <section class="page">

// <div class="page-title">

// Overall Recommendations

// </div>

// <div class="summary-box">

// <h3>Executive Summary</h3>

// <p>

// ${aiSummary.summary || "No summary available."}

// </p>

// </div>

// <div class="recommendation-grid">

// <div class="recommend-card">

// <h3>Key Insights</h3>

// <ul>

// ${(aiSummary.insights || [])
//   .map((item) => `<li>${item}</li>`)
//   .join("")}

// </ul>

// </div>

// <div class="recommend-card">

// <h3>Identified Risks</h3>

// <ul>

// ${(aiSummary.risks || [])
//   .map((item) => `<li>${item}</li>`)
//   .join("")}

// </ul>

// </div>

// <div class="recommend-card">

// <h3>Recommendations</h3>

// <ul>

// ${(aiSummary.recommendations || [])
//   .map((item) => `<li>${item}</li>`)
//   .join("")}

// </ul>

// </div>

// </div>

// <div class="report-footer">

// <p>

// This report was automatically generated using the
// JayKirch Tech Hub AI Reporting System.

// </p>

// <p>

// Generated on
// ${new Date().toLocaleDateString()}

// </p>

// </div>

// </section>

// `;
// }

module.exports = {
  buildRecommendationSection,
};



