// services/arduinoCompileService.js
//
// Server-side compilation for the Arduino Lab (controllers/labController.js's
// compileArduinoSketch). avr8js (loaded client-side, see public/labs/js/
// arduinoLab.js) only EXECUTES a compiled .hex file — it doesn't compile
// C++ — so this shells out to the real arduino-cli, exactly what the
// actual Arduino IDE does under the hood (`arduino-cli compile --fqbn
// arduino:avr:uno sketch.ino`).
//
// Verified locally end-to-end before writing this: a real Blink+Serial
// sketch compiles to a real, valid Intel HEX file in ~2-5s; a broken
// sketch reports a clean, parseable error via `--format json`
// (`{success, compiler_err}` — far more reliable than scraping stdout or
// trusting a bare exit code, which is fragile when the parent process's
// own stdout handling is involved). One real bug found and worth noting:
// a temp directory path containing spaces broke avr-gcc's own include
// resolution on Windows — os.tmpdir() is safe on the actual Linux deploy
// target regardless, but this is exactly the kind of thing that's cheap
// to get right up front and expensive to debug later.

const { execFile } = require("child_process");
const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const ARDUINO_CLI_PATH = process.env.ARDUINO_CLI_PATH || "arduino-cli";
// A fixed, persistent-for-the-life-of-the-container location — the AVR
// core (~60MB: avr-gcc, avrdude, headers) only needs fetching once per
// deploy, not once per compile. ensureAvrCoreInstalled() below is called
// once at app startup (app.js), not per-request.
const ARDUINO_DATA_DIR = process.env.ARDUINO_DIRECTORIES_DATA || path.join(os.tmpdir(), "arduino-cli-data");
const ARDUINO_USER_DIR = process.env.ARDUINO_DIRECTORIES_USER || path.join(os.tmpdir(), "arduino-cli-user");
const FQBN = "arduino:avr:uno";

const COMPILE_TIMEOUT_MS = 15000;
// Generous for a student sketch (a real Blink+Serial example is ~250
// chars) — this exists to reject something absurd before it ever reaches
// the compiler, not to constrain normal use.
const MAX_CODE_LENGTH = 20000;

function arduinoEnv() {
  return {
    ...process.env,
    ARDUINO_DIRECTORIES_DATA: ARDUINO_DATA_DIR,
    ARDUINO_DIRECTORIES_USER: ARDUINO_USER_DIR,
  };
}

function runArduinoCli(args, options = {}) {
  return new Promise((resolve) => {
    execFile(
      ARDUINO_CLI_PATH,
      args,
      { timeout: options.timeout || 120000, maxBuffer: 10 * 1024 * 1024, env: arduinoEnv() },
      (err, stdout, stderr) => resolve({ err, stdout, stderr })
    );
  });
}

let coreInstallPromise = null;

// Called once from app.js at startup — idempotent (arduino-cli itself
// no-ops a re-install of an already-installed core), and safe to call
// again on the next boot of a fresh container where ARDUINO_DATA_DIR
// wasn't persisted. Deliberately not awaited by the caller (fire-and-
// forget, logged) — same shape as this codebase's existing createTables()
// startup call; the compile endpoint below also awaits this promise
// itself before compiling, so an early request during a cold start
// waits for it instead of failing.
// Libraries a sketch can #include that aren't part of the AVR core itself
// (Servo.h etc. live in Arduino's separate Library Manager index, not the
// board core — `core install arduino:avr` alone doesn't fetch them, found
// out the hard way when the Servo component's own sketch failed to
// compile with "Servo.h: No such file or directory"). A curated,
// pre-installed set — not "install anything a student's #include names"
// (that would mean running arduino-cli lib install on arbitrary,
// untrusted student input every compile) — chosen to cover the parts
// already in the palette (Servo, DHT sensor library + its Adafruit
// Unified Sensor dependency for the DHT22) plus a few very common
// intro-electronics libraries worth having ready before the matching
// palette component exists (I2C LCDs, NeoPixel strips, matrix keypads —
// exact names verified against the real Library Manager index, not
// guessed). Add to this list — never let a sketch's own #include trigger
// an install — as new component types need one.
const BUILTIN_LIBRARIES = [
  "Servo",
  "DHT sensor library",
  "Adafruit Unified Sensor",
  "LiquidCrystal I2C",
  "Adafruit NeoPixel",
  "Keypad",
];

