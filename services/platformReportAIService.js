// services/platformReportAIService.js
//
// AI-written commentary for platform analytics reports and pitch decks.
// Kept separate from services/reportAIService.js, which is scoped to
// class/student term reports — this file is scoped to platform-wide
// analytics (services/analyticsAggregationService.js output).
//
// Reuses the exact JSON-extraction pattern proven in reportAIService.js:
// prompt demands "Return ONLY JSON" -> strip ```json fences -> slice
// between first { and last } -> JSON.parse -> typed fallback on failure.

const { askTutor } = require("../utils/ai");

function parseJsonResponse(raw, fallback) {
  let cleaned = String(raw || "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end !== -1) {
    cleaned = cleaned.substring(start, end + 1);
  }

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    console.error("Platform report AI JSON parse failed:", err.message);
    console.error(cleaned);
    return { ...fallback, _parseError: err.message };
  }
}

// Trim each section's data down to what's worth spending prompt tokens on —
// full row-level lists (schools, transactions, activities, courses) get
// capped to a top-N slice rather than sent in full.
function summarizeSectionForAI(sectionName, data) {
  if (!data) return {};

  switch (sectionName) {
    case "overview":
      return data;

    case "business":
      return {
        totalRevenue: data.totalRevenue,
        schoolRevenue: data.schoolRevenue,
        parentRevenue: data.parentRevenue,
        eventRevenue: data.eventRevenue,
        eventRegistrations: data.eventRegistrations,
        schoolsFullyPaid: `${data.paidSchools} of ${data.totalSchoolsWithQuotes} schools with quotes`,
        termsPaid: data.paidTermsCount,
        outstandingBalance: data.outstandingBalance,
        incomeBreakdown: data.incomeBreakdown,
        topSchoolBalances: (data.schools || [])
          .slice()
          .sort((a, b) => Number(b.balance) - Number(a.balance))
          .slice(0, 5),
      };

    case "learning":
      return {
        totalCourses: data.totalCourses,
        totalModules: data.totalModules,
        totalLessons: data.totalLessons,
        periodEnrollments: data.periodEnrollments,
        periodCompletions: data.periodCompletions,
        topCoursesByEnrollment: (data.courses || []).slice(0, 5),
        bottomCoursesByCompletion: (data.courses || [])
          .slice()
          .sort((a, b) => a.moduleCompletion - b.moduleCompletion)
          .slice(0, 5),
      };

    case "schools": {
      const trendsWithPrev = (data.termTrends || []).filter((t) => t.prevStudents !== null);
      return {
        totalSchools: data.totalSchools,
        totalStudents: data.totalStudents,
        totalTeachers: data.totalTeachers,
        totalClassrooms: data.totalClassrooms,
        schoolsOnboardedInPeriod: data.schoolsOnboardedInPeriod,
        topSchoolsByStudents: (data.schools || [])
          .slice()
          .sort((a, b) => Number(b.students) - Number(a.students))
          .slice(0, 5),
        schoolsGrowingMostTermOverTerm: trendsWithPrev
          .slice()
          .sort((a, b) => b.changePct - a.changePct)
          .slice(0, 3)
          .map((t) => ({ school: t.schoolName, term: t.termName, changePct: t.changePct, retentionRate: t.retentionRate })),
        schoolsShrinkingMostTermOverTerm: trendsWithPrev
          .slice()
          .sort((a, b) => a.changePct - b.changePct)
          .filter((t) => t.changePct < 0)
          .slice(0, 3)
          .map((t) => ({ school: t.schoolName, term: t.termName, changePct: t.changePct, retentionRate: t.retentionRate })),
      };
    }

    case "finance":
      return {
        revenue: data.revenue,
        totalTransactions: data.totalTransactions,
        failedTransactions: data.failedTransactions,
        recentTransactions: (data.transactions || []).slice(0, 5),
      };

    case "engagement":
      return {
        dailyUsers: data.dailyUsers,
        weeklyUsers: data.weeklyUsers,
        completedLessons: data.completedLessons,
        aiQuestions: data.aiQuestions,
        totalActivities: data.totalActivities,
      };

    default:
      return data;
  }
}

const SECTION_FALLBACK = {
  summary: "AI commentary unavailable for this section.",
  insights: [],
  risks: [],
  recommendations: [],
};

async function generateSectionCommentary(sectionName, sectionData, periodLabel = "the selected period") {
  const summarized = summarizeSectionForAI(sectionName, sectionData);

  const prompt = `
You are a data analyst writing the "${sectionName}" section of a platform analytics report for an EdTech company, covering ${periodLabel}.

DATA:
${JSON.stringify(summarized, null, 2)}

Write a concise, professional analysis grounded strictly in the numbers above. Do not invent figures not present in the data. All monetary figures are in Nigerian Naira — always use the ₦ symbol, never $.

Return ONLY JSON in this exact shape:
{
  "summary": "",
  "insights": [],
  "risks": [],
  "recommendations": []
}
`;

  const result = await askTutor({ question: prompt, maxTokens: 900 });
  return parseJsonResponse(result, SECTION_FALLBACK);
}

async function generateExecutiveSummary(allSectionsData, periodLabel = "the selected period") {
  const compact = {};
  for (const [key, value] of Object.entries(allSectionsData || {})) {
    compact[key] = summarizeSectionForAI(key, value);
  }

  const prompt = `
You are a data analyst writing the executive summary of a platform-wide analytics report for an EdTech company, covering ${periodLabel}.

FULL PLATFORM DATA (all sections):
${JSON.stringify(compact, null, 2)}

Write a concise executive summary that synthesizes across all sections (users, business/revenue, learning, schools, finance, engagement) — call out the platform's overall trajectory, not just one section. All monetary figures are in Nigerian Naira — always use the ₦ symbol, never $.

Return ONLY JSON in this exact shape:
{
  "summary": "",
  "insights": [],
  "risks": [],
  "recommendations": []
}
`;

  const result = await askTutor({ question: prompt, maxTokens: 1000 });
  return parseJsonResponse(result, SECTION_FALLBACK);
}

