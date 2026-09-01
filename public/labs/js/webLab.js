require.config({
  paths: {
    vs: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/vs",
  },
});

// Set when this editor was opened from a lesson's "Lab Task" tab
// (views/student/dashboard.ejs's loadLabTaskInline) via ?labId=&lessonId= —
// scopes the project to that specific task instead of the student's
// freeform playground project, and changes what Submit does on success.
const LESSON_LAB_ID = new URLSearchParams(window.location.search).get("labId");
// The lesson this task belongs to — used to build the result popup's
// "Back to Lesson" deep link (window.LESSON_MODULE_ID, the other half of
// that link, comes from views/labs/web/editor.ejs's inline script).
const LESSON_ID_FOR_LAB = new URLSearchParams(window.location.search).get("lessonId");

// Fallback shape used by Reset and as the base for legacy-project
// migration — mirrors LAB_TEMPLATES.web.starter in labController.js.
const STARTER_TEMPLATE = {
  pages: [
    { name: "index.html", html: "<h1>Hello World</h1>\n<p>Start building your site!</p>" },
  ],
  css: "body {\n  font-family: sans-serif;\n}",
  js: "",
  activePage: "index.html",
};

const TEMPLATES = {
  basic: {
    pages: [
      { name: "index.html", html: "<h1>My Basic Page</h1>\n<p>Edit this HTML to get started.</p>" },
    ],
    css: "body {\n  font-family: sans-serif;\n  margin: 40px;\n}",
    js: "",
  },
  portfolio: {
    pages: [
      {
        name: "index.html",
        html: "<header>\n  <h1>Jane Doe</h1>\n  <p>Web Developer</p>\n  <nav><a href=\"about.html\">About</a></nav>\n</header>\n<main>\n  <h2>Welcome to my portfolio</h2>\n  <p>A short intro about what you build.</p>\n</main>",
      },
      {
        name: "about.html",
        html: "<h1>About Me</h1>\n<p>Write a little about yourself here.</p>\n<p><a href=\"index.html\">Back to Home</a></p>",
      },
    ],
    css: "body { font-family: sans-serif; margin: 0; }\nheader { background:#222; color:#fff; padding: 30px; text-align:center; }\nnav a { color:#fff; margin: 0 8px; }\nmain { padding: 30px; }",
    js: "",
  },
  landing: {
    pages: [
      {
        name: "index.html",
        html: "<section class=\"hero\">\n  <h1>Big Bold Headline</h1>\n  <p>A short pitch for your product.</p>\n  <button id=\"ctaBtn\">Get Started</button>\n</section>",
      },
    ],
    css: ".hero { text-align:center; padding: 80px 20px; background: linear-gradient(135deg,#4A90D9,#2C5FA8); color:#fff; }\nbutton { padding: 12px 24px; font-size: 16px; border:none; border-radius: 8px; cursor:pointer; background:#fff; color:#2C5FA8; font-weight:600; }",
    js: "document.getElementById('ctaBtn').addEventListener('click', () => alert('Thanks for clicking!'));",
  },
  calculator: {
    pages: [
      {
        name: "index.html",
        html: "<div class=\"calc\">\n  <input id=\"display\" readonly />\n  <div class=\"keys\">\n    <button onclick=\"press('7')\">7</button>\n    <button onclick=\"press('8')\">8</button>\n    <button onclick=\"press('9')\">9</button>\n    <button onclick=\"press('+')\">+</button>\n    <button onclick=\"press('4')\">4</button>\n    <button onclick=\"press('5')\">5</button>\n    <button onclick=\"press('6')\">6</button>\n    <button onclick=\"press('-')\">-</button>\n    <button onclick=\"press('1')\">1</button>\n    <button onclick=\"press('2')\">2</button>\n    <button onclick=\"press('3')\">3</button>\n    <button onclick=\"press('*')\">*</button>\n    <button onclick=\"clearDisplay()\">C</button>\n    <button onclick=\"press('0')\">0</button>\n    <button onclick=\"calculate()\">=</button>\n    <button onclick=\"press('/')\">/</button>\n  </div>\n</div>",
      },
    ],
    css: ".calc { width: 220px; margin: 40px auto; font-family: sans-serif; }\n#display { width: 100%; height: 40px; font-size: 20px; text-align:right; margin-bottom: 8px; box-sizing: border-box; }\n.keys { display:grid; grid-template-columns: repeat(4,1fr); gap: 6px; }\nbutton { padding: 12px; font-size: 16px; cursor:pointer; }",
    js: "function press(v){ document.getElementById('display').value += v; }\nfunction clearDisplay(){ document.getElementById('display').value = ''; }\nfunction calculate(){ try { document.getElementById('display').value = eval(document.getElementById('display').value); } catch(e){ document.getElementById('display').value = 'Error'; } }",
  },
};

