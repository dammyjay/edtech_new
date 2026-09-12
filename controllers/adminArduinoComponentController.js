const pool = require("../models/db");

// The set of component tags this admin panel will let anyone add — NOT a
// free-text field. Every one of these is either a real @wokwi/elements
// custom element this app has actual electrical simulation code for (see
// bindComponentsToSimulation in public/labs/js/arduinoLab.js), a board
// (compiled/simulated as the AVR chip itself, not a "peripheral" needing
// its own binding), or the hand-drawn breadboard. Letting admin pick a
// truly arbitrary tag would just make it easy to add something that LOOKS
// draggable but does nothing when a sketch runs (exactly the gap found —
// and left honestly noted here — with wokwi-dht22 below, which has a real
// pin layout and renders correctly, but whose actual sensor protocol
// isn't simulated yet).
// Every tag below is a real @wokwi/elements custom element, confirmed by
// pulling and inspecting the actual bundle (not guessed from the docs) —
// same rigor as the DHT22 investigation this comment used to describe
// alone. `simulated: false` entries carry a `note` (surfaced in the admin
// UI and the add-picker) rather than being left out: they render and wire
// up correctly on the canvas, they just don't yet drive or react to the
// running sketch. Deliberately excluded entirely: wokwi-esp32-devkit-v1,
// wokwi-nano-rp2040-connect (both run a completely different CPU
// architecture — avr8js only emulates AVR, so neither could ever execute
// a compiled sketch, not just "isn't wired up yet"), wokwi-arduino-mega
// and wokwi-franzininho (other boards needing their own compile target
// and pin-map verification — real, separate work, not a catalog entry).
const KNOWN_GOOD_COMPONENTS = [
  // --- Boards -----------------------------------------------------------
  { tag: "wokwi-arduino-uno", label: "Arduino Uno", category: "Boards", simulated: true },
  { tag: "wokwi-arduino-nano", label: "Arduino Nano", category: "Boards", simulated: true },

  // --- Prototyping --------------------------------------------------------
  { tag: "custom-breadboard", label: "Breadboard", category: "Prototyping", simulated: true },
  {
    tag: "wokwi-resistor",
    label: "Resistor",
    category: "Prototyping",
    simulated: true,
    // Genuinely passive — this simulator doesn't model current/voltage
    // limiting anywhere else either, so a resistor correctly does nothing
    // active, the same as the breadboard above.
  },

  // --- Output -------------------------------------------------------------
  { tag: "wokwi-led", label: "LED", category: "Output", simulated: true },
  { tag: "wokwi-rgb-led", label: "RGB LED", category: "Output", simulated: true },
  { tag: "wokwi-buzzer", label: "Buzzer", category: "Output", simulated: true },
  { tag: "wokwi-servo", label: "Servo Motor", category: "Output", simulated: true },
  { tag: "wokwi-led-bar-graph", label: "LED Bar Graph", category: "Output", simulated: true },
  { tag: "wokwi-7segment", label: "7-Segment Display", category: "Output", simulated: true },
  {
    tag: "wokwi-neopixel",
    label: "NeoPixel LED",
    category: "Output",
    simulated: false,
    note: "Visual/wireable only — the WS2812 addressable-LED protocol isn't simulated yet.",
  },
  {
    tag: "wokwi-neopixel-matrix",
    label: "NeoPixel Matrix",
    category: "Output",
    simulated: false,
    note: "Visual/wireable only — the WS2812 addressable-LED protocol isn't simulated yet.",
  },
  {
    tag: "wokwi-led-ring",
    label: "NeoPixel Ring",
    category: "Output",
    simulated: false,
    note: "Visual/wireable only — the WS2812 addressable-LED protocol isn't simulated yet.",
  },

  // --- Input ----------------------------------------------------------------
  { tag: "wokwi-pushbutton", label: "Push Button", category: "Input", simulated: true },
  { tag: "wokwi-pushbutton-6mm", label: "Push Button (6mm)", category: "Input", simulated: true },
  { tag: "wokwi-slide-switch", label: "Slide Switch", category: "Input", simulated: true },
  { tag: "wokwi-potentiometer", label: "Potentiometer", category: "Input", simulated: true },
  { tag: "wokwi-slide-potentiometer", label: "Slide Potentiometer", category: "Input", simulated: true },
  { tag: "wokwi-dip-switch-8", label: "DIP Switch (8-way)", category: "Input", simulated: true },
  { tag: "wokwi-analog-joystick", label: "Analog Joystick", category: "Input", simulated: true },
  {
    tag: "wokwi-tilt-switch",
    label: "Tilt Switch",
    category: "Input",
    simulated: false,
    note: "Visual/wireable only — there's no way to tilt it in the simulator yet, so it never triggers.",
  },
  {
    tag: "wokwi-ky-040",
    label: "Rotary Encoder",
    category: "Input",
    simulated: false,
    note: "Visual/wireable only — quadrature rotation isn't simulated yet.",
  },
  {
    tag: "wokwi-membrane-keypad",
    label: "Membrane Keypad",
    category: "Input",
    simulated: false,
    note: "Visual/wireable only — row/column matrix scanning isn't simulated yet.",
  },
  {
    tag: "wokwi-rotary-dialer",
    label: "Rotary Dialer",
    category: "Input",
    simulated: false,
    note: "Visual/wireable only — its pulse-dial protocol isn't simulated yet.",
  },

  // --- Sensors --------------------------------------------------------------
  { tag: "wokwi-photoresistor-sensor", label: "Light Sensor", category: "Sensors", simulated: true },
  { tag: "wokwi-ntc-temperature-sensor", label: "Temperature Sensor (NTC)", category: "Sensors", simulated: true },
  {
    tag: "wokwi-dht22",
    label: "DHT22",
    category: "Sensors",
    simulated: false,
    note: "Visual/wireable only — live temperature/humidity readings aren't simulated yet.",
  },
  {
    tag: "wokwi-pir-motion-sensor",
    label: "PIR Motion Sensor",
    category: "Sensors",
    simulated: false,
    note: "Visual/wireable only — motion detection isn't simulated yet.",
  },
  {
    tag: "wokwi-flame-sensor",
    label: "Flame Sensor",
    category: "Sensors",
    simulated: false,
    note: "Visual/wireable only — flame detection isn't simulated yet.",
  },
  {
    tag: "wokwi-gas-sensor",
    label: "Gas Sensor",
    category: "Sensors",
    simulated: false,
    note: "Visual/wireable only — gas readings aren't simulated yet.",
  },
  {
    tag: "wokwi-small-sound-sensor",
    label: "Sound Sensor (Small)",
    category: "Sensors",
    simulated: false,
    note: "Visual/wireable only — sound level readings aren't simulated yet.",
  },
  {
    tag: "wokwi-big-sound-sensor",
    label: "Sound Sensor (Large)",
    category: "Sensors",
    simulated: false,
    note: "Visual/wireable only — sound level readings aren't simulated yet.",
  },
  {
    tag: "wokwi-heart-beat-sensor",
    label: "Heart Rate Sensor",
    category: "Sensors",
    simulated: false,
    note: "Visual/wireable only — pulse readings aren't simulated yet.",
  },
  {
    tag: "wokwi-hc-sr04",
    label: "Ultrasonic Distance Sensor",
    category: "Sensors",
    simulated: false,
    note: "Visual/wireable only — the trigger/echo distance-timing protocol isn't simulated yet.",
  },

  // --- Actuators --------------------------------------------------------------
  {
    tag: "wokwi-ks2e-m-dc5",
    label: "Relay Module",
    category: "Actuators",
    simulated: false,
    note: "Visual/wireable only — coil-driven contact switching isn't simulated yet.",
  },
  {
    tag: "wokwi-stepper-motor",
    label: "Stepper Motor",
    category: "Actuators",
    simulated: false,
    note: "Visual/wireable only — step/direction pulses aren't simulated yet.",
  },
  {
    tag: "wokwi-biaxial-stepper",
    label: "Biaxial Stepper Motor",
    category: "Actuators",
    simulated: false,
    note: "Visual/wireable only — step/direction pulses aren't simulated yet.",
  },

  // --- Modules (mostly I2C/SPI displays, storage, and RF — each needs its
  //     own bespoke bus/protocol simulator, comparable in scope to the
  //     existing Servo pulse-timing code) --------------------------------
  {
    tag: "wokwi-lcd1602",
    label: "LCD Display (16x2)",
    category: "Modules",
    simulated: false,
    note: "Visual/wireable only — the HD44780 display protocol isn't simulated yet.",
  },
  {
    tag: "wokwi-lcd2004",
    label: "LCD Display (20x4)",
    category: "Modules",
    simulated: false,
    note: "Visual/wireable only — the HD44780 display protocol isn't simulated yet.",
  },
  {
    tag: "wokwi-ssd1306",
    label: "OLED Display (SSD1306)",
    category: "Modules",
    simulated: false,
    note: "Visual/wireable only — the I2C OLED display protocol isn't simulated yet.",
  },
  {
    tag: "wokwi-hx711",
    label: "Load Cell Amplifier (HX711)",
    category: "Modules",
    simulated: false,
    note: "Visual/wireable only — its bit-banged ADC protocol isn't simulated yet.",
  },
  {
    tag: "wokwi-ds1307",
    label: "Real-Time Clock (DS1307)",
    category: "Modules",
    simulated: false,
    note: "Visual/wireable only — the I2C real-time-clock protocol isn't simulated yet.",
  },
  {
    tag: "wokwi-mpu6050",
    label: "Accelerometer/Gyroscope (MPU6050)",
    category: "Modules",
    simulated: false,
    note: "Visual/wireable only — the I2C motion-sensor protocol isn't simulated yet.",
  },
  {
    tag: "wokwi-ir-receiver",
    label: "IR Receiver",
    category: "Modules",
    simulated: false,
    note: "Visual/wireable only — the infrared signal protocol isn't simulated yet.",
  },
  {
    tag: "wokwi-ir-remote",
    label: "IR Remote Control",
    category: "Modules",
    simulated: false,
    note: "Visual/wireable only — the infrared signal protocol isn't simulated yet.",
  },
  {
    tag: "wokwi-microsd-card",
    label: "MicroSD Card Module",
    category: "Modules",
    simulated: false,
    note: "Visual/wireable only — its SPI storage protocol isn't simulated yet.",
  },
  {
    tag: "wokwi-ili9341",
    label: "TFT Display (ILI9341)",
    category: "Modules",
    simulated: false,
    note: "Visual/wireable only — its SPI display protocol isn't simulated yet.",
  },
];

