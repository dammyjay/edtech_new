const theme = require("./deckTheme");

function formatNaira(amount) {
  return "₦" + Number(amount || 0).toLocaleString();
}

// platformData: { overview, schools, learning, business, revenueTrend }
// narrative: { tagline, tractionHighlights, marketOpportunity, businessModel, ask, useOfFunds }
// companyInfo: { company_name, logo_url } from company_info (the admin's branding)
async function buildDeck(platformData, narrative, companyInfo) {
  const pptx = theme.newDeck(companyInfo);
  const { overview, schools, business, revenueTrend } = platformData;

  theme.addTitleSlide(pptx, {
    title: pptx.__companyName,
    subtitle: narrative.tagline || "Scaling tech education across Nigeria",
  });

  theme.addStatSlide(pptx, "Traction", [
    { label: "Total Users", value: overview.totalUsers.toLocaleString() },
    { label: "Partner Schools", value: schools.totalSchools.toLocaleString() },
    { label: "Total Revenue", value: formatNaira(overview.revenue) },
    { label: "Avg Quiz Score", value: `${overview.avgQuizScore}%` },
  ]);

  if (revenueTrend && revenueTrend.length) {
    theme.addLineChartSlide(
      pptx,
      "Revenue Growth",
      revenueTrend.map((r) => r.label),
      revenueTrend.map((r) => r.total),
      "Revenue (NGN)"
    );
  }

  theme.addBulletSlide(pptx, "Traction Highlights", narrative.tractionHighlights || []);

  theme.addBulletSlide(pptx, "Market Opportunity", [narrative.marketOpportunity || ""]);

  theme.addBulletSlide(pptx, "Business Model", [narrative.businessModel || ""]);

  const askSlide = theme.addContentSlide(pptx, "The Ask");
  askSlide.addText(narrative.ask || "", {
    x: 0.6, y: 1.5, w: 12.0, h: 1.5, fontSize: 22, bold: true, color: theme.BRAND_GOLD, valign: "top",
  });

  theme.addBulletSlide(pptx, "Use of Funds", narrative.useOfFunds || []);

  theme.addClosingSlide(pptx, {
    headline: "Let's build the future of education together",
    cta: "We'd welcome a conversation about this opportunity.",
  });

  return pptx.write({ outputType: "nodebuffer" });
}

module.exports = { buildDeck };
