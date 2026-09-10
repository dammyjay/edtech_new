// Arduino Lab.
//
// Phase 1 (services/arduinoCompileService.js) proved a real sketch compiles
// server-side to a real .hex. Phase 2 proved that .hex can be *executed*,
// for real, in the browser (avr8js) — driving one hardcoded LED on pin 13,
// still wired up below. Phase 3 (this file's circuit-builder section)
// replaces the old do-nothing drag/drop with real component graphics
// (@wokwi/elements — the same parts Wokwi's own simulator renders) and
// real click-and-drag wiring between actual pins.
//
// Deliberately NOT in scope yet (Phase 4): none of these dropped/wired
// components are actually driven by avr8js's live GPIO state — that's
// what turns "a wire exists" into "the LED you wired really lights up".
// This phase is the visual/data-model half: place parts, wire pins,
// move things around, delete a bad wire.

const canvas = document.getElementById("circuitCanvas");

// ---------------------------------------------------------------------
// Circuit builder — component placement
// ---------------------------------------------------------------------

const wireOverlay = document.getElementById("wireOverlay");
const canvasHint = document.getElementById("circuitCanvasHint");
const SVG_NS = "http://www.w3.org/2000/svg";

let componentCounter = 0;
let wireCounter = 0;
const placedComponents = new Map(); // id -> { id, tag, el }
const pinCircles = new Map(); // "componentId::pinName" -> <circle>
const wires = []; // { id, from: {componentId, pin}, to: {componentId, pin} }

document.querySelectorAll(".component[draggable]").forEach((comp) => {
  comp.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("type", comp.dataset.type);
  });
});

canvas.addEventListener("dragover", (e) => {
  e.preventDefault();
});

canvas.addEventListener("drop", async (e) => {
  e.preventDefault();
  const tag = e.dataTransfer.getData("type");
  if (!tag || !customElements.get(tag)) return; // unknown tag, or the @wokwi/elements CDN script hasn't loaded

  const canvasRect = canvas.getBoundingClientRect();
  await placeComponent(tag, e.clientX - canvasRect.left, e.clientY - canvasRect.top);
});

async function placeComponent(tag, x, y) {
  const el = document.createElement(tag);
  el.classList.add("placed-component");
  el.style.position = "absolute";
  el.style.left = x + "px";
  el.style.top = y + "px";

  const id = "comp-" + ++componentCounter;
  el.dataset.componentId = id;
  canvas.appendChild(el);

  // Lit components render asynchronously — pinInfo itself doesn't need
  // this (it's a plain getter off property defaults), but
  // getBoundingClientRect() below does: before first render a freshly
  // created custom element can report a zero-size box.
  if (el.updateComplete) await el.updateComplete;

  placedComponents.set(id, { id, tag, el });
  attachComponentDrag(el, id);
  renderPins(id);
  if (canvasHint) canvasHint.style.display = "none";
}

// ---------------------------------------------------------------------
// Pin geometry
// ---------------------------------------------------------------------

// Every @wokwi/elements part exposes `.pinInfo` — [{name, x, y, ...}] — with
// x/y in the same CSS-pixel space the part actually renders at (verified
// against the library's own source: e.g. the Uno's SVG is authored in mm,
// pinInfo x/y match its *browser-rendered* px size at that native scale,
// not the SVG's internal viewBox). So as long as a placed part is never
// CSS-scaled, its own getBoundingClientRect() top-left plus pin.x/pin.y is
// exactly the pin's on-screen position — no per-component math needed.
function getPinCanvasPos(componentId, pinName) {
  const comp = placedComponents.get(componentId);
  if (!comp || !comp.el.pinInfo) return null;
  const pin = comp.el.pinInfo.find((p) => p.name === pinName);
  if (!pin) return null;

  const elRect = comp.el.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();
  return {
    x: elRect.left - canvasRect.left + pin.x,
    y: elRect.top - canvasRect.top + pin.y,
  };
}

