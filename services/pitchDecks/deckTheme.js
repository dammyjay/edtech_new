// services/pitchDecks/deckTheme.js
//
// Shared visual design system for every generated .pptx — both the 4
// pitch deck templates and the platform analytics report deck
// (services/reportPptxService.js) build on these primitives, so a single
// design pass here upgrades every deck consistently. This is the
// "consistent branding, distinct structure" split: templates decide slide
// sequence and content, this file decides what everything looks like.
//
// TEMPLATES: the Partnership Proposal deck (services/pitchDecks/proposalDeckTemplate.js)
// additionally supports 4 selectable visual templates — same brand colors
// (gold/dark-brown/cream) as the anchor, each with its own accent color and
// slide composition (card-based, hairline-minimal, diagonal color-block,
// organic-rounded). newDeck(companyInfo, templateKey) resolves one of the
// THEMES below and stores it on the pptx instance as `pptx.__theme`; every
// slide-builder function below reads its colors/fonts/style from
// `pptx.__theme` instead of a hardcoded constant. Callers that don't pass a
// templateKey (the 4 audience decks, the analytics report deck) get
// "heritageGold" by default, which is pixel-identical to this file's
// original single design — so this is additive, not a visual regression
// for any existing caller.

const pptxgen = require("pptxgenjs");
const { getImageDimensions } = require("./imageDimensions");

// Kept exported as bare constants (unchanged values) for any direct
// references elsewhere in the codebase (e.g. investorsDeckTemplate.js
// reads theme.BRAND_GOLD directly) — these match THEMES.heritageGold below.
const BRAND_GOLD = "A17807";
const BRAND_GOLD_LIGHT = "D9A73B";
const BRAND_GOLD_PALE = "F6ECD6";
const BRAND_DARK = "2B2110";
const TEXT_DARK = "3A2F1D";
const TEXT_MUTED = "8A7A5C";
const BG_CREAM = "FFFDF7";
const WHITE = "FFFFFF";
const ACCENT_GREEN = "2E7D4F";
const ACCENT_RED = "B23B3B";

const CARD_SHADOW = { type: "outer", color: "3A2F1D", blur: 6, offset: 3, angle: 90, opacity: 0.18 };

// --- Template registry -----------------------------------------------
// Every theme is built from the same real brand palette (gold #A17807 /
// dark brown #2B2110 / cream), pulled from the live site's own CSS
// (public/css/style.css --brand-pri / --brand-tint) — only `style` (which
// changes slide composition, not just color) and one small accent color
// actually differ between templates, so the four read as one brand family
// rather than four unrelated identities.
const THEMES = {
  heritageGold: {
    key: "heritageGold",
    label: "Heritage Gold",
    description: "Warm and institutional — cards, soft shadows, a serif hand for titles.",
    style: "card",
    bg: BG_CREAM,
    panel: WHITE,
    ink: BRAND_DARK,
    muted: TEXT_MUTED,
    accent: BRAND_GOLD,
    accentLight: BRAND_GOLD_LIGHT,
    accentPale: BRAND_GOLD_PALE,
    accent2: BRAND_GOLD,
    accent3: BRAND_GOLD,
    line: "EBDFC0",
    white: WHITE,
    displayFont: "Georgia",
    bodyFont: "Calibri",
    radius: 0.08,
    shadow: true,
  },
  slateEditorial: {
    key: "slateEditorial",
    label: "Slate Editorial",
    description: "No shadows or card fills — thin rules and whitespace carry the page.",
    style: "flat",
    bg: "FBF3DD",
    panel: "FBF3DD",
    ink: BRAND_DARK,
    muted: TEXT_MUTED,
    accent: BRAND_GOLD,
    accentLight: BRAND_GOLD_LIGHT,
    accentPale: BRAND_GOLD_PALE,
    accent2: "3B5A6B",
    accent3: "3B5A6B",
    line: "E3D6B8",
    white: WHITE,
    displayFont: "Arial",
    bodyFont: "Calibri",
    radius: 0,
    shadow: false,
  },
  signalBlock: {
    key: "signalBlock",
    label: "Signal Block",
    description: "High-contrast dark/gold color-blocking with a rust-red pop for numbers.",
    style: "block",
    bg: "FBF3DD",
    panel: "FBF3DD",
    ink: BRAND_DARK,
    muted: TEXT_MUTED,
    accent: BRAND_GOLD,
    accentLight: BRAND_GOLD_LIGHT,
    accentPale: BRAND_GOLD_PALE,
    accent2: "C1502E",
    accent3: "C1502E",
    line: "E3D6B8",
    white: WHITE,
    displayFont: "Arial Black",
    bodyFont: "Calibri",
    radius: 0.03,
    shadow: false,
  },
  sunnyStudio: {
    key: "sunnyStudio",
    label: "Sunny Studio",
    description: "Rounded, organic accents — the most approachable option.",
    style: "organic",
    bg: "FBF3DD",
    panel: WHITE,
    ink: BRAND_DARK,
    muted: TEXT_MUTED,
    accent: BRAND_GOLD,
    accentLight: BRAND_GOLD_LIGHT,
    accentPale: BRAND_GOLD_PALE,
    accent2: "E8724F",
    accent3: "5C8A94",
    line: "F0E4C4",
    white: WHITE,
    displayFont: "Trebuchet MS",
    bodyFont: "Calibri",
    radius: 0.22,
    shadow: true,
  },
};

const DEFAULT_TEMPLATE_KEY = "heritageGold";

function resolveTheme(templateKey) {
  return THEMES[templateKey] || THEMES[DEFAULT_TEMPLATE_KEY];
}

// For the admin UI's template picker — key + label + description only,
// never the full color/font internals.
const TEMPLATE_OPTIONS = Object.values(THEMES).map((th) => ({
  key: th.key,
  label: th.label,
  description: th.description,
}));

