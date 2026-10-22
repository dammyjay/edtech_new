// services/classDayService.js
//
// Pure date math for schools.class_days (JS Date.getDay() indices,
// 0=Sunday..6=Saturday). No DB access here — callers pass in the
// school's class_days array they already fetched.

/**
 * The next date (today counts) whose weekday is in classDays.
 * @param {number[]} classDays
 * @param {Date} fromDate
 * @returns {Date|null} null if classDays is empty/not configured
 */
function computeNextClassDate(classDays, fromDate = new Date()) {
  if (!Array.isArray(classDays) || classDays.length === 0) return null;

  const days = new Set(classDays.map((d) => Number(d)));
  const start = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());

  for (let offset = 0; offset < 7; offset++) {
    const candidate = new Date(start);
    candidate.setDate(start.getDate() + offset);
    if (days.has(candidate.getDay())) return candidate;
  }
  // classDays had no valid 0-6 entries
  return null;
}

/**
 * True when (today + leadDays) falls on one of classDays — i.e. the
 * reminder-poller's "is a class coming up in exactly leadDays" check.
 * @param {number[]} classDays
 * @param {Date} today
 * @param {number} leadDays
 */
function isReminderDueToday(classDays, today = new Date(), leadDays = 2) {
  if (!Array.isArray(classDays) || classDays.length === 0) return false;

  const target = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  target.setDate(target.getDate() + leadDays);

  return classDays.map(Number).includes(target.getDay());
}

module.exports = { computeNextClassDate, isReminderDueToday };
