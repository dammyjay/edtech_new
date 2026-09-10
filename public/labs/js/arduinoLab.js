// Arduino Lab.
//
// Phase 1 (services/arduinoCompileService.js) proved a real sketch compiles
// server-side to a real .hex. Phase 2 proved that .hex can be *executed*,
// for real, in the browser (avr8js). Phase 3 (the circuit-builder section
// below) replaced the old do-nothing drag/drop with real component graphics
// (@wokwi/elements) and real click-and-drag wiring between actual pins —
// but purely as a visual/data model; nothing read the wires yet. Phase 4
// (the "Peripheral wiring" section, further down) is what closes that gap:
// it walks whatever a student actually wired, maps each connection to a
// real AVR port+bit, and drives the running sketch's live GPIO state
// straight into the component's own visual property (an LED's `value`, a
// buzzer's `hasSignal`) — and the other direction too, for a pushbutton's
// clicks driving an input pin. A Serial Monitor panel shows Serial.print
// output the same way, via avr8js's USART peripheral.

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

  const comp = { id, tag, el };
  placedComponents.set(id, comp);
  attachComponentDrag(el, id);
  renderPins(id);
  if (canvasHint) canvasHint.style.display = "none";
  return comp;
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

// A default starter circuit — an LED wired to pin 13/GND — so the lab
// isn't a blank canvas on first visit, and the starter sketch actually
// has something wired to run against. Called once, after both Monaco and
// the @wokwi/elements bundle are ready.
async function seedDefaultCircuit() {
  const uno = await placeComponent("wokwi-arduino-uno", 40, 40);
  const led = await placeComponent("wokwi-led", 460, 40);
  tryAddWire(led.id, "A", uno.id, "13");
  tryAddWire(led.id, "C", uno.id, "GND.1");
}

// `const`/`let` at a classic script's top level don't become window
// properties (only `function` declarations do), so this is the one place
// the circuit's live state is deliberately exposed — Phase 5 (saving
// project_data: {code, components, wires}) needs to reach in from outside
// this file too, not just this file's own click handlers.
window.arduinoLab = { placedComponents, wires, placeComponent, getPinCanvasPos };

// ---------------------------------------------------------------------
// Peripheral wiring — binding avr8js's live GPIO state to whatever's
// actually wired on the canvas
// ---------------------------------------------------------------------

// The Uno's fixed silkscreen-pin -> physical AVR port/bit mapping — the
// one piece of hardware knowledge avr8js and @wokwi/elements don't give
// you for free (avr8js only knows ports B/C/D; @wokwi/elements' pinInfo
// only knows silkscreen names like "13" or "A0"). Standard, unchanging
// ATmega328P-on-an-Uno wiring, not something to compute.
const PIN_TO_PORT = {
  0: { port: "D", bit: 0 }, 1: { port: "D", bit: 1 }, 2: { port: "D", bit: 2 }, 3: { port: "D", bit: 3 },
  4: { port: "D", bit: 4 }, 5: { port: "D", bit: 5 }, 6: { port: "D", bit: 6 }, 7: { port: "D", bit: 7 },
  8: { port: "B", bit: 0 }, 9: { port: "B", bit: 1 }, 10: { port: "B", bit: 2 }, 11: { port: "B", bit: 3 },
  12: { port: "B", bit: 4 }, 13: { port: "B", bit: 5 },
  A0: { port: "C", bit: 0 }, A1: { port: "C", bit: 1 }, A2: { port: "C", bit: 2 },
  A3: { port: "C", bit: 3 }, A4: { port: "C", bit: 4 }, A5: { port: "C", bit: 5 },
};

function findArduinoComponent() {
  for (const comp of placedComponents.values()) {
    if (comp.tag === "wokwi-arduino-uno") return comp;
  }
  return null;
}

// Every wire touching `componentId` where the *other* end is the Arduino
// — {ownPin, arduinoPin} for each. A part only ever has one hop to the
// board in this tool (no breadboard/intermediate nodes), so this is a
// plain scan, not a graph walk.
function findArduinoConnections(componentId, arduinoId) {
  const hits = [];
  for (const wire of wires) {
    if (wire.from.componentId === componentId && wire.to.componentId === arduinoId) {
      hits.push({ ownPin: wire.from.pin, arduinoPin: wire.to.pin });
    } else if (wire.to.componentId === componentId && wire.from.componentId === arduinoId) {
      hits.push({ ownPin: wire.to.pin, arduinoPin: wire.from.pin });
    }
  }
  return hits;
}