// Several real-data fields fed into decks (courses.description,
// career_pathways.description/target_audience/expected_outcomes) are
// authored through CKEditor in the admin UI and stored as HTML, not plain
// text — pptxgenjs text options take plain strings, so raw markup would
// otherwise leak into slides as literal "<p>" tags. Strips tags, turns
// block/list boundaries into real line breaks, and decodes the handful of
// entities CKEditor actually emits.
function stripHtmlToLines(html) {
  if (!html) return [];
  return String(html)
    .replace(/<\/(li|p|div|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–")
    .replace(/&rsquo;/gi, "’")
    .replace(/&lsquo;/gi, "‘")
    .replace(/&rdquo;/gi, "”")
    .replace(/&ldquo;/gi, "“")
    .replace(/&hellip;/gi, "…")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function stripHtmlToText(html) {
  return stripHtmlToLines(html).join(" ");
}

// Any embedded image (logo repeated on every slide, or a gallery photo)
// gets a full, un-downscaled copy baked into the .pptx by pptxgenjs — no
// deduplication, no resizing — so a full-resolution upload (commonly
// several hundred KB to several MB for real photos) turns into a bloated
// deck for no visual gain, since nothing here displays larger than a few
// inches. Cloudinary (the established upload host for both
// company_info.logo_url and gallery_images.image_url in this app)
// supports on-the-fly resizing via URL transformation params, so request a
// small, quality-optimized copy instead of adding an image-processing
// dependency. Falls back to the original URL if it's not a Cloudinary URL.
// format: "png" for logos (needs transparency support) or "jpg" for real
// photos (better compression, universally supported when embedded in a
// PPTX — f_auto risks Cloudinary returning WebP, which older PowerPoint
// versions can mishandle when baked into a slide).
function getOptimizedImageUrl(url, targetWidth = 900, format = "jpg") {
  if (!url) return null;
  const match = url.match(/^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.+)$/);
  if (!match) return url;
  return `${match[1]}w_${targetWidth},q_auto,f_${format}/${match[2]}`;
}

function getOptimizedLogoUrl(logoUrl, targetWidth = 300) {
  return getOptimizedImageUrl(logoUrl, targetWidth, "png");
}

// Resolves a bare image URL into { url, width, height } — width/height are
// the image's REAL natural pixel dimensions (see imageDimensions.js),
// which addCoverImage() below needs to compute a correct crop. Callers
// building a deck with photos should resolve every URL through this once
// (in parallel, deduped) before handing them to the sync slide builders —
// see services/pitchDecks/proposalDeckTemplate.js.
async function resolvePhoto(url) {
  if (!url) return null;
  const optimizedUrl = getOptimizedImageUrl(url);
  const dims = await getImageDimensions(optimizedUrl);
  return { url: optimizedUrl, width: dims.width, height: dims.height };
}

// The one place that actually calls slide.addImage() with cover-style
// cropping. pptxgenjs's `sizing: { type: 'cover' }` computes its crop from
// whatever w/h you pass as the image's own (outer) options — it does NOT
// fetch the image to find its real size. Passing the SAME numbers for the
// outer w/h and sizing.w/h (an easy mistake — this file used to do exactly
// that) makes the crop math collapse to zero, i.e. the image just gets
// squashed to fit the frame instead of cropped to fill it. The outer w/h
// here must be the image's true natural size (any units — only the ratio
// matters) so the crop is computed against reality; sizing.w/h is the
// actual on-slide frame size.
function addCoverImage(slide, photo, x, y, w, h) {
  if (!photo) return;
  slide.addImage({
    path: photo.url,
    x, y,
    w: photo.width, h: photo.height,
    sizing: { type: "cover", w, h },
  });
}

// Same natural-vs-frame split as resolvePhoto(), but requests PNG (not
// JPEG) so a logo's transparent background survives — used for partner
// school logos, never for photos.
async function resolveLogo(url) {
  if (!url) return null;
  const optimizedUrl = getOptimizedImageUrl(url, 400, "png");
  const dims = await getImageDimensions(optimizedUrl);
  return { url: optimizedUrl, width: dims.width, height: dims.height };
}

// Like addCoverImage, but letterboxes instead of cropping — a school logo
// cropped to fill a frame would have its edges cut off, which looks
// broken; "contain" keeps the whole logo visible with even padding
// instead. Same natural-vs-frame requirement as addCoverImage.
function addContainImage(slide, logo, x, y, w, h) {
  if (!logo) return;
  slide.addImage({
    path: logo.url,
    x, y,
    w: logo.width, h: logo.height,
    sizing: { type: "contain", w, h },
  });
}

// companyInfo: { company_name, logo_url } — fetched fresh per report/deck
// generation (services/reportOrchestratorService.js, pitchDeckGeneratorService.js)
// from the same company_info table the admin edits and every EJS view
// already reads via res.locals.info, so the logo/name here always matches
// what's configured in company info, not a hardcoded brand asset. Stored
// on the pptx instance itself (not a module-level constant) so concurrent
// deck generations never share/race on this state. templateKey selects one
// of THEMES above (see comment at top of file); omitted/unknown falls back
// to "heritageGold", the original single design this file used to have.
function newDeck(companyInfo = {}, templateKey) {
  const pptx = new pptxgen();
  pptx.defineLayout({ name: "WIDESCREEN", width: 13.33, height: 7.5 });
  pptx.layout = "WIDESCREEN";
  pptx.__companyName = companyInfo.company_name || "";
  pptx.__logoUrl = getOptimizedLogoUrl(companyInfo.logo_url);
  pptx.__theme = resolveTheme(templateKey);
  return pptx;
}

// --- Title slide: one of 4 distinct compositions depending on
// pptx.__theme.style — card (gold field + floating white card), flat
// (left/bottom-aligned huge title, no shapes), block (dark bg + diagonal
// gold cut), organic (cream bg + soft blob accents behind a floating
// card). ---
function addTitleSlide(pptx, { title, subtitle }) {
  const t = pptx.__theme;
  const slide = pptx.addSlide();
  const dateLine = `Generated ${new Date().toLocaleDateString()}`;

  if (t.style === "flat") {
    slide.background = { color: t.bg };
    slide.addShape(pptx.ShapeType.rect, { x: 0.7, y: 0.95, w: 1.6, h: 0.045, fill: { color: t.accent }, line: { type: "none" } });
    if (pptx.__logoUrl) slide.addImage({ path: pptx.__logoUrl, x: 0.7, y: 1.15, w: 0.75, h: 0.75 });
    slide.addText(pptx.__companyName, { x: 1.6, y: 1.2, w: 6, h: 0.65, fontSize: 14, bold: true, color: t.ink, fontFace: t.bodyFont, valign: "middle" });
    slide.addText(title, {
      x: 0.7, y: 3.7, w: 11.9, h: 2.0, align: "left", valign: "bottom", fontSize: 44, bold: true, color: t.ink, fontFace: t.displayFont,
    });
    slide.addText(String(subtitle || "").toUpperCase(), {
      x: 0.7, y: 5.85, w: 11.9, h: 0.5, align: "left", fontSize: 12, color: t.accent2, fontFace: t.bodyFont, charSpacing: 1.2,
    });
    slide.addText(dateLine, { x: 0.7, y: 7.02, w: 8, h: 0.35, fontSize: 9, color: t.muted, fontFace: t.bodyFont });
  } else if (t.style === "block") {
    slide.background = { color: t.ink };
    slide.addShape(pptx.ShapeType.rtTriangle, {
      x: -1.4, y: 3.4, w: 9.2, h: 4.8, fill: { color: t.accent }, line: { type: "none" }, flipV: true,
    });
    if (pptx.__logoUrl) slide.addImage({ path: pptx.__logoUrl, x: 0.7, y: 0.55, w: 0.8, h: 0.8 });
    slide.addText(pptx.__companyName, { x: 1.65, y: 0.6, w: 6, h: 0.7, fontSize: 14, bold: true, color: t.bg, fontFace: t.bodyFont, valign: "middle" });
    slide.addText(String(title).toUpperCase(), {
      x: 0.7, y: 1.75, w: 10.8, h: 2.2, align: "left", valign: "top", fontSize: 44, bold: true, color: t.bg, fontFace: t.displayFont, lineSpacing: 44,
    });
    slide.addText(String(subtitle || "").toUpperCase(), {
      x: 0.7, y: 5.75, w: 8.5, h: 0.7, align: "left", fontSize: 13, bold: true, color: t.ink, fontFace: t.bodyFont, charSpacing: 0.5,
    });
    slide.addText(dateLine, { x: 0, y: 7.05, w: 13.33, h: 0.35, align: "center", fontSize: 10, color: t.bg, fontFace: t.bodyFont });
  } else if (t.style === "organic") {
    slide.background = { color: t.bg };
    slide.addShape(pptx.ShapeType.ellipse, { x: 9.6, y: -1.9, w: 5.6, h: 5.6, fill: { color: t.accentPale }, line: { type: "none" } });
    slide.addShape(pptx.ShapeType.ellipse, { x: -2.3, y: 4.6, w: 4.6, h: 4.6, fill: { color: t.accent2, transparency: 55 }, line: { type: "none" } });
    slide.addShape(pptx.ShapeType.ellipse, { x: 10.6, y: 5.15, w: 3.0, h: 3.0, fill: { color: t.accent3, transparency: 45 }, line: { type: "none" } });
    if (pptx.__logoUrl) slide.addImage({ path: pptx.__logoUrl, x: 0.6, y: 0.5, w: 0.9, h: 0.9 });
    slide.addText(pptx.__companyName, { x: 1.6, y: 0.6, w: 6, h: 0.7, fontSize: 15, bold: true, color: t.ink, fontFace: t.bodyFont, valign: "middle" });
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 1.0, y: 2.55, w: 11.33, h: 2.55, rectRadius: t.radius, fill: { color: t.panel }, line: { type: "none" }, shadow: CARD_SHADOW,
    });
    slide.addText(title, { x: 1.4, y: 2.85, w: 10.53, h: 1.15, align: "left", valign: "middle", fontSize: 32, bold: true, color: t.ink, fontFace: t.displayFont });
    slide.addShape(pptx.ShapeType.roundRect, { x: 1.4, y: 4.0, w: 1.1, h: 0.09, rectRadius: 0.04, fill: { color: t.accent }, line: { type: "none" } });
    slide.addText(subtitle, { x: 1.4, y: 4.15, w: 10.53, h: 0.8, align: "left", valign: "top", fontSize: 16, color: t.muted, fontFace: t.bodyFont });
    slide.addText(dateLine, { x: 0, y: 7.05, w: 13.33, h: 0.35, align: "center", fontSize: 10, color: t.muted, fontFace: t.bodyFont });
  } else {
    // card (Heritage Gold) — the original design.
    slide.background = { color: t.accent };
    slide.addShape(pptx.ShapeType.ellipse, { x: 9.5, y: -2.5, w: 7, h: 7, fill: { color: t.accentLight, transparency: 55 }, line: { type: "none" } });
    slide.addShape(pptx.ShapeType.ellipse, { x: -3, y: 4.5, w: 6, h: 6, fill: { color: t.ink, transparency: 80 }, line: { type: "none" } });
    if (pptx.__logoUrl) slide.addImage({ path: pptx.__logoUrl, x: 0.6, y: 0.5, w: 0.9, h: 0.9 });
    slide.addText(pptx.__companyName, { x: 1.6, y: 0.6, w: 6, h: 0.7, fontSize: 15, bold: true, color: t.white, fontFace: t.bodyFont, valign: "middle" });
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 1.0, y: 2.55, w: 11.33, h: 2.55, rectRadius: t.radius, fill: { color: t.white }, line: { type: "none" }, shadow: CARD_SHADOW,
    });
    slide.addText(title, { x: 1.4, y: 2.85, w: 10.53, h: 1.15, align: "left", valign: "middle", fontSize: 32, bold: true, color: t.ink, fontFace: t.displayFont });
    slide.addShape(pptx.ShapeType.rect, { x: 1.4, y: 4.0, w: 1.1, h: 0.05, fill: { color: t.accent }, line: { type: "none" } });
    slide.addText(subtitle, { x: 1.4, y: 4.15, w: 10.53, h: 0.8, align: "left", valign: "top", fontSize: 16, color: t.muted, fontFace: t.bodyFont });
    slide.addText(dateLine, { x: 0, y: 7.05, w: 13.33, h: 0.35, align: "center", fontSize: 10, color: t.white, fontFace: t.bodyFont });
  }

  return slide;
}

