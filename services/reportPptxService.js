// services/reportPptxService.js
//
// Builds the PowerPoint export of a platform analytics report. Reuses the
// same visual design system as the pitch decks (services/pitchDecks/deckTheme.js)
// so all generated .pptx files look consistent, and uses native
// .addChart() so recipients get real editable chart objects in
// PowerPoint, not flattened images.

const theme = require("./pitchDecks/deckTheme");

function formatNaira(amount) {
  return "₦" + Number(amount || 0).toLocaleString();
}

// analytics: output of analyticsAggregationService.getReportAnalytics()
// aiCommentary: { executiveSummary, overview, business, learning, schools, finance, engagement }
// companyInfo: { company_name, logo_url } from company_info (the admin's branding)
async function buildAnalyticsDeck(analytics, aiCommentary, companyInfo) {
  const pptx = theme.newDeck(companyInfo);

  theme.addTitleSlide(pptx, {
    title: "Platform Analytics Report",
    subtitle: analytics.periodLabel,
  });

  // Executive summary
  theme.addStatSlide(pptx, `Executive Summary — ${analytics.periodLabel}`, [
    { label: "Total Users", value: analytics.overview.totalUsers.toLocaleString() },
    { label: "Total Courses", value: analytics.overview.totalCourses.toLocaleString() },
    { label: "Enrollments", value: analytics.overview.totalEnrollments.toLocaleString() },
    { label: "Schools", value: analytics.overview.totalSchools.toLocaleString() },
    { label: "Certificates", value: analytics.overview.certificatesIssued.toLocaleString() },
    { label: "Total Revenue", value: formatNaira(analytics.overview.revenue) },
    { label: "Avg Quiz Score", value: `${analytics.overview.avgQuizScore}%` },
  ]);
  theme.addAiSlide(pptx, "Executive Summary", aiCommentary.executiveSummary);

  // Overview
  theme.addAiSlide(pptx, "Overview", aiCommentary.overview);

  // Business
  theme.addStatSlide(pptx, `Business KPIs — ${analytics.periodLabel}`, [
    { label: "Total Revenue", value: formatNaira(analytics.business.totalRevenue) },
    { label: "School Revenue", value: formatNaira(analytics.business.schoolRevenue) },
    { label: "Parent Revenue", value: formatNaira(analytics.business.parentRevenue) },
    { label: "Event Revenue", value: formatNaira(analytics.business.eventRevenue) },
    { label: "Schools Fully Paid", value: `${analytics.business.paidSchools} / ${analytics.business.totalSchoolsWithQuotes}` },
    { label: "Terms Paid", value: analytics.business.paidTermsCount.toLocaleString() },
    { label: "Outstanding Balance", value: formatNaira(analytics.business.outstandingBalance) },
  ]);
  if ((analytics.business.incomeBreakdown || []).length) {
    theme.addBarChartSlide(
      pptx,
      "Income Breakdown by Source",
      analytics.business.incomeBreakdown.map((r) => r.source),
      analytics.business.incomeBreakdown.map((r) => Number(r.total)),
      "Revenue (NGN)"
    );
  }
  theme.addAiSlide(pptx, "Business", aiCommentary.business);

  // Learning
  const topCourses = (analytics.learning.courses || []).slice(0, 8);
  if (topCourses.length) {
    theme.addBarChartSlide(
      pptx,
      "Top Courses by Enrollment",
      topCourses.map((c) => c.title.slice(0, 25)),
      topCourses.map((c) => Number(c.enrollments)),
      "Enrollments"
    );
  }
  theme.addAiSlide(pptx, "Learning", aiCommentary.learning);

  // Schools
  theme.addStatSlide(pptx, "Schools", [
    { label: "Total Schools", value: analytics.schools.totalSchools.toLocaleString() },
    { label: "Total Students", value: analytics.schools.totalStudents.toLocaleString() },
    { label: "Total Teachers", value: analytics.schools.totalTeachers.toLocaleString() },
    { label: "Total Classrooms", value: analytics.schools.totalClassrooms.toLocaleString() },
  ]);
  const trendsWithPrev = (analytics.schools.termTrends || []).filter((t) => t.prevStudents !== null);
  if (trendsWithPrev.length) {
    const topTrends = trendsWithPrev.slice(0, 8);
    theme.addBarChartSlide(
      pptx,
      "Term-over-Term Enrollment Change (Students Gained/Lost)",
      topTrends.map((t) => `${t.schoolName.slice(0, 16)} (${t.termName.slice(-7)})`),
      topTrends.map((t) => t.change),
      "Students",
      topTrends.map((t) => (t.change >= 0 ? theme.ACCENT_GREEN : theme.ACCENT_RED))
    );
  }
  theme.addAiSlide(pptx, "Schools", aiCommentary.schools);

  // Finance
  theme.addStatSlide(pptx, `Finance — ${analytics.periodLabel}`, [
    { label: "Wallet/Course Revenue", value: formatNaira(analytics.finance.revenue) },
    { label: "Total Transactions", value: analytics.finance.totalTransactions.toLocaleString() },
    { label: "Failed Transactions", value: analytics.finance.failedTransactions.toLocaleString() },
  ]);
  theme.addAiSlide(pptx, "Finance", aiCommentary.finance);

  // Engagement
  theme.addStatSlide(pptx, "Engagement", [
    { label: "Daily Active Users", value: analytics.engagement.dailyUsers.toLocaleString() },
    { label: "Weekly Active Users", value: analytics.engagement.weeklyUsers.toLocaleString() },
    { label: "Completed Lessons", value: analytics.engagement.completedLessons.toLocaleString() },
    { label: "AI Tutor Questions", value: analytics.engagement.aiQuestions.toLocaleString() },
    { label: "Total Activities", value: analytics.engagement.totalActivities.toLocaleString() },
  ]);
  theme.addAiSlide(pptx, "Engagement", aiCommentary.engagement);

  theme.addClosingSlide(pptx, {
    headline: "Thank you",
    cta: "Questions about this report? Reach out anytime.",
  });

  return pptx.write({ outputType: "nodebuffer" });
}

module.exports = { buildAnalyticsDeck };
