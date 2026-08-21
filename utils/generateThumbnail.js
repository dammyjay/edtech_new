// Auto-generates a course/module thumbnail image when a content creator
// doesn't upload their own — same HTML-then-Puppeteer-screenshot technique
// as utils/generateModuleBadge.js and utils/generateCertificate.js, and
// deliberately sharing that same gem-gradient palette + glossy/3D treatment
// (metallic-ish glass shine, floating drop shadow, sparkle accents) so a
// course's auto badge and auto thumbnail read as a matching set.
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const { v4: uuidv4 } = require("uuid");

// Same eight gem tones as generateModuleBadge.js's PALETTE, kept in sync
// deliberately — pass the same `index` to both generators for a module/
// course and the thumbnail + badge come out color-matched.
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

function pickColor(index) {
  const safeIndex = ((Number(index) || 0) % PALETTE.length + PALETTE.length) % PALETTE.length;
  return PALETTE[safeIndex];
}

// Font Awesome 6 (loaded via CDN in the template below) icon per topic
// keyword, so the thumbnail has some visual relevance to its subject
// instead of always showing the same generic icon.
const KEYWORD_ICONS = [
  [/\barray|\blist\b/i, "fa-solid fa-table-cells"],
  [/\bloop\b/i, "fa-solid fa-rotate"],
  [/\bfunction\b/i, "fa-solid fa-code"],
  [/\blogic|condition/i, "fa-solid fa-diagram-project"],
  [/\brobot/i, "fa-solid fa-robot"],
  [/\bai\b|machine learning|artificial intelligence/i, "fa-solid fa-brain"],
  [/\bgame\b/i, "fa-solid fa-gamepad"],
  [/\bweb\b/i, "fa-solid fa-globe"],
  [/design|ui\/ux|\bux\b|\bui\b/i, "fa-solid fa-palette"],
  [/python/i, "fa-brands fa-python"],
  [/javascript|\bjs\b/i, "fa-brands fa-js"],
  [/\bdata\b|database|\bsql\b/i, "fa-solid fa-database"],
  [/\bapp\b|mobile/i, "fa-solid fa-mobile-screen-button"],
  [/3d|blender|animation/i, "fa-solid fa-cube"],
  [/\bmusic|sound|audio/i, "fa-solid fa-music"],
  [/video|film/i, "fa-solid fa-film"],
];

function pickIcon(title) {
  const match = KEYWORD_ICONS.find(([re]) => re.test(title || ""));
  return match ? match[1] : "fa-solid fa-graduation-cap";
}

function esc(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildHtml({ title, subtitle, index = 0 }) {
  const [light, mid, dark] = pickColor(index);
  const iconClass = pickIcon(title);

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8" />
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css" />
      <style>
        * { box-sizing: border-box; }
        html, body {
          margin: 0;
          padding: 0;
          width: 860px;
          height: 500px;
          background: transparent;
          font-family: 'Segoe UI', Arial, sans-serif;
        }
        .thumb-shadow-wrap {
          width: 800px;
          height: 450px;
          margin: 25px 30px;
          filter: drop-shadow(0 12px 20px rgba(0,0,0,0.32));
        }
        .thumb-card {
          position: relative;
          width: 100%;
          height: 100%;
          border-radius: 22px;
          overflow: hidden;
          background: radial-gradient(circle at 25% 20%, ${light} 0%, ${mid} 48%, ${dark} 100%);
        }
        .thumb-blob {
          position: absolute;
          border-radius: 50%;
          background: rgba(255,255,255,0.08);
        }
        .blob-1 { width: 420px; height: 420px; top: -180px; right: -120px; }
        .blob-2 { width: 260px; height: 260px; bottom: -140px; right: 120px; background: rgba(255,255,255,0.06); }
        .thumb-shine {
          position: absolute;
          inset: 0;
          background: linear-gradient(120deg,
            rgba(255,255,255,0.35) 0%,
            rgba(255,255,255,0.12) 22%,
            rgba(255,255,255,0.0) 42%,
            rgba(255,255,255,0.0) 75%,
            rgba(255,255,255,0.1) 100%);
        }
        .thumb-sparkle {
          position: absolute;
          color: rgba(255,255,255,0.8);
          text-shadow: 0 0 6px rgba(255,255,255,0.6);
        }
        .sp-1 { top: 10%; right: 12%; font-size: 22px; }
        .sp-2 { top: 22%; right: 22%; font-size: 13px; }
        .thumb-icon-ring {
          position: absolute;
          top: 50%;
          left: 90px;
          transform: translateY(-50%);
          width: 170px;
          height: 170px;
          border-radius: 50%;
          background: rgba(255,255,255,0.16);
          border: 3px solid rgba(255,255,255,0.55);
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 8px 18px rgba(0,0,0,0.25), inset 0 2px 6px rgba(255,255,255,0.3);
        }
        .thumb-icon-ring i {
          font-size: 76px;
          color: #fff;
          filter: drop-shadow(0 3px 4px rgba(0,0,0,0.3));
        }
        .thumb-text {
          position: absolute;
          left: 300px;
          right: 48px;
          top: 0;
          bottom: 0;
          display: flex;
          flex-direction: column;
          justify-content: center;
        }
        .thumb-subtitle {
          color: rgba(255,255,255,0.85);
          font-weight: 700;
          font-size: 15px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          margin-bottom: 10px;
          text-shadow: 0 1px 3px rgba(0,0,0,0.35);
        }
        .thumb-title {
          color: #fff;
          font-weight: 800;
          font-size: 40px;
          line-height: 1.15;
          text-shadow: 0 3px 8px rgba(0,0,0,0.4);
        }
        .thumb-bottom-bar {
          position: absolute;
          left: 0; right: 0; bottom: 0;
          height: 8px;
          background: linear-gradient(90deg, rgba(255,255,255,0.7), rgba(255,255,255,0.15));
        }
      </style>
    </head>
    <body>
      <div class="thumb-shadow-wrap">
        <div class="thumb-card">
          <div class="thumb-blob blob-1"></div>
          <div class="thumb-blob blob-2"></div>
          <div class="thumb-shine"></div>
          <div class="thumb-sparkle sp-1">✦</div>
          <div class="thumb-sparkle sp-2">✦</div>
          <div class="thumb-icon-ring"><i class="${iconClass}"></i></div>
          <div class="thumb-text">
            ${subtitle ? `<div class="thumb-subtitle">${esc(subtitle)}</div>` : ""}
            <div class="thumb-title">${esc(title)}</div>
          </div>
          <div class="thumb-bottom-bar"></div>
        </div>
      </div>
    </body>
    </html>
  `;
}

// index: a stable per-course/per-catalog counter, same convention as
// generateModuleBadge.js — pass the same index used for a module's badge
// so the two come out color-matched.
module.exports = async ({ title, subtitle, index = 0 }) => {
  const code = uuidv4().slice(0, 12);
  const html = buildHtml({ title, subtitle, index });

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath(),
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 860, height: 500, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: "networkidle0" });

    const outputPath = path.join(__dirname, `../tmp/thumb-${code}.png`);
    await page.screenshot({ path: outputPath, omitBackground: true });

    return { outputPath, code };
  } finally {
    await browser.close();
  }
};

module.exports._buildHtml = buildHtml; // exposed for local visual-debugging scripts only
