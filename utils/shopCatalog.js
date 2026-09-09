// Coin-shop catalog for the newer, non-avatar-frame items (see
// utils/avatarFrames.js for the original frame catalog, which this
// deliberately doesn't touch or replace).
//
// Two different kinds of item live here:
//   - Equippable cosmetics (PROFILE_BANNERS, TITLE_TAGS): unlocked once,
//     then equipped/unequipped freely. Ownership is tracked generically in
//     the user_unlocks table (item_type + item_key), equip state in a
//     dedicated users2.equipped_* column per type — see EQUIP_COLUMNS.
//   - Functional consumables (HINT_TOKEN, XP_BOOST): bought and used
//     immediately, no ownership/equip state, just a coin spend gated by
//     services/coinService.js's spendCoins.

const PROFILE_BANNERS = [
  { key: "banner_slate", name: "Slate", price: 20, style: "background: linear-gradient(135deg, #334155, #64748b);" },
  { key: "banner_forest", name: "Forest", price: 35, style: "background: linear-gradient(135deg, #14532d, #4ade80);" },
  { key: "banner_sunset", name: "Sunset", price: 55, style: "background: linear-gradient(135deg, #7c2d12, #fb923c);" },
  { key: "banner_galaxy", name: "Galaxy", price: 80, style: "background: linear-gradient(135deg, #1e1b4b, #7c3aed, #ec4899);" },
  { key: "banner_gold", name: "Gold Rush", price: 120, style: "background: linear-gradient(135deg, #78350f, #fbbf24);" },
];

const TITLE_TAGS = [
  { key: "title_bug_squasher", name: "Bug Squasher", price: 25 },
  { key: "title_loop_master", name: "Loop Master", price: 25 },
  { key: "title_code_ninja", name: "Code Ninja", price: 45 },
  { key: "title_syntax_sensei", name: "Syntax Sensei", price: 65 },
  { key: "title_algorithm_ace", name: "Algorithm Ace", price: 90 },
];

// Maps an item_type (as stored in user_unlocks) to the equippable catalog
// and the users2 column that holds the currently-equipped key for it.
const EQUIPPABLE_CATALOGS = {
  profile_banner: { items: PROFILE_BANNERS, column: "equipped_profile_banner" },
  title_tag: { items: TITLE_TAGS, column: "equipped_title_tag" },
};

function getEquippableCatalog(itemType) {
  // hasOwnProperty guard: itemType is attacker-controlled (req.body), and a
  // plain `EQUIPPABLE_CATALOGS[itemType]` lookup for a key like "__proto__"
  // or "constructor" would resolve through the prototype chain to a real
  // (truthy) object instead of undefined, bypassing the "unknown item
  // type" check callers rely on.
  if (typeof itemType !== "string" || !Object.prototype.hasOwnProperty.call(EQUIPPABLE_CATALOGS, itemType)) {
    return null;
  }
  return EQUIPPABLE_CATALOGS[itemType];
}

function getEquippableByKey(itemType, itemKey) {
  const catalog = getEquippableCatalog(itemType);
  if (!catalog) return null;
  return catalog.items.find((i) => i.key === itemKey) || null;
}

// Hint tokens are consumed one-at-a-time against the current quiz question,
// no inventory kept — see studentController.useQuizHint.
const HINT_TOKEN_COST = 10;

// 50/50 lifeline — narrows a quiz question's options down to the correct
// one plus one random wrong one, server-computed so correct_option is
// never sent to the client outright (see studentController.useFiftyFifty).
// Priced above the text hint since it's a stronger lifeline.
const FIFTY_FIFTY_COST = 20;

// An XP boost multiplies the next few awardXp() calls (lesson quiz/lab
// completions), tracked via users2.xp_boost_uses_remaining and consumed
// inside services/lessonCompletionService.js.
const XP_BOOST = { cost: 40, uses: 3, multiplier: 2 };

module.exports = {
  PROFILE_BANNERS,
  TITLE_TAGS,
  EQUIPPABLE_CATALOGS,
  getEquippableCatalog,
  getEquippableByKey,
  HINT_TOKEN_COST,
  FIFTY_FIFTY_COST,
  XP_BOOST,
};
