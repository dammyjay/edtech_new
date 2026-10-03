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

function clickEl(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error("clickEl: no element matches " + sel);
    el.click();
  }, selector);
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

// Same fixture as __test_arduino_blocks.js's blink-on-button program.
function buildBlinkOnButtonFixture() {
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
                type: "pin_mode",
                id: "pm1",
                fields: { PIN: "13", MODE: "OUTPUT" },
                next: { block: { type: "pin_mode", id: "pm2", fields: { PIN: "2", MODE: "INPUT_PULLUP" } } },
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
                type: "controls_if",
                id: "if1",
                inputs: {
                  IF0: { block: { type: "button_is_pressed", id: "btn1", fields: { PIN: "2" } } },
                  DO0: { block: { type: "led_on_off", id: "ledOn", fields: { PIN: "13", STATE: "HIGH" } } },
                  ELSE: { block: { type: "led_on_off", id: "ledOff", fields: { PIN: "13", STATE: "LOW" } } },
                },
                extraState: { hasElse: true },
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
      `INSERT INTO users2 (fullname, email, password, role) VALUES ('__Test ABP Student__','__test_abp_student__@example.com',$1,'student') RETURNING id`,
      [pwdHash]
    );
    ids.studentId = studentIns.rows[0].id;
    console.log("SETUP_OK", JSON.stringify(ids));

    const cookies = await login("__test_abp_student__@example.com", "Test1234!");
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    assert(cookies.length > 0, "student login ok");

    // ---- PART A: persistence (save -> reload) ----
    // A fresh, minimal browser session: navigate, build the fixture
    // directly in blocks via the serialization API, add both extensions,
    // save, reload, and confirm it comes back — the SAME scenario the
    // long combined test couldn't finish due to a Chrome crash at a later
    // step, isolated here to the smallest possible session.
    browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"], protocolTimeout: 120000 });
    let page = await browser.newPage();
    await page.setCookie(...cookies);
    page.on("dialog", (d) => d.accept());
    const consoleErrors = [];
    page.on("pageerror", (err) => consoleErrors.push("pageerror: " + err.message));

    await page.goto(`${BASE}/labs/arduino`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector("#arduinoBlocksEditor .blocklySvg", { timeout: 10000 });
    // arduinoLab.js's own async initArduinoProject() (triggered once Monaco
    // finishes loading, independently of Blockly injection) calls
    // window.ArduinoBlocksLab.restoreFromProject(...) when IT finishes —
    // which clears/reseeds the workspace for a brand-new project. Racing
    // ahead of that (building blocks before it resolves) means its restore
    // runs LAST and silently wipes out everything just built. Waiting for
    // currentProjectId (set at the very end of that init flow) avoids this
    // — a real user never hits this race since they don't act within
    // milliseconds of page load.
    await page.waitForFunction(() => typeof currentProjectId !== "undefined" && currentProjectId !== null, { timeout: 15000 });

    const fixture = buildBlinkOnButtonFixture();
    await page.evaluate(
      async (fx) => {
        await addExtension("led");
        await addExtension("pushbutton");
        blocksWorkspace.clear();
        Blockly.serialization.workspaces.load(fx, blocksWorkspace);
        regenerateCodeFromBlocks();
      },
      fixture
    );
    await new Promise((r) => setTimeout(r, 300));

    const generatedBefore = await page.evaluate(() => codeEditor.getValue());
    assert(generatedBefore.includes("digitalWrite(13, HIGH);") && generatedBefore.includes("digitalRead(2) == LOW"), "built the blink-on-button program via blocks in a fresh session");

    await clickEl(page, "#saveBtn");
    await new Promise((r) => setTimeout(r, 2500));

    await browser.close();
    browser = null;

    // Confirm what actually landed in the DB, independent of the browser,
    // before trusting a second page load to prove it (belt and suspenders
    // given how flaky this environment's browser automation has been).
    const savedRow = await pool.query(
      `SELECT lp.project_data FROM lab_projects lp WHERE lp.student_id = $1 AND lp.lab_type = 'arduino' ORDER BY lp.updated_at DESC LIMIT 1`,
      [ids.studentId]
    );
    assert(savedRow.rows.length === 1, "a lab_projects row exists for this student's Arduino project");
    const pd = savedRow.rows[0].project_data;
    console.log("saved project_data keys:", Object.keys(pd));
    assert(pd.mode === "blocks", "saved project_data.mode is 'blocks'");
    assert(Array.isArray(pd.blockExtensions) && pd.blockExtensions.includes("led") && pd.blockExtensions.includes("pushbutton"), "saved project_data.blockExtensions includes both extensions: " + JSON.stringify(pd.blockExtensions));
    assert(pd.blocksWorkspace && Array.isArray(pd.blocksWorkspace.blocks?.blocks) && pd.blocksWorkspace.blocks.blocks.length === 2, "saved project_data.blocksWorkspace has the 2 top-level hat blocks");
    assert(typeof pd.code === "string" && pd.code.includes("digitalWrite(13, HIGH);"), "saved project_data.code is the block-generated C++");

    // Now reload in a fresh browser session and confirm the UI actually
    // restores from exactly that saved row.
    browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"], protocolTimeout: 120000 });
    page = await browser.newPage();
    await page.setCookie(...cookies);
    page.on("dialog", (d) => d.accept());
    page.on("pageerror", (err) => consoleErrors.push("pageerror(reload): " + err.message));

    await page.goto(`${BASE}/labs/arduino`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector("#arduinoBlocksEditor .blocklySvg", { timeout: 10000 });
    await page.waitForFunction(() => typeof currentProjectId !== "undefined" && currentProjectId !== null, { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 300)); // let restoreFromProject's own async extension-loading settle

    const extsAfterReload = await page.evaluate(() => window.ArduinoBlocksLab.getActiveExtensionIds());
    const codeAfterReload = await page.evaluate(() => codeEditor.getValue());
    const blockCountAfterReload = await page.evaluate(() => blocksWorkspace.getAllBlocks(false).length);
    console.log("after fresh-session reload: extensions =", JSON.stringify(extsAfterReload), "blockCount =", blockCountAfterReload);
    assert(extsAfterReload.includes("led") && extsAfterReload.includes("pushbutton"), "a brand-new page load restores both extensions from the saved project");
    assert(codeAfterReload.includes("digitalWrite(13, HIGH);") && codeAfterReload.includes("digitalRead(2) == LOW"), "a brand-new page load regenerates the same correct code from the restored blocks");
    assert(blockCountAfterReload >= 6, "the restored workspace has all the expected blocks (2 hats + pin_mode x2 + if + button + led x2), got " + blockCountAfterReload);

    await browser.close();
    browser = null;

    // ---- PART B: .ino text import (simple, isolated) ----
    browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"], protocolTimeout: 60000 });
    page = await browser.newPage();
    await page.setCookie(...cookies);
    page.on("dialog", (d) => d.accept());

    await page.goto(`${BASE}/labs/arduino`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector("#arduinoBlocksEditor .blocklySvg", { timeout: 10000 });
    // currentProjectId is set at the START of initArduinoProject(), well
    // before its later `await window.ArduinoBlocksLab.restoreFromProject(...)`
    // call (which does its OWN async extension-script loading, then a
    // regenerateCodeFromBlocks() that overwrites codeEditor) actually
    // finishes. This account already has a saved "blocks"-mode project
    // from Part A above, so waiting for its extensions to actually show up
    // is a reliable signal that restoreFromProject — and therefore its
    // codeEditor-overwriting regeneration — has fully completed, before
    // this test does its own codeEditor-overwriting import.
    await page.waitForFunction(() => typeof currentProjectId !== "undefined" && currentProjectId !== null, { timeout: 15000 });
    await page.waitForFunction(() => window.ArduinoBlocksLab.getActiveExtensionIds().includes("led"), { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 200));
    await clickEl(page, "#modeTextBtn");
    await new Promise((r) => setTimeout(r, 200));

    const INO_TEXT = "// imported sketch marker __UNIQUE_TEST_MARKER__\nvoid setup() {}\nvoid loop() {}\n";
    await page.evaluate(async (text) => {
      const file = new File([text], "sketch.ino", { type: "text/plain" });
      await importInoFile(file);
    }, INO_TEXT);
    await new Promise((r) => setTimeout(r, 300));

    const importedInoValue = await page.evaluate(() => codeEditor.getValue());
    assert(importedInoValue.includes("__UNIQUE_TEST_MARKER__"), ".ino text import correctly loads an uploaded file's content into the Monaco editor");

    console.log("\nconsole/page errors captured:", JSON.stringify(consoleErrors, null, 2));
    // public/sw.js's Service Worker registration being denied in this
    // headless/sandboxed Chrome environment is pre-existing and unrelated
    // to Arduino Blocks (confirmed present in diagnostic runs before any
    // of this feature's code existed) — filtered out rather than silently
    // loosening the check for everything.
    const unexpectedErrors = consoleErrors.filter((e) => !e.includes("Registration failed - permission denied"));
    assert(unexpectedErrors.length === 0, "no unexpected browser page errors across all fresh sessions: " + JSON.stringify(unexpectedErrors));

    console.log("\nALL PERSISTENCE/IMPORT TESTS PASSED");
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
