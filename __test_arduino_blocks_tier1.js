require("dotenv").config();
const pool = require("./models/db");
const bcrypt = require("bcrypt");
const axios = require("axios");
const puppeteer = require("puppeteer");

const BASE = "http://127.0.0.1:3098";
const ids = {};

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERTION FAILED: " + msg);
  console.log("OK:", msg);
}

async function login(email, password) {
  const res = await axios.post(
    `${BASE}/admin/login`,
    new URLSearchParams({ email, password }).toString(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" }, maxRedirects: 0, validateStatus: () => true }
  );
  const setCookie = res.headers["set-cookie"];
  return setCookie ? setCookie.map((c) => c.split(";")[0].split("=")).map(([name, value]) => ({ name, value, domain: "127.0.0.1", path: "/" })) : [];
}

// Chains a statement block onto the end of an existing chain, returning
// the new tail — small helper so the big fixture below stays readable
// instead of one giant hand-nested literal.
function chain(tailHolder, key, block) {
  tailHolder[key] = { block };
  return block;
}

// One reporter wrapped in a serial_print statement, as a fixture node —
// the simplest way to exercise every reporter block type in a real
// statement chain (since Blockly statement chains need statement blocks,
// not bare reporters).
function printReporter(id, reporterBlock) {
  return {
    type: "serial_print",
    id: "print_" + id,
    inputs: {
      VALUE: { block: reporterBlock },
      // NEWLINE has a field default (TRUE) — no need to set it explicitly.
    },
  };
}

function buildTier1Fixture() {
  const loopStatements = [
    { type: "led_bar_segment", id: "s1", fields: { PIN: "2", STATE: "HIGH" } },
    { type: "seven_segment_set", id: "s2", fields: { SEGMENT: "A", PIN: "3", STATE: "HIGH" } },
    { type: "relay_set", id: "s3", fields: { PIN: "4", STATE: "HIGH" } },
    printReporter("slideSwitch", { type: "slide_switch_is_on", id: "r1", fields: { PIN: "5" } }),
    printReporter("slidePot", { type: "slide_potentiometer_read", id: "r2", fields: { PIN: "A0" } }),
    printReporter("dip", { type: "dip_switch_is_on", id: "r3", fields: { INDEX: "3", PIN: "6" } }),
    printReporter("joyX", { type: "joystick_axis_read", id: "r4", fields: { AXIS: "X", PIN: "A1" } }),
    printReporter("joyY", { type: "joystick_axis_read", id: "r5", fields: { AXIS: "Y", PIN: "A2" } }),
    printReporter("joyBtn", { type: "joystick_button_is_pressed", id: "r6", fields: { PIN: "7" } }),
    printReporter("tilt", { type: "tilt_switch_is_tilted", id: "r7", fields: { PIN: "8" } }),
    printReporter("pir", { type: "pir_motion_detected", id: "r8", fields: { PIN: "9" } }),
    printReporter("heart", { type: "heart_rate_pulse_detected", id: "r9", fields: { PIN: "10" } }),
    printReporter("flameD", { type: "flame_detected", id: "r10", fields: { PIN: "11" } }),
    printReporter("flameA", { type: "flame_analog_read", id: "r11", fields: { PIN: "A3" } }),
    printReporter("gasD", { type: "gas_detected", id: "r12", fields: { PIN: "12" } }),
    printReporter("gasA", { type: "gas_analog_read", id: "r13", fields: { PIN: "A4" } }),
    printReporter("soundD", { type: "sound_detected", id: "r14", fields: { PIN: "13" } }),
    printReporter("soundA", { type: "sound_analog_read", id: "r15", fields: { PIN: "A5" } }),
    printReporter("light", { type: "light_sensor_read", id: "r16", fields: { PIN: "A0" } }),
    printReporter("ntc", { type: "ntc_temperature_read", id: "r17", fields: { PIN: "A1" } }),
  ];

  // Thread loopStatements into a `next`-chain.
  let head = null;
  let tailHolder = null;
  let tailKey = null;
  for (const stmt of loopStatements) {
    if (!head) {
      head = stmt;
    } else {
      tailHolder.next = { block: stmt };
    }
    tailHolder = stmt;
  }

  return {
    blocks: {
      languageVersion: 0,
      blocks: [
        { type: "arduino_setup", id: "setupHat", x: 40, y: 30 },
        { type: "arduino_loop", id: "loopHat", x: 40, y: 220, inputs: { DO: { block: head } } },
      ],
    },
  };
}

(async () => {
  let browser;
  try {
    const pwdHash = await bcrypt.hash("Test1234!", 10);
    const studentIns = await pool.query(
      `INSERT INTO users2 (fullname, email, password, role) VALUES ('__Test ABT1 Student__','__test_abt1_student__@example.com',$1,'student') RETURNING id`,
      [pwdHash]
    );
    ids.studentId = studentIns.rows[0].id;
    console.log("SETUP_OK", JSON.stringify(ids));

    const cookies = await login("__test_abt1_student__@example.com", "Test1234!");
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    assert(cookies.length > 0, "student login ok");

    browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"], protocolTimeout: 60000 });
    const page = await browser.newPage();
    await page.setCookie(...cookies);
    page.on("dialog", (d) => d.accept());
    const consoleErrors = [];
    page.on("pageerror", (err) => consoleErrors.push("pageerror: " + err.message));

    await page.goto(`${BASE}/labs/arduino`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector("#arduinoBlocksEditor .blocklySvg", { timeout: 10000 });
    await page.waitForFunction(() => typeof currentProjectId !== "undefined" && currentProjectId !== null, { timeout: 15000 });

    const tier1Ids = [
      "ledBarGraph", "sevenSegment", "relay", "slideSwitch", "slidePotentiometer", "dipSwitch",
      "joystick", "tiltSwitch", "pirMotion", "heartRate", "flameSensor", "gasSensor",
      "soundSensorSmall", "soundSensorLarge", "lightSensor", "ntcTemperature",
    ];
    await page.evaluate(async (extIds) => {
      for (const id of extIds) await addExtension(id);
    }, tier1Ids);
    await new Promise((r) => setTimeout(r, 500));

    const activeExts = await page.evaluate(() => window.ArduinoBlocksLab.getActiveExtensionIds());
    assert(tier1Ids.every((id) => activeExts.includes(id)), "all 16 Tier 1 extensions added: " + JSON.stringify(activeExts));

    const fixture = buildTier1Fixture();
    await page.evaluate((fx) => {
      blocksWorkspace.clear();
      Blockly.serialization.workspaces.load(fx, blocksWorkspace);
      regenerateCodeFromBlocks();
    }, fixture);
    await new Promise((r) => setTimeout(r, 400));

    const generated = await page.evaluate(() => codeEditor.getValue());
    console.log("--- Generated code ---\n" + generated + "\n----------------------");

    // Spot-check representative generated lines from each component.
    assert(generated.includes("digitalWrite(2, HIGH);"), "LED bar graph segment generates digitalWrite");
    assert(generated.includes("digitalWrite(3, HIGH);"), "7-segment generates digitalWrite");
    assert(generated.includes("digitalWrite(4, HIGH);"), "relay generates digitalWrite");
    assert(generated.includes("digitalRead(5) == HIGH"), "slide switch generates digitalRead");
    assert(generated.includes("analogRead(A0)"), "slide potentiometer / light sensor generate analogRead");
    assert(generated.includes("digitalRead(6) == HIGH"), "DIP switch generates digitalRead");
    assert(generated.includes("analogRead(A1)"), "joystick X axis / NTC generate analogRead");
    assert(generated.includes("analogRead(A2)"), "joystick Y axis generates analogRead");
    assert(generated.includes("digitalRead(7) == LOW"), "joystick button generates digitalRead (pressed = LOW)");
    assert(generated.includes("digitalRead(8) == HIGH"), "tilt switch generates digitalRead (active-HIGH)");
    assert(generated.includes("digitalRead(9) == HIGH"), "PIR motion generates digitalRead (active-HIGH)");
    assert(generated.includes("digitalRead(10) == HIGH"), "heart rate generates digitalRead (active-HIGH)");
    assert(generated.includes("digitalRead(11) == LOW"), "flame digital generates digitalRead (active-LOW)");
    assert(generated.includes("analogRead(A3)"), "flame analog generates analogRead");
    assert(generated.includes("digitalRead(12) == LOW"), "gas digital generates digitalRead (active-LOW)");
    assert(generated.includes("analogRead(A4)"), "gas analog generates analogRead");
    assert(generated.includes("digitalRead(13) == LOW"), "sound digital generates digitalRead (active-LOW)");
    assert(generated.includes("analogRead(A5)"), "sound analog generates analogRead");
    assert((generated.match(/Serial\.println\(/g) || []).length === 17, "all 17 reporter blocks generate a Serial.println call");

    const compileRes = await axios.post(
      `${BASE}/labs/arduino/compile`,
      { code: generated },
      { headers: { Cookie: cookieHeader }, validateStatus: () => true, timeout: 60000 }
    );
    console.log("compile result:", JSON.stringify({ success: compileRes.data.success, error: compileRes.data.error, hexLen: compileRes.data.hex?.length }));
    assert(compileRes.status === 200, "compile endpoint responds 200");
    assert(compileRes.data.success === true, "the full Tier 1 (16-extension) program actually compiles via the real arduino-cli: " + JSON.stringify(compileRes.data.error || ""));
    assert(typeof compileRes.data.hex === "string" && compileRes.data.hex.length > 0, "compile returns a non-empty .hex");

    console.log("\nconsole/page errors captured:", JSON.stringify(consoleErrors, null, 2));
    const unexpectedErrors = consoleErrors.filter((e) => !e.includes("Registration failed - permission denied"));
    assert(unexpectedErrors.length === 0, "no unexpected browser page errors: " + JSON.stringify(unexpectedErrors));

    console.log("\nALL TIER 1 EXTENSION TESTS PASSED");
  } catch (err) {
    console.error("TEST FAILED:", err.message);
    process.exitCode = 1;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {}
    }
    try {
      if (ids.studentId) {
        await pool.query("DELETE FROM lab_projects WHERE student_id=$1", [ids.studentId]);
        await pool.query("DELETE FROM users2 WHERE id=$1", [ids.studentId]);
      }
      console.log("DB cleanup done.");
    } catch (cleanupErr) {
      console.error("Cleanup error:", cleanupErr.message);
    }
    await pool.end();
  }
})();
