require.config({
  paths: {
    vs: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/vs",
  },
});

// Set when this editor was opened from a lesson's "Lab Task" tab
// (views/student/dashboard.ejs's loadLabTaskInline) via ?labId=&lessonId= —
// scopes the project to that specific task instead of the student's
// freeform playground project, and changes what Submit does on success.
// Same pattern as public/labs/js/webLab.js.
const LESSON_LAB_ID = new URLSearchParams(window.location.search).get("labId");
const LESSON_ID_FOR_LAB = new URLSearchParams(window.location.search).get("lessonId");

// Mirrors LAB_TEMPLATES.python.starter in controllers/labController.js —
// used by Reset and as the fallback for an empty/legacy project.
const STARTER_TEMPLATE = { code: 'print("Hello, world!")\n' };

// Real code can legitimately run for a while (a loop over real data, a
// numpy computation), but a worker can't be gracefully interrupted
// mid-execution without SharedArrayBuffer — unavailable here (this app
// sets no COOP/COEP headers). So a runaway/infinite loop gets killed
// outright and a fresh worker spins up for the next Run. Matches the
// existing 15-second COMPILE_TIMEOUT_MS precedent in
// services/arduinoCompileService.js.
const RUN_TIMEOUT_MS = 15000;

// Same small, auto-dismissing toast as Web Lab's showToast
// (public/labs/js/webLab.js) — line-for-line analogue, not shared, matching
// how Blockly Lab also keeps its own copy rather than a shared module.
function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = "weblab-toast weblab-toast-" + type;
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => toast.classList.remove("show"), 2200);
  setTimeout(() => toast.remove(), 2600);
}

function appendConsoleEntry(text, level) {
  const output = document.getElementById("consoleOutput");
  const line = document.createElement("div");
  line.className = "console-line console-" + level;
  line.textContent = text; // textContent only — student-printed output is never HTML
  output.appendChild(line);
  output.scrollTop = output.scrollHeight;
}

// --- Execution engine: Pyodide runs inside pythonWorker.js, never on the
// main thread and never on the server — see that file's header comment
// for the full reasoning. This just wires the worker's messages into the
// console panel and the Run button's state. ---
let worker = null;
let runTimeoutHandle = null;
let running = false;
let workerReady = false;

function setStatus(text) {
  const el = document.getElementById("saveStatus");
  if (el) el.textContent = text;
}

function spawnWorker() {
  workerReady = false;
  worker = new Worker("/labs/js/pythonWorker.js");

  worker.onmessage = (event) => {
    const msg = event.data;
    if (msg.type === "ready") {
      workerReady = true;
      document.getElementById("runBtn").disabled = false;
      if (!running) setStatus("Ready");
    } else if (msg.type === "init-error") {
      appendConsoleEntry("[Couldn't start the Python engine: " + msg.message + "]", "error");
      setStatus("Failed to load — try refreshing");
    } else if (msg.type === "stdout") {
      appendConsoleEntry(msg.line, "stdout");
    } else if (msg.type === "stderr") {
      appendConsoleEntry(msg.line, "stderr");
    } else if (msg.type === "done" || msg.type === "run-error") {
      clearTimeout(runTimeoutHandle);
      running = false;
      if (msg.type === "run-error") appendConsoleEntry(msg.message, "error");

      // Respawn a fresh worker after every run, not just after a
      // timeout-kill — matches the plan doc's Section 5.6 recommendation
      // for Phase 1. Pyodide can leave state behind between separate
      // runPythonAsync() calls in the same worker (e.g. an un-flushed
      // partial stdout line from a run that errored right after a
      // no-newline input() prompt bleeds into the next run's output) —
      // a fresh interpreter per Run avoids that whole bug class. Usually
      // invisible: the respawn happens during the student's natural
      // look-at-output pause, and reloads fast from browser cache after
      // the first load.
      document.getElementById("runBtn").disabled = true;
      worker.terminate();
      spawnWorker();
    }
  };

  worker.onerror = () => {
    appendConsoleEntry("[The Python engine crashed — click Run to restart it.]", "error");
    setStatus("Ready");
    running = false;
    document.getElementById("runBtn").disabled = false;
    spawnWorker();
  };

  worker.postMessage({ type: "init" });
}

function runCode() {
  if (running || !workerReady) return;
  running = true;
  document.getElementById("runBtn").disabled = true;
  document.getElementById("consoleOutput").innerHTML = "";
  setStatus("Running…");

  const stdinRaw = document.getElementById("stdinInput").value;
  const stdinLines = stdinRaw ? stdinRaw.split("\n") : [];
  worker.postMessage({ type: "run", code: window.codeEditor.getValue(), stdinLines });

  runTimeoutHandle = setTimeout(() => {
    appendConsoleEntry(`[Timed out after ${RUN_TIMEOUT_MS / 1000}s — stopped. Check for an infinite loop.]`, "error");
    worker.terminate();
    running = false;
    document.getElementById("runBtn").disabled = true;
    setStatus("Restarting…");
    spawnWorker();
  }, RUN_TIMEOUT_MS);
}

