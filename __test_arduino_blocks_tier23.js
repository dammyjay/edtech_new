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

function printReporter(id, reporterBlock) {
  return {
    type: "serial_print",
    id: "print_" + id,
    inputs: { VALUE: { block: reporterBlock } },
  };
}

function chainAll(statements) {
  let head = null;
  let tail = null;
  for (const stmt of statements) {
    if (!head) head = stmt;
    else tail.next = { block: stmt };
    tail = stmt;
  }
  return head;
}

function buildTier23Fixture() {
  const setupStatements = [
    { type: "stepper_attach", id: "stepSetup", fields: { A_PLUS: "8", A_MINUS: "9", B_PLUS: "10", B_MINUS: "11" } },
    { type: "neopixel_attach", id: "npSetup", fields: { COUNT: 8, PIN: "6" } },
    { type: "keypad_setup", id: "kpSetup", fields: { R1: "A0", R2: "A1", R3: "A2", R4: "A3", C1: "2", C2: "3", C3: "4", C4: "5" } },
    { type: "lcd2004_setup", id: "lcd4Setup", fields: { RS: "12", E: "13", D4: "A4", D5: "A5", D6: "7", D7: "A0" } },
    { type: "ssd1306_setup", id: "oledSetup" },
    { type: "hx711_setup", id: "hxSetup", fields: { DT: "A1", SCK: "A2" } },
    { type: "ds1307_setup", id: "rtcSetup" },
    { type: "mpu6050_setup", id: "mpuSetup" },
    { type: "ir_receiver_setup", id: "irSetup", fields: { PIN: "A3" } },
    { type: "ili9341_setup", id: "tftSetup", fields: { CS: "A4", DC: "A5" } },
  ];

  const loopStatements = [
    { type: "stepper_set_speed", id: "stepSpeed", inputs: { RPM: { shadow: { type: "math_number", fields: { NUM: 10 } } } } },
    { type: "stepper_step", id: "stepStep", inputs: { STEPS: { shadow: { type: "math_number", fields: { NUM: 100 } } } } },
    { type: "neopixel_set_pixel", id: "npSet", inputs: {
        INDEX: { shadow: { type: "math_number", fields: { NUM: 0 } } },
        R: { shadow: { type: "math_number", fields: { NUM: 255 } } },
        G: { shadow: { type: "math_number", fields: { NUM: 0 } } },
        B: { shadow: { type: "math_number", fields: { NUM: 0 } } },
      } },
    { type: "neopixel_show", id: "npShow" },
    { type: "lcd2004_print", id: "lcd4Print", inputs: {
        TEXT: { shadow: { type: "text", fields: { TEXT: "hi" } } },
        COL: { shadow: { type: "math_number", fields: { NUM: 0 } } },
        ROW: { shadow: { type: "math_number", fields: { NUM: 0 } } },
      } },
    { type: "lcd2004_clear", id: "lcd4Clear" },
    { type: "ssd1306_print", id: "oledPrint", inputs: {
        TEXT: { shadow: { type: "text", fields: { TEXT: "hi" } } },
        COL: { shadow: { type: "math_number", fields: { NUM: 0 } } },
        ROW: { shadow: { type: "math_number", fields: { NUM: 0 } } },
      } },
    { type: "ssd1306_show", id: "oledShow" },
    { type: "ssd1306_clear", id: "oledClear" },
    printReporter("hx", { type: "hx711_read", id: "hxRead" }),
    printReporter("rtcHour", { type: "ds1307_read", id: "rtcRead", fields: { FIELD: "hour" } }),
    printReporter("mpuAccel", { type: "mpu6050_read", id: "mpuRead", fields: { FIELD: "accelZ" } }),
    printReporter("irRecv", { type: "ir_received", id: "irRecv" }),
    printReporter("irCmd", { type: "ir_command", id: "irCmd" }),
    { type: "ir_resume", id: "irResume" },
    printReporter("sdBegin", { type: "sd_begin", id: "sdBegin", fields: { PIN: "A0" } }),
    { type: "ili9341_fill_screen", id: "tftFill", fields: { COLOR: "ILI9341_BLUE" } },
    { type: "ili9341_draw_pixel", id: "tftPixel", inputs: {
        X: { shadow: { type: "math_number", fields: { NUM: 10 } } },
        Y: { shadow: { type: "math_number", fields: { NUM: 10 } } },
      }, fields: { COLOR: "ILI9341_WHITE" } },
    { type: "ili9341_print", id: "tftPrint", inputs: {
        TEXT: { shadow: { type: "text", fields: { TEXT: "hi" } } },
        X: { shadow: { type: "math_number", fields: { NUM: 0 } } },
        Y: { shadow: { type: "math_number", fields: { NUM: 0 } } },
      }, fields: { COLOR: "ILI9341_WHITE" } },
    printReporter("clkRead", { type: "encoder_clk_read", id: "clkRead", fields: { PIN: "2" } }),
    printReporter("dtRead", { type: "encoder_dt_read", id: "dtRead", fields: { PIN: "3" } }),
    printReporter("encBtn", { type: "encoder_button_is_pressed", id: "encBtn", fields: { PIN: "4" } }),
    printReporter("dialDialing", { type: "dialer_is_dialing", id: "dialDialing", fields: { PIN: "5" } }),
    printReporter("dialPulse", { type: "dialer_pulse_active", id: "dialPulse", fields: { PIN: "A1" } }),
    printReporter("kpKey", { type: "keypad_key_pressed", id: "kpKey", fields: { KEY: "5" } }),
  ];

  return {
    blocks: {
      languageVersion: 0,
      blocks: [
        { type: "arduino_setup", id: "setupHat", x: 40, y: 30, inputs: { DO: { block: chainAll(setupStatements) } } },
        { type: "arduino_loop", id: "loopHat", x: 40, y: 220, inputs: { DO: { block: chainAll(loopStatements) } } },
      ],
    },
  };
}

