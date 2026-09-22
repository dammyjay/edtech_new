// Python Lab execution engine. Pyodide (CPython compiled to WebAssembly)
// runs entirely inside this Web Worker — never on the main thread (which
// would freeze the editor UI during a run) and never on the server (this
// app's server never executes student-submitted code, for any lab type —
// see docs/python-lab-implementation-plan.docx section 2 for why that
// matters here specifically). A worker also can't reach the DOM or this
// origin's cookies, matching the same "no allow-same-origin" isolation
// principle Web Lab's preview <iframe> uses, just via a different
// mechanism (workers are isolated by nature, not by a sandbox attribute).
//
// Design + the numbers below (cold-load time, the loadPackagesFromImports
// requirement) come from the Phase 0 spike (spike/python-lab-poc/), which
// verified this exact mechanism end to end with a real browser before any
// of it was wired into the real app.
const PYODIDE_VERSION = "0.26.4"; // pinned exact version — never "latest",
// matching how public/labs/js/arduinoLab.js pins avr8js to an exact version,
// so a CDN update can't silently change what a student's code runs against.
const PYODIDE_CDN_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

let pyodideReadyPromise = null;

function loadPyodideOnce() {
  if (!pyodideReadyPromise) {
    pyodideReadyPromise = (async () => {
      importScripts(PYODIDE_CDN_BASE + "pyodide.js");
      const pyodide = await self.loadPyodide({ indexURL: PYODIDE_CDN_BASE });

      // Line-buffered stdout/stderr — posted back as plain lines, never
      // HTML, so public/labs/js/pythonLab.js can render them with
      // textContent only (same rule Web Lab's console panel follows).
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
      await loadPyodideOnce();
      postMessage({ type: "ready" });
    } catch (err) {
      postMessage({ type: "init-error", message: String(err && err.message ? err.message : err) });
    }
    return;
  }

  if (type === "run") {
    try {
      const pyodide = await loadPyodideOnce();

      // input() has no real stdin to read from by default in a Worker —
      // Pyodide raises OSError [Errno 29] the instant a script calls it,
      // which reads as a broken interpreter rather than "this program
      // wants input." Feed it the student's pre-typed lines (the Stdin
      // box in the editor) instead: since every line is already known up
      // front, this callback can return synchronously — no
      // SharedArrayBuffer / blocking-read machinery needed (this app sets
      // no COOP/COEP headers, so that path isn't available anyway).
      // Returning null past the last line raises the same EOFError a real
      // Python script gets from `python script.py < input.txt` running out
      // of input — a clear, standard failure instead of the OSError.
      // Verified against Pyodide 0.26.4 directly (spike/python-lab-poc)
      // before wiring in here.
      const lines = (stdinLines || []).slice();
      pyodide.setStdin({ stdin: () => (lines.length ? lines.shift() : null) });

      // runPythonAsync does NOT auto-load a script's imported packages —
      // confirmed the hard way in the Phase 0 spike. Without this line,
      // "import numpy" raises ModuleNotFoundError even though numpy ships
      // in the Pyodide distribution; this scans the source for import
      // statements and fetches whichever prebuilt wheels are actually
      // needed (once — cached for later runs in this same worker).
      await pyodide.loadPackagesFromImports(code);
      await pyodide.runPythonAsync(code);
      postMessage({ type: "done" });
    } catch (err) {
      // Pyodide surfaces Python tracebacks as the JS error's message —
      // exactly what a student needs to see to debug their own code.
      postMessage({ type: "run-error", message: String(err && err.message ? err.message : err) });
    }
  }
};
