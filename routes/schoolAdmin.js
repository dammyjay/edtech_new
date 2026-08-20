const express = require("express");
const router = express.Router();
const schoolAdminController = require("../controllers/schoolAdminController");
const adminController = require("../controllers/adminController");
const activityLoggerMiddleware = require("../middlewares/activityMiddleware");
const { requireSchoolAdmin } = require("../middlewares/auth");
const multer = require("multer");
const path = require("path");

// Every route below requires a logged-in school_admin who owns a school —
// see middlewares/auth.js's requireSchoolAdmin for what this actually
// fixes (it wasn't just missing, req.session.user.school_id was never
// populated at all, breaking several routes below outright).
router.use(requireSchoolAdmin);

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/"); // make sure this folder exists
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ storage });

// Dashboard
router.get("/dashboard", schoolAdminController.getDashboard);

// Approvals
router.post(
  "/approve/:id",
  activityLoggerMiddleware(
    "School user approved",
    (req) => `User ID: ${req.params.id}`
  ),
  schoolAdminController.approveUser
);

router.post(
  "/approve-all",
  activityLoggerMiddleware(
    "School user approved",
    (req) => `User ID: ${req.params.id}`
  ),
  schoolAdminController.approveAllUsers
);

router.post(
  "/bulk-add-students",
  upload.single("file"),
  activityLoggerMiddleware(
    "School bulk students added",
    (req) => `User ID: ${req.params.id}`
  ),
  schoolAdminController.bulkAddStudents
);

router.post(
  "/add-student",
  activityLoggerMiddleware(
    "School student added",
    (req) => `User ID: ${req.params.id}`
  ),
  schoolAdminController.addStudent
);


router.post(
  "/reject/:id",
  activityLoggerMiddleware(
    "School User rejected",
    (req) => `User ID: ${req.params.id}`
  ),
  schoolAdminController.rejectUser
);

// Classroom CRUD
router.get("/classrooms", schoolAdminController.listClassrooms);
// router.get("/classrooms/new", schoolAdminController.newClassroomForm);
router.post(
  "/classrooms/new",
  activityLoggerMiddleware(
    "Classroom created",
    (req) => `Classroom: ${req.body.name}`
  ),
  schoolAdminController.createClassroom
);
router.get("/classrooms/:id", schoolAdminController.viewClassroom);
router.get("/classrooms/:id/edit", schoolAdminController.editClassroomForm);
router.post(
  "/classrooms/:id/edit",
  activityLoggerMiddleware(
    "Classroom updated",
    (req) => `Classroom: ${req.body.name}`
  ),
  schoolAdminController.updateClassroom
);
router.post(
  "/classrooms/:id/delete",
  activityLoggerMiddleware(
    "Classroom deleted",
    (req) => `Classroom: ${req.body.name}`
  ),
  schoolAdminController.deleteClassroom
);
router.get("/section/:section", schoolAdminController.loadSection);
// Add student to a classroom
// router.post(
//   "/classrooms/:id/add-student",
//   activityLoggerMiddleware(
//     "Student assigned to classroom",
//     (req) => `Classroom: ${req.body.name}`
//   ),
//   schoolAdminController.assignToClassroom
// );

router.post(
  "/classrooms/:id/add-student",
  activityLoggerMiddleware(
    "Student assigned to classroom",
    (req) => `Classroom ID: ${req.params.id}`
  ),
  schoolAdminController.assignToClassroom
);

// Assign student to classroom (via modal/fetch)
router.post(
  "/students/:id/assign-classroom",
  schoolAdminController.assignToClassroomB
);


// Quotes
// router.get("/section/quotes", schoolAdminController.getQuotes);
router.post(
  "/quotes/add",
  activityLoggerMiddleware(
    "Quote added",
    (req) =>
      `Requested: ${req.body.requested_students}, Price: ${req.body.price_quote}`
  ),
  schoolAdminController.addQuote
);
router.post(
  "/quotes/delete/:id",
  activityLoggerMiddleware(
    "Quote deleted",
    (req) => `Quote ID: ${req.params.id}`
  ),
  schoolAdminController.deleteQuote
);