// Wires up every non-Arduino placed component against the just-started
// simulation and returns a cleanup function. Re-run fresh on every Run
// click (see runSketch) — components/wires can change between runs.
function bindComponentsToSimulation(ports, PinState) {
  const uno = findArduinoComponent();
  const boundVisuals = []; // {el, prop} — reset to an "off" state on stop
  const buttonListeners = []; // {el, onPress, onRelease} — removed on stop

  if (!uno) return () => {}; // nothing to bind without a board on the canvas

  for (const comp of placedComponents.values()) {
    if (comp.id === uno.id) continue;
    const connections = findArduinoConnections(comp.id, uno.id);
    if (!connections.length) continue;

    if (comp.tag === "wokwi-led" || comp.tag === "wokwi-buzzer") {
      const prop = comp.tag === "wokwi-led" ? "value" : "hasSignal";
      for (const { arduinoPin } of connections) {
        const loc = PIN_TO_PORT[arduinoPin];
        if (!loc || !ports[loc.port]) continue; // e.g. wired to GND — nothing to listen to
        const port = ports[loc.port];
        const listener = () => {
          comp.el[prop] = port.pinState(loc.bit) === PinState.High;
        };
        port.addListener(listener);
        comp.el[prop] = port.pinState(loc.bit) === PinState.High; // set the initial state — addListener only fires on change
        boundVisuals.push({ el: comp.el, prop });
      }
    } else if (comp.tag === "wokwi-pushbutton") {
      for (const { arduinoPin } of connections) {
        const loc = PIN_TO_PORT[arduinoPin];
        if (!loc || !ports[loc.port]) continue; // the leg wired to GND, not the signal leg
        const port = ports[loc.port];
        // Idle HIGH, matching the standard pinMode(pin, INPUT_PULLUP) this
        // wiring implies — pressed pulls it LOW, exactly like a real button.
        port.setPin(loc.bit, true);
        const onPress = () => port.setPin(loc.bit, false);
        const onRelease = () => port.setPin(loc.bit, true);
        comp.el.addEventListener("button-press", onPress);
        comp.el.addEventListener("button-release", onRelease);
        buttonListeners.push({ el: comp.el, onPress, onRelease });
      }
    }
  }

  return function unbind() {
    for (const { el, prop } of boundVisuals) el[prop] = false;
    for (const { el, onPress, onRelease } of buttonListeners) {
      el.removeEventListener("button-press", onPress);
      el.removeEventListener("button-release", onRelease);
    }
  };
}

// ---------------------------------------------------------------------
// Serial Monitor
// ---------------------------------------------------------------------

const MAX_SERIAL_LINES = 500; // a runaway loop shouldn't grow this panel forever

function clearSerialOutput() {
  const output = document.getElementById("serialOutput");
  if (output) output.innerHTML = '<span class="serial-placeholder">Waiting for Serial output…</span>';
  const dot = document.querySelector(".serial-dot");
  if (dot) dot.classList.remove("connected");
}

function appendSerialLine(text) {
  const output = document.getElementById("serialOutput");
  if (!output) return;
  const placeholder = output.querySelector(".serial-placeholder");
  if (placeholder) placeholder.remove();
  const dot = document.querySelector(".serial-dot");
  if (dot) dot.classList.add("connected");

  const line = document.createElement("div");
  line.textContent = text;
  output.appendChild(line);
  while (output.children.length > MAX_SERIAL_LINES) output.removeChild(output.firstChild);
  output.scrollTop = output.scrollHeight;
}

// ---------------------------------------------------------------------
// Monaco editor
// ---------------------------------------------------------------------

require.config({
  paths: {
    vs: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/vs",
  },
});

const STARTER_SKETCH = `// An LED is already wired to pin 13 (and GND) on the canvas.
// Run it and watch the LED actually blink — drag more parts on and wire
// them to other pins to see the same thing happen for those too.

void setup() {
  pinMode(13, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  digitalWrite(13, HIGH);
  Serial.println("LED ON");
  delay(500);
  digitalWrite(13, LOW);
  Serial.println("LED OFF");
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
  clearSerialOutput();
  seedDefaultCircuit();
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

let simState = null; // { cpu, startWallMs, timeoutId, unbindComponents }

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

  const {
    CPU, AVRIOPort, AVRTimer, AVRUSART, portBConfig, portCConfig, portDConfig,
    timer0Config, usart0Config, avrInstruction, PinState,
  } = avr8js;

  const progMem = parseIntelHex(compileResult.hex);
  const cpu = new CPU(progMem);
  // All three GPIO ports — a wired component could land on any of them
  // (digital pins 0-7 = PORTD, 8-13 = PORTB, A0-A5 = PORTC).
  const ports = {
    B: new AVRIOPort(cpu, portBConfig),
    C: new AVRIOPort(cpu, portCConfig),
    D: new AVRIOPort(cpu, portDConfig),
  };
  new AVRTimer(cpu, timer0Config); // required for delay()/millis() to ever advance

  clearSerialOutput();
  const usart = new AVRUSART(cpu, usart0Config, CPU_HZ);
  usart.onLineTransmit = (line) => appendSerialLine(line.replace(/\r$/, "")); // Serial.println sends "\r\n"

  const unbindComponents = bindComponentsToSimulation(ports, PinState);

  simState = { cpu, startWallMs: performance.now(), timeoutId: null, unbindComponents };
  setButtonsRunning(true, false);
  setStatus("Running", "running");

  // Deliberately setTimeout, not requestAnimationFrame: rAF is throttled
  // (or stopped outright) whenever the page isn't actively painting — a
  // backgrounded/inactive tab in a real browser, or any headless run —
  // which starves this loop of ticks while wall-clock time (and the
  // sketch's own delay()/millis() math) keeps moving, so the simulation
  // falls further behind every frame and never catches up. setTimeout
  // keeps ticking regardless, and every wired component already updates
  // synchronously inside its own GPIO listener (bindComponentsToSimulation
  // above), so painting isn't tied to this timer either.
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
  if (simState) {
    if (simState.timeoutId) clearTimeout(simState.timeoutId);
    if (simState.unbindComponents) simState.unbindComponents();
  }
  simState = null;

  setButtonsRunning(false, false);
  setStatus("Stopped", "idle");
}
