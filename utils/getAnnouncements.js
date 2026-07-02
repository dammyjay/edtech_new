const pool = require("../models/db");

async function getAnnouncements(location) {
  const result = await pool.query(
    `
    SELECT *
    FROM announcements
    WHERE status = 'published'
      AND (
            start_date IS NULL
            OR start_date <= NOW()
          )
      AND (
            end_date IS NULL
            OR end_date >= NOW()
          )
      AND (
            display_locations IS NULL
            OR $1 = ANY(display_locations)
          )
    ORDER BY
      CASE priority
          WHEN 'critical' THEN 4
          WHEN 'high' THEN 3
          WHEN 'normal' THEN 2
          WHEN 'low' THEN 1
          ELSE 0
      END DESC,
      sort_order ASC,
      created_at DESC
    `,
    [location],
  );

  return result.rows;
}

module.exports = getAnnouncements;