// Small, brief, auto-dismissing confirmation — same lifecycle/markup
// pattern as the Blockly Lab's showToast (public/labs/js/blocklyLab.js).
function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = "weblab-toast weblab-toast-" + type;
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => toast.classList.remove("show"), 2200);
  setTimeout(() => toast.remove(), 2600);
}

// project_data can be the CURRENT {pages,css,js,activePage} shape, or the
// legacy flat {html,css,js} shape saved before multi-page support existed
// (real projects with that old shape already exist in the DB) — normalize
// once at load time so every other function only ever deals with `pages`.
function normalizeProjectData(raw) {
  if (raw && Array.isArray(raw.pages) && raw.pages.length) {
    const pages = raw.pages.map((p) => ({ name: p.name, html: p.html || "" }));
    const activePage = raw.activePage && pages.some((p) => p.name === raw.activePage)
      ? raw.activePage
      : pages[0].name;
    return { pages, css: raw.css || "", js: raw.js || "", activePage };
  }
  return {
    pages: [{ name: "index.html", html: (raw && raw.html) || "" }],
    css: (raw && raw.css) || "",
    js: (raw && raw.js) || "",
    activePage: "index.html",
  };
}

function getPageHtml(pageName) {
  if (pageName === window.activePageName) return htmlEditor.getValue();
  const page = window.pages.find((p) => p.name === pageName);
  return page ? page.html : "<h1>Page not found</h1>";
}

// Injected into every preview build: intercepts clicks on internal links
// (so "navigating" to another page doesn't just error inside srcdoc, which
// can't load separate files) and mirrors console.log/warn/error + runtime
// errors back to the parent so they can show up in the Console panel —
// previously there was zero visibility into a student's JS errors.
function buildInjectedScript() {
  return `
<script>
(function () {
  document.addEventListener("click", function (e) {
    const a = e.target.closest("a");
    if (!a) return;
    const href = a.getAttribute("href");
    if (!href || /^([a-z]+:)?\\/\\//i.test(href) || href.startsWith("#") || href.startsWith("mailto:")) return;
    e.preventDefault();
    parent.postMessage({ type: "weblab-navigate", page: href }, "*");
  });

  function serialize(a) {
    try { return typeof a === "object" ? JSON.stringify(a) : String(a); }
    catch (e) { return String(a); }
  }

  ["log", "warn", "error", "info"].forEach(function (level) {
    const orig = console[level];
    console[level] = function () {
      const args = Array.prototype.slice.call(arguments);
      try {
        parent.postMessage({ type: "weblab-console", level: level, args: args.map(serialize) }, "*");
      } catch (e) {}
      orig.apply(console, args);
    };
  });

  window.addEventListener("error", function (e) {
    parent.postMessage({ type: "weblab-console", level: "error", args: [e.message + " (line " + e.lineno + ")"] }, "*");
  });
})();
<\/script>`;
}

function buildPreviewHtml(pageName) {
  const css = cssEditor.getValue();
  const js = jsEditor.getValue();
  const html = getPageHtml(pageName);

  return `
<!DOCTYPE html>
<html>
<head>
${buildInjectedScript()}
<style>
${css}
</style>
</head>
<body>
${html}
<script>
${js}
<\/script>
</body>
</html>`;
}

let runTimeout;
function scheduleRun() {
  clearTimeout(runTimeout);
  runTimeout = setTimeout(runCode, 400);
}

function runCode() {
  document.getElementById("consoleOutput").innerHTML = "";
  const iframe = document.getElementById("preview");
  iframe.srcdoc = buildPreviewHtml(window.activePageName);
}

