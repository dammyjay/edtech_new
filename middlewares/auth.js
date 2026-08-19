// middlewares/auth.js

const pool = require("../models/db");

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }
  if (req.user) {
    return next();
  }
  return res.redirect("/admin/login");
}

function ensureParent(req, res, next) {
  if (req.session.user && req.session.user.role === "parent") {
    return next();
  }
  return res.status(403).send("Access denied");
}

function ensureInstructorOrAdmin(req, res, next) {
  if (
    req.isAuthenticated &&
    req.isAuthenticated() &&
    (req.user.role === "instructor" || req.user.role === "admin")
  ) {
    return next();
  }
  return res.redirect("/admin/login");
}

function isAdmin(req, res, next) {
  if (
    req.isAuthenticated &&
    req.isAuthenticated() &&
    (req.user.role === "admin")
  ) {
    return next();
  }
  return res.redirect("/admin/login");
}

// Gate for every /school-admin/* route. Two things were previously missing
// here: (1) nothing verified the logged-in user is actually a school_admin
// — any authenticated session could reach these routes; (2) login
// (controllers/adminController.js) only ever stores
// { id, email, role, profile_picture } in req.session.user, so
// req.session.user.school_id was ALWAYS undefined — every controller
// function that read it directly (approveUser, approveAllUsers,
// rejectUser, getQuotes, getTerms, attendancePage, getQuoteDetails,
// getPaymentHistory, getWeeklyAttendanceStats) was silently broken for
// every school admin, every time. Resolving the school here once, on
// every request, fixes both: it 403s non-school-admins, 404s a
// school-admin account with no school row, and — for legitimate
// requests — populates req.session.user.school_id (and req.schoolId /
// req.schoolName) before any controller runs.
async function requireSchoolAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== "school_admin") {
    return res.status(403).send("Access denied");
  }
  try {
    const result = await pool.query(
      "SELECT id, name FROM schools WHERE created_by = $1 LIMIT 1",
      [req.session.user.id]
    );
    if (!result.rows.length) {
      return res.status(404).send("No school found for this admin account");
    }
    req.session.user.school_id = result.rows[0].id;
    req.schoolId = result.rows[0].id;
    req.schoolName = result.rows[0].name;
    return next();
  } catch (err) {
    console.error("requireSchoolAdmin error:", err);
    return res.status(500).send("Server error");
  }
}

module.exports = {
  ensureAuthenticated,
  ensureParent,
  ensureInstructorOrAdmin,
  requireSchoolAdmin,
};

