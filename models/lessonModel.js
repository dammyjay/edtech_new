// models/moduleModel.js
// models/lessonModel.js
const { pool } = require('../models/db');

async function getLessonsByCourse(courseId) {
  const result = await pool.query(
    `SELECT l.* FROM lessons l 
     JOIN modules m ON l.module_id = m.id 
     WHERE m.course_id = $1 ORDER BY l.sort_order ASC`,
    [courseId]
  );
  return result.rows;
}

module.exports = { getLessonsByCourse };
