const express = require("express");
const router = express.Router();
const classroomAnalyticsController = require("../controllers/classroomAnalyticsController");
const { ensureAdmin } = require("../middlewares/auth");
const { ensureCsrfToken, verifyCsrfToken } = require("../middlewares/csrf");

// All classroom analytics routes require admin. This was commented out —
// getClassroomDashboard and exportClassroomSummary had no auth check at
// all (anyone could view or export any classroom's full analytics);
// reactivateStudentTerm happened to check admin internally, but was
// relying on that alone.
//
// Scoped to "/admin/classrooms" specifically — this router is mounted
// with NO path prefix (app.js: app.use(classroomAnalyticsRoutes)), so a
// path-less router.use() here would run for EVERY request in the app
// that falls through to this router (any request not fully handled by
// an earlier-mounted one), not just these three routes. A path-less
// version of exactly this gate broke every /labs/* route for non-admins
// the moment it was added — caught live in verification. See
// routes/notificationRoutes.js for the same mistake made and fixed once
// already elsewhere in this codebase.
router.use("/admin/classrooms", ensureAdmin, ensureCsrfToken, verifyCsrfToken);

/**
 * Main Classroom Dashboard
 */
router.get(
  "/admin/classrooms/:classroomId/dashboard",
  classroomAnalyticsController.getClassroomDashboard
);

/**
 * Export Full Classroom Summary (PDF or CSV later)
 */
router.get(
  "/admin/classrooms/:classroomId/dashboard/export",
  classroomAnalyticsController.exportClassroomSummary
);

/**
 * Reactivate a student's ended term for free (platform admin only —
 * see classroomAnalyticsController.reactivateStudentTerm)
 */
router.post(
  "/admin/classrooms/:classroomId/terms/:termId/students/:studentId/reactivate",
  classroomAnalyticsController.reactivateStudentTerm
);

module.exports = router;
