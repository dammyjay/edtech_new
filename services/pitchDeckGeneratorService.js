// services/pitchDeckGeneratorService.js
//
// Orchestrator for the 4 audience-specific pitch deck templates. Fetches
// the relevant analytics slice, generates the AI narrative for that
// audience (services/platformReportAIService.js), dispatches to the
// matching template (services/pitchDecks/*Template.js), and logs the run
// the same way services/reportOrchestratorService.js does for analytics
// reports.

const pool = require("../models/db");
const analyticsAggregationService = require("./analyticsAggregationService");
const platformReportAIService = require("./platformReportAIService");
const { getCompanyInfo } = require("../utils/companyInfo");

const schoolsDeckTemplate = require("./pitchDecks/schoolsDeckTemplate");
const grantsDeckTemplate = require("./pitchDecks/grantsDeckTemplate");
const investorsDeckTemplate = require("./pitchDecks/investorsDeckTemplate");
const partnersDeckTemplate = require("./pitchDecks/partnersDeckTemplate");
const proposalDeckTemplate = require("./pitchDecks/proposalDeckTemplate");

const TEMPLATES = {
  schools: schoolsDeckTemplate,
  grants: grantsDeckTemplate,
  investors: investorsDeckTemplate,
  partners: partnersDeckTemplate,
};

async function logPitchDeckGeneration({ audience, triggeredByUserId, status, errorMessage }) {
  try {
    await pool.query(
      `
      INSERT INTO report_generation_log
        (report_type, scope, period_label, formats_generated, audience, triggered_by, triggered_by_user_id, status, error_message)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      ["pitch_deck", "on_demand", null, ["pptx"], audience, "admin", triggeredByUserId || null, status, errorMessage || null]
    );
  } catch (err) {
    console.error("Failed to write report_generation_log for pitch deck:", err.message);
  }
}

async function generatePitchDeck(audience, { triggeredByUserId } = {}) {
  const template = TEMPLATES[audience];
  if (!template) {
    throw new Error(`Unknown pitch deck audience: ${audience}`);
  }

  try {
    const [overview, schools, learning, business, companyInfo] = await Promise.all([
      analyticsAggregationService.getOverviewAnalytics(null),
      analyticsAggregationService.getSchoolsAnalytics(null),
      analyticsAggregationService.getLearningAnalytics(null),
      analyticsAggregationService.getBusinessAnalytics({}),
      getCompanyInfo(),
    ]);

    const platformData = { overview, schools, learning, business };

    if (audience === "investors") {
      platformData.revenueTrend = await analyticsAggregationService.getMonthlyRevenueTrend(12);
    }

    const narrative = await platformReportAIService.generatePitchDeckNarrative(audience, platformData);
    const buffer = await template.buildDeck(platformData, narrative, companyInfo);

    await logPitchDeckGeneration({ audience, triggeredByUserId, status: "success" });

    return {
      buffer,
      filename: `pitch-deck-${audience}.pptx`,
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    };
  } catch (err) {
    await logPitchDeckGeneration({ audience, triggeredByUserId, status: "error", errorMessage: err.message });
    throw err;
  }
}

// ---------------------------------------------------------------------
// Partnership proposal — a two-step flow, unlike the one-shot decks above:
// 1. generateProposalPreview() fetches real platform data + an AI draft
//    and returns it as plain JSON (no file built yet) so the admin can
//    review/edit it in the dashboard.
// 2. buildProposalDeckFromContent() takes whatever content the admin
//    actually approved (edits included) and renders the final .pptx from
//    exactly that — no AI call here, so downloading never silently
//    diverges from what was previewed.
// ---------------------------------------------------------------------

async function getProposalPlatformData() {
  const [overview, schools, learning, courses] = await Promise.all([
    analyticsAggregationService.getOverviewAnalytics(null),
    analyticsAggregationService.getSchoolsAnalytics(null),
    analyticsAggregationService.getLearningAnalytics(null),
    pool.query(`
      SELECT title, description, level
      FROM courses
      ORDER BY sort_order, id
      LIMIT 12
    `),
  ]);

  return {
    totalUsers: overview.totalUsers,
    totalSchools: schools.totalSchools,
    totalStudents: schools.totalStudents,
    totalTeachers: schools.totalTeachers,
    totalCourses: learning.totalCourses,
    certificatesIssued: overview.certificatesIssued,
    avgQuizScore: overview.avgQuizScore,
    courseCatalog: courses.rows,
  };
}

async function generateProposalPreview({ recipientName, focusNotes, triggeredByUserId } = {}) {
  const [platformData, companyInfo] = await Promise.all([
    getProposalPlatformData(),
    getCompanyInfo(),
  ]);

  const draft = await platformReportAIService.generateProposalDraft({
    recipientName,
    focusNotes,
    platformData: { ...platformData, companyName: companyInfo.company_name },
  });

  return {
    recipientName: recipientName || "",
    companyName: companyInfo.company_name || "",
    tagline: draft.tagline || "",
    aboutUs: draft.aboutUs || "",
    trackRecordStats: [
      { label: "Partner Schools", value: String(platformData.totalSchools) },
      { label: "Students Reached", value: String(platformData.totalStudents) },
      { label: "Certificates Issued", value: String(platformData.certificatesIssued) },
    ],
    trackRecordQuote: draft.trackRecordQuote || "",
    programs: draft.programs || [],
    programDeepDives: draft.programDeepDives || [],
    curriculumSteps: draft.curriculumSteps || [],
    benefits: draft.benefits || [],
    processSteps: draft.processSteps || [],
    faq: draft.faq || [],
    pricing: {
      amount: "PER PUPIL",
      price: "",
      unit: "per term",
      note2: "",
      includes: [],
      note: "",
    },
    contacts: [],
    connectPreamble: "",
  };
}

async function buildProposalDeckFromContent(content, { triggeredByUserId } = {}) {
  try {
    const companyInfo = await getCompanyInfo();
    const buffer = await proposalDeckTemplate.buildDeck(content, companyInfo);

    await logPitchDeckGeneration({ audience: "proposal", triggeredByUserId, status: "success" });

    return {
      buffer,
      filename: `partnership-proposal-${(content.recipientName || "draft").replace(/[^\w-]+/g, "_")}.pptx`,
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    };
  } catch (err) {
    await logPitchDeckGeneration({ audience: "proposal", triggeredByUserId, status: "error", errorMessage: err.message });
    throw err;
  }
}

module.exports = {
  generatePitchDeck,
  generateProposalPreview,
  buildProposalDeckFromContent,
};
