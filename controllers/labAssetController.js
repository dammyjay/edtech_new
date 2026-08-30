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
