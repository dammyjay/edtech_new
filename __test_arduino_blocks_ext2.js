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

// Exercises all 6 new extensions in one program. Two servo_write blocks
// deliberately placed in a row to directly test the hoisting dedup — the
// generated code must contain exactly ONE "#include <Servo.h>" and ONE
// "Servo myservo;" line, not two, despite two blocks both requesting them.
function buildAllExtensionsFixture() {
  return {
    blocks: {
      languageVersion: 0,
      blocks: [
        {
          type: "arduino_setup",
          id: "setupHat",
          x: 40,
          y: 30,
          inputs: {
            DO: {
              block: {
                type: "servo_attach",
                id: "servoAttach",
                fields: { PIN: "9" },
                next: {
                  block: {
                    type: "ultrasonic_setup",
                    id: "usSetup",
                    fields: { TRIG: "6", ECHO: "7" },
                    next: {
                      block: {
                        type: "lcd_setup",
                        id: "lcdSetup",
                        fields: { RS: "12", E: "11", D4: "5", D5: "4", D6: "3", D7: "2" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        {
          type: "arduino_loop",
          id: "loopHat",
          x: 40,
          y: 220,
          inputs: {
            DO: {
              block: {
                type: "servo_write",
                id: "servoWrite1",
                inputs: { ANGLE: { shadow: { type: "math_number", fields: { NUM: 90 } } } },
                next: {
                  block: {
                    type: "servo_write",
                    id: "servoWrite2",
                    inputs: { ANGLE: { shadow: { type: "math_number", fields: { NUM: 0 } } } },
                    next: {
                      block: {
                        type: "buzzer_on_off",
                        id: "buzz1",
                        fields: { PIN: "8", STATE: "HIGH" },
                        next: {
                          block: {
                            type: "rgb_led_set",
                            id: "rgb1",
                            fields: { R_PIN: "A0", R_STATE: "HIGH", G_PIN: "A1", G_STATE: "LOW", B_PIN: "A2", B_STATE: "HIGH" },
                            next: {
                              block: {
                                type: "lcd_print",
                                id: "lcdPrint1",
                                inputs: {
                                  TEXT: { block: { type: "ultrasonic_distance", id: "usDist" } },
                                  COL: { shadow: { type: "math_number", fields: { NUM: 0 } } },
                                  ROW: { shadow: { type: "math_number", fields: { NUM: 0 } } },
                                },
                                next: {
                                  block: {
                                    type: "lcd_print",
                                    id: "lcdPrint2",
                                    inputs: {
                                      TEXT: { block: { type: "potentiometer_read", id: "potRead", fields: { PIN: "A3" } } },
                                      COL: { shadow: { type: "math_number", fields: { NUM: 0 } } },
                                      ROW: { shadow: { type: "math_number", fields: { NUM: 1 } } },
                                    },
                                    next: { block: { type: "lcd_clear", id: "lcdClear1" } },
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      ],
    },
  };
}

(async () => {
  let browser;
  try {
    const pwdHash = await bcrypt.hash("Test1234!", 10);
    const studentIns = await pool.query(
      `INSERT INTO users2 (fullname, email, password, role) VALUES ('__Test ABE2 Student__','__test_abe2_student__@example.com',$1,'student') RETURNING id`,
      [pwdHash]
    );
    ids.studentId = studentIns.rows[0].id;
    console.log("SETUP_OK", JSON.stringify(ids));

    const cookies = await login("__test_abe2_student__@example.com", "Test1234!");
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

    const newExtensionIds = ["servo", "ultrasonic", "lcd1602", "buzzer", "rgbLed", "potentiometer"];
    await page.evaluate(async (ids) => {
      for (const id of ids) await addExtension(id);
    }, newExtensionIds);
    await new Promise((r) => setTimeout(r, 300));

    const activeExts = await page.evaluate(() => window.ArduinoBlocksLab.getActiveExtensionIds());
    assert(newExtensionIds.every((id) => activeExts.includes(id)), "all 6 new extensions added: " + JSON.stringify(activeExts));

    const toolboxCategoryNames = await page.evaluate(() =>
      blocksWorkspace.getToolbox().getToolboxItems().map((item) => (item.getName ? item.getName() : null)).filter(Boolean)
    );
    ["Servo", "Ultrasonic", "LCD1602", "Buzzer", "RGB LED", "Potentiometer"].forEach((name) => {
      assert(toolboxCategoryNames.includes(name), `toolbox has a "${name}" category: ` + JSON.stringify(toolboxCategoryNames));
    });

    const fixture = buildAllExtensionsFixture();
    await page.evaluate((fx) => {
      blocksWorkspace.clear();
      Blockly.serialization.workspaces.load(fx, blocksWorkspace);
      regenerateCodeFromBlocks();
    }, fixture);
    await new Promise((r) => setTimeout(r, 300));

    const generated = await page.evaluate(() => codeEditor.getValue());
    console.log("--- Generated code ---\n" + generated + "\n----------------------");

    // Hoisting correctness: each #include and global object line appears
    // EXACTLY ONCE, despite two servo_write blocks and three lcd_* blocks
    // all requesting the same include/declaration.
    const countOccurrences = (text, needle) => text.split(needle).length - 1;
    assert(countOccurrences(generated, "#include <Servo.h>") === 1, "exactly one #include <Servo.h> despite 2 servo_write blocks");
    assert(countOccurrences(generated, "Servo myservo;") === 1, "exactly one 'Servo myservo;' global declaration");
    assert(countOccurrences(generated, "myservo.attach(9);") === 1, "exactly one myservo.attach() setup call");
    assert(countOccurrences(generated, "#include <LiquidCrystal.h>") === 1, "exactly one #include <LiquidCrystal.h> despite 3 lcd_* blocks");
    assert(countOccurrences(generated, "LiquidCrystal lcd(12, 11, 5, 4, 3, 2);") === 1, "exactly one LiquidCrystal lcd(...) global declaration with the wired pins");
    assert(countOccurrences(generated, "lcd.begin(16, 2);") === 1, "exactly one lcd.begin() setup call");
    assert(countOccurrences(generated, "float readUltrasonicDistance()") === 1, "exactly one readUltrasonicDistance() helper function definition");
    assert(countOccurrences(generated, "const int US_TRIG_PIN = 6;") === 1, "exactly one US_TRIG_PIN declaration");

    // Correctness of each extension's actual generated statements.
    assert(generated.includes("myservo.write(90);"), "first servo_write generates myservo.write(90)");
    assert(generated.includes("myservo.write(0);"), "second servo_write generates myservo.write(0)");
    assert(generated.includes("digitalWrite(8, HIGH);"), "buzzer_on_off generates digitalWrite");
    assert(
      generated.includes("digitalWrite(A0, HIGH);") && generated.includes("digitalWrite(A1, LOW);") && generated.includes("digitalWrite(A2, HIGH);"),
      "rgb_led_set generates 3 digitalWrite calls for R/G/B"
    );
    assert(generated.includes("lcd.setCursor(0, 0);") && generated.includes("lcd.print(readUltrasonicDistance());"), "first lcd_print prints the ultrasonic reporter's value");
    assert(generated.includes("lcd.setCursor(0, 1);") && generated.includes("lcd.print(analogRead(A3));"), "second lcd_print prints the potentiometer reporter's value");
    assert(generated.includes("lcd.clear();"), "lcd_clear generates lcd.clear()");
    assert(generated.includes("pinMode(US_TRIG_PIN, OUTPUT);") && generated.includes("pinMode(US_ECHO_PIN, INPUT);"), "ultrasonic_setup generates correct pinMode calls");

    // Real compile against the live arduino-cli endpoint (now repaired —
    // this environment's AVR toolchain was missing its runtime DLLs,
    // fixed via a core uninstall+reinstall, unrelated to this feature's
    // code).
    const compileRes = await axios.post(
      `${BASE}/labs/arduino/compile`,
      { code: generated },
      { headers: { Cookie: cookieHeader }, validateStatus: () => true, timeout: 60000 }
    );
    console.log("compile result:", JSON.stringify({ success: compileRes.data.success, error: compileRes.data.error, hexLen: compileRes.data.hex?.length }));
    assert(compileRes.status === 200, "compile endpoint responds 200");
    assert(compileRes.data.success === true, "the full 6-extension program actually compiles via the real arduino-cli: " + JSON.stringify(compileRes.data.error || ""));
    assert(typeof compileRes.data.hex === "string" && compileRes.data.hex.length > 0, "compile returns a non-empty .hex");

    console.log("\nconsole/page errors captured:", JSON.stringify(consoleErrors, null, 2));
    const unexpectedErrors = consoleErrors.filter((e) => !e.includes("Registration failed - permission denied"));
    assert(unexpectedErrors.length === 0, "no unexpected browser page errors: " + JSON.stringify(unexpectedErrors));

    console.log("\nALL EXTENSION BATCH 2 TESTS PASSED");
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
