const theme = require("./deckTheme");

// platformData: { overview, schools, learning }
// narrative: { mutualValueProps, integrationOverview, jointGoals, nextSteps }
// companyInfo: { company_name, logo_url } from company_info (the admin's branding)
async function buildDeck(platformData, narrative, companyInfo) {
  const pptx = theme.newDeck(companyInfo);
  const { overview, schools, learning } = platformData;

  theme.addTitleSlide(pptx, {
    title: "Partnering With " + pptx.__companyName,
    subtitle: "Building the future of tech education together",
  });

  theme.addStatSlide(pptx, "Platform at a Glance", [
    { label: "Total Users", value: overview.totalUsers.toLocaleString() },
    { label: "Partner Schools", value: schools.totalSchools.toLocaleString() },
    { label: "Courses", value: learning.totalCourses.toLocaleString() },
  ]);

  theme.addBulletSlide(pptx, "Mutual Value", narrative.mutualValueProps || []);

  theme.addBulletSlide(pptx, "How Integration Works", [narrative.integrationOverview || ""]);

  theme.addBulletSlide(pptx, "Joint Goals", narrative.jointGoals || []);

  theme.addBulletSlide(pptx, "Next Steps", [narrative.nextSteps || ""]);

  theme.addClosingSlide(pptx, {
    headline: "Let's explore this partnership",
    cta: "We're excited to discuss how we can work together.",
  });

  return pptx.write({ outputType: "nodebuffer" });
}

module.exports = { buildDeck };
