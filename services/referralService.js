const pool = require("../models/db");
const { notifyUser } = require("../utils/notify");

async function awardReferralBadgeToFamily(parentId, badgeName, notifyTitle) {
  const kids = await pool.query(`SELECT child_id FROM parent_children WHERE parent_id = $1`, [parentId]);
  for (const { child_id } of kids.rows) {
    await pool.query(`INSERT INTO user_badges (user_id, badge_name, awarded_at) VALUES ($1,$2,NOW())`, [
      child_id,
      badgeName,
    ]);
    await notifyUser(child_id, { type: "referral_badge", title: notifyTitle, message: badgeName, url: "/student/dashboard" });
  }
  await notifyUser(parentId, {
    type: "referral_badge",
    title: notifyTitle,
    message: `Your family earned the "${badgeName}" badge!`,
    url: "/parent/dashboard",
  });
}

// Called from controllers/studentController.js's completeLesson, only when
// that was the student's first-ever lesson completion — "first real
// activity" is the deliberately-chosen bar for awarding a referral bonus,
// not signup alone (trivially gameable with throwaway accounts).
//
// The UPDATE...WHERE referral_reward_given=false...RETURNING claim is
// atomic: only one caller can ever successfully flip the flag from false
// to true, so even if this somehow ran twice concurrently for the same
// student, the badge can only be awarded once per referral.
async function maybeAwardReferralBonus(studentId) {
  try {
    const parents = await pool.query(`SELECT parent_id FROM parent_children WHERE child_id = $1`, [studentId]);
    for (const { parent_id } of parents.rows) {
      const claim = await pool.query(
        `UPDATE users2 SET referral_reward_given = true
         WHERE id = $1 AND referred_by_user_id IS NOT NULL AND referral_reward_given = false
         RETURNING referred_by_user_id`,
        [parent_id]
      );
      if (!claim.rows.length) continue; // not a referred parent, or already claimed

      const referrerId = claim.rows[0].referred_by_user_id;
      await awardReferralBadgeToFamily(referrerId, "Referral Star — Brought a Friend!", "🎉 Referral badge earned!");
      await awardReferralBadgeToFamily(parent_id, "Referral Star — Welcome Bonus!", "🎉 Referral badge earned!");
    }
  } catch (err) {
    console.error("maybeAwardReferralBonus failed:", err.message);
  }
}

module.exports = { maybeAwardReferralBonus };
