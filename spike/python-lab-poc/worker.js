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

      pyodide.setStdout({ batched: (line) => postMessage({ type: "stdout", line }) });
      pyodide.setStderr({ batched: (line) => postMessage({ type: "stderr", line }) });

      return pyodide;
    })();
  }
  return pyodideReadyPromise;
}

self.onmessage = async (event) => {
  const { type, code, stdinLines } = event.data;

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

      // input() has no real stdin by default in a Worker — raises OSError
      // [Errno 29] the instant a script calls it. Feed it pre-typed lines
      // instead: since they're all known up front, this callback returns
      // synchronously, no SharedArrayBuffer needed. Returning null past the
      // last line raises the same EOFError a real `python script.py <
      // input.txt` running out of input gets. Confirmed working against
      // Pyodide 0.26.4 here before this shipped in the real Python Lab
      // (public/labs/js/pythonWorker.js).
      const lines = (stdinLines || []).slice();
      pyodide.setStdin({ stdin: () => (lines.length ? lines.shift() : null) });

      await pyodide.loadPackagesFromImports(code);
      await pyodide.runPythonAsync(code);
      postMessage({ type: "done", runMs: Math.round(performance.now() - t0) });
    } catch (err) {
      postMessage({ type: "run-error", message: String(err && err.message ? err.message : err) });
    }
  }
};
