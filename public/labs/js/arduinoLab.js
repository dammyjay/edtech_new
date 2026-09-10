// Arduino Lab — Phase 2 (run-time proof of concept).
//
// Phase 1 (services/arduinoCompileService.js) proved a real sketch compiles
// server-side to a real .hex. This phase proves the other half: that .hex
// can be *executed*, for real, in the browser — via avr8js (the same AVR
// CPU core Wokwi itself runs on), driving one hardcoded LED on pin 13.
//
// Deliberately NOT in scope yet (see the approved plan, Phases 3-5):
// click-and-drag wiring, @wokwi/elements graphics, Serial Monitor, saving
// to lab_projects. The existing drag/drop below (placeholder boxes on
// #circuitCanvas) is Phase 3's stub, left as-is — it doesn't interfere
// with this phase's fixed LED demo.
//
// avr8js API used here (CPU, AVRIOPort, AVRTimer, avrInstruction,
// portBConfig, timer0Config, PinState) was verified end-to-end against a
// real compiled blink sketch in a local Node script before writing this —
// specifically that Timer0 has to be attached for delay()/millis() to
// advance at all (Arduino's delay() spins on millis(), which only moves
// via Timer0's overflow interrupt firing); without it every sketch just
// hangs forever inside its first delay() call.

const canvas = document.getElementById("circuitCanvas");

document.querySelectorAll(".component").forEach((comp) => {
  comp.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("type", comp.dataset.type);
  });
});

canvas.addEventListener("dragover", (e) => {
  e.preventDefault();
});

canvas.addEventListener("drop", (e) => {
  e.preventDefault();

  const type = e.dataTransfer.getData("type");

  const item = document.createElement("div");

  item.className = "circuit-item";

  item.innerText = type.toUpperCase();

  item.style.left = e.offsetX + "px";
  item.style.top = e.offsetY + "px";

  canvas.appendChild(item);
});

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