function appendConsoleEntry(level, args) {
  const output = document.getElementById("consoleOutput");
  const line = document.createElement("div");
  line.className = "console-line console-" + level;
  line.textContent = (args || []).join(" ");
  output.appendChild(line);
  output.scrollTop = output.scrollHeight;
}

function renderPageTabs() {
  const container = document.getElementById("pageTabs");
  container.querySelectorAll(".page-tab").forEach((el) => el.remove());
  const addBtn = document.getElementById("addPageBtn");

  window.pages.forEach((page) => {
    const tab = document.createElement("div");
    tab.className = "page-tab" + (page.name === window.activePageName ? " active" : "");

    const nameSpan = document.createElement("span");
    nameSpan.className = "page-tab-name";
    nameSpan.textContent = page.name;
    nameSpan.addEventListener("click", () => switchToPage(page.name));
    tab.appendChild(nameSpan);

    if (window.pages.length > 1) {
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "page-tab-delete";
      delBtn.innerHTML = "&times;";
      delBtn.title = "Delete page";
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        deletePage(page.name);
      });
      tab.appendChild(delBtn);
    }

    container.insertBefore(tab, addBtn);
  });

  document.getElementById("activePageLabel").textContent = window.activePageName;
}

function switchToPage(name) {
  const target = window.pages.find((p) => p.name === name);
  if (!target) return;

  const outgoing = window.pages.find((p) => p.name === window.activePageName);
  if (outgoing) outgoing.html = htmlEditor.getValue();

  window.activePageName = name;
  htmlEditor.setValue(target.html);
  renderPageTabs();
  runCode();
}

function addPage() {
  let name = prompt("New page name (e.g. about.html):");
  if (!name) return;
  name = name.trim();
  if (!name) return;
  if (!/\.html?$/i.test(name)) name += ".html";

  if (window.pages.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    showToast("A page with that name already exists.", "error");
    return;
  }

  const outgoing = window.pages.find((p) => p.name === window.activePageName);
  if (outgoing) outgoing.html = htmlEditor.getValue();

  const title = name.replace(/\.html?$/i, "");
  window.pages.push({
    name,
    html: `<h1>${title}</h1>\n<p><a href="index.html">Back to Home</a></p>`,
  });
  switchToPage(name);
  autoSave();
  showToast(`Page "${name}" added!`, "success");
}

async function deletePage(name) {
  if (window.pages.length <= 1) return;
  const confirmed = await showConfirm(`Delete "${name}"? This can't be undone.`, {
    type: "danger",
    confirmText: "Delete",
  });
  if (!confirmed) return;

  window.pages = window.pages.filter((p) => p.name !== name);

  if (window.activePageName === name) {
    window.activePageName = window.pages[0].name;
    htmlEditor.setValue(window.pages[0].html);
    runCode();
  }

  renderPageTabs();
  autoSave();
  showToast(`Page "${name}" deleted.`, "info");
}

async function saveProject(manual) {
  if (!window.currentProjectId) return;

  const activePage = window.pages.find((p) => p.name === window.activePageName);
  if (activePage) activePage.html = htmlEditor.getValue();

  const payload = {
    projectId: window.currentProjectId,
    projectData: {
      pages: window.pages,
      css: cssEditor.getValue(),
      js: jsEditor.getValue(),
      activePage: window.activePageName,
    },
  };

  try {
    const res = await fetch("/labs/project/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    document.getElementById("saveStatus").textContent = data.success ? "Saved" : "Save failed";
    if (manual) {
      if (data.success) showToast("💾 Project saved!", "success");
      else showToast("Couldn't save — try again.", "error");
    }
  } catch (err) {
    console.error("SAVE ERROR:", err);
    document.getElementById("saveStatus").textContent = "Save failed";
    if (manual) showToast("Couldn't save — try again.", "error");
  }
}

let saveTimeout;
function autoSave() {
  if (!window.autoSaveEnabled) return;
  document.getElementById("saveStatus").textContent = "Saving…";
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => saveProject(false), 5000);
}

