/* ==========================================================
   AI RECOMMENDATIONS
========================================================== */
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

<div class="summary-card" style="text-align: left;">

<h2>

Key Insights

</h2>

<ul>

${(ai.insights || [])
  .map(
    (i) => `
    <li>
      ${
        typeof i === "string"
          ? i
          : `<strong>${i.title || ""}</strong>${
              i.description ? `<br>${i.description}` : ""
            }`
      }
    </li>
  `,
  )
  .join("")}

</ul>

</div>

<div class="summary-card" style="text-align: left";>

<h2>

Potential Risks

</h2>

<ul>

${(ai.risks || [])
  .map(
    (r) => `
    <li>
      ${
        typeof r === "string"
          ? r
          : `<strong>${r.title || ""}</strong>${
              r.description ? `<br>${r.description}` : ""
            }`
      }
    </li>
  `,
  )
  .join("")}

</ul>

</div>

</div>

<div class="ai-summary">

<h2 class="card-title">

Recommendations

</h2>

<ul>

${(ai.recommendations || [])
  .map(
    (r) => `
    <li>
      ${
        typeof r === "string"
          ? r
          : `<strong>${r.title || ""}</strong>${
              r.description ? `<br>${r.description}` : ""
            }`
      }
    </li>
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

module.exports = {
  buildRecommendationSection,
};



