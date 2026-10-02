// Shared "run this Python code read-only" widget — used wherever a saved
// Python Lab project needs to actually execute instead of just showing
// static text: the in-app gallery modal (labGallery.js), the admin
// moderation modal (projectGalleryModeration.ejs), and the public, no-login
// showcase (showcaseProject.ejs). Pure client-side (same pythonWorker.js
// Pyodide-in-a-Worker engine the real Python Lab editor uses) — no server
// compute cost, so this is safe to expose even to anonymous visitors,
// unlike Arduino's real compile+simulate (gated to logged-in viewers —
// see the "Open in Simulator" links instead).
//
// Usage: window.LabRunPython.render(containerEl, code)
(function () {
  const RUN_TIMEOUT_MS = 15000; // same ceiling as the real editor (pythonLab.js)

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  function render(container, code) {
    container.innerHTML = `
      <div class="lrp-toolbar">
        <button type="button" class="lrp-run-btn">▶ Run this code</button>
        <span class="lrp-status"></span>
      </div>
      <pre class="lrp-code">${escapeHtml(code || "")}</pre>
      <div class="lrp-console" hidden></div>
    `;

    const runBtn = container.querySelector(".lrp-run-btn");
    const statusEl = container.querySelector(".lrp-status");
    const consoleEl = container.querySelector(".lrp-console");

    let worker = null;
    let timeoutHandle = null;

    function appendLine(text, cls) {
      const line = document.createElement("div");
      line.className = "lrp-console-line " + (cls || "");
      line.textContent = text;
      consoleEl.appendChild(line);
      consoleEl.scrollTop = consoleEl.scrollHeight;
    }

    function finish(statusText) {
      clearTimeout(timeoutHandle);
      if (worker) {
        worker.terminate();
        worker = null;
      }
      runBtn.disabled = false;
      runBtn.textContent = "▶ Run this code";
      statusEl.textContent = statusText || "";
    }

    runBtn.addEventListener("click", () => {
      runBtn.disabled = true;
      runBtn.textContent = "Loading Python…";
      statusEl.textContent = "";
      consoleEl.hidden = false;
      consoleEl.innerHTML = "";

      worker = new Worker("/labs/js/pythonWorker.js");
      worker.onmessage = (event) => {
        const msg = event.data;
        if (msg.type === "ready") {
          // The 15s budget is for the SCRIPT, not Pyodide's own cold WASM
          // load (a multi-MB download — can easily exceed 15s on its own
          // on a slow connection) — same distinction the real editor's
          // pythonLab.js draws by pre-warming its worker well before Run
          // is ever clickable, rather than racing a timeout against the
          // load. Starting the clock only now, once the interpreter is
          // actually ready to run code, matches that.
          timeoutHandle = setTimeout(() => {
            appendLine("Stopped — this ran too long (15s limit).", "lrp-stderr");
            finish("⏱️ Timed out");
          }, RUN_TIMEOUT_MS);
          runBtn.textContent = "Running…";
          worker.postMessage({ type: "run", code, stdinLines: [] });
        } else if (msg.type === "stdout") {
          appendLine(msg.line, "lrp-stdout");
        } else if (msg.type === "stderr") {
          appendLine(msg.line, "lrp-stderr");
        } else if (msg.type === "done") {
          finish("✅ Finished");
        } else if (msg.type === "init-error" || msg.type === "run-error") {
          appendLine(msg.message, "lrp-stderr");
          finish("❌ Error");
        }
      };
      worker.onerror = (err) => {
        appendLine(String(err.message || err), "lrp-stderr");
        finish("❌ Error");
      };
      worker.postMessage({ type: "init" });
    });
  }

  window.LabRunPython = { render };
})();