async function initLab(labType) {
  try {
    const res = await fetch("/labs/project/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ labType, labId: LESSON_LAB_ID || undefined }),
    });
    const data = await res.json();

    if (!data.success) {
      showToast("Couldn't load your project — please refresh.", "error");
      return;
    }

    window.currentProjectId = data.project.id;
    // Only meaningful for a lesson-attached task (LESSON_LAB_ID set) — how
    // many times it's already been AI-graded, for the resubmit confirm
    // message and the MAX_LAB_SUBMISSIONS cap below.
    window.labSubmissionCount = data.submissionCount || 0;

    const normalized = normalizeProjectData(data.project.project_data);
    window.pages = normalized.pages;
    window.activePageName = normalized.activePage;

    cssEditor.setValue(normalized.css);
    jsEditor.setValue(normalized.js);
    htmlEditor.setValue((window.pages.find((p) => p.name === window.activePageName) || window.pages[0]).html);

    renderPageTabs();
    runCode();

    window.autoSaveEnabled = true;
  } catch (err) {
    console.error("INIT ERROR:", err);
    showToast("Couldn't load your project — please refresh.", "error");
  }
}

window.addEventListener("message", (e) => {
  const data = e.data;
  if (!data || typeof data !== "object") return;

  if (data.type === "weblab-navigate") {
    const match = window.pages.find((p) => p.name.toLowerCase() === String(data.page).toLowerCase());
    if (match) switchToPage(match.name);
  } else if (data.type === "weblab-console") {
    appendConsoleEntry(data.level, data.args);
  }
});

