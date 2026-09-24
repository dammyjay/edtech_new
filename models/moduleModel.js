// models/moduleModel.js
const pool = require("../models/db");


async function getModulesByCourse(courseId) {
  const result = await pool.query(
    'SELECT * FROM modules WHERE course_id = $1 AND archived_at IS NULL ORDER BY sort_order ASC',
    [courseId]
  );
  return result.rows;
}

module.exports = {getModulesByCourse};
