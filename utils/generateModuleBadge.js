// Auto-generates a module badge image when a content creator doesn't
// upload their own — same technique already used for certificates
// (utils/generateCertificate.js): build an HTML template, screenshot it
// with Puppeteer, hand back a local PNG for the caller to upload to
// Cloudinary. Styled after the hexagonal course-icon badges already used
// in the company's own course catalog, with a glossy/embossed "3D medal"
// treatment layered on top: a metallic gold rim, a gem-like radial gradient
// face, a glass shine highlight, a floating drop shadow, a notched ribbon,
// and small sparkle accents.
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const { v4: uuidv4 } = require("uuid");

// Eight visually distinct gem-tone gradients so badges across a course's
// modules don't all look identical. Each has a light/mid/dark stop so the
// radial "gem" fill in buildHtml has real depth, not a flat two-color wash.
// Picked by index (see pickBadgeColor below), not randomly, so the same
// module always regenerates the same look.
const PALETTE = [
  ["#E9A6FF", "#8B2FC9", "#4A1568"], // purple
  ["#FF8A8A", "#B23A3A", "#5C1414"], // deep red
  ["#7FF5E4", "#0E7C7B", "#053E3D"], // teal
  ["#FFD9A8", "#E08A3C", "#7A420F"], // orange/peach
  ["#AAB9FF", "#2C3E91", "#141E52"], // blue/lavender
  ["#A6F0B4", "#1B7A3D", "#0C3A1B"], // green
  ["#F5DA8A", "#A17807", "#5A4204"], // brand gold
  ["#FFB0D6", "#C9327A", "#6B1740"], // pink
];

function pickBadgeColor(index) {
  const safeIndex = ((Number(index) || 0) % PALETTE.length + PALETTE.length) % PALETTE.length;
  return PALETTE[safeIndex];
}

// A light keyword map so the achievement name on the ribbon has some
// relevance to what the module is actually about, instead of always
// being generic. Falls back to a rotating generic list when nothing matches.
const KEYWORD_TITLES = [
  [/\barray/i, "Array Architect"],
  [/\bloop/i, "Loop Master"],
  [/\bfunction/i, "Function Wizard"],
  [/\bvariable/i, "Variable Virtuoso"],
  [/\blogic|condition/i, "Logic Commander"],
  [/\brobot/i, "Robotics Pioneer"],
  [/\bai\b|machine learning|artificial intelligence/i, "AI Trailblazer"],
  [/\bgame/i, "Game Developer Pro"],
  [/\bweb\b/i, "Web Builder"],
  [/design|ui\/ux|\bux\b|\bui\b/i, "Design Innovator"],
  [/python/i, "Python Pro"],
  [/javascript|\bjs\b/i, "JS Champion"],
  [/\bdata\b/i, "Data Explorer"],
  [/\bapp\b|mobile/i, "App Creator"],
  [/database|\bsql\b/i, "Data Architect"],
];

const GENERIC_TITLES = [
  "Tech Enthusiast",
  "Rising Star",
  "Skill Master",
  "Knowledge Seeker",
  "Concept Champion",
  "Bright Achiever",
  "Pro Builder",
  "Trailblazer",
];

function pickAchievementName(moduleTitle, index) {
  const match = KEYWORD_TITLES.find(([re]) => re.test(moduleTitle || ""));
  if (match) return match[1];
  const safeIndex = ((Number(index) || 0) % GENERIC_TITLES.length + GENERIC_TITLES.length) % GENERIC_TITLES.length;
  return GENERIC_TITLES[safeIndex];
}