require(["vs/editor/editor.main"], function () {
  // JS pane gets real IntelliSense (DOM globals etc.), not just bracket
  // matching — previously only HTML/CSS had suggestion options set at all.
  // `lib` is what actually teaches the language service about `document`/
  // `window`/etc. — without it, completions on `document.` come back
  // empty even with quickSuggestions/suggestOnTriggerCharacters enabled.
  if (window.monaco.languages.typescript && window.monaco.languages.typescript.javascriptDefaults) {
    monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
      allowNonTsExtensions: true,
      target: monaco.languages.typescript.ScriptTarget.ES2020,
      lib: ["es2020", "dom"],
    });
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
      // Syntax errors (real typos/broken code) stay on; semantic/type
      // errors stay off — a beginner's JS calling an inline onclick
      // handler or using a loose global shouldn't be red-squiggled as
      // "wrong" the way TypeScript would treat it.
      noSemanticValidation: true,
      noSyntaxValidation: false,
    });
  }

  // One shared options object applied identically to all three editors —
  // previously HTML got the full set, CSS a reduced set, and JS almost
  // none, which is very likely why "code completion" felt broken.
  const sharedOptions = {
    automaticLayout: true,
    theme: "vs-dark",
    minimap: { enabled: false },
    // Monaco's "sticky scroll" (a floating bar + drop-shadow pinned to the
    // top showing the enclosing tag/block while scrolling) is proportionally
    // huge in these short, stacked editor panes — its box-shadow reads as a
    // big gray/white gradient band across most of the visible code.
    stickyScroll: { enabled: false },
    // The actual main cause of that gray band: Monaco's decorationsOverviewRuler
    // canvas ends up with its internal pixel buffer sized for the editor's
    // real height (~175px) while its CSS-rendered height gets stuck at a
    // stale, much taller value (~6725px seen in testing) in this
    // flex-nested, toggle-visibility layout — the browser then stretches
    // that tiny bitmap ~38x, which reads as a blurry gradient smear.
    // Disabling the ruler removes the mis-sized canvas entirely.
    overviewRulerLanes: 0,
    overviewRulerBorder: false,
    hideCursorInOverviewRuler: true,
    fontSize: 16,
    wordWrap: "on",
    autoClosingBrackets: "always",
    autoClosingQuotes: "always",
    autoIndent: "full",
    formatOnPaste: true,
    formatOnType: true,
    suggestOnTriggerCharacters: true,
    quickSuggestions: true,
    tabCompletion: "on",
    acceptSuggestionOnEnter: "on",
  };

  window.htmlEditor = monaco.editor.create(document.getElementById("htmlEditor"), {
    ...sharedOptions,
    value: "",
    language: "html",
  });

  window.cssEditor = monaco.editor.create(document.getElementById("cssEditor"), {
    ...sharedOptions,
    value: "",
    language: "css",
  });

  window.jsEditor = monaco.editor.create(document.getElementById("jsEditor"), {
    ...sharedOptions,
    value: "",
    language: "javascript",
  });

  document.getElementById("runBtn").addEventListener("click", runCode);
  document.getElementById("saveBtn").addEventListener("click", () => saveProject(true));
  document.getElementById("addPageBtn").addEventListener("click", addPage);
  document.getElementById("clearConsoleBtn").addEventListener("click", () => {
    document.getElementById("consoleOutput").innerHTML = "";
  });

  document.getElementById("resetBtn").addEventListener("click", async () => {
    const confirmed = await showConfirm(
      "Reset will discard all your pages, CSS, and JS and restore the starter template. This can't be undone.",
      { type: "danger", confirmText: "Reset" }
    );
    if (!confirmed) return;

    window.pages = STARTER_TEMPLATE.pages.map((p) => ({ ...p }));
    window.activePageName = STARTER_TEMPLATE.activePage;
    cssEditor.setValue(STARTER_TEMPLATE.css);
    jsEditor.setValue(STARTER_TEMPLATE.js);
    htmlEditor.setValue(window.pages[0].html);
    renderPageTabs();
    runCode();
    autoSave();
    showToast("Project reset to starter template.", "success");
  });

  document.getElementById("templateSelect").addEventListener("change", async (e) => {
    const key = e.target.value;
    e.target.value = "";
    if (!key || !TEMPLATES[key]) return;

    const confirmed = await showConfirm(
      "This will replace your current pages, CSS, and JS with the template. Continue?",
      { type: "danger", confirmText: "Replace" }
    );
    if (!confirmed) return;

    const tpl = TEMPLATES[key];
    window.pages = tpl.pages.map((p) => ({ ...p }));
    window.activePageName = window.pages[0].name;
    cssEditor.setValue(tpl.css);
    jsEditor.setValue(tpl.js);
    htmlEditor.setValue(window.pages[0].html);
    renderPageTabs();
    runCode();
    autoSave();
    showToast(`Loaded "${key}" template!`, "success");
  });

  document.getElementById("fullscreenBtn").addEventListener("click", () => {
    document.querySelector(".weblab-container").requestFullscreen().catch(() => {
      showAlert("Fullscreen isn't available right now.");
    });
  });
  document.getElementById("exitFullscreenBtn").addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen();
  });
  document.addEventListener("fullscreenchange", () => {
    const isFs = !!document.fullscreenElement;
    document.getElementById("fullscreenBtn").style.display = isFs ? "none" : "inline-flex";
    document.getElementById("exitFullscreenBtn").style.display = isFs ? "inline-flex" : "none";
  });

  const MAX_LAB_SUBMISSIONS = 3; // must match controllers/labController.js

  document.getElementById("submitBtn").addEventListener("click", async () => {
    if (!window.currentProjectId) return;

    if (LESSON_LAB_ID && (window.labSubmissionCount || 0) >= MAX_LAB_SUBMISSIONS) {
      showAlert(`You've used all ${MAX_LAB_SUBMISSIONS} submissions for this task.`);
      return;
    }

    const confirmMessage = LESSON_LAB_ID && window.labSubmissionCount > 0
      ? `You've already submitted this task and it was graded. Submit again for updated feedback? (attempt ${window.labSubmissionCount + 1} of ${MAX_LAB_SUBMISSIONS})`
      : LESSON_LAB_ID
        ? "Submit this lab task? This will complete it and get you AI feedback."
        : "Submit this project? Your teacher/classmates may review it.";
    const confirmed = await showConfirm(confirmMessage, { confirmText: "Submit" });
    if (!confirmed) return;

    await saveProject(false);

    try {
      const res = await fetch("/labs/project/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: window.currentProjectId }),
      });
      const data = await res.json();

      if (!data.success) {
        showToast(data.message || "Couldn't submit — try again.", "error");
        return;
      }

      if (typeof data.submissionCount === "number") {
        window.labSubmissionCount = data.submissionCount;
      }

      if (LESSON_LAB_ID) {
        // Lesson-attached task — submitting completes the LAB and pays its
        // own XP; the lesson only fully "completes" (unlocks the next one)
        // once every part it has is done — see
        // services/lessonCompletionService.js:maybeUnlockNextLesson. A
        // lesson with a quiz still pending won't unlock yet even on a
        // successful first lab submission.
        if (data.isFirstSubmission) {
          if (data.lessonComplete) {
            showToast(`🎉 Lesson complete! +${data.xpGained} XP, +${data.coinsGained} coins`, "success");
          } else {
            showToast(`✅ Lab task submitted! +${data.xpGained} XP, +${data.coinsGained} coins`, "success");
          }
          if (data.levelUp) {
            setTimeout(() => showToast("🎊 Level up!", "success"), 1300);
          }
        } else {
          showToast("Task re-submitted!", "success");
        }
        // AI-graded feedback (controllers/labController.js's
        // gradeLessonLabSubmission) — a result popup with real next steps
        // instead of a plain OK-only alert: always offers "Back to
        // Lesson", plus "Proceed to Next Lesson" when this submission was
        // the one that actually unlocked it.
        if (data.labFeedback) {
          const scoreLine = data.labFeedback.score !== null ? `Score: ${data.labFeedback.score}/100\n\n` : "";
          setTimeout(async () => {
            const buttons = [{ label: "⬅ Back to Lesson", value: "lesson", className: "ui-alert-btn-secondary" }];
            if (data.lessonComplete && data.nextLessonId) {
              buttons.push({ label: "➡️ Proceed to Next Lesson", value: "next", className: "ui-alert-btn-primary" });
            }
            const dialogType = data.labFeedback.score !== null && data.labFeedback.score >= 50 ? "success" : "info";
            const choice = await showActionDialog(`${scoreLine}${data.labFeedback.feedback}`, dialogType, buttons);
            if (choice === "lesson" && LESSON_ID_FOR_LAB) {
              window.location.href = `/student/dashboard?section=module&moduleId=${window.LESSON_MODULE_ID}&openLesson=${LESSON_ID_FOR_LAB}`;
            } else if (choice === "next" && data.nextLessonId) {
              window.location.href = `/student/dashboard?section=module&moduleId=${data.nextLessonModuleId}&openLesson=${data.nextLessonId}`;
            }
          }, 600);
        }
      } else if (data.isFirstSubmission) {
        showToast(`🎉 Project submitted! +${data.xpGained} XP, +${data.coinsGained} coins`, "success");
        if (data.levelUp) {
          setTimeout(() => showToast("🎊 Level up!", "success"), 1300);
        }
      } else {
        showToast("Project re-submitted!", "success");
      }
    } catch (err) {
      console.error("SUBMIT ERROR:", err);
      showToast("Couldn't submit — try again.", "error");
    }
  });

  document.querySelectorAll(".preview-viewport-toggle button").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".preview-viewport-toggle button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelector(".preview-frame-wrap").style.setProperty("--preview-width", btn.dataset.width);
    });
  });

  // Thin sidebar toggles for which editor pane(s) are visible — hiding
  // one lets the remaining one(s) expand to fill the space instead of
  // always splitting three ways, so a single pane can go "full height".
  const EDITORS_BY_KEY = { html: htmlEditor, css: cssEditor, js: jsEditor };
  document.querySelectorAll(".ev-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.target;
      const card = document.querySelector(`.editor-card[data-editor="${key}"]`);
      const isCurrentlyActive = btn.classList.contains("active");

      if (isCurrentlyActive && document.querySelectorAll(".ev-toggle.active").length === 1) {
        showToast("At least one editor has to stay visible.", "error");
        return;
      }

      btn.classList.toggle("active");
      card.style.display = btn.classList.contains("active") ? "flex" : "none";

      // Editors hidden via display:none report zero size — force a fresh
      // layout pass on all three once the newly-visible one(s) actually
      // have real dimensions again, rather than waiting on Monaco's own
      // automaticLayout polling to notice.
      setTimeout(() => {
        Object.values(EDITORS_BY_KEY).forEach((ed) => ed.layout());
      }, 50);
    });
  });

  htmlEditor.onDidChangeModelContent(() => {
    scheduleRun();
    autoSave();
  });
  cssEditor.onDidChangeModelContent(() => {
    scheduleRun();
    autoSave();
  });
  jsEditor.onDidChangeModelContent(() => {
    scheduleRun();
    autoSave();
  });

  initLab("web");
});
