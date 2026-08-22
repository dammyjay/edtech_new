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

// Same thirty gem tones as generateModuleBadge.js's PALETTE, kept in sync
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
  ["#FFA3F0", "#C230A8", "#5E1352"], // magenta
  ["#A6E9FF", "#1C8FC9", "#0B4568"], // sky/cyan
  ["#D4FF9E", "#6EA82A", "#365A12"], // lime
  ["#FFEA9E", "#D9A521", "#6B4E0A"], // amber
  ["#C3B8FF", "#5539C9", "#2A1B68"], // indigo
  ["#FFB3C1", "#D63A5C", "#6B1526"], // rose
  ["#B8D4FF", "#3B6EC9", "#1C3568"], // steel blue
  ["#A6FFDA", "#1CA872", "#0C5238"], // mint
  ["#FFB09E", "#D9552E", "#6B2510"], // coral
  ["#E0A8E9", "#8B3AB2", "#451858"], // plum
  ["#9EF5EA", "#1C9C93", "#0C4D48"], // turquoise
  ["#E4FFA0", "#9CBF2C", "#4A5C14"], // chartreuse
  ["#E9A0A6", "#8B2C36", "#451418"], // maroon
  ["#A0B8E9", "#2C4B8B", "#142445"], // navy
  ["#FFC0A0", "#D97A4C", "#6B3C24"], // salmon
  ["#E0DFA0", "#8B892C", "#454414"], // olive
  ["#E9A0BC", "#8B2C52", "#451428"], // burgundy
  ["#A0EFFF", "#2C9CC9", "#144D68"], // aqua
  ["#FFF0A0", "#E0C42C", "#705E14"], // sunflower
  ["#A0F5C0", "#159C56", "#0A4E2A"], // emerald
  ["#A0C0FF", "#2C5CC9", "#142C68"], // sapphire
  ["#C8A0FF", "#6B2CC9", "#351468"], // amethyst
];

function pickColor(index) {
  const safeIndex = ((Number(index) || 0) % PALETTE.length + PALETTE.length) % PALETTE.length;
  return PALETTE[safeIndex];
}

