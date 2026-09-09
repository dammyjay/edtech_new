// Coins: a spendable gamification currency, deliberately separate from XP
// (decorative, never spent) and wallet_balance2 (real Paystack money). The
// invariant that matters is one-directional: coins can never convert back
// into wallet money (no cash-out path exists anywhere in this file), so
// they can't be gamed into real cash. Wallet -> coins (buyCoinsWithWallet
// below) is the opposite, allowed direction — spending real money on
// gamification currency, same shape as any other in-app purchase.
const pool = require("../models/db");

const NAIRA_PER_COIN = 5;

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

// Converts wallet money into coins at NAIRA_PER_COIN per coin — the
// reverse direction of services/xpExchangeService.js's redeemable_xp ->
// wallet exchange (1 point = ₦5), kept at the same rate so the whole
// economy stays internally consistent. Atomic conditional debit — same
// overspend-proof pattern as spendCoins above — so a student can't convert
// more than their real wallet balance covers even under concurrent
// requests. Returns the new {walletBalance, coins}, or null if the wallet
// didn't have enough.
async function buyCoinsWithWallet(userId, coinsAmount) {
  if (!userId || !coinsAmount || coinsAmount <= 0 || !Number.isInteger(coinsAmount)) return null;
  const nairaCost = coinsAmount * NAIRA_PER_COIN;

  const result = await pool.query(
    `UPDATE users2 SET wallet_balance2 = wallet_balance2 - $1, coins = COALESCE(coins, 0) + $2
     WHERE id = $3 AND wallet_balance2 >= $1
     RETURNING wallet_balance2, coins`,
    [nairaCost, coinsAmount, userId]
  );
  if (result.rows.length === 0) return null;

  await pool.query(
    `INSERT INTO wallet_transactions (user_id, type, direction, amount, description)
     VALUES ($1, 'coin_purchase', 'debit', $2, $3)`,
    [userId, nairaCost, `Converted ₦${nairaCost} into ${coinsAmount} coins`]
  );
  await pool.query(
    "INSERT INTO coin_history (user_id, amount, reason) VALUES ($1, $2, $3)",
    [userId, coinsAmount, "Wallet conversion"]
  );

  return { walletBalance: result.rows[0].wallet_balance2, coins: result.rows[0].coins };
}

module.exports = { awardCoins, spendCoins, buyCoinsWithWallet, NAIRA_PER_COIN };
