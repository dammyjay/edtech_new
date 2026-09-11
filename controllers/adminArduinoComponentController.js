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
const KNOWN_GOOD_COMPONENTS = [
  { tag: "wokwi-arduino-uno", label: "Arduino Uno", category: "Boards" },
  { tag: "wokwi-arduino-nano", label: "Arduino Nano", category: "Boards" },
  { tag: "custom-breadboard", label: "Breadboard", category: "Prototyping" },
  { tag: "wokwi-led", label: "LED", category: "Output" },
  { tag: "wokwi-rgb-led", label: "RGB LED", category: "Output" },
  { tag: "wokwi-buzzer", label: "Buzzer", category: "Output" },
  { tag: "wokwi-servo", label: "Servo Motor", category: "Output" },
  { tag: "wokwi-pushbutton", label: "Push Button", category: "Input" },
  { tag: "wokwi-slide-switch", label: "Slide Switch", category: "Input" },
  { tag: "wokwi-potentiometer", label: "Potentiometer", category: "Input" },
  { tag: "wokwi-photoresistor-sensor", label: "Light Sensor", category: "Sensors" },
  {
    tag: "wokwi-dht22",
    label: "DHT22",
    category: "Sensors",
    note: "Visual/wireable only — live temperature/humidity readings aren't simulated yet.",
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