function requireAdmin(req, res) {
  if (!req.session.user || req.session.user.role !== "admin") {
    res.redirect("/admin/login");
    return false;
  }
  return true;
}

exports.getAdminArduinoComponents = async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const categoriesRes = await pool.query(
    `SELECT * FROM lab_asset_categories WHERE lab_type = 'arduino' AND asset_type = 'component' ORDER BY name ASC`
  );
  const componentsRes = await pool.query(
    `SELECT la.*, lac.name AS category_name
     FROM lab_assets la
     LEFT JOIN lab_asset_categories lac ON lac.id = la.category_id
     WHERE la.lab_type = 'arduino' AND la.asset_type = 'component'
     ORDER BY la.sort_order ASC, la.name ASC`
  );

  // Only tags not already in the catalog are offered in the "Add" picker
  // — re-adding a duplicate would just be confusing (two palette cards
  // for the same part).
  const existingTags = new Set(componentsRes.rows.map((c) => c.asset_url));
  const addableComponents = KNOWN_GOOD_COMPONENTS.filter((c) => !existingTags.has(c.tag));

  res.render("admin/arduinoComponents", {
    categories: categoriesRes.rows,
    components: componentsRes.rows,
    addableComponents,
    users: req.session.user,
    role: "admin",
    info: {},
    activePage: "arduino-components",
  });
};