(async () => {
  let browser;
  try {
    const pwdHash = await bcrypt.hash("Test1234!", 10);
    const studentIns = await pool.query(
      `INSERT INTO users2 (fullname, email, password, role) VALUES ('__Test ABT23 Student__','__test_abt23_student__@example.com',$1,'student') RETURNING id`,
      [pwdHash]
    );
    ids.studentId = studentIns.rows[0].id;
    console.log("SETUP_OK", JSON.stringify(ids));

    const cookies = await login("__test_abt23_student__@example.com", "Test1234!");
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    assert(cookies.length > 0, "student login ok");

    browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"], protocolTimeout: 90000 });
    const page = await browser.newPage();
    await page.setCookie(...cookies);
    page.on("dialog", (d) => d.accept());
    const consoleErrors = [];
    page.on("pageerror", (err) => consoleErrors.push("pageerror: " + err.message));

    await page.goto(`${BASE}/labs/arduino`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector("#arduinoBlocksEditor .blocklySvg", { timeout: 10000 });
    await page.waitForFunction(() => typeof currentProjectId !== "undefined" && currentProjectId !== null, { timeout: 15000 });

    const tier23Ids = [
      "rotaryEncoder", "rotaryDialer", "stepperMotor", "biaxialStepper",
      "neopixelLed", "neopixelMatrix", "neopixelRing", "membraneKeypad",
      "lcd2004", "ssd1306", "hx711", "ds1307", "mpu6050", "irReceiver", "microSd", "ili9341",
    ];
    await page.evaluate(async (extIds) => {
      for (const id of extIds) await addExtension(id);
    }, tier23Ids);
    await new Promise((r) => setTimeout(r, 500));

    const activeExts = await page.evaluate(() => window.ArduinoBlocksLab.getActiveExtensionIds());
    assert(tier23Ids.every((id) => activeExts.includes(id)), "all 16 Tier 2+3 extensions added: " + JSON.stringify(activeExts));

    const fixture = buildTier23Fixture();
    await page.evaluate((fx) => {
      blocksWorkspace.clear();
      Blockly.serialization.workspaces.load(fx, blocksWorkspace);
      regenerateCodeFromBlocks();
    }, fixture);
    await new Promise((r) => setTimeout(r, 500));

    const generated = await page.evaluate(() => codeEditor.getValue());
    console.log("--- Generated code ---\n" + generated + "\n----------------------");

    const countOccurrences = (text, needle) => text.split(needle).length - 1;

    // Hoisting correctness.
    assert(countOccurrences(generated, "#include <Stepper.h>") === 1, "exactly one #include <Stepper.h>");
    assert(countOccurrences(generated, "#include <Adafruit_NeoPixel.h>") === 1, "exactly one #include <Adafruit_NeoPixel.h>");
    assert(countOccurrences(generated, "#include <Keypad.h>") === 1, "exactly one #include <Keypad.h>");
    assert(countOccurrences(generated, "#include <LiquidCrystal.h>") === 1, "exactly one #include <LiquidCrystal.h> (LCD2004)");
    assert(countOccurrences(generated, "#include <Adafruit_SSD1306.h>") === 1, "exactly one #include <Adafruit_SSD1306.h>");
    assert(countOccurrences(generated, "#include <HX711.h>") === 1, "exactly one #include <HX711.h>");
    assert(countOccurrences(generated, "#include <RTClib.h>") === 1, "exactly one #include <RTClib.h>");
    assert(countOccurrences(generated, "#include <Adafruit_MPU6050.h>") === 1, "exactly one #include <Adafruit_MPU6050.h>");
    assert(countOccurrences(generated, "#include <IRremote.hpp>") === 1, "exactly one #include <IRremote.hpp>");
    assert(countOccurrences(generated, "#include <SD.h>") === 1, "exactly one #include <SD.h>");
    assert(countOccurrences(generated, "#include <Adafruit_ILI9341.h>") === 1, "exactly one #include <Adafruit_ILI9341.h>");
    assert(countOccurrences(generated, "Stepper myStepper(") === 1, "exactly one Stepper object declaration");
    assert(countOccurrences(generated, "Adafruit_MPU6050 mpu;") === 1, "exactly one MPU6050 object declaration");

    // Representative generated statements.
    assert(generated.includes("myStepper.setSpeed(10);"), "stepper speed block correct");
    assert(generated.includes("myStepper.step(100);"), "stepper step block correct");
    assert(generated.includes("strip.setPixelColor(0, 255, 0, 0);"), "neopixel set pixel correct");
    assert(generated.includes("strip.show();"), "neopixel show correct");
    assert(generated.includes('keypad.getKey() == \'5\''), "keypad key-pressed check correct");
    assert(generated.includes("lcd20x4.begin(20, 4);"), "LCD2004 begin uses 20x4");
    assert(generated.includes("oled.begin(SSD1306_SWITCHCAPVCC, 0x3C);"), "SSD1306 begin correct");
    assert(generated.includes("scale.read()"), "HX711 read correct");
    assert(generated.includes("rtc.now().hour()"), "DS1307 read correct");
    assert(generated.includes("mpu6050ReadAccelZ()"), "MPU6050 read uses named helper function");
    assert(generated.includes("float mpu6050ReadAccelZ()"), "MPU6050 helper function is actually defined");
    assert(generated.includes("IrReceiver.begin(") && generated.includes("DISABLE_LED_FEEDBACK"), "IR receiver begin correct");
    assert(generated.includes("IrReceiver.decode()"), "IR received check correct");
    assert(generated.includes("IrReceiver.decodedIRData.command"), "IR command read correct");
    assert(generated.includes("IrReceiver.resume();"), "IR resume correct");
    assert(generated.includes("SD.begin(A0)"), "SD begin correct");
    assert(generated.includes("tft.fillScreen(ILI9341_BLUE);"), "TFT fill screen correct");
    assert(generated.includes("tft.drawPixel(10, 10, ILI9341_WHITE);"), "TFT draw pixel correct");

    const compileRes = await axios.post(
      `${BASE}/labs/arduino/compile`,
      { code: generated },
      { headers: { Cookie: cookieHeader }, validateStatus: () => true, timeout: 120000 }
    );
    console.log("compile result:", JSON.stringify({ success: compileRes.data.success, error: compileRes.data.error, hexLen: compileRes.data.hex?.length }));
    assert(compileRes.status === 200, "compile endpoint responds 200");
    assert(compileRes.data.success === true, "the full Tier 2+3 (16-extension) program actually compiles via the real arduino-cli: " + JSON.stringify(compileRes.data.error || ""));
    assert(typeof compileRes.data.hex === "string" && compileRes.data.hex.length > 0, "compile returns a non-empty .hex");

    console.log("\nconsole/page errors captured:", JSON.stringify(consoleErrors, null, 2));
    const unexpectedErrors = consoleErrors.filter((e) => !e.includes("Registration failed - permission denied"));
    assert(unexpectedErrors.length === 0, "no unexpected browser page errors: " + JSON.stringify(unexpectedErrors));

    console.log("\nALL TIER 2+3 EXTENSION TESTS PASSED");
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
