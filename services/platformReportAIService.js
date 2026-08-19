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
  curriculumIntro: "",
  careerPathwayIntro: "",
  competitionsExhibitions: "",
  benefits: [{ title: "", description: "" }],
  processSteps: [{ title: "", description: "" }],
  faq: [{ question: "", answer: "" }],
};

// Real operational facts about the platform, not derivable from the
// database — ground the AI in what the platform actually does instead of
// letting it invent generic EdTech filler. Kept as one block so every
// audience's proposal draws from the same accurate source, not
// per-audience guesses that could drift or contradict each other.
const PLATFORM_CAPABILITIES = `
- In-school teaching runs once per week per class/cohort.
- Students are prepared for project showcases, both internal (within the school) and external (inter-school/public).
- Students are also prepared for relevant coding/tech competitions as they become available.
- Progress system: students earn badges for completing modules and points for finishing lessons; points feed into an awards/leaderboard system recognizing top performers.
- The platform is multi-stakeholder, not just student-facing:
  - School admins can monitor enrollment, class progress, student progress, attendance, activity logs, and per-term reports for their school.
  - Teachers can monitor their students' progress and identify who is excelling versus who needs extra support.
  - Parents can monitor their own children's progress from their own account.
  - All stakeholders (school admin, teacher, parent) receive reminders where relevant, and certificates are issued when a student completes a course.
  - Students can download their own progress as a report card, or export it as a CV/portfolio document showcasing their skills and completed courses.
- The platform includes an AI-assisted learning feature (an AI tutor students can ask questions to while learning).
`.trim();

const PROPOSAL_AUDIENCE_FOCUS = {
  schools: "This proposal is for a prospective PARTNER SCHOOL deciding whether to adopt this platform for their pupils. Lead with curriculum quality, learning outcomes, ease of onboarding, and how it fits into the school's existing timetable and reporting needs.",
  grants: "This proposal is for a GRANT COMMITTEE deciding whether to fund this platform's mission. Lead with impact on beneficiaries (students, especially from under-resourced schools), the underlying theory of change, and long-term sustainability — de-emphasize revenue/pricing framing in favor of mission and reach.",
  investors: "This proposal is for a prospective INVESTOR deciding whether to fund this platform. Lead with traction, growth, the real revenue/usage numbers provided, market opportunity, and a clear, confident funding ask.",
  partners: "This proposal is for a prospective BUSINESS/STRATEGIC PARTNER (not a school directly) deciding whether to collaborate. Lead with mutual value, how the partnership/integration would work operationally, and shared goals.",
};

// Section 11's framing changes by audience — schools/partners is literally
// a price list, investors want a funding ask, grants want a funding
// request tied to impact. The admin still fills in every number
// themselves (see buildProposalDeckFromContent) — this only affects the
// wording the AI drafts around that section, and the slide's own title.
const INVESTMENT_SECTION_TITLE = {
  schools: "Investment",
  partners: "Partnership Terms",
  investors: "The Ask",
  grants: "Funding Request",
};

// Draft content for a partnership-proposal pitch deck
// (services/pitchDecks/proposalDeckTemplate.js), shared across all 4
// audiences (schools/grants/investors/partners) — unlike the older fixed
// generatePitchDeckNarrative() shapes, this is one flexible structure
// meant to be reviewed and edited by an admin before the final deck is
// built (see services/pitchDeckGeneratorService.js's
// generateProposalPreview()/buildProposalDeckFromContent() split).
// Pricing/ask numbers are deliberately NOT part of this shape — always
// admin-entered, never AI-guessed, since it's a real business decision.
async function generateProposalDraft({ audience = "schools", recipientName, focusNotes, platformData }) {
  const focus = PROPOSAL_AUDIENCE_FOCUS[audience] || PROPOSAL_AUDIENCE_FOCUS.schools;
  const investmentTitle = INVESTMENT_SECTION_TITLE[audience] || INVESTMENT_SECTION_TITLE.schools;

  const prompt = `
You are writing the narrative content for a partnership proposal pitch deck that ${platformData.companyName || "this EdTech platform"} will send to a prospective partner${recipientName ? ` named "${recipientName}"` : ""}.

${focus}

The goal is to make the reader genuinely excited — professional, warm, and grounded in real facts, not generic filler. Model the structure and tone on a well-produced partnership proposal: a confident "About Us", a track-record section backed by real stats, a clear breakdown of programs/offerings, a benefits section, a numbered "how it works" process, and an FAQ addressing likely objections. The deck's pricing/ask section will be titled "${investmentTitle}" — you are not writing that section's numbers, but keep your other sections' framing consistent with it (e.g. don't call it "tuition fees" if this is an investor deck).

The deck also has a "The Curriculum" section and a "Career Pathways" section, but their actual course/pathway cards are built directly from real database records the admin selects afterward, not from anything you write — your only job for those two sections is a short (2-4 sentence) framing paragraph each: "curriculumIntro" introduces the curriculum section (e.g. what kind of learning progression it represents), and "careerPathwayIntro" makes the case for WHY building toward a real career pathway matters — the purpose of preparing a learner who can go on to build an actual career in that field, not just complete a course. Use the real course/pathway titles listed in the platform data below where it reads naturally, but do not invent specific curriculum steps or pathway details — those come from the real records.

There's also an optional "competitionsExhibitions" paragraph (2-4 sentences) — how the platform prepares students for project showcases (internal and external) and relevant coding/tech competitions as they become available (see REAL PLATFORM CAPABILITIES below). This whole section is optional in the final deck (the admin can clear it), so write it as a genuine selling point, not a filler afterthought.

REAL PLATFORM CAPABILITIES (use these facts directly — this is what the platform genuinely does, weave the relevant ones into programs/benefits/curriculum/FAQ rather than inventing different features):
${PLATFORM_CAPABILITIES}

${focusNotes ? `SPECIFIC FOCUS REQUESTED BY THE ADMIN PREPARING THIS PROPOSAL: ${focusNotes}` : ""}

REAL PLATFORM DATA (use these facts for anything you state as a statistic or track-record claim — do not invent numbers not present here):
${JSON.stringify(platformData, null, 2)}

Return ONLY JSON in this exact shape — "programs" should have 3-4 items, "programDeepDives" should cover 1-2 of the most important programs with 3-5 specs each and 3-5 features each, "curriculumIntro", "careerPathwayIntro" and "competitionsExhibitions" should each be one short paragraph (2-4 sentences), "benefits" should have 5-6 items, "processSteps" should have 4-5 items, "faq" should have 5-6 items:
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
  INVESTMENT_SECTION_TITLE,
};