// --- Every content slide shares this frame: themed background, a header
// band or rule with the title, small logo mark and page footer — exact
// treatment depends on pptx.__theme.style (see addTitleSlide comment). ---
function addSectionHeader(pptx, slide, title, pageNum) {
  const t = pptx.__theme;
  slide.background = { color: t.bg };

  if (t.style === "flat") {
    slide.addText(title, {
      x: 0.55, y: 0.32, w: 10.3, h: 0.83, valign: "bottom", fontSize: 24, bold: true, color: t.ink, fontFace: t.displayFont,
    });
    slide.addShape(pptx.ShapeType.rect, { x: 0.55, y: 1.18, w: 1.9, h: 0.045, fill: { color: t.accent2 }, line: { type: "none" } });
    if (pptx.__logoUrl) slide.addImage({ path: pptx.__logoUrl, x: 12.2, y: 0.35, w: 0.6, h: 0.6 });
  } else if (t.style === "block") {
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 1.15, fill: { color: t.ink }, line: { type: "none" } });
    slide.addShape(pptx.ShapeType.rtTriangle, { x: 12.1, y: 0, w: 1.23, h: 1.15, fill: { color: t.accent }, line: { type: "none" }, flipH: true });
    slide.addText(title, { x: 0.55, y: 0, w: 10.5, h: 1.15, valign: "middle", fontSize: 24, bold: true, color: t.bg, fontFace: t.displayFont });
  } else if (t.style === "organic") {
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 1.15, fill: { color: t.ink }, line: { type: "none" } });
    slide.addShape(pptx.ShapeType.ellipse, { x: 11.95, y: -0.45, w: 2.0, h: 2.0, fill: { color: t.accent2, transparency: 40 }, line: { type: "none" } });
    slide.addText(title, { x: 0.55, y: 0, w: 10.5, h: 1.15, valign: "middle", fontSize: 24, bold: true, color: t.white, fontFace: t.displayFont });
    if (pptx.__logoUrl) slide.addImage({ path: pptx.__logoUrl, x: 12.15, y: 0.2, w: 0.75, h: 0.75 });
  } else {
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 1.15, fill: { color: t.ink }, line: { type: "none" } });
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 1.15, w: 13.33, h: 0.06, fill: { color: t.accent }, line: { type: "none" } });
    slide.addText(title, { x: 0.55, y: 0, w: 10.5, h: 1.15, valign: "middle", fontSize: 24, bold: true, color: t.white, fontFace: t.displayFont });
    if (pptx.__logoUrl) slide.addImage({ path: pptx.__logoUrl, x: 12.15, y: 0.2, w: 0.75, h: 0.75 });
  }

  slide.addText(pptx.__companyName, { x: 0.4, y: 7.15, w: 8, h: 0.3, fontSize: 9, color: t.muted, fontFace: t.bodyFont });
  if (pageNum) {
    slide.addText(String(pageNum), { x: 12.6, y: 7.15, w: 0.5, h: 0.3, align: "right", fontSize: 9, color: t.muted, fontFace: t.bodyFont });
  }
}

let slideCounter = 0;
function addContentSlide(pptx, title) {
  slideCounter += 1;
  const slide = pptx.addSlide();
  addSectionHeader(pptx, slide, title, slideCounter);
  return slide;
}

function addBulletSlide(pptx, title, bullets, options = {}) {
  const t = pptx.__theme;
  const slide = addContentSlide(pptx, title);

  slide.addShape(t.style === "flat" ? pptx.ShapeType.rect : pptx.ShapeType.roundRect, {
    x: 0.55, y: 1.5, w: 12.23, h: 5.3, rectRadius: t.radius,
    fill: { color: t.panel }, line: { color: t.line, width: 1 }, shadow: t.shadow ? CARD_SHADOW : undefined,
  });

  const bulletItems = bullets.filter(Boolean).map((b) => ({
    text: b,
    options: { bullet: { code: "25CF", indent: 20 }, color: t.accent, breakLine: true },
  }));

  slide.addText(
    bulletItems.map((item) => ({
      text: item.text,
      options: { ...item.options, color: t.ink },
    })),
    { x: 1.0, y: 1.85, w: 11.3, h: 4.7, fontSize: options.fontSize || 17, valign: "top", paraSpaceAfter: 16, lineSpacing: 24, fontFace: t.bodyFont }
  );
  return slide;
}

// --- Plain flowing-paragraph slide (e.g. "About Us") — addBulletSlide
// always adds bullet markers, which don't suit prose. ---
// options.photo: optional, a resolved { url, width, height } (see
// resolvePhoto() above) — when present, the card splits into a text
// column (left) and a framed cover-cropped photo (right) instead of using
// the full width for text. Used for About Us with a real gallery photo.
function addParagraphSlide(pptx, title, text, options = {}) {
  const t = pptx.__theme;
  const slide = addContentSlide(pptx, title);
  const hasImage = !!options.photo;
  const textW = hasImage ? 6.9 : 10.83;

  slide.addShape(t.style === "flat" ? pptx.ShapeType.rect : pptx.ShapeType.roundRect, {
    x: 0.55, y: 1.5, w: 12.23, h: 5.3, rectRadius: t.radius,
    fill: { color: t.panel }, line: { color: t.line, width: 1 }, shadow: t.shadow ? CARD_SHADOW : undefined,
  });
  slide.addShape(pptx.ShapeType.rect, { x: 1.0, y: 1.9, w: 0.08, h: 0.6, fill: { color: t.accent }, line: { type: "none" } });
  if (options.quote) {
    slide.addText(options.quote, {
      x: 1.25, y: 1.85, w: textW, h: 0.7, fontSize: 15, italic: true, bold: true, color: t.accent, valign: "middle", fontFace: t.displayFont,
    });
  }
  slide.addText(text, {
    x: 1.0, y: options.quote ? 2.75 : 1.9, w: textW, h: options.quote ? 3.85 : 4.7,
    fontSize: 14, color: t.ink, valign: "top", lineSpacing: 22, fontFace: t.bodyFont,
  });

  if (hasImage) {
    const imgX = 8.15;
    const imgW = 4.3;
    const imgH = 4.3;
    const imgY = 2.05;
    slide.addShape(pptx.ShapeType.roundRect, {
      x: imgX - 0.06, y: imgY - 0.06, w: imgW + 0.12, h: imgH + 0.12, rectRadius: 0.06,
      fill: { color: t.accentPale }, line: { type: "none" },
    });
    addCoverImage(slide, options.photo, imgX, imgY, imgW, imgH);
  }

  return slide;
}

