// utils/companyInfo.js
//
// Single place for backend (non-EJS) code — report/pitch-deck generators,
// cron jobs — to fetch the admin-managed company branding (logo, name)
// from company_info, the same table res.locals.info is populated from for
// EJS views. company_info is a singleton settings row (logo_url and
// company_name are NOT NULL), so the fallback below only matters if the
// table is genuinely empty.

const pool = require("../models/db");

async function getCompanyInfo() {
  const result = await pool.query(
    "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
  );
  return (
    result.rows[0] || {
      company_name: "",
      logo_url: null,
    }
  );
}

module.exports = { getCompanyInfo };
