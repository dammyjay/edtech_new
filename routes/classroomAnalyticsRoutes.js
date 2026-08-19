const express = require("express");
const router = express.Router();
const classroomAnalyticsController = require("../controllers/classroomAnalyticsController");
const { ensureAdmin } = require("../middlewares/auth");

// All classroom analytics routes require admin
// router.use(ensureAdmin);

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
