// Phase 0 spike — proves the core Python Lab execution mechanism before any
// of it gets wired into the real app: Pyodide (CPython-to-WebAssembly) runs
// entirely inside this Web Worker, never on the main thread and never on a
// server, matching the client-only sandboxing pattern this app already uses
// for Web Lab and Blockly Lab. See docs/python-lab-implementation-plan.docx
// section 5 for the full design this spike is validating.
//
// Pinned to an exact Pyodide version (never "latest") — same discipline as
// public/labs/js/arduinoLab.js pins avr8js to an exact version — so a CDN
// update can't silently change what a student's code runs against.
const PYODIDE_VERSION = "0.26.4";
const PYODIDE_CDN_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

let pyodideReadyPromise = null;

function loadPyodideOnce() {
  if (!pyodideReadyPromise) {
    pyodideReadyPromise = (async () => {
      importScripts(PYODIDE_CDN_BASE + "pyodide.js");
      const pyodide = await self.loadPyodide({ indexURL: PYODIDE_CDN_BASE });

      // Line-buffered stdout/stderr capture — postMessage each completed
      // line back to the main thread's console panel. Matches Web Lab's
      // "never use innerHTML for printed output" rule (buildInjectedScript
      // in public/labs/js/webLab.js) — the main thread renders these as
      // plain text, never HTML, so student-printed output can't inject markup.
      pyodide.setStdout({ batched: (line) => postMessage({ type: "stdout", line }) });
      pyodide.setStderr({ batched: (line) => postMessage({ type: "stderr", line }) });

      return pyodide;
    })();
  }
  return pyodideReadyPromise;
}

self.onmessage = async (event) => {
  const { type, code } = event.data;

  if (type === "init") {
    try {
      const t0 = performance.now();
      await loadPyodideOnce();
      postMessage({ type: "ready", loadMs: Math.round(performance.now() - t0) });
    } catch (err) {
      postMessage({ type: "init-error", message: String(err && err.message ? err.message : err) });
    }
    return;
  }

  if (type === "run") {
    try {
      const pyodide = await loadPyodideOnce();
      const t0 = performance.now();
      // runPythonAsync does NOT auto-load packages a script imports — that
      // was a wrong assumption going in (see docs/python-lab-implementation-
      // plan.docx section 10, "default package preload"). Without this line
      // `import numpy` throws ModuleNotFoundError even though numpy ships in
      // the Pyodide distribution; loadPackagesFromImports scans the source
      // for import statements and fetches whichever of Pyodide's prebuilt
      // wheels are actually needed, once, then they're cached for reuse.
      await pyodide.loadPackagesFromImports(code);
      await pyodide.runPythonAsync(code);
      postMessage({ type: "done", runMs: Math.round(performance.now() - t0) });
    } catch (err) {
      // Pyodide surfaces Python tracebacks as the JS error's message —
      // exactly what a student needs to see to debug their own code.
      postMessage({ type: "run-error", message: String(err && err.message ? err.message : err) });
    }
  }
};
