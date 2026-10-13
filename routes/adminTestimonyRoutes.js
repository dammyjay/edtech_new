
const express = require("express");
const router = express.Router();
const pool = require("../models/db");
const { ensureAdmin } = require("../middlewares/auth");
const { ensureCsrfToken, verifyCsrfToken } = require("../middlewares/csrf");

// Every route in this file is under /admin/testimonies — toggle and
// delete below had NO auth check at all (anyone could publish/unpublish
// or delete any testimony); this router-wide gate covers all three.
router.use(ensureAdmin);
router.use(ensureCsrfToken, verifyCsrfToken);

// Show All Testimonies
router.get("/admin/testimonies", async (req, res) => {
  const info =
    (await pool.query("SELECT * FROM company_info ORDER BY id DESC LIMIT 1"))
      .rows[0] || {};
  const testimonies = (
    await pool.query("SELECT * FROM testimonies ORDER BY created_at DESC")
  ).rows;
  res.render("admin/manageTestimonies", {
    info,
    testimonies,
    role: "admin",
    users: req.session.user,
  });
});

// Toggle Publish Status
router.post("/admin/testimonies/toggle/:id", async (req, res) => {
  const { publish } = req.body;
  await pool.query("UPDATE testimonies SET is_published = $1 WHERE id = $2", [
    publish === "true",
    req.params.id,
  ]);
  res.redirect("/admin/testimonies");
});

// Delete Testimony
router.post("/admin/testimonies/delete/:id", async (req, res) => {
  await pool.query("DELETE FROM testimonies WHERE id = $1", [req.params.id]);
  res.redirect("/admin/testimonies");
});

module.exports = router;