// Full-bleed photo card with a title band and caption — for track record /
// showcase / team photos pulled from the gallery. Falls back gracefully by
// simply not being called when no matching image was found (see
// services/pitchDeckGeneratorService.js's gallery matching).
// photo: a resolved { url, width, height } (see resolvePhoto() above).
function addImageHighlightSlide(pptx, title, photo, caption) {
  const t = pptx.__theme;
  const slide = addContentSlide(pptx, title);

  const x = 0.55, y = 1.5, w = 12.23, h = caption ? 4.75 : 5.3;
  slide.addShape(pptx.ShapeType.roundRect, {
    x: x - 0.06, y: y - 0.06, w: w + 0.12, h: h + 0.12, rectRadius: t.radius,
    fill: { color: t.accentPale }, line: { type: "none" }, shadow: t.shadow ? CARD_SHADOW : undefined,
  });
  addCoverImage(slide, photo, x, y, w, h);

  if (caption) {
    slide.addShape(pptx.ShapeType.rect, { x: 0.55, y: 6.35, w: 12.23, h: 0.45, fill: { color: t.ink }, line: { type: "none" } });
    slide.addText(caption, { x: 0.75, y: 6.35, w: 11.83, h: 0.45, fontSize: 11, italic: true, color: t.accentLight, valign: "middle", fontFace: t.bodyFont });
  }

  return slide;
}

// --- Multiple photos per slide, auto-paginated — used both for a
// dedicated "Photo Gallery" section in the body of a deck and for an
// evidence-heavy Appendix at the end. `columns`/`rows` control the grid
// (e.g. 3x2 = 6 small photos per slide for a gallery wall; 2x1 = 2 large
// photos per slide when the point is to let each photo actually be seen).
// photos: array of resolved { url, width, height, caption } (see
// resolvePhoto() above) — items with no photo are skipped.
function addPhotoGridSlides(pptx, title, photos, { columns = 3, rows = 2 } = {}) {
  const t = pptx.__theme;
  const perSlide = columns * rows;
  const usable = photos.filter(Boolean);
  if (!usable.length) return;

  const chunks = [];
  for (let i = 0; i < usable.length; i += perSlide) {
    chunks.push(usable.slice(i, i + perSlide));
  }

  chunks.forEach((chunk, chunkIndex) => {
    const slideTitle = chunks.length > 1 ? `${title} (${chunkIndex + 1}/${chunks.length})` : title;
    const slide = addContentSlide(pptx, slideTitle);

    const areaX = 0.55, areaY = 1.5, areaW = 12.23, areaH = 5.3;
    const gapX = 0.22, gapY = 0.22;
    const cellW = (areaW - gapX * (columns - 1)) / columns;
    const cellH = (areaH - gapY * (rows - 1)) / rows;

    chunk.forEach((photo, i) => {
      const col = i % columns;
      const row = Math.floor(i / columns);
      const x = areaX + col * (cellW + gapX);
      const y = areaY + row * (cellH + gapY);
      const captionH = photo.caption ? 0.3 : 0;
      const photoH = cellH - captionH;

      slide.addShape(pptx.ShapeType.roundRect, {
        x: x - 0.03, y: y - 0.03, w: cellW + 0.06, h: photoH + 0.06, rectRadius: t.radius * 0.5,
        fill: { color: t.accentPale }, line: { type: "none" }, shadow: t.shadow ? CARD_SHADOW : undefined,
      });
      addCoverImage(slide, photo, x, y, cellW, photoH);

      if (photo.caption) {
        slide.addText(photo.caption, {
          x, y: y + photoH + 0.02, w: cellW, h: captionH, fontSize: 9, color: t.muted, align: "center", valign: "top", fontFace: t.bodyFont,
        });
      }
    });
  });
}

// --- Logo wall, e.g. "Schools We Partner With" — a grid of real partner
// logos (schools.logo_url), each letterboxed (never cropped, see
// addContainImage) inside its own card so an odd logo aspect ratio never
// looks broken. Auto-paginates like addPhotoGridSlides.
// logos: array of resolved { url, width, height, caption } (see
// resolveLogo() above) — items with no logo are skipped.
function addLogoWallSlide(pptx, title, logos, { columns = 4, rows = 2 } = {}) {
  const t = pptx.__theme;
  const perSlide = columns * rows;
  const usable = logos.filter(Boolean);
  if (!usable.length) return;

  const chunks = [];
  for (let i = 0; i < usable.length; i += perSlide) {
    chunks.push(usable.slice(i, i + perSlide));
  }

  chunks.forEach((chunk, chunkIndex) => {
    const slideTitle = chunks.length > 1 ? `${title} (${chunkIndex + 1}/${chunks.length})` : title;
    const slide = addContentSlide(pptx, slideTitle);

    const areaX = 0.55, areaY = 1.5, areaW = 12.23, areaH = 5.3;
    const gapX = 0.3, gapY = 0.3;
    const cellW = (areaW - gapX * (columns - 1)) / columns;
    const cellH = (areaH - gapY * (rows - 1)) / rows;
    const labelH = 0.3;
    const logoH = cellH - labelH;
    const pad = 0.18;

    chunk.forEach((logo, i) => {
      const col = i % columns;
      const row = Math.floor(i / columns);
      const x = areaX + col * (cellW + gapX);
      const y = areaY + row * (cellH + gapY);

      slide.addShape(t.style === "flat" ? pptx.ShapeType.rect : pptx.ShapeType.roundRect, {
        x, y, w: cellW, h: logoH, rectRadius: t.radius,
        fill: { color: t.panel }, line: { color: t.line, width: 1 }, shadow: t.shadow ? CARD_SHADOW : undefined,
      });
      addContainImage(slide, logo, x + pad, y + pad, cellW - pad * 2, logoH - pad * 2);

      if (logo.caption) {
        slide.addText(logo.caption, {
          x, y: y + logoH + 0.02, w: cellW, h: labelH, fontSize: 9, color: t.muted, align: "center", valign: "top", fontFace: t.bodyFont,
        });
      }
    });
  });
}