const PITCH_DECK_SHAPES = {
  schools: {
    tagline: "",
    curriculumHighlights: [],
    outcomesSummary: "",
    onboardingSteps: [],
    testimonialAngle: "",
  },
  grants: {
    missionStatement: "",
    problemStatement: "",
    beneficiaryImpact: [],
    theoryOfChange: "",
    sustainabilityPlan: "",
  },
  investors: {
    tagline: "",
    tractionHighlights: [],
    marketOpportunity: "",
    businessModel: "",
    ask: "",
    useOfFunds: [],
  },
  partners: {
    mutualValueProps: [],
    integrationOverview: "",
    jointGoals: [],
    nextSteps: "",
  },
};

const AUDIENCE_PROMPT_FOCUS = {
  schools: "Convince a prospective partner school to adopt this platform for their students — lead with curriculum quality, learning outcomes, and how easy onboarding is.",
  grants: "Convince a grant committee to fund this platform's mission — lead with impact on beneficiaries (students), the underlying theory of change, and long-term sustainability, not revenue metrics.",
  investors: "Convince an investor to fund this platform — lead with traction, growth, revenue, market opportunity, and a clear funding ask.",
  partners: "Convince a potential business partner to collaborate — lead with mutual value, how integration would work, and shared goals.",
};

async function generatePitchDeckNarrative(audience, deckData) {
  const shape = PITCH_DECK_SHAPES[audience];
  if (!shape) {
    throw new Error(`Unknown pitch deck audience: ${audience}`);
  }

  const prompt = `
You are writing the narrative content for a pitch deck aimed at: ${audience}.

${AUDIENCE_PROMPT_FOCUS[audience]}

PLATFORM DATA (use only what's relevant and factual — do not invent numbers). All monetary figures are in Nigerian Naira — always use the ₦ symbol, never $.
${JSON.stringify(deckData, null, 2)}

Return ONLY JSON in this exact shape (fill every field, arrays should have 3-6 items each):
${JSON.stringify(shape, null, 2)}
`;

  const result = await askTutor({ question: prompt, maxTokens: 1500 });
  return parseJsonResponse(result, shape);
}

const PROPOSAL_DRAFT_SHAPE = {
  tagline: "",
  aboutUs: "",
  trackRecordQuote: "",
  programs: [{ title: "", description: "" }],
  programDeepDives: [{ title: "", description: "", specs: [{ label: "", value: "" }], features: [""] }],
  curriculumSteps: [{ title: "", description: "" }],
  benefits: [{ title: "", description: "" }],
  processSteps: [{ title: "", description: "" }],
  faq: [{ question: "", answer: "" }],
};

// Draft content for a partnership-proposal pitch deck (services/pitchDecks/proposalDeckTemplate.js).
// Unlike generatePitchDeckNarrative's 4 fixed audiences, this is a single
// flexible shape meant to be reviewed and edited by an admin before the
// final deck is built — see services/pitchDeckGeneratorService.js's
// generateProposalPreview()/buildProposalDeckFromContent() split. Pricing
// is deliberately NOT part of this shape — that's always admin-entered,
// never AI-guessed, since it's a real business decision.
async function generateProposalDraft({ recipientName, focusNotes, platformData }) {
  const prompt = `
You are writing the narrative content for a partnership proposal pitch deck that ${platformData.companyName || "this EdTech platform"} will send to a prospective partner${recipientName ? ` named "${recipientName}"` : ""}.

The goal is to make the reader genuinely excited to partner — professional, warm, and grounded in real numbers, not generic filler. Model the structure and tone on a well-produced partnership proposal: a confident "About Us", a track-record section backed by real stats, a clear breakdown of programs/offerings with concrete specifics (age range, format, frequency — invent reasonable, realistic operational specifics consistent with an EdTech coding/tech-skills platform for schools, since exact specifics aren't in the data below), a short curriculum/learning-path outline, a benefits section explaining why this matters for pupils, a numbered "how a partnership works" process, and an FAQ addressing likely objections a school would have.

${focusNotes ? `SPECIFIC FOCUS REQUESTED BY THE ADMIN PREPARING THIS PROPOSAL: ${focusNotes}` : ""}

REAL PLATFORM DATA (use these facts for anything you state as a statistic or track-record claim — do not invent numbers not present here):
${JSON.stringify(platformData, null, 2)}

Return ONLY JSON in this exact shape — "programs" should have 3-4 items, "programDeepDives" should cover 1-2 of the most important programs with 3-5 specs each and 3-5 features each, "curriculumSteps" should have exactly 3 items (a beginner/intermediate/advanced-style progression), "benefits" should have 5-6 items, "processSteps" should have 4-5 items, "faq" should have 5-6 items:
${JSON.stringify(PROPOSAL_DRAFT_SHAPE, null, 2)}
`;

  const result = await askTutor({ question: prompt, maxTokens: 3000 });
  return parseJsonResponse(result, PROPOSAL_DRAFT_SHAPE);
}

module.exports = {
  generateSectionCommentary,
  generateExecutiveSummary,
  generatePitchDeckNarrative,
  generateProposalDraft,
  summarizeSectionForAI,
};