exports.createCategory = async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { name } = req.body;
  if (!name) return res.redirect("/admin/arduino-components");
  await pool.query(
    `INSERT INTO lab_asset_categories (lab_type, asset_type, name) VALUES ('arduino','component',$1)`,
    [name]
  );
  res.redirect("/admin/arduino-components");
};

exports.deleteCategory = async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { id } = req.params;
  await pool.query("DELETE FROM lab_asset_categories WHERE id = $1", [id]);
  res.redirect("/admin/arduino-components");
};

// Adds one of the pre-vetted KNOWN_GOOD_COMPONENTS to the catalog —
// rejects anything else outright rather than trusting client input for
// the tag name, since that's exactly the field this whole allowlist
// exists to guard.
exports.addComponent = async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { tag, label, category_id } = req.body;
  const known = KNOWN_GOOD_COMPONENTS.find((c) => c.tag === tag);
  if (!known) return res.redirect("/admin/arduino-components");

  const existing = await pool.query(
    `SELECT id FROM lab_assets WHERE lab_type = 'arduino' AND asset_type = 'component' AND asset_url = $1`,
    [tag]
  );
  if (existing.rows.length) return res.redirect("/admin/arduino-components"); // already in the catalog

  const maxSortRes = await pool.query(
    `SELECT COALESCE(MAX(sort_order), -1) AS max_sort FROM lab_assets
     WHERE lab_type = 'arduino' AND asset_type = 'component' AND category_id = $1`,
    [category_id || null]
  );
  const nextSort = maxSortRes.rows[0].max_sort + 1;

  await pool.query(
    `INSERT INTO lab_assets (lab_type, asset_type, category_id, name, asset_url, sort_order, uploaded_by)
     VALUES ('arduino','component',$1,$2,$3,$4,$5)`,
    [category_id || null, (label || known.label).trim(), tag, nextSort, req.session.user.id]
  );
  res.redirect("/admin/arduino-components");
};

exports.updateComponent = async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { id } = req.params;
  const { name, category_id, sort_order } = req.body;
  if (!name) return res.redirect("/admin/arduino-components");
  await pool.query(
    `UPDATE lab_assets SET name = $1, category_id = $2, sort_order = $3
     WHERE id = $4 AND lab_type = 'arduino' AND asset_type = 'component'`,
    [name.trim(), category_id || null, parseInt(sort_order, 10) || 0, id]
  );
  res.redirect("/admin/arduino-components");
};

// The whole reason this needs a real column instead of just deleting a
// disabled row: a component a lot of students have already placed on
// their canvas should stop appearing in the PALETTE for new placements
// without retroactively breaking those students' already-saved circuits
// (which only ever store the tag name, not a live reference to this
// catalog row).
exports.toggleComponent = async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { id } = req.params;
  await pool.query(
    `UPDATE lab_assets SET enabled = NOT enabled
     WHERE id = $1 AND lab_type = 'arduino' AND asset_type = 'component'`,
    [id]
  );
  res.redirect("/admin/arduino-components");
};

exports.deleteComponent = async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { id } = req.params;
  await pool.query(
    `DELETE FROM lab_assets WHERE id = $1 AND lab_type = 'arduino' AND asset_type = 'component'`,
    [id]
  );
  res.redirect("/admin/arduino-components");
};