function renderPins(componentId) {
  const comp = placedComponents.get(componentId);
  if (!comp || !comp.el.pinInfo) return;

  for (const pin of comp.el.pinInfo) {
    const pos = getPinCanvasPos(componentId, pin.name);
    if (!pos) continue;

    const key = componentId + "::" + pin.name;
    let circle = pinCircles.get(key);
    if (!circle) {
      circle = document.createElementNS(SVG_NS, "circle");
      circle.setAttribute("r", "5");
      circle.setAttribute("class", "wire-pin");
      circle.dataset.componentId = componentId;
      circle.dataset.pinName = pin.name;
      circle.addEventListener("mousedown", onPinMouseDown);
      wireOverlay.appendChild(circle);
      pinCircles.set(key, circle);
    }
    circle.setAttribute("cx", pos.x);
    circle.setAttribute("cy", pos.y);
  }
}

// ---------------------------------------------------------------------
// Moving a placed component
// ---------------------------------------------------------------------

function attachComponentDrag(el, id) {
  el.addEventListener("mousedown", (e) => {
    // Pin circles live in the separate SVG overlay, not inside `el` — a
    // mousedown reaching here is always on the component's own body.
    e.preventDefault();
    const canvasRect = canvas.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const grabOffsetX = e.clientX - elRect.left;
    const grabOffsetY = e.clientY - elRect.top;

    function onMove(ev) {
      const x = Math.max(0, ev.clientX - canvasRect.left - grabOffsetX);
      const y = Math.max(0, ev.clientY - canvasRect.top - grabOffsetY);
      el.style.left = x + "px";
      el.style.top = y + "px";
      renderPins(id);
      redrawWires();
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
}

// ---------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------

let pendingWire = null; // { fromComponentId, fromPin, from: {x,y}, rubberPath }

function onPinMouseDown(e) {
  e.preventDefault();
  const fromComponentId = e.target.dataset.componentId;
  const fromPin = e.target.dataset.pinName;
  const from = getPinCanvasPos(fromComponentId, fromPin);
  if (!from) return;

  const rubberPath = document.createElementNS(SVG_NS, "path");
  rubberPath.setAttribute("class", "wire-rubberband");
  wireOverlay.appendChild(rubberPath);

  pendingWire = { fromComponentId, fromPin, from, rubberPath };
  document.addEventListener("mousemove", onWireDragMove);
  document.addEventListener("mouseup", onWireDragEnd);
}

function onWireDragMove(e) {
  if (!pendingWire) return;
  const canvasRect = canvas.getBoundingClientRect();
  const to = { x: e.clientX - canvasRect.left, y: e.clientY - canvasRect.top };
  pendingWire.rubberPath.setAttribute("d", wirePath(pendingWire.from, to));
}

function onWireDragEnd(e) {
  document.removeEventListener("mousemove", onWireDragMove);
  document.removeEventListener("mouseup", onWireDragEnd);
  if (!pendingWire) return;

  pendingWire.rubberPath.remove();
  const dropTarget = document.elementFromPoint(e.clientX, e.clientY);
  if (dropTarget && dropTarget.classList.contains("wire-pin")) {
    tryAddWire(
      pendingWire.fromComponentId,
      pendingWire.fromPin,
      dropTarget.dataset.componentId,
      dropTarget.dataset.pinName
    );
  }
  pendingWire = null;
}

function tryAddWire(fromComponentId, fromPin, toComponentId, toPin) {
  if (fromComponentId === toComponentId && fromPin === toPin) return; // a pin can't wire to itself

  const isDuplicate = wires.some(
    (w) =>
      (w.from.componentId === fromComponentId && w.from.pin === fromPin &&
        w.to.componentId === toComponentId && w.to.pin === toPin) ||
      (w.from.componentId === toComponentId && w.from.pin === toPin &&
        w.to.componentId === fromComponentId && w.to.pin === fromPin)
  );
  if (isDuplicate) return;

  wires.push({
    id: "wire-" + ++wireCounter,
    from: { componentId: fromComponentId, pin: fromPin },
    to: { componentId: toComponentId, pin: toPin },
  });
  redrawWires();
}

function removeWire(wireId) {
  const idx = wires.findIndex((w) => w.id === wireId);
  if (idx !== -1) wires.splice(idx, 1);
  redrawWires();
}

function redrawWires() {
  wireOverlay.querySelectorAll(".wire-path").forEach((p) => p.remove());
  for (const wire of wires) {
    const from = getPinCanvasPos(wire.from.componentId, wire.from.pin);
    const to = getPinCanvasPos(wire.to.componentId, wire.to.pin);
    if (!from || !to) continue; // the component it referenced is gone

    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", wirePath(from, to));
    path.setAttribute("class", "wire-path");
    path.addEventListener("click", () => removeWire(wire.id));
    // Insert before any existing child so wires always render under pins.
    wireOverlay.insertBefore(path, wireOverlay.firstChild);
  }
}

// A gentle S-curve between two pins, like a real jumper wire looping
// between two header pins rather than a straight ruled line.
function wirePath(from, to) {
  const bulge = Math.max(Math.abs(to.y - from.y) * 0.5, 30);
  return `M ${from.x} ${from.y} C ${from.x} ${from.y + bulge}, ${to.x} ${to.y - bulge}, ${to.x} ${to.y}`;
}

// `const`/`let` at a classic script's top level don't become window
// properties (only `function` declarations do), so this is the one place
// the circuit's live state is deliberately exposed — Phase 4 (binding
// avr8js's GPIO state to whatever's actually wired) and Phase 5 (saving
// project_data: {code, components, wires}) both need to reach in from
// outside this file, not just this file's own click handlers.
window.arduinoLab = { placedComponents, wires, placeComponent, getPinCanvasPos };

// ---------------------------------------------------------------------
// Monaco editor
// ---------------------------------------------------------------------

require.config({
  paths: {
    vs: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/vs",
  },
});

const STARTER_SKETCH = `// Pin 13 has a real LED wired to it in this playground.
// Run it and watch the LED on the canvas actually blink.

void setup() {
  pinMode(13, OUTPUT);
}

void loop() {
  digitalWrite(13, HIGH);
  delay(500);
  digitalWrite(13, LOW);
  delay(500);
}
`;

let codeEditor = null;

require(["vs/editor/editor.main"], function () {
  codeEditor = monaco.editor.create(document.getElementById("arduinoCodeEditor"), {
    value: STARTER_SKETCH,
    language: "cpp",
    automaticLayout: true,
    theme: "vs-dark",
    minimap: { enabled: false },
    fontSize: 15,
    wordWrap: "on",
    autoClosingBrackets: "always",
    autoClosingQuotes: "always",
    tabSize: 2,
  });

  document.getElementById("runBtn").addEventListener("click", runSketch);
  document.getElementById("stopBtn").addEventListener("click", stopSimulation);
});

// ---------------------------------------------------------------------
// Status line
// ---------------------------------------------------------------------

function setStatus(message, kind) {
  const el = document.getElementById("arduinoStatus");
  if (!el) return;
  el.textContent = message;
  el.className = "arduino-status" + (kind ? " arduino-status--" + kind : "");
}

function setButtonsRunning(isRunning, isBusy) {
  const runBtn = document.getElementById("runBtn");
  const stopBtn = document.getElementById("stopBtn");
  runBtn.disabled = isRunning || isBusy;
  stopBtn.disabled = !isRunning;
}

// ---------------------------------------------------------------------
// Intel HEX -> program memory
// ---------------------------------------------------------------------

// avr8js's CPU wants program memory as a Uint16Array (word-addressed, the
// way AVR instructions actually are). ATmega328P has 32KB of flash.
function parseIntelHex(hexString) {
  const prog = new Uint8Array(32 * 1024);
  let extendedAddr = 0;

  for (const rawLine of hexString.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith(":")) continue;

    const byteCount = parseInt(line.substr(1, 2), 16);
    const address = parseInt(line.substr(3, 4), 16);
    const recordType = parseInt(line.substr(7, 2), 16);

    if (recordType === 1) break; // end-of-file record
    if (recordType === 4) {
      extendedAddr = parseInt(line.substr(9, 4), 16) << 16;
      continue;
    }
    if (recordType !== 0) continue; // only data records matter here

    for (let i = 0; i < byteCount; i++) {
      const byte = parseInt(line.substr(9 + i * 2, 2), 16);
      prog[extendedAddr + address + i] = byte;
    }
  }

  return new Uint16Array(prog.buffer, 0, prog.length / 2);
}

// ---------------------------------------------------------------------
// avr8js run loop
// ---------------------------------------------------------------------

const CPU_HZ = 16_000_000; // Uno's clock speed — the sketch's delay()/millis() math assumes this.
const MAX_FRAME_WALL_MS = 12; // guard rail so one batch can never jank the page

let avr8jsLoaderPromise = null;
function loadAvr8js() {
  if (!avr8jsLoaderPromise) {
    avr8jsLoaderPromise = import("https://cdn.jsdelivr.net/npm/avr8js@0.21.1/+esm");
  }
  return avr8jsLoaderPromise;
}

let simState = null; // { cpu, portB, rafId, startWallMs }

async function runSketch() {
  if (!codeEditor) return;
  stopSimulation(); // a stray previous run should never keep ticking underneath a new one

  setButtonsRunning(false, true);
  setStatus("Compiling...", "busy");

  let compileResult;
  try {
    const res = await fetch("/labs/arduino/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: codeEditor.getValue() }),
    });
    compileResult = await res.json();
  } catch (err) {
    setStatus("Couldn't reach the compiler — check your connection and try again.", "error");
    setButtonsRunning(false, false);
    return;
  }

  if (!compileResult.success) {
    setStatus(compileResult.error || "Compile failed.", "error");
    setButtonsRunning(false, false);
    return;
  }

  setStatus("Starting simulator...", "busy");

  let avr8js;
  try {
    avr8js = await loadAvr8js();
  } catch (err) {
    setStatus("Couldn't load the simulator — check your connection and try again.", "error");
    setButtonsRunning(false, false);
    return;
  }

  const { CPU, AVRIOPort, AVRTimer, portBConfig, timer0Config, avrInstruction, PinState } = avr8js;

  const progMem = parseIntelHex(compileResult.hex);
  const cpu = new CPU(progMem);
  const portB = new AVRIOPort(cpu, portBConfig);
  new AVRTimer(cpu, timer0Config); // required for delay()/millis() to ever advance

  const led = document.getElementById("pin13Led");

  portB.addListener(() => {
    const state = portB.pinState(5); // digital pin 13 == PORTB bit 5 (PB5)
    if (led) led.classList.toggle("on", state === PinState.High);
  });

  simState = { cpu, startWallMs: performance.now(), timeoutId: null };
  setButtonsRunning(true, false);
  setStatus("Running", "running");

  // Deliberately setTimeout, not requestAnimationFrame: rAF is throttled
  // (or stopped outright) whenever the page isn't actively painting — a
  // backgrounded/inactive tab in a real browser, or any headless run —
  // which starves this loop of ticks while wall-clock time (and the
  // sketch's own delay()/millis() math) keeps moving, so the simulation
  // falls further behind every frame and never catches up. setTimeout
  // keeps ticking regardless, and the LED already updates synchronously
  // inside the portB listener above, so painting isn't tied to this timer.
  function frame() {
    if (!simState) return;
    const frameStart = performance.now();
    const elapsedSimMs = frameStart - simState.startWallMs;
    const targetCycles = elapsedSimMs * (CPU_HZ / 1000);

    // performance.now() is cheap once, not thousands of times a batch —
    // calling it on every single simulated instruction (millions/sec) was
    // the actual bottleneck here, not the AVR emulation itself: checking
    // it only every 4096 instructions restores real throughput while still
    // capping how long one batch can ever block the page.
    let sinceCheck = 0;
    while (cpu.cycles < targetCycles) {
      avrInstruction(cpu);
      cpu.tick();
      if (++sinceCheck >= 4096) {
        sinceCheck = 0;
        if (performance.now() - frameStart > MAX_FRAME_WALL_MS) break;
      }
    }

    simState.timeoutId = setTimeout(frame, 0);
  }

  simState.timeoutId = setTimeout(frame, 0);
}

function stopSimulation() {
  if (simState && simState.timeoutId) {
    clearTimeout(simState.timeoutId);
  }
  simState = null;

  const led = document.getElementById("pin13Led");
  if (led) led.classList.remove("on");

  setButtonsRunning(false, false);
  setStatus("Stopped", "idle");
}
