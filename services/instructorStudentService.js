// Backing logic for the instructor-facing "Add Student" flow
// (instructorController.addStudentDirect). Kept separate from the admin
// side's own student-creation helpers (adminController.js) rather than
// reusing them directly, because:
//  - addUserToSchool's auto-generated email has no collision handling —
//    users2.email is UNIQUE, so a second same-named student in the same
//    school would 500 there. generateUniqueStudentEmail below retries.
//  - the two existing admin avatar/PIN helpers write mutually
//    inconsistent data when chained (enableAvatarLoginForStudentIds sets
//    avatar_seed='user-${id}' with no avatar_url; generateAvatarsForStudentIds
//    sets a different avatar_seed format with avatar_url but no pin).
//    generateStudentPinAndAvatar below is a single source of truth instead.

// `client` is a transaction client (pool.connect()'d by the caller) so
// this sees uncommitted rows from the same transaction too, and so the
// retry loop and the eventual INSERT share one consistent view.
async function generateUniqueStudentEmail(client, fullname, schoolName) {
  const nameSlug = fullname.replace(/\s+/g, "").toLowerCase();
  const schoolSlug = (schoolName || "school").split(" ")[0].toLowerCase();
  const base = `${nameSlug}@${schoolSlug}school.com`;

  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0
      ? base
      : `${nameSlug}${attempt + 1}@${schoolSlug}school.com`;
    const existing = await client.query("SELECT 1 FROM users2 WHERE email = $1", [candidate]);
    if (existing.rowCount === 0) return candidate;
  }
  throw new Error("Could not generate a unique email after 50 attempts.");
}

function generateStudentPinAndAvatar(userId) {
  const pin = Math.floor(1000 + Math.random() * 9000).toString();
  const avatarSeed = `student-${userId}`;
  const avatarUrl = `https://api.dicebear.com/7.x/adventurer/png?seed=${avatarSeed}`;
  return { pin, avatarSeed, avatarUrl };
}

module.exports = { generateUniqueStudentEmail, generateStudentPinAndAvatar };