async function saveProject(manual) {
  if (!window.currentProjectId) return;

  const payload = {
    projectId: window.currentProjectId,
    projectData: {
      code: window.codeEditor.getValue(),
      stdin: document.getElementById("stdinInput").value,
    },
  };

  try {
    const data = window.OfflineSync
      ? await window.OfflineSync.saveOrQueue("/labs/project/save", payload, `python:${window.currentProjectId}`)
      : await (await fetch("/labs/project/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })).json();

    document.getElementById("saveStatus").textContent = data.queued ? "Saved offline — will sync" : (data.success ? "Saved" : "Save failed");
    if (manual) {
      if (data.queued) showToast("📡 Offline — saved locally, will sync when back online", "info");
      else if (data.success) showToast("💾 Project saved!", "success");
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

async function initLab() {
  try {
    const res = await fetch("/labs/project/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ labType: "python", labId: LESSON_LAB_ID || undefined }),
    });
    const data = await res.json();

    if (!data.success) {
      showToast("Couldn't load your project — please refresh.", "error");
      return;
    }

    window.currentProjectId = data.project.id;
    window.labSubmissionCount = data.submissionCount || 0;
    window.currentProjectStatus = data.project.status;

    const projectData = data.project.project_data || {};
    window.codeEditor.setValue(projectData.code || STARTER_TEMPLATE.code);
    document.getElementById("stdinInput").value = projectData.stdin || "";

    window.autoSaveEnabled = true;
  } catch (err) {
    console.error("INIT ERROR:", err);
    showToast("Couldn't load your project — please refresh.", "error");
  }
}

require(["vs/editor/editor.main"], function () {
  window.codeEditor = monaco.editor.create(document.getElementById("codeEditor"), {
    value: "",
    language: "python",
    automaticLayout: true,
    theme: "vs-dark",
    minimap: { enabled: false },
    stickyScroll: { enabled: false },
    overviewRulerLanes: 0,
    overviewRulerBorder: false,
    hideCursorInOverviewRuler: true,
    fontSize: 16,
    wordWrap: "on",
    autoClosingBrackets: "always",
    autoClosingQuotes: "always",
    autoIndent: "full",
    tabCompletion: "on",
    acceptSuggestionOnEnter: "on",
  });

  document.getElementById("runBtn").addEventListener("click", runCode);
  document.getElementById("saveBtn").addEventListener("click", () => saveProject(true));
  document.getElementById("clearConsoleBtn").addEventListener("click", () => {
    document.getElementById("consoleOutput").innerHTML = "";
  });

  document.getElementById("resetBtn").addEventListener("click", async () => {
    const confirmed = await showConfirm(
      "Reset will discard your code and restore the starter template. This can't be undone.",
      { type: "danger", confirmText: "Reset" }
    );
    if (!confirmed) return;

    window.codeEditor.setValue(STARTER_TEMPLATE.code);
    document.getElementById("stdinInput").value = "";
    autoSave();
    showToast("Project reset to starter template.", "success");
  });

  document.getElementById("stdinInput").addEventListener("input", autoSave);

  document.getElementById("fullscreenBtn").addEventListener("click", () => {
    document.querySelector(".pylab-container").requestFullscreen().catch(() => {
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
        if (data.labFeedback) {
          const scoreLine = data.labFeedback.score !== null ? `Score: ${data.labFeedback.score}/100\n\n` : "";
          const masteryLine = data.labFeedback.masterySignal
            ? `\n\n${data.labFeedback.masterySignal.signalType === "bonus" ? "🌟" : "📘"} ${data.labFeedback.masterySignal.message}`
            : "";
          setTimeout(async () => {
            const buttons = [{ label: "⬅ Back to Lesson", value: "lesson", className: "ui-alert-btn-secondary" }];
            if (data.lessonComplete && data.nextLessonId) {
              buttons.push({ label: "➡️ Proceed to Next Lesson", value: "next", className: "ui-alert-btn-primary" });
            }
            const dialogType = data.labFeedback.score !== null && data.labFeedback.score >= 50 ? "success" : "info";
            const choice = await showActionDialog(`${scoreLine}${data.labFeedback.feedback}${masteryLine}`, dialogType, buttons);
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

      window.currentProjectStatus = "submitted";
    } catch (err) {
      console.error("SUBMIT ERROR:", err);
      showToast("Couldn't submit — try again.", "error");
    }
  });

  window.codeEditor.onDidChangeModelContent(() => {
    autoSave();
  });

  document.getElementById("runBtn").disabled = true; // re-enabled once the worker reports ready
  spawnWorker();
  initLab();
});