function esc(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const HEX_CLIP = "polygon(50% 0%, 96% 22%, 96% 78%, 50% 100%, 4% 78%, 4% 22%)";

function buildHtml({ moduleTitle, courseTitle, companyName, logoUrl, index = 0 }) {
  const [light, mid, dark] = pickBadgeColor(index);
  const achievementName = pickAchievementName(moduleTitle, index);

  // Hexagon points at top/bottom center, flat-ish angled sides — all real
  // content stays inside the middle ~70% band (roughly y=15%..85%, centered
  // horizontally with generous side padding) so nothing ever touches the
  // tapered corners, however long a course/module title runs.
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8" />
      <style>
        * { box-sizing: border-box; }
        html, body {
          margin: 0;
          padding: 0;
          width: 540px;
          height: 600px;
          background: transparent;
          font-family: 'Segoe UI', Arial, sans-serif;
        }
        .badge-shadow-wrap {
          width: 500px;
          height: 540px;
          margin: 30px 20px;
          filter: drop-shadow(0 14px 22px rgba(0,0,0,0.38)) drop-shadow(0 2px 4px rgba(0,0,0,0.25));
        }
        .badge-wrap {
          position: relative;
          width: 100%;
          height: 100%;
        }
        /* Layer 1: metallic gold outer rim */
        .badge-rim {
          position: absolute;
          inset: 0;
          background: linear-gradient(135deg, #FFF3C4 0%, #E8C662 22%, #B9902C 48%, #8B6F14 62%, #E8C662 82%, #FFF3C4 100%);
          clip-path: ${HEX_CLIP};
        }
        /* Layer 2: thin light bevel ring between rim and face */
        .badge-bevel {
          position: absolute;
          top: 10px; left: 10px; right: 10px; bottom: 10px;
          background: linear-gradient(135deg, #fff8e0, #d8b45a);
          clip-path: ${HEX_CLIP};
        }
        /* Layer 3: gem-toned radial face, light spot upper-left for depth */
        .badge-face {
          position: absolute;
          top: 15px; left: 15px; right: 15px; bottom: 15px;
          background: radial-gradient(circle at 34% 24%, ${light} 0%, ${mid} 46%, ${dark} 100%);
          clip-path: ${HEX_CLIP};
        }
        /* Layer 4: glossy glass shine overlay */
        .badge-shine {
          position: absolute;
          top: 15px; left: 15px; right: 15px; bottom: 15px;
          clip-path: ${HEX_CLIP};
          background: linear-gradient(115deg,
            rgba(255,255,255,0.55) 0%,
            rgba(255,255,255,0.22) 18%,
            rgba(255,255,255,0.0) 38%,
            rgba(255,255,255,0.0) 70%,
            rgba(255,255,255,0.12) 100%);
        }
        .badge-sparkle {
          position: absolute;
          color: rgba(255,255,255,0.85);
          text-shadow: 0 0 6px rgba(255,255,255,0.7);
        }
        .spark-1 { top: 12%; left: 18%; font-size: 20px; }
        .spark-2 { top: 20%; right: 14%; font-size: 13px; }
        .spark-3 { bottom: 14%; left: 12%; font-size: 12px; }
        .badge-content {
          position: absolute;
          top: 15%;
          bottom: 15%;
          left: 15%;
          right: 15%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
        }
        .badge-logo {
          max-height: 30px;
          max-width: 140px;
          object-fit: contain;
          margin-bottom: 12px;
          filter: drop-shadow(0 1px 2px rgba(0,0,0,0.35));
        }
        .badge-logo-fallback {
          color: #fff;
          font-weight: 800;
          font-size: 12px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          opacity: 0.92;
          margin-bottom: 12px;
          text-shadow: 0 1px 2px rgba(0,0,0,0.4);
        }
        .badge-course-title {
          color: #fff;
          font-weight: 800;
          font-size: 22px;
          text-align: center;
          line-height: 1.25;
          text-shadow: 0 2px 5px rgba(0,0,0,0.45);
          margin-bottom: 18px;
        }
        .badge-ribbon-wrap {
          position: relative;
          width: 108%;
          margin-bottom: 16px;
          filter: drop-shadow(0 4px 6px rgba(0,0,0,0.3));
        }
        .badge-ribbon {
          width: 100%;
          background: linear-gradient(180deg, #fffdf5 0%, #f0e6c8 30%, #d4b96a 55%, #b9902c 100%);
          clip-path: polygon(4% 0%, 96% 0%, 100% 50%, 96% 100%, 4% 100%, 0% 50%);
          padding: 11px 22px;
          text-align: center;
        }
        .badge-ribbon-text {
          color: #4a2f00;
          font-weight: 800;
          font-size: 19px;
          text-shadow: 0 1px 0 rgba(255,255,255,0.5);
        }
        .badge-desc-panel {
          width: 100%;
          background: linear-gradient(180deg, rgba(255,255,255,0.97), rgba(245,245,245,0.94));
          border-radius: 6px;
          padding: 10px 12px;
          text-align: center;
          box-shadow: 0 3px 8px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.8);
        }
        .badge-desc-text {
          color: #333;
          font-weight: 700;
          font-size: 15px;
          line-height: 1.35;
        }
      </style>
    </head>
    <body>
      <div class="badge-shadow-wrap">
        <div class="badge-wrap">
          <div class="badge-rim"></div>
          <div class="badge-bevel"></div>
          <div class="badge-face"></div>
          <div class="badge-shine"></div>
          <div class="badge-sparkle spark-1">✦</div>
          <div class="badge-sparkle spark-2">✦</div>
          <div class="badge-sparkle spark-3">✦</div>
          <div class="badge-content">
            ${
              logoUrl
                ? `<img class="badge-logo" src="${esc(logoUrl)}" />`
                : `<div class="badge-logo-fallback">${esc(companyName || "")}</div>`
            }
            <div class="badge-course-title">${esc(courseTitle)}</div>
            <div class="badge-ribbon-wrap"><div class="badge-ribbon"><div class="badge-ribbon-text">${esc(achievementName)}</div></div></div>
            <div class="badge-desc-panel"><div class="badge-desc-text">${esc(moduleTitle)}</div></div>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}

// index: a stable per-course counter (e.g. how many modules the course
// already has) — NOT the raw module id, since ids aren't guaranteed to
// be sequential per course and would make color/name rotation look random.
module.exports = async (opts) => {
  const badgeCode = uuidv4().slice(0, 12);
  const html = buildHtml(opts);

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath(),
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 540, height: 600, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: "networkidle0" });

    const outputPath = path.join(__dirname, `../tmp/badge-${badgeCode}.png`);
    await page.screenshot({ path: outputPath, omitBackground: true });

    return { outputPath, badgeCode };
  } finally {
    await browser.close();
  }
};

module.exports._buildHtml = buildHtml; // exposed for local visual-debugging scripts only
