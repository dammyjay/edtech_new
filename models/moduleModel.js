// models/moduleModel.js
const pool = require("../models/db");


async function getModulesByCourse(courseId) {
  const result = await pool.query(
    'SELECT * FROM modules WHERE course_id = $1 ORDER BY sort_order ASC',
    [courseId]
  );
  return result.rows;
}

module.exports = {getModulesByCourse};
