// Cashes in a student's redeemable_xp for either Coins (1:1) or real
// Naira into their Wallet (1 point = ₦5). redeemable_xp is deliberately
// separate from users2.xp — xp drives Level (utils/xpLevels.js) and must
// never go down; only redeemable_xp is ever spent here.
const pool = require("../models/db");
const { awardCoins } = require("./coinService");

const NAIRA_PER_POINT = 5;

// Atomic conditional decrement — same overspend-proof pattern as
// spendCoins (services/coinService.js). Returns null if the student
// doesn't have enough redeemable_xp (0 rows updated).
async function exchangeXp(studentId, amount, target) {
  if (!studentId || !amount || amount <= 0 || !Number.isInteger(amount)) return null;
  if (target !== "coins" && target !== "wallet") return null;

  const claim = await pool.query(
    `UPDATE users2 SET redeemable_xp = redeemable_xp - $1
     WHERE id = $2 AND COALESCE(redeemable_xp, 0) >= $1
     RETURNING redeemable_xp, wallet_balance2, coins`,
    [amount, studentId]
  );
  if (claim.rows.length === 0) return null;

  if (target === "coins") {
    await awardCoins(studentId, amount, "XP exchange");
    const updated = await pool.query("SELECT coins FROM users2 WHERE id = $1", [studentId]);
    return {
      redeemableXp: claim.rows[0].redeemable_xp,
      coins: updated.rows[0].coins,
      walletBalance: null,
    };
  }

  const nairaAmount = amount * NAIRA_PER_POINT;
  const walletRes = await pool.query(
    "UPDATE users2 SET wallet_balance2 = wallet_balance2 + $1 WHERE id = $2 RETURNING wallet_balance2",
    [nairaAmount, studentId]
  );
  await pool.query(
    `INSERT INTO wallet_transactions (user_id, type, direction, amount, description)
     VALUES ($1, 'xp_exchange', 'credit', $2, $3)`,
    [studentId, nairaAmount, `Exchanged ${amount} points for ₦${nairaAmount}`]
  );

  return {
    redeemableXp: claim.rows[0].redeemable_xp,
    coins: null,
    walletBalance: walletRes.rows[0].wallet_balance2,
  };
}

module.exports = { exchangeXp, NAIRA_PER_POINT };
