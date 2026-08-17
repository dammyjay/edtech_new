// services/pitchDecks/deckTheme.js
//
// Shared visual design system for every generated .pptx — both the 4
// pitch deck templates and the platform analytics report deck
// (services/reportPptxService.js) build on these primitives, so a single
// design pass here upgrades every deck consistently. This is the
// "consistent branding, distinct structure" split: templates decide slide
// sequence and content, this file decides what everything looks like.

const pptxgen = require("pptxgenjs");

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

// companyInfo: { company_name, logo_url } — fetched fresh per report/deck
// generation (services/reportOrchestratorService.js, pitchDeckGeneratorService.js)
// from the same company_info table the admin edits and every EJS view
// already reads via res.locals.info, so the logo/name here always matches
// what's configured in company info, not a hardcoded brand asset. Stored
// on the pptx instance itself (not a module-level constant) so concurrent
// deck generations never share/race on this state.
function newDeck(companyInfo = {}) {
  const pptx = new pptxgen();
  pptx.defineLayout({ name: "WIDESCREEN", width: 13.33, height: 7.5 });
  pptx.layout = "WIDESCREEN";
  pptx.__companyName = companyInfo.company_name || "";
  pptx.__logoUrl = companyInfo.logo_url || null;
  return pptx;
}

// --- Title slide: full-bleed gold field, layered geometric accents, a
// floating white card carrying the title/subtitle so it reads like a
// designed cover rather than text-on-a-color-block. ---
function addTitleSlide(pptx, { title, subtitle }) {
  const slide = pptx.addSlide();
  slide.background = { color: BRAND_GOLD };

  // Layered circular accents for depth, dark-to-light gold tones.
  slide.addShape(pptx.ShapeType.ellipse, { x: 9.5, y: -2.5, w: 7, h: 7, fill: { color: BRAND_GOLD_LIGHT, transparency: 55 }, line: { type: "none" } });
  slide.addShape(pptx.ShapeType.ellipse, { x: -3, y: 4.5, w: 6, h: 6, fill: { color: BRAND_DARK, transparency: 80 }, line: { type: "none" } });

  if (pptx.__logoUrl) slide.addImage({ path: pptx.__logoUrl, x: 0.6, y: 0.5, w: 0.9, h: 0.9 });
  slide.addText(pptx.__companyName, { x: 1.6, y: 0.6, w: 6, h: 0.7, fontSize: 15, bold: true, color: WHITE, valign: "middle" });

  slide.addShape(pptx.ShapeType.roundRect, {
    x: 1.0, y: 2.55, w: 11.33, h: 2.55, rectRadius: 0.12,
    fill: { color: WHITE }, line: { type: "none" }, shadow: CARD_SHADOW,
  });
  slide.addText(title, {
    x: 1.4, y: 2.85, w: 10.53, h: 1.15, align: "left", valign: "middle",
    fontSize: 32, bold: true, color: BRAND_DARK,
  });
  slide.addShape(pptx.ShapeType.rect, { x: 1.4, y: 4.0, w: 1.1, h: 0.05, fill: { color: BRAND_GOLD }, line: { type: "none" } });
  slide.addText(subtitle, {
    x: 1.4, y: 4.15, w: 10.53, h: 0.8, align: "left", valign: "top", fontSize: 16, color: TEXT_MUTED,
  });

  slide.addText(`Generated ${new Date().toLocaleDateString()}`, {
    x: 0, y: 7.05, w: 13.33, h: 0.35, align: "center", fontSize: 10, color: WHITE,
  });
  return slide;
}