// Payments
router.get("/section/payments", schoolAdminController.getPayments);
router.post("/payments/update", schoolAdminController.updatePayment);

// Courses & Classrooms
router.post("/classroom-courses/assign", schoolAdminController.assignCourseToClassroom);

router.post(
  "/classroom-courses/update/:id",
  activityLoggerMiddleware(
    "Classroom course updated",
    (req) =>
      `Assignment ID: ${req.params.id}, New Course ID: ${req.body.courseId}`
  ),
  schoolAdminController.updateClassroomCourse
);
router.post(
  "/classroom-courses/delete/:id",
  activityLoggerMiddleware(
    "Classroom course deleted",
    (req) => `Assignment ID: ${req.params.id}`
  ),
  schoolAdminController.deleteClassroomCourse
);

router.get("/terms", schoolAdminController.getTerms);

router.post("/terms/create", schoolAdminController.createTerm);

router.post(
  "/terms/:id/update",
  schoolAdminController.updateTerm,
);

router.delete(
  "/terms/:id/delete",
  schoolAdminController.deleteTerm,
);

router.post(
  "/terms/assign-students",
  schoolAdminController.assignStudentsToTerm,
);

router.get(
  "/terms/:termId/students",
  schoolAdminController.getTermStudents,
);

router.get(
  "/terms/:termId/export",
  schoolAdminController.exportTermStudentsExcel,
);

router.get(
  "/attendance",
  
  schoolAdminController.attendancePage,
);

router.get(
  "/attendance/students",
  
  schoolAdminController.getAttendanceStudents,
);

router.post(
  "/attendance/save",
  
  schoolAdminController.saveAttendance,
);

router.get(
  "/attendance/history",
  schoolAdminController.getAttendanceHistory,
);

router.get(
  "/attendance/stats",

  schoolAdminController.getWeeklyAttendanceStats,
);

// Must come before the /attendance/:id wildcard below, or Express would
// match "summary" as an :id.
router.get(
  "/attendance/summary",
  schoolAdminController.getAttendanceSummary,
);

router.get(
  "/attendance/:id",
  schoolAdminController.getAttendanceSession,
);

router.get(
  "/attendance/:sessionId/pdf",
  schoolAdminController.exportAttendancePDF,
);

router.get(
  "/attendance/:termId/excel",
  schoolAdminController.exportAttendanceExcel,
);

router.get("/quotes", schoolAdminController.getQuotes);

router.get(
  "/quotes/:id",
  
  schoolAdminController.getQuoteDetails,
);

router.get(
  "/quotes/:id/download",
  
  schoolAdminController.downloadQuotePDF,
);

router.get(
  "/quotes/:id/payments",

  schoolAdminController.getPaymentHistory,
);

router.get(
  "/payments/:id/receipt",
  schoolAdminController.downloadPaymentReceipt,
);

// =============================
// ANALYTICS & REPORTS
// Parity with what the platform admin can see about a school — student
// progress detail, term/classroom growth+retention analytics, and a
// school-wide summary PDF — all scoped to the requesting school admin's
// own school only. Term/student report CARDS are generated only by the
// platform admin (see adminController.js's endTerm) — a school admin
// only ever views what's already stored, gated by whether the admin has
// marked the term ended (see getClassTermReportStatus below).
// =============================
router.get("/students/:id/progress", adminController.viewStudentProgress);
router.get("/term-analytics", schoolAdminController.getTermAnalytics);
router.get("/download-progress", schoolAdminController.downloadSchoolProgressReport);
router.get(
  "/reports/:classroomId/:termId/status",
  schoolAdminController.getClassTermReportStatus,
);
router.get(
  "/classrooms/:classroomId/dashboard",
  schoolAdminController.getClassroomDashboard,
);
router.get(
  "/classrooms/:classroomId/dashboard/export",
  schoolAdminController.exportClassroomSummary,
);

// Reports the platform admin generated and stored for this school (see
// services/classTermReportStore.js) — view-only, no regeneration.
router.get("/stored-reports", schoolAdminController.listStoredReports);
router.get("/stored-reports/:id/download", schoolAdminController.downloadStoredReport);

module.exports = router;
