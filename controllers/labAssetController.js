const pool = require("../models/db");

// GET admin lab assets page (Blockly only, for now)
exports.getAdminLabAssets = async (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.redirect("/admin/login");
  }

  const categoriesRes = await pool.query(
    `SELECT * FROM lab_asset_categories WHERE lab_type = 'blockly' ORDER BY name ASC`
  );
  const assetsRes = await pool.query(
    `SELECT la.*, lac.name AS category_name
     FROM lab_assets la
     LEFT JOIN lab_asset_categories lac ON lac.id = la.category_id
     WHERE la.lab_type = 'blockly'
     ORDER BY la.created_at DESC`
  );

  const spriteCategories = categoriesRes.rows.filter((c) => c.asset_type === "sprite");
  const backgroundCategories = categoriesRes.rows.filter((c) => c.asset_type === "background");
  const spriteAssets = assetsRes.rows.filter((a) => a.asset_type === "sprite");
  const backgroundAssets = assetsRes.rows.filter((a) => a.asset_type === "background");

  // Attach each sprite's admin-curated costumes (lab_asset_costumes) —
  // what a student sees pre-added when they add this sprite to their own
  // project (see controllers/labController.js's getBlocklyLab). Backgrounds
  // have no costume concept.
  if (spriteAssets.length) {
    const costumesRes = await pool.query(
      `SELECT * FROM lab_asset_costumes WHERE lab_asset_id = ANY($1) ORDER BY sort_order ASC, id ASC`,
      [spriteAssets.map((a) => a.id)]
    );
    spriteAssets.forEach((a) => {
      a.costumes = costumesRes.rows.filter((c) => c.lab_asset_id === a.id);
    });

    const soundsRes = await pool.query(
      `SELECT * FROM lab_asset_sounds WHERE lab_asset_id = ANY($1) ORDER BY sort_order ASC, id ASC`,
      [spriteAssets.map((a) => a.id)]
    );
    spriteAssets.forEach((a) => {
      a.sounds = soundsRes.rows.filter((s) => s.lab_asset_id === a.id);
    });
  }

  res.render("admin/labAssets", {
    spriteCategories,
    backgroundCategories,
    spriteAssets,
    backgroundAssets,
    users: req.session.user,
    role: "admin",
    info: {},
    activePage: "lab-assets",
  });
};

// Create a category (sprite or background)
exports.createCategory = async (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.redirect("/admin/login");
  }
  const { name, asset_type } = req.body;
  if (!name || !["sprite", "background"].includes(asset_type)) {
    return res.redirect("/admin/lab-assets");
  }
  await pool.query(
    `INSERT INTO lab_asset_categories (lab_type, asset_type, name) VALUES ('blockly', $1, $2)`,
    [asset_type, name]
  );
  res.redirect("/admin/lab-assets");
};

// Upload one or more sprites/backgrounds in a single request — the file
// input allows multiple selection, and the form sends a matching
// names[] entry per file (same order as the files themselves), so each
// upload gets its own name instead of sharing one. category_id/asset_type
// apply to the whole batch. req.files (Cloudinary URLs already resolved
// by middlewares/upload.js's CloudinaryStorage) come from upload.array().
exports.uploadAsset = async (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.redirect("/admin/login");
  }
  const { category_id, asset_type } = req.body;
  const files = req.files || [];
  if (!files.length || !["sprite", "background"].includes(asset_type)) {
    return res.redirect("/admin/lab-assets");
  }

  let names = req.body.names || [];
  if (!Array.isArray(names)) names = [names];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const fallbackName = file.originalname.replace(/\.[^/.]+$/, "");
    const name = (names[i] || "").trim() || fallbackName;

    await pool.query(
      `INSERT INTO lab_assets (lab_type, asset_type, category_id, name, asset_url, uploaded_by)
       VALUES ('blockly', $1, $2, $3, $4, $5)`,
      [asset_type, category_id || null, name, file.path, req.session.user.id]
    );
  }

  res.redirect("/admin/lab-assets");
};

// Rename/recategorize an existing asset, optionally replacing its image
// (req.file present only when the admin chose a new file in the edit form).
exports.editAsset = async (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.redirect("/admin/login");
  }
  const { id } = req.params;
  const { name, category_id } = req.body;
  if (!name) {
    return res.redirect("/admin/lab-assets");
  }

  if (req.file) {
    await pool.query(
      `UPDATE lab_assets SET name = $1, category_id = $2, asset_url = $3 WHERE id = $4`,
      [name, category_id || null, req.file.path, id]
    );
  } else {
    await pool.query(
      `UPDATE lab_assets SET name = $1, category_id = $2 WHERE id = $3`,
      [name, category_id || null, id]
    );
  }

  res.redirect("/admin/lab-assets");
};

exports.deleteAsset = async (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.redirect("/admin/login");
  }
  const { id } = req.params;
  await pool.query("DELETE FROM lab_assets WHERE id = $1", [id]);
  res.redirect("/admin/lab-assets");
};

exports.deleteCategory = async (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.redirect("/admin/login");
  }
  const { id } = req.params;
  await pool.query("DELETE FROM lab_asset_categories WHERE id = $1", [id]);
  res.redirect("/admin/lab-assets");
};

// Pre-attach one or more costumes to a sprite asset — same bulk
// multi-file + parallel names[] shape as uploadAsset above, scoped to one
// sprite via :id instead of a category. A student adding this sprite to
// their project gets these seeded onto its costume list automatically
// (controllers/labController.js's getBlocklyLab).
exports.uploadCostume = async (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.redirect("/admin/login");
  }
  const { id } = req.params;
  const files = req.files || [];
  if (!files.length) {
    return res.redirect("/admin/lab-assets");
  }

  let names = req.body.names || [];
  if (!Array.isArray(names)) names = [names];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const fallbackName = file.originalname.replace(/\.[^/.]+$/, "");
    const name = (names[i] || "").trim() || fallbackName;

    await pool.query(
      `INSERT INTO lab_asset_costumes (lab_asset_id, name, asset_url) VALUES ($1, $2, $3)`,
      [id, name, file.path]
    );
  }

  res.redirect("/admin/lab-assets");
};

exports.deleteCostume = async (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.redirect("/admin/login");
  }
  const { costumeId } = req.params;
  await pool.query("DELETE FROM lab_asset_costumes WHERE id = $1", [costumeId]);
  res.redirect("/admin/lab-assets");
};

// Pre-attach one or more sound clips to a sprite asset — same shape as
// uploadCostume above. A student adding this sprite to their project gets
// these seeded onto its sound list automatically (labController.js's
// getBlocklyLab).
exports.uploadSound = async (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.redirect("/admin/login");
  }
  const { id } = req.params;
  const files = req.files || [];
  if (!files.length) {
    return res.redirect("/admin/lab-assets");
  }

  let names = req.body.names || [];
  if (!Array.isArray(names)) names = [names];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const fallbackName = file.originalname.replace(/\.[^/.]+$/, "");
    const name = (names[i] || "").trim() || fallbackName;

    await pool.query(
      `INSERT INTO lab_asset_sounds (lab_asset_id, name, asset_url) VALUES ($1, $2, $3)`,
      [id, name, file.path]
    );
  }

  res.redirect("/admin/lab-assets");
};

exports.deleteSound = async (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.redirect("/admin/login");
  }
  const { soundId } = req.params;
  await pool.query("DELETE FROM lab_asset_sounds WHERE id = $1", [soundId]);
  res.redirect("/admin/lab-assets");
};
