// services/pitchDecks/proposalDeckTemplate.js
//
// Partnership proposal deck — structurally modeled on a real reference
// proposal the admin shared (cover -> agenda -> about -> track record ->
// programs -> deep dives -> curriculum -> benefits -> how-it-works ->
// pricing -> FAQ -> contact -> [optional appendix]). Unlike the 4
// fixed-audience decks (schools/grants/investors/partners), this one is
// built from a `content` object that started as an AI draft but may have
// been reviewed and edited by an admin in the preview step before this
// ever runs — see services/pitchDeckGeneratorService.js. This file does
// no AI calls and makes no database calls; it just renders whatever
// content it's given.

const theme = require("./deckTheme");

// content: { recipientName, tagline, aboutUs, trackRecordStats, trackRecordQuote,
//   programs, programDeepDives, benefits, processSteps, pricing, faq, contacts,
//   images: { aboutUs, trackRecord, closingHighlight } (single-photo slots, URLs or null),
//   galleryPhotos: [{ url, caption }] (optional "Photo Gallery" grid section in the body),
//   appendixPhotos: [{ url, caption }] (optional evidence appendix at the end),
//   appendixLayout: 'grid' | 'twoPerSlide' (default 'grid'),
//   partnerSchoolLogos: [{ name, logoUrl }] (optional "Schools We Partner
//     With" logo wall, real schools.logo_url rows the admin picks),
//   competitionsExhibitions (optional AI-drafted paragraph, cleared = section
//     omitted),
//   curriculum: { intro (AI-drafted framing paragraph), courses: [{ title,
//     description, thumbnailUrl }], layout: 'threePerSlide' | 'twoPerSlide'
//     (default 'threePerSlide') } (real courses.* rows the admin picks —
//     not AI-invented steps),
//   careerPathways: { intro (AI-drafted "why a real career path matters"
//     paragraph), pathways: [{ title, description, targetAudience,
//     durationEstimate, expectedOutcomes (newline-separated string),
//     thumbnailUrl }] } (real career_pathways rows the admin picks),
//   template: one of theme.TEMPLATE_OPTIONS' keys (default 'heritageGold') —
//     selects the deck's whole visual identity (colors + slide composition),
//     see deckTheme.js's THEMES }
// companyInfo: { company_name, logo_url }
// Every photo/logo/course/pathway slot may be empty (nothing picked) —
// that whole section is simply omitted rather than leaving a broken slide.
async function buildDeck(content, companyInfo) {
  const pptx = theme.newDeck(companyInfo, content.template);

  // Every photo used anywhere in the deck gets resolved (real dimensions
  // fetched, Cloudinary-optimized) exactly once up front, in parallel —
  // this is what actually fixes cover-crop-vs-stretch (see deckTheme.js's
  // resolvePhoto/addCoverImage) and avoids re-fetching the same image
  // twice if it's reused across slots.
  const images = content.images || {};
  const galleryPhotos = content.galleryPhotos || [];
  const appendixPhotos = content.appendixPhotos || [];
  const curriculum = content.curriculum || {};
  const careerPathways = content.careerPathways || {};
  const partnerSchoolLogos = content.partnerSchoolLogos || [];

  const [
    aboutUsPhoto, trackRecordPhoto, closingPhoto,
    resolvedGalleryPhotos, resolvedAppendixPhotos,
    resolvedCourses, resolvedPathways, resolvedPartnerLogos,
  ] = await Promise.all([
    theme.resolvePhoto(images.aboutUs),
    theme.resolvePhoto(images.trackRecord),
    theme.resolvePhoto(images.closingHighlight),
    Promise.all(galleryPhotos.map(async (p) => {
      const resolved = await theme.resolvePhoto(p.url);
      return resolved ? { ...resolved, caption: p.caption || "" } : null;
    })),
    Promise.all(appendixPhotos.map(async (p) => {
      const resolved = await theme.resolvePhoto(p.url);
      return resolved ? { ...resolved, caption: p.caption || "" } : null;
    })),
    // course.description / pathway.description / .targetAudience /
    // .expectedOutcomes are authored via CKEditor in the admin UI and
    // stored as HTML, not plain text — stripHtmlToText/Lines convert them
    // to what pptxgenjs's text options actually expect (see deckTheme.js).
    Promise.all((curriculum.courses || []).map(async (c) => ({
      title: c.title || "",
      description: theme.stripHtmlToText(c.description),
      thumbnail: await theme.resolvePhoto(c.thumbnailUrl),
    }))),
    Promise.all((careerPathways.pathways || []).map(async (p) => ({
      title: p.title || "",
      description: theme.stripHtmlToText(p.description),
      targetAudience: theme.stripHtmlToText(p.targetAudience),
      durationEstimate: p.durationEstimate || "",
      expectedOutcomes: theme.stripHtmlToLines(p.expectedOutcomes),
      thumbnail: await theme.resolvePhoto(p.thumbnailUrl),
    }))),
    Promise.all(partnerSchoolLogos.map(async (l) => {
      const resolved = await theme.resolveLogo(l.logoUrl);
      return resolved ? { ...resolved, caption: l.name || "" } : null;
    })),
  ]);

  theme.addTitleSlide(pptx, {
    title: "Partnership Proposal",
    subtitle: content.tagline || `Prepared for ${content.recipientName || "Your School"}`,
  });

  const investmentTitle = content.investmentTitle || "Investment";
  const processTitle = content.processTitle || "How a Partnership Works";
  const hasAppendix = resolvedAppendixPhotos.filter(Boolean).length > 0;
  const hasPartnerLogos = resolvedPartnerLogos.filter(Boolean).length > 0;
  const hasCurriculum = resolvedCourses.length > 0;
  const hasCareerPathways = resolvedPathways.length > 0;
  const hasCompetitions = !!content.competitionsExhibitions;

  theme.addTocSlide(pptx, "Agenda", [
    "About Us",
    "Our Track Record",
    ...(hasPartnerLogos ? ["Schools We Partner With"] : []),
    "Our Programs",
    "Program Deep Dive",
    ...(hasCurriculum ? ["The Curriculum"] : []),
    ...(hasCareerPathways ? ["Career Pathways"] : []),
    ...(hasCompetitions ? ["Competitions & Exhibitions"] : []),
    "Why It Matters",
    processTitle,
    investmentTitle,
    "Frequently Asked Questions",
    "Let's Connect",
    ...(hasAppendix ? ["Appendix — Photo Evidence"] : []),
  ]);

  theme.addParagraphSlide(pptx, "About Us", content.aboutUs || "", {
    quote: null,
    photo: aboutUsPhoto,
  });

  if ((content.trackRecordStats || []).length) {
    theme.addStatSlide(pptx, "Our Track Record", content.trackRecordStats);
  }
  if (content.trackRecordQuote) {
    theme.addParagraphSlide(pptx, "Our Track Record", content.trackRecordQuote, { quote: content.trackRecordQuote });
  }
  if (trackRecordPhoto) {
    theme.addImageHighlightSlide(pptx, "Our Track Record", trackRecordPhoto, "");
  }

  if (hasPartnerLogos) {
    theme.addLogoWallSlide(pptx, "Schools We Partner With", resolvedPartnerLogos);
  }

  if ((content.programs || []).length) {
    theme.addFeatureGridSlide(pptx, "Our Programs", content.programs, content.programsIntro || "");
  }

  (content.programDeepDives || []).forEach((program) => {
    theme.addSpecTableSlide(pptx, program.title, program.description, program.specs || [], program.features || []);
  });

  if (hasCurriculum) {
    const curriculumColumns = curriculum.layout === "twoPerSlide" ? 2 : 3;
    theme.addCourseCardSlides(pptx, "The Curriculum", curriculum.intro || "", resolvedCourses, { columns: curriculumColumns });
  }

  if (hasCareerPathways) {
    theme.addPathwaySlides(pptx, "Career Pathways", careerPathways.intro || "", resolvedPathways);
  }

  if (content.competitionsExhibitions) {
    theme.addParagraphSlide(pptx, "Competitions & Exhibitions", content.competitionsExhibitions, { quote: null, photo: null });
  }

  if ((content.benefits || []).length) {
    theme.addFeatureGridSlide(pptx, "Why It Matters", content.benefits);
  }

  // A general "Photo Gallery" section in the body — distinct from the
  // Appendix below: this is a handful of representative photos woven into
  // the narrative flow, while the appendix is meant to be exhaustive
  // evidence at the end.
  if (resolvedGalleryPhotos.filter(Boolean).length) {
    theme.addPhotoGridSlides(pptx, "Photo Gallery", resolvedGalleryPhotos, { columns: 3, rows: 2 });
  }

  if ((content.processSteps || []).length) {
    theme.addProcessSlide(pptx, processTitle, content.processSteps);
  }

  if (content.pricing) {
    theme.addPricingSlide(pptx, investmentTitle, content.pricing);
  }

  if ((content.faq || []).length) {
    theme.addFaqSlides(pptx, "Frequently Asked Questions", content.faq);
  }

  if (closingPhoto) {
    theme.addImageHighlightSlide(pptx, "Join Our Learning Community", closingPhoto, "");
  }

  theme.addContactSlide(pptx, {
    preamble: content.connectPreamble || "",
    contacts: content.contacts || [],
    headline: content.closingHeadline || "We'd welcome the opportunity to work with you.",
    cta: `With appreciation, ${content.companyName || companyInfo.company_name || ""}`,
  });

  if (hasAppendix) {
    const layout = content.appendixLayout === "twoPerSlide" ? { columns: 2, rows: 1 } : { columns: 3, rows: 2 };
    theme.addPhotoGridSlides(pptx, "Appendix — Photo Evidence", resolvedAppendixPhotos, layout);
  }

  return pptx.write({ outputType: "nodebuffer" });
}

module.exports = { buildDeck };
