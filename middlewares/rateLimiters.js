// Shared rate limiters. globalLimiter is applied once, app-wide, in
// app.js. loginLimiter is applied per-route to the login and
// password-reset entry points in routes/adminRoutes.js and
// routes/instructor.js — those are the highest-value brute-force targets
// (the shared login handler covers every role: admin, instructor,
// teacher, school_admin, student, parent), and previously had no attempt
// limit, delay, or lockout of any kind.
const rateLimit = require("express-rate-limit");

const globalLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again in a few minutes." },
});

module.exports = { globalLimiter, loginLimiter };