// --- Every content slide shares this frame: cream background, a slim
// gold header band with the title, small logo mark and page footer. ---
function addSectionHeader(pptx, slide, title, pageNum) {
  slide.background = { color: BG_CREAM };

  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 1.15, fill: { color: BRAND_DARK }, line: { type: "none" } });
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 1.15, w: 13.33, h: 0.06, fill: { color: BRAND_GOLD }, line: { type: "none" } });
  slide.addText(title, {
    x: 0.55, y: 0, w: 10.5, h: 1.15, valign: "middle", fontSize: 24, bold: true, color: WHITE,
  });
  if (pptx.__logoUrl) slide.addImage({ path: pptx.__logoUrl, x: 12.15, y: 0.2, w: 0.75, h: 0.75 });

  slide.addText(pptx.__companyName, { x: 0.4, y: 7.15, w: 8, h: 0.3, fontSize: 9, color: TEXT_MUTED });
  if (pageNum) {
    slide.addText(String(pageNum), { x: 12.6, y: 7.15, w: 0.5, h: 0.3, align: "right", fontSize: 9, color: TEXT_MUTED });
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
  const slide = addContentSlide(pptx, title);

  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.55, y: 1.5, w: 12.23, h: 5.3, rectRadius: 0.08,
    fill: { color: WHITE }, line: { color: "EBDFC0", width: 1 }, shadow: CARD_SHADOW,
  });

  const bulletItems = bullets.filter(Boolean).map((b) => ({
    text: b,
    options: { bullet: { code: "25CF", indent: 20 }, color: BRAND_GOLD, breakLine: true },
  }));

  slide.addText(
    bulletItems.map((item, i) => ({
      text: item.text,
      options: { ...item.options, color: TEXT_DARK },
    })),
    { x: 1.0, y: 1.85, w: 11.3, h: 4.7, fontSize: options.fontSize || 17, valign: "top", paraSpaceAfter: 16, lineSpacing: 24 }
  );
  return slide;
}

function addStatSlide(pptx, title, stats) {
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

    slide.addShape(pptx.ShapeType.roundRect, {
      x, y, w: cellW, h: cellH, rectRadius: 0.1,
      fill: { color: WHITE }, line: { type: "none" }, shadow: CARD_SHADOW,
    });
    slide.addShape(pptx.ShapeType.roundRect, {
      x, y, w: cellW, h: 0.12, rectRadius: 0.06,
      fill: { color: BRAND_GOLD }, line: { type: "none" },
    });
    slide.addText(String(s.value), {
      x, y: y + 0.4, w: cellW, h: 0.95, align: "center", fontSize: 30, bold: true, color: BRAND_DARK,
    });
    slide.addText(s.label.toUpperCase(), {
      x: x + 0.15, y: y + 1.4, w: cellW - 0.3, h: 0.7, align: "center", fontSize: 11.5, color: TEXT_MUTED, charSpacing: 1,
    });
  });

  return slide;
}

function addLineChartSlide(pptx, title, labels, values, seriesName) {
  const slide = addContentSlide(pptx, title);

  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.55, y: 1.4, w: 12.23, h: 5.4, rectRadius: 0.08,
    fill: { color: WHITE }, line: { color: "EBDFC0", width: 1 }, shadow: CARD_SHADOW,
  });

  slide.addChart(
    pptx.ChartType.line,
    [{ name: seriesName, labels, values }],
    {
      x: 0.9, y: 1.75, w: 11.55, h: 4.75,
      chartColors: [BRAND_GOLD],
      lineSize: 3,
      lineDataSymbol: "circle",
      lineDataSymbolSize: 7,
      lineDataSymbolLineColor: BRAND_GOLD,
      showLegend: false,
      showValue: false,
      catAxisLabelColor: TEXT_MUTED,
      catAxisLabelFontSize: 10,
      valAxisLabelColor: TEXT_MUTED,
      valAxisLabelFontSize: 10,
      gridLineColor: "EBDFC0",
      dataBorder: { pt: 1, color: WHITE },
    }
  );
  return slide;
}

// colors: optional array of hex colors, one per bar (e.g. green for
// growth, red for decline) — falls back to a single brand-gold color for
// every bar when omitted.
function addBarChartSlide(pptx, title, categories, values, valueLabel, colors) {
  const slide = addContentSlide(pptx, title);

  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.55, y: 1.4, w: 12.23, h: 5.4, rectRadius: 0.08,
    fill: { color: WHITE }, line: { color: "EBDFC0", width: 1 }, shadow: CARD_SHADOW,
  });

  slide.addChart(
    pptx.ChartType.bar,
    [{ name: valueLabel, labels: categories, values }],
    {
      x: 0.9, y: 1.75, w: 11.55, h: 4.75,
      barDir: "col",
      chartColors: colors && colors.length ? colors : [BRAND_GOLD],
      valueBarColors: !!(colors && colors.length),
      showLegend: false,
      showValue: true,
      dataLabelColor: TEXT_DARK,
      dataLabelFontSize: 10,
      catAxisLabelColor: TEXT_MUTED,
      catAxisLabelFontSize: 9,
      valAxisLabelColor: TEXT_MUTED,
      valAxisLabelFontSize: 10,
      valAxisTitle: valueLabel,
      showValAxisTitle: true,
      gridLineColor: "EBDFC0",
    }
  );
  return slide;
}

