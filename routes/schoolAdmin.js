const express = require("express");
const router = express.Router();
const schoolAdminController = require("../controllers/schoolAdminController");
const activityLoggerMiddleware = require("../middlewares/activityMiddleware");
const multer = require("multer");
const path = require("path");

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
router.post(
  "/classrooms/:id/add-student",
  activityLoggerMiddleware(
    "Student assigned to classroom",
    (req) => `Classroom: ${req.body.name}`
  ),
  schoolAdminController.addStudentToClassroom
);



// Quotes
router.get("/section/quotes", schoolAdminController.getQuotes);
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
router.get("/section/classroom-courses", schoolAdminController.getClassroomCourses);
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
// router.post(
//   "/classroom-courses/assign",
//   schoolAdminController.addPaymentAdjustment
// );



module.exports = router;