// --- Curriculum, as real course cards (thumbnail + title + description
// straight from the courses table), not AI-invented steps. `intro` is an
// optional AI-drafted framing paragraph shown on its own slide first.
// courses: array of { title, description, thumbnail: resolved photo|null }
// — items with neither a title nor description are skipped upstream by
// the caller (see proposalDeckTemplate.js).
// `columns` (2 or 3) lays out a single row per slide, not a grid — fewer,
// bigger cards so a course's real thumbnail and description both stay
// legible instead of being crammed into a small tile.
function addCourseCardSlides(pptx, title, intro, courses, { columns = 3 } = {}) {
  const t = pptx.__theme;
  const usable = (courses || []).filter(Boolean);
  if (!usable.length) return;

  if (intro) {
    addParagraphSlide(pptx, title, intro, { quote: null, photo: null });
  }

  const perSlide = columns;
  const chunks = [];
  for (let i = 0; i < usable.length; i += perSlide) {
    chunks.push(usable.slice(i, i + perSlide));
  }

  chunks.forEach((chunk, chunkIndex) => {
    const slideTitle = chunks.length > 1 ? `${title} (${chunkIndex + 1}/${chunks.length})` : title;
    const slide = addContentSlide(pptx, slideTitle);

    const areaX = 0.55, areaY = 1.5, areaW = 12.23, cellH = 5.3;
    const gapX = 0.32;
    const cellW = (areaW - gapX * (columns - 1)) / columns;
    const thumbH = cellH * 0.5;

    chunk.forEach((course, i) => {
      const x = areaX + i * (cellW + gapX);
      const y = areaY;

      const hasThumb = !!course.thumbnail;
      const textY = hasThumb ? y + thumbH + 0.1 : y;
      const textH = hasThumb ? cellH - thumbH - 0.1 : cellH;

      if (hasThumb) {
        slide.addShape(pptx.ShapeType.roundRect, {
          x: x - 0.04, y: y - 0.04, w: cellW + 0.08, h: thumbH + 0.08, rectRadius: t.radius * 0.75,
          fill: { color: t.accentPale }, line: { type: "none" }, shadow: t.shadow ? CARD_SHADOW : undefined,
        });
        addCoverImage(slide, course.thumbnail, x, y, cellW, thumbH);
      }

      slide.addShape(t.style === "flat" ? pptx.ShapeType.rect : pptx.ShapeType.roundRect, {
        x, y: textY, w: cellW, h: textH, rectRadius: t.radius * 0.75,
        fill: { color: t.panel }, line: { color: t.line, width: 1 }, shadow: hasThumb ? undefined : (t.shadow ? CARD_SHADOW : undefined),
      });
      slide.addText(course.title || "", {
        x: x + 0.22, y: textY + 0.12, w: cellW - 0.44, h: 0.4, fontSize: 14, bold: true, color: t.ink, fontFace: t.displayFont,
      });
      slide.addText(course.description || "", {
        x: x + 0.22, y: textY + 0.52, w: cellW - 0.44, h: textH - 0.64, fontSize: 11, color: t.muted, valign: "top", fontFace: t.bodyFont,
      });
    });
  });
}

// --- One full slide per career pathway: real description + a target-
// audience/duration spec table + an expected-outcomes checklist framing
// "where this can lead" for a learner, plus an optional thumbnail.
// Grounded in real career_pathways data the admin picks and can edit —
// not AI-invented.
// pathway: { title, description, thumbnail: resolved photo|null,
//   targetAudience, durationEstimate, expectedOutcomes: string[] }
function addPathwaySlide(pptx, pathway) {
  const t = pptx.__theme;
  const slide = addContentSlide(pptx, pathway.title || "Career Pathway");
  const hasImage = !!pathway.thumbnail;
  const textW = hasImage ? 7.1 : 12.23;

  slide.addShape(t.style === "flat" ? pptx.ShapeType.rect : pptx.ShapeType.roundRect, {
    x: 0.55, y: 1.5, w: 12.23, h: 5.3, rectRadius: t.radius,
    fill: { color: t.panel }, line: { color: t.line, width: 1 }, shadow: t.shadow ? CARD_SHADOW : undefined,
  });

  let top = 1.8;
  if (pathway.description) {
    slide.addText(pathway.description, {
      x: 0.85, y: top, w: textW, h: 1.5, fontSize: 12.5, color: t.ink, valign: "top", fontFace: t.bodyFont,
    });
    top += 1.6;
  }

  const metaRows = [
    pathway.targetAudience ? { label: "Who it's for", value: pathway.targetAudience } : null,
    pathway.durationEstimate ? { label: "Typical duration", value: pathway.durationEstimate } : null,
  ].filter(Boolean);
  metaRows.forEach((m, i) => {
    const y = top + i * 0.45;
    slide.addText(m.label.toUpperCase(), { x: 0.85, y, w: 2.4, h: 0.4, fontSize: 10, bold: true, color: t.accent, valign: "middle", fontFace: t.bodyFont });
    slide.addText(m.value, { x: 3.25, y, w: textW - 2.4, h: 0.4, fontSize: 11.5, color: t.ink, valign: "middle", fontFace: t.bodyFont });
  });
  top += metaRows.length * 0.45 + (metaRows.length ? 0.15 : 0);

  const outcomes = (pathway.expectedOutcomes || []).filter(Boolean);
  if (outcomes.length) {
    slide.addText("WHERE THIS CAN LEAD", { x: 0.85, y: top, w: textW, h: 0.3, fontSize: 10.5, bold: true, color: t.accent, charSpacing: 1, fontFace: t.bodyFont });
    slide.addText(
      outcomes.map((o) => ({ text: o, options: { bullet: { code: "2713", indent: 20 }, breakLine: true, color: ACCENT_GREEN } })),
      { x: 0.85, y: top + 0.35, w: textW, h: Math.max(0.5, 6.6 - (top + 0.35)), fontSize: 11.5, color: t.ink, valign: "top", paraSpaceAfter: 6, fontFace: t.bodyFont }
    );
  }

  if (hasImage) {
    addCoverImage(slide, pathway.thumbnail, 8.15, 1.8, 4.4, 4.75);
  }

  return slide;
}

// intro: optional AI-drafted framing paragraph — the "purpose" narrative
// (why building toward a real career path matters for the learner) —
// shown once on its own slide before the individual pathway slides.
function addPathwaySlides(pptx, sectionTitle, intro, pathways) {
  const usable = (pathways || []).filter(Boolean);
  if (!usable.length) return;

  if (intro) {
    addParagraphSlide(pptx, sectionTitle, intro, { quote: null, photo: null });
  }
  usable.forEach((pathway) => addPathwaySlide(pptx, pathway));
}

// --- Stats: one of 4 treatments — card (white cards + gold top rule),
// flat (no card, hairline rule under each stat), block (solid dark tiles),
// organic (rounded soft cards). ---
function addStatSlide(pptx, title, stats) {
  const t = pptx.__theme;
  const slide = addContentSlide(pptx, title);
  const cols = Math.min(stats.length, 4);
  const gap = 0.3;
  const cellW = (12.23 - gap * (cols - 1)) / cols;
  const cellH = 2.2;
  const startX = 0.55;
  const startY = 2.4;

  stats.forEach((s, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = startX + col * (cellW + gap);
    const y = startY + row * (cellH + 0.3);

    if (t.style === "flat") {
      slide.addShape(pptx.ShapeType.rect, { x, y: y + cellH - 0.02, w: cellW, h: 0.015, fill: { color: t.line }, line: { type: "none" } });
      slide.addText(String(s.value), { x, y: y + 0.3, w: cellW, h: 1.1, align: "left", fontSize: 32, bold: true, color: t.ink, fontFace: t.displayFont });
      slide.addText(s.label.toUpperCase(), { x, y: y + 1.5, w: cellW, h: 0.5, align: "left", fontSize: 10.5, color: t.accent2, fontFace: t.bodyFont, charSpacing: 1 });
    } else if (t.style === "block") {
      slide.addShape(pptx.ShapeType.rect, { x, y, w: cellW, h: cellH, fill: { color: t.ink }, line: { type: "none" } });
      slide.addText(String(s.value), { x, y: y + 0.4, w: cellW, h: 0.95, align: "center", fontSize: 30, bold: true, color: t.accent2, fontFace: t.displayFont });
      slide.addText(s.label.toUpperCase(), { x: x + 0.15, y: y + 1.4, w: cellW - 0.3, h: 0.7, align: "center", fontSize: 11, color: t.bg, fontFace: t.bodyFont, charSpacing: 1 });
    } else if (t.style === "organic") {
      slide.addShape(pptx.ShapeType.roundRect, { x, y, w: cellW, h: cellH, rectRadius: t.radius, fill: { color: t.panel }, line: { type: "none" }, shadow: CARD_SHADOW });
      slide.addText(String(s.value), { x, y: y + 0.42, w: cellW, h: 0.95, align: "center", fontSize: 28, bold: true, color: t.accent2, fontFace: t.displayFont });
      slide.addText(s.label.toUpperCase(), { x: x + 0.15, y: y + 1.4, w: cellW - 0.3, h: 0.7, align: "center", fontSize: 11, color: t.muted, fontFace: t.bodyFont, charSpacing: 1 });
    } else {
      slide.addShape(pptx.ShapeType.roundRect, { x, y, w: cellW, h: cellH, rectRadius: t.radius, fill: { color: t.panel }, line: { type: "none" }, shadow: CARD_SHADOW });
      slide.addShape(pptx.ShapeType.roundRect, { x, y, w: cellW, h: 0.12, rectRadius: 0.06, fill: { color: t.accent }, line: { type: "none" } });
      slide.addText(String(s.value), { x, y: y + 0.4, w: cellW, h: 0.95, align: "center", fontSize: 30, bold: true, color: t.ink, fontFace: t.displayFont });
      slide.addText(s.label.toUpperCase(), { x: x + 0.15, y: y + 1.4, w: cellW - 0.3, h: 0.7, align: "center", fontSize: 11.5, color: t.muted, fontFace: t.bodyFont, charSpacing: 1 });
    }
  });

  return slide;
}

