// controllers/lessonLabController.js
//
// Admin-side CRUD for attaching a lab task (Blockly or Web lab) to a
// lesson — the counterpart to learningController.js's getOrCreateLessonQuiz,
// but for lesson_labs instead of quizzes. One lab per lesson (a lab task is
// a single instructions blob, not a list of sub-items like quiz questions),
// so this is a plain get + upsert rather than a parent row + child rows.

const pool = require("../models/db");

const ALLOWED_LAB_TYPES = ["web", "blockly"];

// GET /admin/lesson/:lessonId/lab
// Unlike getOrCreateLessonQuiz, this does NOT auto-insert a blank row —
// a lab task needs real instructions to be useful, so "none yet" is a
// legitimate, common state the admin UI should show as an empty form.
exports.getOrCreateLessonLab = async (req, res) => {
  const { lessonId } = req.params;

  try {
    const labRes = await pool.query(
      `SELECT * FROM lesson_labs WHERE lesson_id = $1 ORDER BY id DESC LIMIT 1`,
      [lessonId]
    );

    res.json({
      success: true,
      lab: labRes.rows[0] || null,
    });
  } catch (err) {
    console.error("getOrCreateLessonLab error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
};

// POST /admin/lesson/:lessonId/lab
// Upserts the single lesson_labs row for this lesson.
exports.saveLessonLab = async (req, res) => {
  const { lessonId } = req.params;
  const { title, description, lab_type, instructions, points } = req.body;

  if (!title || !lab_type) {
    return res.status(400).json({ success: false, message: "Title and lab type are required." });
  }
  if (!ALLOWED_LAB_TYPES.includes(lab_type)) {
    return res.status(400).json({
      success: false,
      message: `Lab type must be one of: ${ALLOWED_LAB_TYPES.join(", ")}`,
    });
  }

  const pointsValue = Number.isFinite(parseInt(points, 10)) ? parseInt(points, 10) : 10;

  try {
    const existing = await pool.query(
      `SELECT id FROM lesson_labs WHERE lesson_id = $1 ORDER BY id DESC LIMIT 1`,
      [lessonId]
    );

    let lab;
    if (existing.rows.length > 0) {
      const updated = await pool.query(
        `UPDATE lesson_labs
         SET title = $1, description = $2, lab_type = $3, instructions = $4, points = $5
         WHERE id = $6
         RETURNING *`,
        [title, description || null, lab_type, instructions || null, pointsValue, existing.rows[0].id]
      );
      lab = updated.rows[0];
    } else {
      const created = await pool.query(
        `INSERT INTO lesson_labs (lesson_id, title, description, lab_type, instructions, points, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [lessonId, title, description || null, lab_type, instructions || null, pointsValue, req.session?.user?.id || null]
      );
      lab = created.rows[0];
    }

    res.json({ success: true, lab });
  } catch (err) {
    console.error("saveLessonLab error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
};

// POST /admin/lesson/:lessonId/lab/delete
exports.deleteLessonLab = async (req, res) => {
  const { lessonId } = req.params;
  try {
    await pool.query(`DELETE FROM lesson_labs WHERE lesson_id = $1`, [lessonId]);
    res.json({ success: true });
  } catch (err) {
    console.error("deleteLessonLab error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
};
