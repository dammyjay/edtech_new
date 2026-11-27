// routes/pwaRoutes.js
const express = require("express");
const router = express.Router();
const { ensureAuthenticated } = require("../middlewares/auth");
const { ensureCsrfToken, verifyCsrfToken } = require("../middlewares/csrf");
const pool = require("../models/db");

router.post(
  "/pwa/install-prompt/dismiss",
  ensureAuthenticated,
  ensureCsrfToken,
  verifyCsrfToken,
  async (req, res) => {
    try {
      await pool.query(
        "UPDATE users2 SET install_prompt_dismissed_at = NOW() WHERE id = $1",
        [req.session.user.id]
      );
      res.json({ ok: true });
    } catch (err) {
      console.error("install-prompt dismiss failed:", err.message);
      res.status(500).json({ ok: false });
    }
  }
);

module.exports = router;