function addAiSlide(pptx, title, ai) {
  if (!ai) return;
  const slide = addContentSlide(pptx, `${title} — AI Analysis`);

  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.55, y: 1.4, w: 12.23, h: 0.95, rectRadius: 0.08,
    fill: { color: BRAND_GOLD_PALE }, line: { type: "none" },
  });
  slide.addText(ai.summary || "", {
    x: 0.85, y: 1.5, w: 11.6, h: 0.75, fontSize: 12.5, italic: true, color: TEXT_DARK, valign: "middle",
  });

  const columns = [
    { heading: "Insights", items: ai.insights || [], color: ACCENT_GREEN },
    { heading: "Risks", items: ai.risks || [], color: ACCENT_RED },
    { heading: "Recommendations", items: ai.recommendations || [], color: BRAND_GOLD },
  ];

  const colW = 3.95;
  const gap = 0.19;
  columns.forEach((col, i) => {
    const x = 0.55 + i * (colW + gap);
    slide.addShape(pptx.ShapeType.roundRect, {
      x, y: 2.55, w: colW, h: 4.25, rectRadius: 0.08,
      fill: { color: WHITE }, line: { color: "EBDFC0", width: 1 }, shadow: CARD_SHADOW,
    });
    slide.addShape(pptx.ShapeType.rect, { x, y: 2.55, w: colW, h: 0.5, fill: { color: col.color }, line: { type: "none" } });
    slide.addText(col.heading.toUpperCase(), {
      x, y: 2.55, w: colW, h: 0.5, align: "center", valign: "middle", fontSize: 12, bold: true, color: WHITE, charSpacing: 1,
    });
    slide.addText(
      (col.items.length ? col.items : ["None identified."]).map((t) => ({
        text: t, options: { bullet: { code: "2022", indent: 12 }, breakLine: true },
      })),
      { x: x + 0.22, y: 3.2, w: colW - 0.4, h: 3.45, fontSize: 11, color: TEXT_DARK, valign: "top", paraSpaceAfter: 10 }
    );
  });

  return slide;
}

function addClosingSlide(pptx, { headline, cta }) {
  const slide = pptx.addSlide();
  slide.background = { color: BRAND_DARK };
  slide.addShape(pptx.ShapeType.ellipse, { x: -2.5, y: -2, w: 6, h: 6, fill: { color: BRAND_GOLD, transparency: 75 }, line: { type: "none" } });
  slide.addShape(pptx.ShapeType.ellipse, { x: 10, y: 4, w: 5, h: 5, fill: { color: BRAND_GOLD, transparency: 80 }, line: { type: "none" } });

  if (pptx.__logoUrl) slide.addImage({ path: pptx.__logoUrl, x: 5.92, y: 1.7, w: 1.5, h: 1.5 });
  slide.addText(headline, { x: 1, y: 3.4, w: 11.33, h: 1.0, align: "center", fontSize: 27, bold: true, color: WHITE });
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 4.67, y: 4.55, w: 4, h: 0.65, rectRadius: 0.32, fill: { color: BRAND_GOLD }, line: { type: "none" },
  });
  slide.addText(cta, { x: 4.67, y: 4.55, w: 4, h: 0.65, align: "center", valign: "middle", fontSize: 13, bold: true, color: BRAND_DARK });
  slide.addText(pptx.__companyName, { x: 0, y: 6.9, w: 13.33, h: 0.4, align: "center", fontSize: 11, color: "D9A73B" });
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
  newDeck,
  addTitleSlide,
  addSectionHeader,
  addContentSlide,
  addBulletSlide,
  addStatSlide,
  addLineChartSlide,
  addBarChartSlide,
  addAiSlide,
  addClosingSlide,
};
