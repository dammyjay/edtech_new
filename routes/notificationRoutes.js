const express = require("express");
const router = express.Router();
const pool = require("../models/db");
const { ensureAuthenticated } = require("../middlewares/auth");

router.use(ensureAuthenticated);

router.get("/notifications", async (req, res) => {
  try {
    const userId = req.user.id;
    const { rows } = await pool.query(
      `SELECT id, type, title, message, url, is_read, created_at
       FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [userId]
    );
    res.json(rows);
  } catch (err) {
    console.error("List notifications error:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/notifications/unread-count", async (req, res) => {
  try {
    const userId = req.user.id;
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS count FROM notifications WHERE user_id = $1 AND is_read = false`,
      [userId]
    );
    res.json({ count: parseInt(rows[0].count, 10) });
  } catch (err) {
    console.error("Unread notification count error:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/notifications/:id/read", async (req, res) => {
  try {
    const userId = req.user.id;
    await pool.query(
      `UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2`,
      [req.params.id, userId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Mark notification read error:", err.message);
    res.status(500).json({ success: false });
  }
});

router.post("/notifications/read-all", async (req, res) => {
  try {
    const userId = req.user.id;
    await pool.query(
      `UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false`,
      [userId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Mark all notifications read error:", err.message);
    res.status(500).json({ success: false });
  }
});

module.exports = router;
