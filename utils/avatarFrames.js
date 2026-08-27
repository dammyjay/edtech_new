// Hardcoded catalog of avatar frames purchasable with coins — not
// admin-editable in v1 (mirrors the LEVELS array in utils/xpLevels.js).
// Each frame is a CSS border style rendered as a ring around the existing
// profile picture, keyed by `key` and persisted as users2.equipped_avatar_frame.
const AVATAR_FRAMES = [
  { key: "bronze_ring", name: "Bronze Ring", price: 15, style: "border: 4px solid #cd7f32;" },
  { key: "silver_ring", name: "Silver Ring", price: 30, style: "border: 4px solid #c0c0c0;" },
  { key: "gold_ring", name: "Gold Ring", price: 50, style: "border: 4px solid #ffd700;" },
  { key: "ocean_glow", name: "Ocean Glow", price: 75, style: "border: 4px solid #2a9d8f; box-shadow: 0 0 10px #2a9d8f;" },
  { key: "sunset_glow", name: "Sunset Glow", price: 100, style: "border: 4px solid #ff7043; box-shadow: 0 0 10px #ff7043;" },
  { key: "royal_glow", name: "Royal Glow", price: 150, style: "border: 4px solid #7c4dff; box-shadow: 0 0 14px #7c4dff;" },
];

function getFrameByKey(key) {
  return AVATAR_FRAMES.find((f) => f.key === key) || null;
}

module.exports = { AVATAR_FRAMES, getFrameByKey };