async function ensureAvrCoreInstalled() {
  if (!coreInstallPromise) {
    coreInstallPromise = (async () => {
      const updateResult = await runArduinoCli(["core", "update-index"], { timeout: 60000 });
      if (updateResult.err) {
        console.error("arduino-cli core update-index failed:", updateResult.stderr || updateResult.err.message);
      }
      const installResult = await runArduinoCli(["core", "install", "arduino:avr"], { timeout: 180000 });
      if (installResult.err) {
        console.error("arduino-cli core install arduino:avr failed:", installResult.stderr || installResult.err.message);
        throw new Error("Arduino AVR core install failed");
      }
      console.log("arduino-cli: arduino:avr core ready.");

      const libUpdateResult = await runArduinoCli(["lib", "update-index"], { timeout: 60000 });
      if (libUpdateResult.err) {
        console.error("arduino-cli lib update-index failed:", libUpdateResult.stderr || libUpdateResult.err.message);
      }
      for (const lib of BUILTIN_LIBRARIES) {
        const libInstallResult = await runArduinoCli(["lib", "install", lib], { timeout: 120000 });
        if (libInstallResult.err) {
          // Non-fatal — a missing extra library shouldn't take down the
          // whole compiler; sketches that don't #include it are unaffected.
          console.error(`arduino-cli lib install ${lib} failed:`, libInstallResult.stderr || libInstallResult.err.message);
        }
      }
      console.log("arduino-cli: builtin libraries ready.");
    })();
  }
  return coreInstallPromise;
}

// Strips the noisy internal temp-path prefix from every compiler error
// line so a student sees "sketch.ino:3: error: ..." instead of a raw
// C:\...\arduino-compile\<random>\sketch\sketch.ino:3: ... path.
function cleanCompilerError(raw) {
  return String(raw || "")
    .replace(/[^\s]*[\\/]sketch\.ino/g, "sketch.ino")
    .slice(0, 3000);
}

/**
 * Compiles one Arduino sketch (a single .ino file's worth of C++) against
 * an Uno and returns either the resulting Intel HEX (as a string, ready
 * to hand to avr8js client-side) or a student-readable error message.
 * Never throws — every failure path (bad code, timeout, missing
 * toolchain) resolves to `{ success: false, error }`.
 *
 * @param {string} code
 * @returns {Promise<{success: true, hex: string} | {success: false, error: string}>}
 */
async function compileSketch(code) {
  if (typeof code !== "string" || !code.trim()) {
    return { success: false, error: "There's no code to compile yet." };
  }
  if (code.length > MAX_CODE_LENGTH) {
    return { success: false, error: "This sketch is too long to compile." };
  }

  try {
    await ensureAvrCoreInstalled();
  } catch (err) {
    return { success: false, error: "The Arduino compiler isn't ready yet — try again in a moment." };
  }

  // A dedicated, randomly-named temp dir per compile — never reused
  // across requests/students, fully removed afterward regardless of
  // outcome (the finally block below).
  const workDir = path.join(os.tmpdir(), "arduino-compile", crypto.randomBytes(8).toString("hex"));
  const sketchDir = path.join(workDir, "sketch");
  const outDir = path.join(workDir, "out");

  try {
    await fs.mkdir(sketchDir, { recursive: true });
    await fs.mkdir(outDir, { recursive: true });
    // arduino-cli requires the sketch file to share its parent folder's
    // name (sketchDir is literally named "sketch" for exactly this).
    await fs.writeFile(path.join(sketchDir, "sketch.ino"), code, "utf8");

    const { err, stdout, stderr } = await runArduinoCli(
      ["compile", "--fqbn", FQBN, sketchDir, "--output-dir", outDir, "--format", "json"],
      { timeout: COMPILE_TIMEOUT_MS }
    );

    if (err && err.killed) {
      return { success: false, error: "Compiling took too long and was stopped. Check for anything that might make the compiler itself hang." };
    }

    let parsed = null;
    try {
      parsed = JSON.parse(stdout);
    } catch (e) {
      // Fall through — parsed stays null, handled below.
    }

    if (!parsed) {
      console.error("arduino-cli produced no parseable JSON:", (stderr || "").slice(0, 500));
      return { success: false, error: "The compiler didn't respond as expected — try again." };
    }

    if (!parsed.success) {
      return { success: false, error: cleanCompilerError(parsed.compiler_err) || "Compile failed." };
    }

    const hexPath = path.join(outDir, "sketch.ino.hex");
    const hex = await fs.readFile(hexPath, "utf8");
    return { success: true, hex };
  } catch (err) {
    console.error("compileSketch error:", err.message);
    return { success: false, error: "Something went wrong compiling your sketch." };
  } finally {
    // Best-effort cleanup — never lets a cleanup failure surface as the
    // compile's own result.
    fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

// Cheap, synchronous — used by a health-check-style admin view later if
// wanted, and handy for local debugging.
function isArduinoCliAvailable() {
  try {
    fsSync.accessSync(ARDUINO_CLI_PATH);
    return true;
  } catch (e) {
    return null; // unknown when it's just "arduino-cli" resolved via PATH, not a literal file path
  }
}

module.exports = { compileSketch, ensureAvrCoreInstalled, isArduinoCliAvailable };
