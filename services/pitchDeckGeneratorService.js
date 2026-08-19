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
const deckTheme = require("./pitchDecks/deckTheme");

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
  const [overview, schools, learning, courses, careerPathways] = await Promise.all([
    analyticsAggregationService.getOverviewAnalytics(null),
    analyticsAggregationService.getSchoolsAnalytics(null),
    analyticsAggregationService.getLearningAnalytics(null),
    pool.query(`
      SELECT title, description, level
      FROM courses
      ORDER BY sort_order, id
      LIMIT 12
    `),
    pool.query(`
      SELECT title, description, target_audience
      FROM career_pathways
      ORDER BY id
      LIMIT 10
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
    careerPathwayCatalog: careerPathways.rows,
  };
}

// Full-detail catalogs for the admin picker UI (ids, thumbnails, all
// pathway fields) — kept separate from getProposalPlatformData() above,
// which stays lean since that one gets dumped straight into the AI
// prompt and extra fields there would just be wasted tokens.
async function getCurriculumPickerAssets() {
  const [courses, pathways, schools] = await Promise.all([
    pool.query(`
      SELECT id, title, description, thumbnail_url, level, career_pathway_id
      FROM courses
      ORDER BY sort_order, id
    `),
    pool.query(`
      SELECT id, title, description, thumbnail_url, target_audience, expected_outcomes, duration_estimate
      FROM career_pathways
      ORDER BY id
    `),
    // Excludes schools falling back to the generic default-school.png
    // placeholder (see controllers/userController.js) — that isn't a real
    // partner logo, and showing it in a "Schools We Partner With" wall
    // would defeat the point of the section.
    pool.query(`
      SELECT id, name, logo_url
      FROM schools
      WHERE logo_url IS NOT NULL AND logo_url <> '' AND logo_url NOT LIKE '%default-school%'
      ORDER BY name
    `),
  ]);

  return {
    courses: courses.rows,
    careerPathways: pathways.rows,
    partnerSchools: schools.rows,
  };
}

// ---------------------------------------------------------------------
// Gallery image matching — the platform's photos aren't tagged by "what
// kind of moment" (existing categories are mostly school/event names like
// "Vistan School", "Exhibition"), so this does best-effort keyword
// matching against title + category text rather than a clean lookup. It
// only ever SUGGESTS images (surfaced as editable dropdowns in the admin
// UI, see views/admin/dashboard.ejs) — never silently forces a bad match
// into the deck, since a wrong photo would look worse than no photo.
// ---------------------------------------------------------------------

const IMAGE_TAXONOMY = {
  classroom: ["class", "classroom", "lesson", "teaching", "activities", "activity"],
  project: ["project", "algorithm", "circuit", "robot", "app", "build", "demo", "code", "coding"],
  competition: ["competition", "showcase", "exhibition", "contest"],
  certificate: ["certificate", "award", "graduation", "medal"],
  group: ["group", "team", "cohort", "upper class", "senior class"],
  teacherTraining: ["teacher training", "instructor training", "training session"],
};

async function getGalleryImages() {
  const result = await pool.query(`
    SELECT gi.id, gi.title, gi.image_url, gc.name AS category
    FROM gallery_images gi
    LEFT JOIN gallery_categories gc ON gc.id = gi.category_id
    ORDER BY gi.uploaded_at DESC
  `);
  return result.rows;
}

function scoreGalleryImage(image, keywords, recipientName) {
  const haystack = `${image.title || ""} ${image.category || ""}`.toLowerCase();
  let score = 0;
  keywords.forEach((kw) => { if (haystack.includes(kw)) score += 1; });
  if (recipientName && haystack.includes(recipientName.toLowerCase())) score += 5;
  return score;
}

function pickBestGalleryImage(images, keywords, recipientName, usedIds) {
  let best = null;
  let bestScore = 0;
  for (const img of images) {
    if (usedIds.has(img.id)) continue;
    const score = scoreGalleryImage(img, keywords, recipientName);
    if (score > bestScore) {
      best = img;
      bestScore = score;
    }
  }
  return best;
}

// Suggests one photo per slot — About Us (classroom scene), Track Record
// (competition/showcase/certificate moment, falling back to a project
// photo), and a closing highlight (group/team photo, falling back to
// another classroom shot). Each slot avoids reusing an image already
// picked for an earlier slot. Returns null for a slot with no reasonable
// match rather than guessing.
async function suggestProposalImages({ recipientName } = {}) {
  const images = await getGalleryImages();
  const usedIds = new Set();

  const aboutUs = pickBestGalleryImage(images, IMAGE_TAXONOMY.classroom, recipientName, usedIds);
  if (aboutUs) usedIds.add(aboutUs.id);

  const trackRecord =
    pickBestGalleryImage(images, [...IMAGE_TAXONOMY.competition, ...IMAGE_TAXONOMY.certificate], recipientName, usedIds) ||
    pickBestGalleryImage(images, IMAGE_TAXONOMY.project, recipientName, usedIds);
  if (trackRecord) usedIds.add(trackRecord.id);

  const closingHighlight =
    pickBestGalleryImage(images, IMAGE_TAXONOMY.group, recipientName, usedIds) ||
    pickBestGalleryImage(images, IMAGE_TAXONOMY.classroom, recipientName, usedIds);
  if (closingHighlight) usedIds.add(closingHighlight.id);

  return {
    aboutUs: aboutUs ? aboutUs.image_url : null,
    trackRecord: trackRecord ? trackRecord.image_url : null,
    closingHighlight: closingHighlight ? closingHighlight.image_url : null,
  };
}

const VALID_PROPOSAL_AUDIENCES = ["schools", "grants", "investors", "partners"];

// Contact links aren't in company_info (no phone/social columns there) —
// they're literal values already hardcoded in the site footer
// (views/partials/footer.ejs / userFooter.ejs). Mirroring those same real
// values here means a proposal starts pre-filled with what's already
// public on the platform, rather than an empty form the admin has to fill
// from scratch every time — they can still edit/remove any of these.
function getDefaultProposalContacts(companyInfo) {
  return [
    { label: "Email", value: "jaykirchtechhub@gmail.com" },
    { label: "WhatsApp", value: "https://wa.link/wv7jtg" },
    { label: "Instagram", value: "https://instagram.com/jkt_hub" },
  ];
}

const PROCESS_TITLE = {
  schools: "How a Partnership Works",
  partners: "How a Partnership Works",
  investors: "How We'll Work Together",
  grants: "How the Funding Would Be Used",
};

const PROGRAMS_INTRO = {
  schools: "Ways your school can work with us — pick one, or combine them into a full partnership.",
  partners: "Ways we can work together — pick one, or combine them into a full partnership.",
  investors: "What the platform currently offers and where growth is focused.",
  grants: "Programs this funding would directly support.",
};

const CLOSING_HEADLINE = {
  schools: "We'd welcome the opportunity to partner with your school.",
  partners: "We'd welcome the opportunity to explore this partnership.",
  investors: "We'd welcome the opportunity to discuss this further.",
  grants: "We'd welcome the opportunity to discuss this funding opportunity.",
};

async function generateProposalPreview({ audience = "schools", recipientName, focusNotes, triggeredByUserId } = {}) {
  if (!VALID_PROPOSAL_AUDIENCES.includes(audience)) {
    throw new Error(`Unknown proposal audience: ${audience}`);
  }

  const [platformData, companyInfo] = await Promise.all([
    getProposalPlatformData(),
    getCompanyInfo(),
  ]);

  const [draft, images] = await Promise.all([
    platformReportAIService.generateProposalDraft({
      audience,
      recipientName,
      focusNotes,
      platformData: { ...platformData, companyName: companyInfo.company_name },
    }),
    suggestProposalImages({ recipientName }),
  ]);

  return {
    audience,
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
    programsIntro: PROGRAMS_INTRO[audience],
    programDeepDives: draft.programDeepDives || [],
    curriculum: { intro: draft.curriculumIntro || "", courses: [], layout: "threePerSlide" },
    careerPathways: { intro: draft.careerPathwayIntro || "", pathways: [] },
    partnerSchoolLogos: [],
    competitionsExhibitions: draft.competitionsExhibitions || "",
    benefits: draft.benefits || [],
    processSteps: draft.processSteps || [],
    processTitle: PROCESS_TITLE[audience],
    faq: draft.faq || [],
    investmentTitle: platformReportAIService.INVESTMENT_SECTION_TITLE[audience],
    pricing: {
      amount: audience === "investors" ? "FUNDING SOUGHT" : audience === "grants" ? "REQUESTED AMOUNT" : "PER PUPIL",
      price: "",
      unit: audience === "investors" || audience === "grants" ? "one-time / as agreed" : "per term",
      note2: "",
      includes: [],
      note: "",
    },
    contacts: getDefaultProposalContacts(companyInfo),
    connectPreamble: "",
    closingHeadline: CLOSING_HEADLINE[audience],
    template: deckTheme.DEFAULT_TEMPLATE_KEY,
    images,
  };
}

async function buildProposalDeckFromContent(content, { triggeredByUserId } = {}) {
  const audience = VALID_PROPOSAL_AUDIENCES.includes(content.audience) ? content.audience : "schools";

  try {
    const companyInfo = await getCompanyInfo();
    const buffer = await proposalDeckTemplate.buildDeck(content, companyInfo);

    await logPitchDeckGeneration({ audience: `proposal-${audience}`, triggeredByUserId, status: "success" });

    return {
      buffer,
      filename: `partnership-proposal-${audience}-${(content.recipientName || "draft").replace(/[^\w-]+/g, "_")}.pptx`,
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    };
  } catch (err) {
    await logPitchDeckGeneration({ audience: `proposal-${audience}`, triggeredByUserId, status: "error", errorMessage: err.message });
    throw err;
  }
}

module.exports = {
  generatePitchDeck,
  generateProposalPreview,
  buildProposalDeckFromContent,
  getGalleryImages,
  getCurriculumPickerAssets,
};
