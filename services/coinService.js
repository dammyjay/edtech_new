// Coins: a spendable gamification currency, deliberately separate from XP
// (decorative, never spent) and wallet_balance2 (real Paystack money, never
// touched here) so it can't be gamed into cash or used to pay-to-win.
const pool = require("../models/db");

// Fire-and-forget safe — mirrors the xp_history insert pattern used
// elsewhere (submitLessonQuiz's xpGained block).
async function awardCoins(userId, amount, reason) {
  if (!userId || !amount || amount <= 0) return;
  await pool.query("UPDATE users2 SET coins = COALESCE(coins, 0) + $1 WHERE id = $2", [amount, userId]);
  await pool.query(
    "INSERT INTO coin_history (user_id, amount, reason) VALUES ($1, $2, $3)",
    [userId, amount, reason || null]
  );
}

// Atomic conditional update — same claim pattern as referral_reward_given
// in services/referralService.js. Returns the new balance on success, or
// null if the user didn't have enough coins (0 rows updated), so callers
// can't overspend even under concurrent requests.
async function spendCoins(userId, amount, reason) {
  if (!userId || !amount || amount <= 0) return null;
  const result = await pool.query(
    `UPDATE users2 SET coins = coins - $1
     WHERE id = $2 AND COALESCE(coins, 0) >= $1
     RETURNING coins`,
    [amount, userId]
  );
  if (result.rows.length === 0) return null;

  await pool.query(
    "INSERT INTO coin_history (user_id, amount, reason) VALUES ($1, $2, $3)",
    [userId, -amount, reason || null]
  );
  return result.rows[0].coins;
}

module.exports = { awardCoins, spendCoins };