function addLineChartSlide(pptx, title, labels, values, seriesName) {
  const t = pptx.__theme;
  const slide = addContentSlide(pptx, title);

  slide.addShape(t.style === "flat" ? pptx.ShapeType.rect : pptx.ShapeType.roundRect, {
    x: 0.55, y: 1.4, w: 12.23, h: 5.4, rectRadius: t.radius,
    fill: { color: t.panel }, line: { color: t.line, width: 1 }, shadow: t.shadow ? CARD_SHADOW : undefined,
  });

  slide.addChart(
    pptx.ChartType.line,
    [{ name: seriesName, labels, values }],
    {
      x: 0.9, y: 1.75, w: 11.55, h: 4.75,
      chartColors: [t.accent],
      lineSize: 3,
      lineDataSymbol: "circle",
      lineDataSymbolSize: 7,
      lineDataSymbolLineColor: t.accent,
      showLegend: false,
      showValue: false,
      catAxisLabelColor: t.muted,
      catAxisLabelFontSize: 10,
      valAxisLabelColor: t.muted,
      valAxisLabelFontSize: 10,
      gridLineColor: t.line,
      dataBorder: { pt: 1, color: t.white },
    }
  );
  return slide;
}

// colors: optional array of hex colors, one per bar (e.g. green for
// growth, red for decline) — falls back to a single brand-gold color for
// every bar when omitted.
function addBarChartSlide(pptx, title, categories, values, valueLabel, colors) {
  const t = pptx.__theme;
  const slide = addContentSlide(pptx, title);

  slide.addShape(t.style === "flat" ? pptx.ShapeType.rect : pptx.ShapeType.roundRect, {
    x: 0.55, y: 1.4, w: 12.23, h: 5.4, rectRadius: t.radius,
    fill: { color: t.panel }, line: { color: t.line, width: 1 }, shadow: t.shadow ? CARD_SHADOW : undefined,
  });

  slide.addChart(
    pptx.ChartType.bar,
    [{ name: valueLabel, labels: categories, values }],
    {
      x: 0.9, y: 1.75, w: 11.55, h: 4.75,
      barDir: "col",
      chartColors: colors && colors.length ? colors : [t.accent],
      valueBarColors: !!(colors && colors.length),
      showLegend: false,
      showValue: true,
      dataLabelColor: t.ink,
      dataLabelFontSize: 10,
      catAxisLabelColor: t.muted,
      catAxisLabelFontSize: 9,
      valAxisLabelColor: t.muted,
      valAxisLabelFontSize: 10,
      valAxisTitle: valueLabel,
      showValAxisTitle: true,
      gridLineColor: t.line,
    }
  );
  return slide;
}

function addAiSlide(pptx, title, ai) {
  if (!ai) return;
  const t = pptx.__theme;
  const slide = addContentSlide(pptx, `${title} — AI Analysis`);

  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.55, y: 1.4, w: 12.23, h: 0.95, rectRadius: t.radius, fill: { color: t.accentPale }, line: { type: "none" },
  });
  slide.addText(ai.summary || "", {
    x: 0.85, y: 1.5, w: 11.6, h: 0.75, fontSize: 12.5, italic: true, color: t.ink, valign: "middle", fontFace: t.bodyFont,
  });

  const columns = [
    { heading: "Insights", items: ai.insights || [], color: ACCENT_GREEN },
    { heading: "Risks", items: ai.risks || [], color: ACCENT_RED },
    { heading: "Recommendations", items: ai.recommendations || [], color: t.accent },
  ];

  const colW = 3.95;
  const gap = 0.19;
  columns.forEach((col, i) => {
    const x = 0.55 + i * (colW + gap);
    slide.addShape(pptx.ShapeType.roundRect, {
      x, y: 2.55, w: colW, h: 4.25, rectRadius: t.radius,
      fill: { color: t.panel }, line: { color: t.line, width: 1 }, shadow: t.shadow ? CARD_SHADOW : undefined,
    });
    slide.addShape(pptx.ShapeType.rect, { x, y: 2.55, w: colW, h: 0.5, fill: { color: col.color }, line: { type: "none" } });
    slide.addText(col.heading.toUpperCase(), {
      x, y: 2.55, w: colW, h: 0.5, align: "center", valign: "middle", fontSize: 12, bold: true, color: t.white, charSpacing: 1, fontFace: t.bodyFont,
    });
    slide.addText(
      (col.items.length ? col.items : ["None identified."]).map((text) => ({
        text, options: { bullet: { code: "2022", indent: 12 }, breakLine: true },
      })),
      { x: x + 0.22, y: 3.2, w: colW - 0.4, h: 3.45, fontSize: 11, color: t.ink, valign: "top", paraSpaceAfter: 10, fontFace: t.bodyFont }
    );
  });

  return slide;
}

// --- Agenda / table of contents: numbered two-column grid of section
// names, matching the reference proposal's "What's Inside" page. ---
function addTocSlide(pptx, title, items) {
  const t = pptx.__theme;
  const slide = addContentSlide(pptx, title);
  const cols = 2;
  const rows = Math.ceil(items.length / cols);
  const cellW = 5.95;
  const cellH = Math.min(1.05, (5.3 - (rows - 1) * 0.15) / rows);
  const gapX = 0.33;
  const gapY = 0.15;
  const startX = 0.55;
  const startY = 1.55;
  const numberColor = t.style === "flat" ? t.accent : t.accentLight;

  items.forEach((item, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = startX + col * (cellW + gapX);
    const y = startY + row * (cellH + gapY);

    if (t.style === "flat") {
      slide.addShape(pptx.ShapeType.rect, { x, y: y + cellH - 0.03, w: cellW, h: 0.02, fill: { color: t.line }, line: { type: "none" } });
    } else if (t.style === "block") {
      slide.addShape(pptx.ShapeType.rect, { x, y, w: cellW, h: cellH, fill: { color: i % 2 === 0 ? t.accentPale : t.bg }, line: { type: "none" } });
    } else {
      slide.addShape(pptx.ShapeType.roundRect, { x, y, w: cellW, h: cellH, rectRadius: t.radius * 0.5, fill: { color: t.accentPale }, line: { type: "none" } });
    }

    slide.addText(String(i + 1).padStart(2, "0"), {
      x: x + 0.2, y, w: 0.9, h: cellH, valign: "middle", fontSize: 22, bold: true, color: numberColor, fontFace: t.displayFont,
    });
    slide.addText(item, {
      x: x + 1.05, y, w: cellW - 1.2, h: cellH, valign: "middle", fontSize: 13, bold: true, color: t.ink, fontFace: t.bodyFont,
    });
  });

  return slide;
}

