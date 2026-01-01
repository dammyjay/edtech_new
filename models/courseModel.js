const pool = require("../models/db");

// models/courseModel.js
async function getCourseById(id) {
  const result = await pool.query("SELECT * FROM courses WHERE id = $1", [id]);
  return result.rows[0];
}
module.exports = { getCourseById };
