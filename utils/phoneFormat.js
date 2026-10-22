// utils/phoneFormat.js
//
// users2.phone is free-text digits with no country code and no
// validation anywhere in this codebase (confirmed: signup collects it
// via <input type="number">, no + prefix possible). WhatsApp's Cloud
// API needs a full E.164-style number. Per the user's own confirmation,
// numbers are assumed Nigerian — strip a leading 0, prefix 234 — and
// anything that still doesn't look plausible returns null so the
// caller just skips WhatsApp and sends email only, rather than firing
// a doomed API call.

/**
 * @param {string} rawPhone
 * @returns {string|null} digits-only international number (no leading
 *   '+', as Meta's Cloud API expects), or null if unusable.
 */
function toWhatsAppNumber(rawPhone) {
  if (!rawPhone) return null;

  let digits = String(rawPhone).replace(/\D/g, "");
  if (!digits) return null;

  if (digits.startsWith("234")) {
    // already has the country code
  } else if (digits.startsWith("0")) {
    digits = "234" + digits.slice(1);
  } else {
    digits = "234" + digits;
  }

  // A real Nigerian mobile number is 234 + 10 digits = 13 digits total.
  if (digits.length !== 13) return null;

  return digits;
}

module.exports = { toWhatsAppNumber };
