const pool = require("../models/db");

// "First L." — never the full legal name. Shared by every public-facing
// achievement route (the main page, individual badge/certificate share
// pages) so the redaction rule can't drift between them.
function toDisplayName(fullname) {
  const parts = (fullname || "").trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0] || "Student";
}

// Looks up a student by their public profile slug, only if sharing is
// currently enabled (checked live, not just "does the slug exist" — so
// disabling takes effect immediately even though the slug itself persists).
async function getPublicStudentBySlug(slug) {
  const res = await pool.query(
    `SELECT id, fullname, avatar_url FROM users2 WHERE public_profile_slug = $1 AND public_profile_enabled = true`,
    [slug]
  );
  const student = res.rows[0];
  if (!student) return null;
  return { ...student, displayName: toDisplayName(student.fullname) };
}

module.exports = { toDisplayName, getPublicStudentBySlug };
