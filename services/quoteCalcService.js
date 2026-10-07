// services/quoteCalcService.js
//
// Single source of truth for a school quote's final price: tuition
// (live student count × price_per_student) + any stacked add-ons
// (quote_addons, flat fee per term) − an optional discount (percent or
// flat ₦, layered on top of price_per_student — which already covers a
// negotiated custom per-student rate on its own).
//
// Replaces three previously-separate, inconsistent calculations:
// controllers/adminController.js's getSchoolDetails (a display-only live
// recompute that DID include add-ons), updateTerm/assignStudentsToTerm
// (which recompute total_amount from students × price alone, silently
// dropping add-ons), and services/quoteDocumentService.js's own invoice
// SQL (same students × price-only gap). quote_addons had 0 real rows
// before this feature, so the gap never surfaced — but it would have
// mispriced the first add-on anyone used.

const pool = require("../models/db");

async function calculateQuoteTotal(quoteId) {
  const quoteRes = await pool.query(
    `SELECT id, term_id, price_per_student, discount_type, discount_value, discount_reason
     FROM quotes WHERE id = $1`,
    [quoteId]
  );
  const quote = quoteRes.rows[0];
  if (!quote) return null;

  const countRes = await pool.query(
    `SELECT COUNT(*) FROM student_term_enrollments WHERE term_id = $1`,
    [quote.term_id]
  );
  const totalStudents = Number(countRes.rows[0].count);

  const addonsRes = await pool.query(
    `SELECT qa.id, qa.plan_id, qa.price_amount, qa.quantity, qa.free_quantity_snapshot,
            qa.price_per_extra_unit_snapshot, pp.name AS plan_name
     FROM quote_addons qa
     LEFT JOIN pricing_plans pp ON pp.id = qa.plan_id
     WHERE qa.quote_id = $1
     ORDER BY qa.id ASC`,
    [quoteId]
  );
  const addons = addonsRes.rows.map((a) => ({ ...a, label: formatAddonLabel(a) }));
  const addonTotal = addons.reduce((sum, a) => sum + Number(a.price_amount), 0);

  const pricePerStudent = Number(quote.price_per_student) || 0;
  const subtotal = totalStudents * pricePerStudent + addonTotal;

  const discountType = quote.discount_type || "none";
  const discountValue = Number(quote.discount_value) || 0;
  let discountAmount = 0;
  if (discountType === "percent") discountAmount = Math.round((subtotal * discountValue) / 100);
  else if (discountType === "flat") discountAmount = discountValue;
  // "Modules included at no extra charge" — the agreed rate is purely
  // per-student; whichever add-ons are attached are waived automatically,
  // live, whatever they are or however many — not a fixed number admin
  // typed in. Selecting/deselecting add-ons later changes this discount
  // on its own, since it's always recomputed from the current addonTotal,
  // never stored as its own value.
  else if (discountType === "addons_included") discountAmount = addonTotal;
  discountAmount = Math.min(Math.max(0, discountAmount), subtotal);

  const totalAmount = subtotal - discountAmount;

  return {
    quoteId: quote.id,
    termId: quote.term_id,
    totalStudents,
    pricePerStudent,
    addons,
    addonTotal,
    subtotal,
    discountType,
    discountValue,
    discountReason: quote.discount_reason || "",
    discountAmount,
    totalAmount,
  };
}

// Recomputes and persists total_students/total_amount/balance onto the
// quotes row. `status` is deliberately left untouched — it's an
// independent state admin already manages via recorded payments
// (adminController.js's addPayment), not something a price change should
// silently overwrite.
async function recalcAndPersistQuoteTotal(quoteId) {
  const calc = await calculateQuoteTotal(quoteId);
  if (!calc) return null;

  const paidRes = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS total_paid FROM school_payments WHERE quote_id = $1`,
    [quoteId]
  );
  const totalPaid = Number(paidRes.rows[0].total_paid);
  const balance = calc.totalAmount - totalPaid;

  await pool.query(
    `UPDATE quotes SET total_students = $1, total_amount = $2, balance = $3 WHERE id = $4`,
    [calc.totalStudents, calc.totalAmount, balance, quoteId]
  );

  return { ...calc, totalPaid, balance };
}

// Human-readable breakdown for a quote_addons row — plain "Internet
// support" for a flat add-on, or e.g. "Laptop Rental — 5 requested, 2
// free + 3 × ₦15,000" for a quantity-based one, so admin/schools never
// have to guess why a line costs what it does.
function formatAddonLabel(addon) {
  const name = addon.plan_name || "Add-on";
  if (addon.quantity == null) return name;

  const quantity = Number(addon.quantity);
  const freeQty = Number(addon.free_quantity_snapshot) || 0;
  const perUnit = Number(addon.price_per_extra_unit_snapshot) || 0;
  const extraUnits = Math.max(0, quantity - freeQty);

  if (extraUnits === 0) return `${name} — ${quantity} requested (all free, up to ${freeQty})`;
  return `${name} — ${quantity} requested, ${freeQty} free + ${extraUnits} × ₦${perUnit.toLocaleString()}`;
}

// Attaches one add-on to a quote, used by both createTerm and updateTerm
// (controllers/adminController.js). For a quantity-based add-on (e.g.
// Laptop Rental), `requestedQuantity` is how many the school is asking
// for this term — defaulting to the plan's free allowance when omitted,
// since just ticking the box with no number means "give the free
// amount." Snapshots the plan's current free_quantity/
// price_per_extra_unit so a later edit to the add-on itself never
// retroactively changes this quote's price (same principle as
// price_amount already follows for flat add-ons).
async function attachAddonToQuote(quoteId, planId, requestedQuantity) {
  const planRes = await pool.query(
    `SELECT price_amount, is_quantity_based, free_quantity, price_per_extra_unit
     FROM pricing_plans WHERE id = $1 AND is_addon = true`,
    [planId]
  );
  const plan = planRes.rows[0];
  if (!plan) return;

  if (plan.is_quantity_based) {
    const freeQty = Number(plan.free_quantity) || 0;
    const perUnit = Number(plan.price_per_extra_unit) || 0;
    const quantity = Number(requestedQuantity) || freeQty;
    const extraUnits = Math.max(0, quantity - freeQty);
    const priceAmount = extraUnits * perUnit;
    await pool.query(
      `INSERT INTO quote_addons (quote_id, plan_id, price_amount, quantity, free_quantity_snapshot, price_per_extra_unit_snapshot)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [quoteId, planId, priceAmount, quantity, freeQty, perUnit]
    );
  } else {
    await pool.query(
      `INSERT INTO quote_addons (quote_id, plan_id, price_amount) VALUES ($1, $2, $3)`,
      [quoteId, planId, plan.price_amount]
    );
  }
}

module.exports = { calculateQuoteTotal, recalcAndPersistQuoteTotal, attachAddonToQuote, formatAddonLabel };
