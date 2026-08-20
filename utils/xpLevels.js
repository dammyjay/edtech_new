// Turns the raw, ever-increasing XP total into a kid-friendly named
// level with a visible "how close to the next one" progress bar. XP
// itself already exists (users2.xp, xp_history) — this is purely a
// derived view over it, no new data to maintain.
const LEVELS = [
  { level: 1, name: "Explorer", minXp: 0 },
  { level: 2, name: "Coder", minXp: 100 },
  { level: 3, name: "Builder", minXp: 250 },
  { level: 4, name: "Innovator", minXp: 500 },
  { level: 5, name: "Creator", minXp: 900 },
  { level: 6, name: "Engineer", minXp: 1500 },
  { level: 7, name: "Master", minXp: 2500 },
  { level: 8, name: "Grandmaster", minXp: 4000 },
];

// Returns { level, name, xp, xpIntoLevel, xpForNextLevel, progressPercent }.
// xpForNextLevel/progressPercent are null at the final level — there's
// nothing further to progress toward.
function getLevelForXp(xp) {
  const safeXp = Number(xp) || 0;

  let current = LEVELS[0];
  let next = null;
  for (let i = 0; i < LEVELS.length; i++) {
    if (safeXp >= LEVELS[i].minXp) {
      current = LEVELS[i];
      next = LEVELS[i + 1] || null;
    }
  }

  const xpIntoLevel = safeXp - current.minXp;
  const xpForNextLevel = next ? next.minXp - current.minXp : null;
  // floor, not round — 100% should only ever show once the next level
  // is actually reached, not a point early due to rounding up.
  const progressPercent = next
    ? Math.min(99, Math.floor((xpIntoLevel / xpForNextLevel) * 100))
    : 100;

  return {
    level: current.level,
    name: current.name,
    xp: safeXp,
    xpIntoLevel,
    xpForNextLevel,
    progressPercent,
  };
}

module.exports = { getLevelForXp, LEVELS };
