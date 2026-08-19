// services/pitchDecks/proposalDeckTemplate.js
//
// Partnership proposal deck — structurally modeled on a real reference
// proposal the admin shared (cover -> agenda -> about -> track record ->
// programs -> deep dives -> curriculum -> benefits -> how-it-works ->
// pricing -> FAQ -> contact). Unlike the 4 fixed-audience decks
// (schools/grants/investors/partners), this one is built from a `content`
// object that started as an AI draft but may have been reviewed and
// edited by an admin in the preview step before this ever runs — see
// services/pitchDeckGeneratorService.js. This file does no AI calls and
// makes no database calls; it just renders whatever content it's given.

const theme = require("./deckTheme");

// content: { recipientName, tagline, aboutUs, trackRecordStats, trackRecordQuote,
//   programs, programDeepDives, curriculumSteps, benefits, processSteps,
//   pricing, faq, contacts }
// companyInfo: { company_name, logo_url }
async function buildDeck(content, companyInfo) {
  const pptx = theme.newDeck(companyInfo);

  theme.addTitleSlide(pptx, {
    title: "Partnership Proposal",
    subtitle: content.tagline || `Prepared for ${content.recipientName || "Your School"}`,
  });

  theme.addTocSlide(pptx, "Agenda", [
    "About Us",
    "Our Track Record",
    "Our Programs",
    "Program Deep Dive",
    "The Curriculum",
    "Why It Matters",
    "How a Partnership Works",
    "Investment",
    "Frequently Asked Questions",
    "Let's Connect",
  ]);

  theme.addParagraphSlide(pptx, "About Us", content.aboutUs || "", { quote: null });

  if ((content.trackRecordStats || []).length) {
    theme.addStatSlide(pptx, "Our Track Record", content.trackRecordStats);
  }
  if (content.trackRecordQuote) {
    theme.addParagraphSlide(pptx, "Our Track Record", content.trackRecordQuote, { quote: content.trackRecordQuote });
  }

  if ((content.programs || []).length) {
    theme.addFeatureGridSlide(pptx, "Our Programs", content.programs, "Ways your school can work with us — pick one, or combine them into a full partnership.");
  }

  (content.programDeepDives || []).forEach((program) => {
    theme.addSpecTableSlide(pptx, program.title, program.description, program.specs || [], program.features || []);
  });

  if ((content.curriculumSteps || []).length) {
    theme.addProcessSlide(pptx, "The Curriculum", content.curriculumSteps);
  }

  if ((content.benefits || []).length) {
    theme.addFeatureGridSlide(pptx, "Why It Matters", content.benefits);
  }

  if ((content.processSteps || []).length) {
    theme.addProcessSlide(pptx, "How a Partnership Works", content.processSteps);
  }

  if (content.pricing) {
    theme.addPricingSlide(pptx, "Investment", content.pricing);
  }

  if ((content.faq || []).length) {
    theme.addFaqSlides(pptx, "Frequently Asked Questions", content.faq);
  }

  theme.addContactSlide(pptx, {
    preamble: content.connectPreamble || "",
    contacts: content.contacts || [],
    headline: "We'd welcome the opportunity to partner with you.",
    cta: `With appreciation, ${content.companyName || companyInfo.company_name || ""}`,
  });

  return pptx.write({ outputType: "nodebuffer" });
}

module.exports = { buildDeck };
