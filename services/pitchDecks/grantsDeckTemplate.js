const theme = require("./deckTheme");

// platformData: { overview, schools, learning }
// narrative: { missionStatement, problemStatement, beneficiaryImpact, theoryOfChange, sustainabilityPlan }
// companyInfo: { company_name, logo_url } from company_info (the admin's branding)
async function buildDeck(platformData, narrative, companyInfo) {
  const pptx = theme.newDeck(companyInfo);
  const { overview, schools } = platformData;

  theme.addTitleSlide(pptx, {
    title: pptx.__companyName,
    subtitle: narrative.missionStatement || "Expanding access to quality tech education",
  });

  theme.addBulletSlide(pptx, "The Problem", [narrative.problemStatement || ""]);

  theme.addStatSlide(pptx, "Beneficiaries Reached", [
    { label: "Students", value: schools.totalStudents.toLocaleString() },
    { label: "Schools", value: schools.totalSchools.toLocaleString() },
    { label: "Certificates Issued", value: overview.certificatesIssued.toLocaleString() },
  ]);

  theme.addBulletSlide(pptx, "Impact on Beneficiaries", narrative.beneficiaryImpact || []);

  theme.addBulletSlide(pptx, "Theory of Change", [narrative.theoryOfChange || ""]);

  theme.addBulletSlide(pptx, "Sustainability Plan", [narrative.sustainabilityPlan || ""]);

  theme.addClosingSlide(pptx, {
    headline: "Partner with us to expand this impact",
    cta: "We welcome the opportunity to discuss funding this mission.",
  });

  return pptx.write({ outputType: "nodebuffer" });
}

module.exports = { buildDeck };