// Font Awesome 6 (loaded via CDN in the template below) icon per topic
// keyword, so the thumbnail has some visual relevance to its subject
// instead of always showing the same generic icon. Large, broad catalog on
// purpose — this app's catalog spans far more than just programming
// courses, and a bigger keyword list means fewer titles fall back to the
// generic graduation cap. Order matters (first match wins): the original
// core programming-concept entries stay first so existing behavior for
// already-matching titles doesn't change; everything else is appended
// after, grouped by subject area.
const KEYWORD_ICONS = [
  // ---- original core CS entries (unchanged, kept first) ----
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

  // ---- programming languages & platforms ----
  [/typescript|\bts\b/i, "fa-solid fa-code"],
  [/\bjava\b(?!script)/i, "fa-brands fa-java"],
  [/c\+\+|cplusplus/i, "fa-solid fa-code"],
  [/c#|csharp|\.net|dotnet/i, "fa-solid fa-code"],
  [/\bphp\b/i, "fa-brands fa-php"],
  [/\bswift\b/i, "fa-brands fa-swift"],
  [/kotlin/i, "fa-solid fa-mobile-screen-button"],
  [/\bgolang\b|\bgo lang/i, "fa-solid fa-code"],
  [/\brust\b/i, "fa-solid fa-gears"],
  [/\bruby\b(?!\s*(red|stone))/i, "fa-solid fa-gem"],
  [/\bscala\b/i, "fa-solid fa-code"],
  [/\bperl\b/i, "fa-solid fa-code"],
  [/\br programming|\br language|\br studio/i, "fa-solid fa-chart-line"],
  [/matlab/i, "fa-solid fa-chart-line"],
  [/\bdart\b/i, "fa-solid fa-mobile-screen-button"],
  [/\blua\b/i, "fa-solid fa-code"],
  [/haskell|functional programming/i, "fa-solid fa-code"],
  [/html|css|stylesheet/i, "fa-brands fa-html5"],
  [/\breact\b/i, "fa-brands fa-react"],
  [/node\.?js|express\.?js/i, "fa-brands fa-node-js"],
  [/angular/i, "fa-brands fa-angular"],
  [/vue\.?js/i, "fa-brands fa-vuejs"],
  [/wordpress/i, "fa-brands fa-wordpress"],
  [/shopify/i, "fa-brands fa-shopify"],
  [/\bgit\b|version control/i, "fa-brands fa-git-alt"],
  [/github/i, "fa-brands fa-github"],
  [/docker|container/i, "fa-brands fa-docker"],
  [/\baws\b|amazon web services/i, "fa-brands fa-aws"],
  [/linux/i, "fa-brands fa-linux"],
  [/android/i, "fa-brands fa-android"],
  [/\bios\b|iphone|xcode/i, "fa-brands fa-apple"],
  [/raspberry pi/i, "fa-brands fa-raspberry-pi"],
  [/figma/i, "fa-brands fa-figma"],
  [/google/i, "fa-brands fa-google"],

  // ---- core CS / programming concepts ----
  [/algorithm/i, "fa-solid fa-diagram-project"],
  [/data structure/i, "fa-solid fa-sitemap"],
  [/recursion|recursive/i, "fa-solid fa-rotate"],
  [/sort(ing)?/i, "fa-solid fa-arrow-down-a-z"],
  [/search(ing)?/i, "fa-solid fa-magnifying-glass"],
  [/pointer/i, "fa-solid fa-arrow-right"],
  [/object[- ]oriented|\boop\b|\bclass\b/i, "fa-solid fa-cubes"],
  [/inheritance|polymorphism/i, "fa-solid fa-diagram-project"],
  [/\bapi\b/i, "fa-solid fa-plug"],
  [/debug(ging)?/i, "fa-solid fa-bug"],
  [/compiler|syntax/i, "fa-solid fa-terminal"],
  [/pseudocode|flowchart/i, "fa-solid fa-diagram-project"],
  [/binary|bitwise/i, "fa-solid fa-code"],
  [/version control|source control/i, "fa-brands fa-git-alt"],
  [/terminal|command line|shell scripting/i, "fa-solid fa-terminal"],
  [/software engineering|programming fundamentals/i, "fa-solid fa-laptop-code"],
  [/variable\b/i, "fa-solid fa-code"],

  // ---- AI / ML / data ----
  [/deep learning|neural network/i, "fa-solid fa-brain"],
  [/chatbot|conversational ai/i, "fa-solid fa-comments"],
  [/computer vision|image recognition/i, "fa-solid fa-eye"],
  [/natural language processing|\bnlp\b/i, "fa-solid fa-comments"],
  [/data science/i, "fa-solid fa-chart-line"],
  [/big data/i, "fa-solid fa-database"],
  [/data analysis|data analytics/i, "fa-solid fa-chart-bar"],
  [/statistics|statistical/i, "fa-solid fa-chart-pie"],
  [/prediction|forecasting/i, "fa-solid fa-chart-line"],
  [/data visualization/i, "fa-solid fa-chart-pie"],

  // ---- web / app dev ----
  [/website|frontend|front-end/i, "fa-solid fa-globe"],
  [/backend|back-end|server[- ]side/i, "fa-solid fa-server"],
  [/full[- ]?stack/i, "fa-solid fa-layer-group"],
  [/responsive/i, "fa-solid fa-mobile-screen-button"],
  [/hosting|deployment|deploy/i, "fa-solid fa-cloud-arrow-up"],
  [/\bcloud\b/i, "fa-solid fa-cloud"],
  [/devops/i, "fa-solid fa-gears"],
  [/e-?commerce|online store/i, "fa-solid fa-cart-shopping"],
  [/wireframe|prototyp(e|ing)/i, "fa-solid fa-draw-polygon"],

  // ---- game dev ----
  [/unity|unreal engine|game engine/i, "fa-solid fa-gamepad"],
  [/sprite|level design/i, "fa-solid fa-shapes"],
  [/virtual reality|\bvr\b/i, "fa-solid fa-vr-cardboard"],
  [/augmented reality|\bar\b/i, "fa-solid fa-cube"],
  [/esports|e-sports/i, "fa-solid fa-trophy"],
  [/chess/i, "fa-solid fa-chess"],
  [/puzzle/i, "fa-solid fa-puzzle-piece"],

  // ---- cybersecurity / networking ----
  [/cybersecurity|cyber security|\bhacking\b|ethical hacking/i, "fa-solid fa-shield-halved"],
  [/encryption|cryptograph/i, "fa-solid fa-lock"],
  [/firewall/i, "fa-solid fa-shield-halved"],
  [/password/i, "fa-solid fa-key"],
  [/\bnetwork(ing)?\b/i, "fa-solid fa-network-wired"],
  [/\bvpn\b/i, "fa-solid fa-user-secret"],
  [/malware|virus|phishing/i, "fa-solid fa-bug"],
  [/\bwifi\b/i, "fa-solid fa-wifi"],

  // ---- hardware / robotics / IoT ----
  [/robotics/i, "fa-solid fa-robot"],
  [/hardware|circuit|electronics/i, "fa-solid fa-microchip"],
  [/sensor/i, "fa-solid fa-satellite-dish"],
  [/arduino/i, "fa-solid fa-microchip"],
  [/internet of things|\biot\b/i, "fa-solid fa-network-wired"],
  [/drone/i, "fa-solid fa-plane"],
  [/3d print(ing)?/i, "fa-solid fa-cube"],
  [/battery|power supply/i, "fa-solid fa-battery-full"],
  [/solar|renewable energy/i, "fa-solid fa-solar-panel"],

  // ---- business / entrepreneurship ----
  [/entrepreneurship|startup/i, "fa-solid fa-rocket"],
  [/\bbusiness\b/i, "fa-solid fa-briefcase"],
  [/marketing|digital marketing/i, "fa-solid fa-bullseye"],
  [/\bfinance\b|financial/i, "fa-solid fa-sack-dollar"],
  [/accounting|bookkeeping/i, "fa-solid fa-calculator"],
  [/economics/i, "fa-solid fa-chart-line"],
  [/management|leadership/i, "fa-solid fa-people-group"],
  [/\bsales\b/i, "fa-solid fa-handshake"],
  [/branding/i, "fa-solid fa-bullseye"],
  [/investment|investing|stock market/i, "fa-solid fa-chart-line"],
  [/negotiation/i, "fa-solid fa-handshake"],
  [/project management/i, "fa-solid fa-clipboard-list"],
  [/human resources|\bhr\b/i, "fa-solid fa-people-group"],
  [/real estate/i, "fa-solid fa-house"],
  [/supply chain|logistics/i, "fa-solid fa-truck"],

  // ---- creative / design ----
  [/\bart\b|drawing|sketch/i, "fa-solid fa-paintbrush"],
  [/painting/i, "fa-solid fa-paintbrush"],
  [/photography|photo editing/i, "fa-solid fa-camera"],
  [/video editing/i, "fa-solid fa-film"],
  [/graphic design/i, "fa-solid fa-palette"],
  [/illustration/i, "fa-solid fa-pen-nib"],
  [/3d modeling|cgi/i, "fa-solid fa-cube"],
  [/music production/i, "fa-solid fa-music"],
  [/sound design|audio engineering/i, "fa-solid fa-headphones"],
  [/fashion design/i, "fa-solid fa-shirt"],
  [/interior design/i, "fa-solid fa-couch"],
  [/creative writing|storytelling/i, "fa-solid fa-feather"],
  [/animation studio|motion graphics/i, "fa-solid fa-film"],
  [/typography/i, "fa-solid fa-font"],

  // ---- music ----
  [/singing|vocal/i, "fa-solid fa-microphone"],
  [/guitar/i, "fa-solid fa-music"],
  [/piano|keyboard music/i, "fa-solid fa-music"],
  [/drums|percussion/i, "fa-solid fa-drum"],
  [/\bdj\b|mixing/i, "fa-solid fa-headphones"],
  [/composition|songwriting/i, "fa-solid fa-music"],
  [/orchestra|band\b/i, "fa-solid fa-music"],

  // ---- science ----
  [/\bscience\b/i, "fa-solid fa-flask"],
  [/physics/i, "fa-solid fa-atom"],
  [/chemistry/i, "fa-solid fa-flask-vial"],
  [/biology/i, "fa-solid fa-dna"],
  [/astronomy|space exploration/i, "fa-solid fa-satellite"],
  [/\benvironment(al)?\b|climate/i, "fa-solid fa-leaf"],
  [/ecology|sustainability/i, "fa-solid fa-seedling"],
  [/genetics/i, "fa-solid fa-dna"],
  [/anatomy|physiology/i, "fa-solid fa-lungs"],
  [/medicine|medical/i, "fa-solid fa-stethoscope"],
  [/\bhealth\b|healthcare/i, "fa-solid fa-heart-pulse"],
  [/nutrition|diet/i, "fa-solid fa-apple-whole"],
  [/engineering/i, "fa-solid fa-gears"],
  [/mechanical/i, "fa-solid fa-gears"],
  [/electrical/i, "fa-solid fa-bolt"],
  [/civil engineering|architecture/i, "fa-solid fa-city"],
  [/geology/i, "fa-solid fa-mountain"],
  [/meteorology|weather/i, "fa-solid fa-cloud-sun"],
  [/oceanography|marine biology/i, "fa-solid fa-water"],

  // ---- math ----
  [/\bmath(s|ematics)?\b/i, "fa-solid fa-square-root-variable"],
  [/algebra/i, "fa-solid fa-square-root-variable"],
  [/geometry/i, "fa-solid fa-draw-polygon"],
  [/calculus/i, "fa-solid fa-chart-line"],
  [/trigonometry/i, "fa-solid fa-ruler-combined"],
  [/arithmetic/i, "fa-solid fa-calculator"],
  [/probability/i, "fa-solid fa-dice"],

  // ---- language arts / humanities ----
  [/\benglish\b/i, "fa-solid fa-book-open"],
  [/creative writing|essay writing|\bwriting\b/i, "fa-solid fa-pen-nib"],
  [/literature/i, "fa-solid fa-book"],
  [/grammar/i, "fa-solid fa-spell-check"],
  [/reading comprehension|\breading\b/i, "fa-solid fa-book-open"],
  [/spelling|vocabulary/i, "fa-solid fa-spell-check"],
  [/\bhistory\b/i, "fa-solid fa-landmark"],
  [/geography/i, "fa-solid fa-earth-americas"],
  [/social studies|civics/i, "fa-solid fa-people-group"],
  [/philosophy/i, "fa-solid fa-book"],
  [/psychology/i, "fa-solid fa-brain"],
  [/sociology/i, "fa-solid fa-people-group"],
  [/religion|theology/i, "fa-solid fa-hands-praying"],
  [/law\b|legal studies/i, "fa-solid fa-gavel"],

  // ---- languages ----
  [/spanish/i, "fa-solid fa-language"],
  [/french\b/i, "fa-solid fa-language"],
  [/german\b/i, "fa-solid fa-language"],
  [/chinese|mandarin/i, "fa-solid fa-language"],
  [/arabic/i, "fa-solid fa-language"],
  [/japanese/i, "fa-solid fa-language"],
  [/korean/i, "fa-solid fa-language"],
  [/language learning|foreign language/i, "fa-solid fa-language"],
  [/translation|translator/i, "fa-solid fa-language"],

  // ---- soft skills / life skills ----
  [/communication skills/i, "fa-solid fa-comments"],
  [/teamwork|collaboration/i, "fa-solid fa-people-group"],
  [/public speaking|presentation/i, "fa-solid fa-microphone"],
  [/critical thinking|problem solving/i, "fa-solid fa-lightbulb"],
  [/time management|productivity/i, "fa-solid fa-clock"],
  [/\bcareer\b|resume|interview/i, "fa-solid fa-briefcase"],
  [/goal setting|mindset/i, "fa-solid fa-bullseye"],
  [/financial literacy|budgeting/i, "fa-solid fa-sack-dollar"],
  [/cooking|culinary/i, "fa-solid fa-utensils"],
  [/life skills/i, "fa-solid fa-lightbulb"],
  [/parenting/i, "fa-solid fa-child"],

  // ---- sports / fitness / misc ----
  [/\bsports\b/i, "fa-solid fa-futbol"],
  [/fitness|workout|exercise/i, "fa-solid fa-dumbbell"],
  [/\byoga\b/i, "fa-solid fa-person-running"],
  [/football|soccer/i, "fa-solid fa-futbol"],
  [/basketball/i, "fa-solid fa-basketball"],
  [/gardening/i, "fa-solid fa-seedling"],
  [/travel|tourism/i, "fa-solid fa-plane"],
  [/photography/i, "fa-solid fa-camera"],
  [/certificate|certification/i, "fa-solid fa-certificate"],
  [/award|achievement/i, "fa-solid fa-award"],
  [/introduction|beginner|fundamentals|basics/i, "fa-solid fa-lightbulb"],
  [/advanced|mastery|expert/i, "fa-solid fa-crown"],
  [/project\b/i, "fa-solid fa-diagram-project"],
  [/quiz|assessment|exam/i, "fa-solid fa-clipboard-list"],
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
