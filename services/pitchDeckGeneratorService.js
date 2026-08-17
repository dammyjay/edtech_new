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

module.exports = { generatePitchDeck };