// --- Feature grid: title+description cards, used for "Our Programs" and
// "Why It Matters" style sections. One of 4 treatments — card (white
// cards, gold left-bar), flat (bordered outline cells, no fill), block
// (alternating solid dark/gold tiles), organic (rounded cards with a
// cycling accent stripe). ---
function addFeatureGridSlide(pptx, title, items, description) {
  const t = pptx.__theme;
  const slide = addContentSlide(pptx, title);
  let top = 1.4;

  if (description) {
    slide.addText(description, { x: 0.55, y: top, w: 12.23, h: 0.5, fontSize: 13, italic: true, color: t.muted, fontFace: t.bodyFont });
    top += 0.55;
  }

  const cols = 2;
  const rows = Math.ceil(items.length / cols);
  const cellW = 5.95;
  const gapX = 0.33;
  const gapY = t.style === "flat" ? 0.02 : 0.22;
  const availH = 7.15 - top;
  const cellH = Math.min(1.7, (availH - (rows - 1) * gapY) / rows);
  const startX = 0.55;

  items.forEach((item, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = startX + col * (cellW + gapX);
    const y = top + row * (cellH + gapY);

    if (t.style === "flat") {
      slide.addShape(pptx.ShapeType.rect, { x, y, w: cellW, h: cellH - 0.02, fill: { type: "none" }, line: { color: t.line, width: 1 } });
      slide.addText(String(i + 1).padStart(2, "0"), { x: x + 0.2, y: y + 0.1, w: 1.0, h: 0.3, fontSize: 10, color: t.accent2, fontFace: t.bodyFont });
      slide.addText(item.title, { x: x + 0.2, y: y + 0.4, w: cellW - 0.4, h: 0.4, fontSize: 14, bold: true, color: t.ink, fontFace: t.displayFont });
      slide.addText(item.description || "", { x: x + 0.2, y: y + 0.8, w: cellW - 0.4, h: cellH - 0.92, fontSize: 11, color: t.muted, valign: "top", fontFace: t.bodyFont });
    } else if (t.style === "block") {
      const blockColor = i % 2 === 0 ? t.ink : t.accent;
      const onBlockText = i % 2 === 0 ? t.bg : t.ink;
      slide.addShape(pptx.ShapeType.rect, { x, y, w: cellW, h: cellH, fill: { color: blockColor }, line: { type: "none" } });
      slide.addText(item.title, { x: x + 0.25, y: y + 0.15, w: cellW - 0.45, h: 0.4, fontSize: 14, bold: true, color: onBlockText, fontFace: t.displayFont });
      slide.addText(item.description || "", { x: x + 0.25, y: y + 0.55, w: cellW - 0.45, h: cellH - 0.68, fontSize: 10.5, color: onBlockText, valign: "top", fontFace: t.bodyFont });
    } else if (t.style === "organic") {
      slide.addShape(pptx.ShapeType.roundRect, { x, y, w: cellW, h: cellH, rectRadius: t.radius, fill: { color: t.panel }, line: { type: "none" }, shadow: CARD_SHADOW });
      const stripeColors = [t.accent, t.accent2, t.accent3, t.accent];
      slide.addShape(pptx.ShapeType.roundRect, { x: x + 0.15, y: y + 0.14, w: cellW - 0.3, h: 0.08, rectRadius: 0.04, fill: { color: stripeColors[i % stripeColors.length] }, line: { type: "none" } });
      slide.addText(item.title, { x: x + 0.25, y: y + 0.34, w: cellW - 0.45, h: 0.4, fontSize: 14, bold: true, color: t.ink, fontFace: t.displayFont });
      slide.addText(item.description || "", { x: x + 0.25, y: y + 0.74, w: cellW - 0.45, h: cellH - 0.87, fontSize: 11, color: t.muted, valign: "top", fontFace: t.bodyFont });
    } else {
      slide.addShape(pptx.ShapeType.roundRect, { x, y, w: cellW, h: cellH, rectRadius: t.radius, fill: { color: t.panel }, line: { color: t.line, width: 1 }, shadow: CARD_SHADOW });
      slide.addShape(pptx.ShapeType.rect, { x, y, w: 0.08, h: cellH, fill: { color: t.accent }, line: { type: "none" } });
      slide.addText(item.title, { x: x + 0.25, y: y + 0.12, w: cellW - 0.45, h: 0.4, fontSize: 14, bold: true, color: t.ink, fontFace: t.displayFont });
      slide.addText(item.description || "", { x: x + 0.25, y: y + 0.52, w: cellW - 0.45, h: cellH - 0.65, fontSize: 11, color: t.muted, valign: "top", fontFace: t.bodyFont });
    }
  });

  return slide;
}

// --- Spec table + optional checklist, for a single program/offering
// "deep dive" page (age range, class size, frequency, etc.). ---
function addSpecTableSlide(pptx, title, description, specs, features) {
  const t = pptx.__theme;
  const slide = addContentSlide(pptx, title);
  let top = 1.4;

  if (description) {
    slide.addText(description, { x: 0.55, y: top, w: 12.23, h: 0.5, fontSize: 13, italic: true, color: t.muted, fontFace: t.bodyFont });
    top += 0.55;
  }

  const rowH = 0.5;
  (specs || []).forEach((spec, i) => {
    const y = top + i * rowH;
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.55, y, w: 12.23, h: rowH,
      fill: { color: i % 2 === 0 ? t.accentPale : t.panel }, line: { type: "none" },
    });
    slide.addText(spec.label.toUpperCase(), { x: 0.75, y, w: 3.2, h: rowH, valign: "middle", fontSize: 11, bold: true, color: t.accent, fontFace: t.bodyFont });
    slide.addText(spec.value, { x: 4.1, y, w: 8.5, h: rowH, valign: "middle", fontSize: 12.5, color: t.ink, fontFace: t.bodyFont });
  });

  if (features && features.length) {
    const featTop = top + (specs || []).length * rowH + 0.35;
    slide.addText(
      features.map((f) => ({ text: f, options: { bullet: { code: "2713", indent: 20 }, breakLine: true, color: ACCENT_GREEN } })),
      { x: 0.55, y: featTop, w: 12.23, h: Math.max(0.5, 6.9 - featTop), fontSize: 12.5, color: t.ink, valign: "top", paraSpaceAfter: 8, fontFace: t.bodyFont }
    );
  }

  return slide;
}

// --- Numbered vertical process steps ("How a Partnership Works"). ---
function addProcessSlide(pptx, title, steps) {
  const t = pptx.__theme;
  const slide = addContentSlide(pptx, title);
  const rowH = Math.min(1.05, 5.3 / steps.length);
  const startY = 1.5;

  steps.forEach((step, i) => {
    const y = startY + i * rowH;
    slide.addShape(pptx.ShapeType.ellipse, {
      x: 0.55, y: y + 0.08, w: 0.55, h: 0.55, fill: { color: t.accent }, line: { type: "none" },
    });
    slide.addText(String(i + 1), {
      x: 0.55, y: y + 0.08, w: 0.55, h: 0.55, align: "center", valign: "middle", fontSize: 16, bold: true, color: t.white, fontFace: t.displayFont,
    });
    slide.addText(step.title, {
      x: 1.3, y, w: 11.4, h: 0.4, fontSize: 14, bold: true, color: t.ink, fontFace: t.displayFont,
    });
    slide.addText(step.description || "", {
      x: 1.3, y: y + 0.38, w: 11.4, h: rowH - 0.4, fontSize: 11.5, color: t.muted, valign: "top", fontFace: t.bodyFont,
    });
  });

  return slide;
}

