const theme = require("./deckTheme");

// platformData: { overview, schools, learning }
// narrative: { tagline, curriculumHighlights, outcomesSummary, onboardingSteps, testimonialAngle }
// companyInfo: { company_name, logo_url } from company_info (the admin's branding)
async function buildDeck(platformData, narrative, companyInfo) {
  const pptx = theme.newDeck(companyInfo);
  const { overview, schools, learning } = platformData;

  theme.addTitleSlide(pptx, {
    title: "Partner With " + pptx.__companyName,
    subtitle: narrative.tagline || "A learning platform built for schools",
  });

  theme.addStatSlide(pptx, "Platform at a Glance", [
    { label: "Partner Schools", value: schools.totalSchools.toLocaleString() },
    { label: "Students Served", value: schools.totalStudents.toLocaleString() },
    { label: "Courses Offered", value: learning.totalCourses.toLocaleString() },
    { label: "Certificates Issued", value: overview.certificatesIssued.toLocaleString() },
  ]);

  theme.addBulletSlide(pptx, "Curriculum Highlights", narrative.curriculumHighlights || []);

  theme.addBulletSlide(pptx, "Learning Outcomes", [narrative.outcomesSummary || ""]);

  theme.addBulletSlide(pptx, "Onboarding Your School", narrative.onboardingSteps || []);

  if (narrative.testimonialAngle) {
    theme.addBulletSlide(pptx, "Why Schools Choose Us", [narrative.testimonialAngle]);
  }

  theme.addClosingSlide(pptx, {
    headline: "Ready to bring this to your school?",
    cta: "Let's talk about onboarding your students.",
  });

  return pptx.write({ outputType: "nodebuffer" });
}

module.exports = { buildDeck };