// --- Pricing card + includes checklist + optional note banner. ---
function addPricingSlide(pptx, title, pricing) {
  const t = pptx.__theme;
  const slide = addContentSlide(pptx, title);
  const shapeType = t.style === "flat" ? pptx.ShapeType.rect : pptx.ShapeType.roundRect;

  slide.addShape(shapeType, {
    x: 0.55, y: 1.5, w: 4.2, h: 3.6, rectRadius: t.radius,
    fill: { color: t.ink }, line: { type: "none" }, shadow: t.shadow ? CARD_SHADOW : undefined,
  });
  slide.addText((pricing.amount || "").toUpperCase(), { x: 0.75, y: 1.75, w: 3.8, h: 0.4, align: "center", fontSize: 11, color: t.accentLight, fontFace: t.bodyFont, charSpacing: 1 });
  slide.addText(pricing.price || "", { x: 0.75, y: 2.15, w: 3.8, h: 1.1, align: "center", fontSize: 38, bold: true, color: t.accentLight, fontFace: t.displayFont });
  slide.addText(pricing.unit || "", { x: 0.75, y: 3.25, w: 3.8, h: 0.4, align: "center", fontSize: 12, color: t.bg, fontFace: t.bodyFont });
  if (pricing.note2) {
    slide.addText(pricing.note2, { x: 0.75, y: 3.65, w: 3.8, h: 1.2, align: "center", fontSize: 10, color: t.accentLight, valign: "top", fontFace: t.bodyFont });
  }

  slide.addShape(shapeType, {
    x: 5.15, y: 1.5, w: 7.63, h: 3.6, rectRadius: t.radius,
    fill: { color: t.panel }, line: { color: t.line, width: 1 }, shadow: t.shadow ? CARD_SHADOW : undefined,
  });
  slide.addText("WHAT'S INCLUDED", { x: 5.4, y: 1.65, w: 7, h: 0.35, fontSize: 12, bold: true, color: t.accent, fontFace: t.bodyFont, charSpacing: 1 });
  slide.addText(
    (pricing.includes || []).map((inc) => ({ text: inc, options: { bullet: { code: "2713", indent: 20 }, breakLine: true, color: ACCENT_GREEN } })),
    { x: 5.4, y: 2.05, w: 7.15, h: 2.95, fontSize: 12.5, color: t.ink, valign: "top", paraSpaceAfter: 8, fontFace: t.bodyFont }
  );

  if (pricing.note) {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 0.55, y: 5.3, w: 12.23, h: 1.35, rectRadius: t.radius, fill: { color: t.accentPale }, line: { type: "none" },
    });
    slide.addText(pricing.note, {
      x: 0.85, y: 5.45, w: 11.6, h: 1.05, fontSize: 11.5, italic: true, color: t.ink, valign: "middle", fontFace: t.bodyFont,
    });
  }

  return slide;
}

// --- FAQ: question/answer pairs, auto-paginated across as many slides as
// needed rather than overflowing one page. ---
function addFaqSlides(pptx, title, faqItems, perSlide = 5) {
  const t = pptx.__theme;
  const chunks = [];
  for (let i = 0; i < faqItems.length; i += perSlide) {
    chunks.push(faqItems.slice(i, i + perSlide));
  }

  chunks.forEach((chunk, chunkIndex) => {
    const slideTitle = chunks.length > 1 ? `${title} (${chunkIndex + 1}/${chunks.length})` : title;
    const slide = addContentSlide(pptx, slideTitle);
    const rowH = 5.3 / chunk.length;
    const startY = 1.5;

    chunk.forEach((item, i) => {
      const y = startY + i * rowH;
      slide.addText(`Q: ${item.question}`, {
        x: 0.55, y, w: 12.23, h: 0.35, fontSize: 13, bold: true, color: t.accent, fontFace: t.displayFont,
      });
      slide.addText(item.answer, {
        x: 0.75, y: y + 0.35, w: 12.0, h: rowH - 0.4, fontSize: 11.5, color: t.ink, valign: "top", fontFace: t.bodyFont,
      });
    });
  });
}

// --- Contact/closing slide with a 3-column contact-details block above
// the closing banner (phone/WhatsApp, email, social) — a richer variant
// of addClosingSlide for proposal-style decks that need to leave the
// reader with concrete next-step contact info, not just a CTA. ---
function addContactSlide(pptx, { preamble, contacts, headline, cta }) {
  const t = pptx.__theme;
  const slide = addContentSlide(pptx, "Let's Connect");
  const shapeType = t.style === "flat" ? pptx.ShapeType.rect : pptx.ShapeType.roundRect;

  let top = 1.5;
  if (preamble) {
    slide.addText(preamble, { x: 0.55, y: top, w: 12.23, h: 0.8, fontSize: 13, color: t.muted, valign: "top", fontFace: t.bodyFont });
    top += 0.9;
  }

  const cols = contacts.length;
  const gap = 0.3;
  const cellW = (12.23 - gap * (cols - 1)) / cols;
  contacts.forEach((c, i) => {
    const x = 0.55 + i * (cellW + gap);
    slide.addShape(shapeType, {
      x, y: top, w: cellW, h: 1.3, rectRadius: t.radius,
      fill: { color: t.panel }, line: { color: t.line, width: 1 }, shadow: t.shadow ? CARD_SHADOW : undefined,
    });
    slide.addText(c.label.toUpperCase(), { x: x + 0.15, y: top + 0.15, w: cellW - 0.3, h: 0.35, fontSize: 10, bold: true, color: t.muted, fontFace: t.bodyFont, charSpacing: 1 });
    slide.addText(c.value, { x: x + 0.15, y: top + 0.5, w: cellW - 0.3, h: 0.7, fontSize: 13, bold: true, color: t.ink, valign: "top", fontFace: t.bodyFont });
  });

  const bandY = top + 1.65;
  slide.addShape(shapeType, {
    x: 0.55, y: bandY, w: 12.23, h: 1.1, rectRadius: t.radius, fill: { color: t.ink }, line: { type: "none" },
  });
  slide.addText(headline, { x: 0.85, y: bandY + 0.12, w: 11.6, h: 0.5, align: "center", fontSize: 16, bold: true, color: t.white, fontFace: t.displayFont });
  slide.addText(cta, { x: 0.85, y: bandY + 0.6, w: 11.6, h: 0.4, align: "center", fontSize: 11.5, color: t.accentLight, fontFace: t.bodyFont });

  return slide;
}

function addClosingSlide(pptx, { headline, cta }) {
  const t = pptx.__theme;
  const slide = pptx.addSlide();
  slide.background = { color: t.ink };
  slide.addShape(pptx.ShapeType.ellipse, { x: -2.5, y: -2, w: 6, h: 6, fill: { color: t.accent, transparency: 75 }, line: { type: "none" } });
  slide.addShape(pptx.ShapeType.ellipse, { x: 10, y: 4, w: 5, h: 5, fill: { color: t.accent, transparency: 80 }, line: { type: "none" } });

  if (pptx.__logoUrl) slide.addImage({ path: pptx.__logoUrl, x: 5.92, y: 1.7, w: 1.5, h: 1.5 });
  slide.addText(headline, { x: 1, y: 3.4, w: 11.33, h: 1.0, align: "center", fontSize: 27, bold: true, color: t.white, fontFace: t.displayFont });
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 4.67, y: 4.55, w: 4, h: 0.65, rectRadius: t.style === "flat" ? 0.06 : 0.32, fill: { color: t.accent }, line: { type: "none" },
  });
  slide.addText(cta, { x: 4.67, y: 4.55, w: 4, h: 0.65, align: "center", valign: "middle", fontSize: 13, bold: true, color: t.ink, fontFace: t.bodyFont });
  slide.addText(pptx.__companyName, { x: 0, y: 6.9, w: 13.33, h: 0.4, align: "center", fontSize: 11, color: t.accentLight, fontFace: t.bodyFont });
  return slide;
}

module.exports = {
  BRAND_GOLD,
  BRAND_GOLD_LIGHT,
  BRAND_GOLD_PALE,
  BRAND_DARK,
  TEXT_DARK,
  TEXT_MUTED,
  BG_CREAM,
  WHITE,
  ACCENT_GREEN,
  ACCENT_RED,
  THEMES,
  DEFAULT_TEMPLATE_KEY,
  TEMPLATE_OPTIONS,
  resolveTheme,
  newDeck,
  addTitleSlide,
  addSectionHeader,
  addContentSlide,
  addBulletSlide,
  addParagraphSlide,
  addImageHighlightSlide,
  addPhotoGridSlides,
  addLogoWallSlide,
  addCourseCardSlides,
  addPathwaySlides,
  resolvePhoto,
  resolveLogo,
  stripHtmlToLines,
  stripHtmlToText,
  addStatSlide,
  addLineChartSlide,
  addBarChartSlide,
  addAiSlide,
  addTocSlide,
  addFeatureGridSlide,
  addSpecTableSlide,
  addProcessSlide,
  addPricingSlide,
  addFaqSlides,
  addContactSlide,
  addClosingSlide,
};
