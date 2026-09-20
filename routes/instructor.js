// routes/instructor.js
const express = require("express");
const router = express.Router();
const { ensureInstructorOrAdmin } = require("../middlewares/auth");
const { loginLimiter } = require("../middlewares/rateLimiters");
const { ensureCsrfToken, verifyCsrfToken } = require("../middlewares/csrf");
const learningController = require("../controllers/learningController");
const adminController = require("../controllers/adminController");
const instructorController = require("../controllers/instructorController");
// const upload = require("../middlewares/upload");
const { upload, lessonUpload, lessonSlideUpload } = require("../middlewares/upload");

router.post("/login", loginLimiter, adminController.login);
// Instructor dashboard
// router.get("/dashboard", (req, res) => {
//   res.render("instructor/dashboard", {
//     info: req.user || { fullname: "Instructor" }, // better than req.info
//   });
// });

// Everything below this line requires a logged-in instructor/admin
// session. Previously only a scattered subset of routes in this file
// carried ensureInstructorOrAdmin individually — report downloads,
// attendance session details/export, and chat-moderation routes
// (mute/lock/delete-message) had none at all, reachable anonymously.
// A single router-wide gate (matching the pattern already used in
// routes/teacher.js and routes/schoolAdmin.js) closes that gap for
// every current and future route in this file at once.
router.use(ensureInstructorOrAdmin);

// CSRF protection for everything below — see the matching comment in
// routes/adminRoutes.js. Every view this router renders either includes
// partials/adminHeader.ejs directly, or is an AJAX section fragment
// (views/instructor/sections/*.ejs) injected into instructor/dashboard.ejs,
// which already has the token + public/js/csrf.js loaded — confirmed by
// checking every .ejs file under views/instructor/ before enabling this.
router.use(ensureCsrfToken, verifyCsrfToken);

router.post("/set-school", instructorController.setActiveSchool);
router.get("/dashboard", adminController.instructorDashboard);
router.get("/ajax/courses", instructorController.ajaxCourses);
// routes/instructorRoutes.js
router.get("/section/:section",instructorController.loadSection);
router.get("/classroom/:id/students", instructorController.getInstructorClassesSection);
router.get("/students", instructorController.getInstructorStudentsSection);
router.get("/reports", instructorController.getInstructorReportsSection);
router.get("/student/:id/progress", instructorController.viewStudentProgress);
router.get(
  "/student/:studentId/quizzes/:quizId/download",
  instructorController.downloadQuizReport
);
router.get("/student/:id/report", instructorController.downloadStudentReport);
router.get(
  "/section/assigned-courses",
  instructorController.assignedCoursesSection
);

// Attendance section
// router.get("/attendance", instructorController.loadAttendanceSection);

router.get("/attendance/students", instructorController.getAttendanceStudents);

router.post("/attendance/save", instructorController.saveAttendance);

router.get("/attendance/history", instructorController.getAttendanceHistory);

router.get("/attendance/session/:id", instructorController.getAttendanceSessionDetails);

router.get("/attendance/export/pdf/:sessionId", instructorController.exportAttendancePDF);

// Gamified points/coins — anti-bias caps enforced server-side in
// services/instructorAwardService.js, not just in the UI.
router.post("/students/:id/award", ensureInstructorOrAdmin, instructorController.awardStudentPoints);
router.get("/awards/recent", ensureInstructorOrAdmin, instructorController.getRecentAwards);

// Class Reports — narrative CKEditor write-ups, distinct from the
// downloadable PDF student reports above.
router.post("/class-reports", ensureInstructorOrAdmin, instructorController.createClassReport);
router.get("/class-reports/:id", ensureInstructorOrAdmin, instructorController.getClassReport);
router.post("/class-reports/:id/edit", ensureInstructorOrAdmin, instructorController.updateClassReport);
router.post("/class-reports/:id/delete", ensureInstructorOrAdmin, instructorController.deleteClassReport);

// Courses
router.post(
  "/courses",
  ensureInstructorOrAdmin,
  upload.single("thumbnail"),
  adminController.createCourse
);

router.post(
  "/courses/edit/:id",
  upload.single("thumbnail"),
  adminController.editCourse
);
router.post("/courses/delete/:id", adminController.deleteCourse);

router.get("/pathways/:id/courses", adminController.showCoursesByPathway);
router.post(
  "/pathways/:id/courses",
  upload.single("thumbnail"),
  adminController.createCourseUnderPathway
);
router.get("/courses/:id", learningController.viewSingleCourse);
router.post("/admin/courses/:id/edit", learningController.updateCourse);

router.post(
  "/modules/create",
  ensureInstructorOrAdmin,
  upload.single("thumbnail"),
  learningController.createModule
);

router.post(
  "/modules/edit/:id",
  upload.single("thumbnail"),
  learningController.editModule
);
router.post("/modules/delete/:id", learningController.deleteModule);

router.post(
  "/lessons/create",
  ensureInstructorOrAdmin,
  lessonSlideUpload,
  learningController.createLesson
);

router.post("/lessons/:id/edit", lessonSlideUpload, learningController.editLesson);
router.post("/lessons/:id/delete", learningController.deleteLesson);
router.get("/lessons/:id/json", learningController.getLessonJSON);

// Get-or-create quiz for lesson — see the matching comment in
// routes/adminRoutes.js for why this is POST, not GET.
router.post("/lesson/:lessonId/quiz", learningController.getOrCreateLessonQuiz);

// Create question
router.post(
  "/quiz-question/create",
  upload.none(),
  learningController.createQuizQuestion
);

router.post(
  "/quiz-question/:id/edit",
  upload.none(), // multer middleware to parse form-data
  learningController.editQuizQuestion
);

// Delete question
router.post("/quiz-question/:id/delete", learningController.deleteQuizQuestion);

router.post(
  "/assignments/create",
  upload.none(),
  learningController.createAssignment
);
router.post(
  "/assignments/:id/edit",
  upload.none(),
  learningController.editAssignment
);

// Delete
router.post("/assignments/:id/delete", learningController.deleteAssignment);

// Projects
router.post("/admin/courses/:id/project", learningController.createProject);

// Download student course/module summary — same handlers admin's rich
// progress page uses, reused so instructor's parity version can offer
// the same report-download buttons.
router.get(
  "/student/:studentId/course-summary/:courseId/download",
  adminController.downloadCourseSummary
);
router.get(
  "/student/:studentId/module-summary/:moduleId/download",
  adminController.downloadModuleSummary
);

// Direct 1:1 chat (instructor <-> student). Previously mis-wired: the
// send route was double-prefixed ("/instructor/instructor/chat/send",
// unreachable) and the get-messages route pointed at adminController's
// copy instead of instructorController's own — the chat UI silently
// worked around both by calling the student-side routes instead, which
// meant instructor messages skipped the profanity filter students'
// messages go through. Fixed to point at instructor's own controller,
// which now has the same filter (see instructorController.sendChatMessage).
router.post("/chat/send", instructorController.sendChatMessage);
router.get("/chat/messages/:receiverId", instructorController.getChatMessages);
router.get("/chats/unread-count", instructorController.getUnreadChatCount);
router.get("/chats", instructorController.getInstructorChats);

router.get("/chats/:studentId", instructorController.getChatWithStudent);
router.post("/chat/markRead/:receiverId", instructorController.markMessagesAsRead);
router.get("/search-student", instructorController.searchStudent);
router.get("/messages/unread", instructorController.getUnreadMessages);

router.post("/class/send", instructorController.sendClassMessage)
router.get("/class/messages/:classroomId",instructorController.getClassMessages)
router.get("/class-chat/:classroomId",instructorController.renderClassChat)
router.post("/mute-student", instructorController.muteStudent);
router.post("/unmute-student", instructorController.unmuteStudent)
router.post("/class/lock", instructorController.lockClassChat);
router.post("/class/unlock", instructorController.unlockClassChat);
router.post("/class/delete-message", instructorController.deleteClassMessage);

// View course content (modules, lessons, quizzes)
router.get(
  "/courses/:courseId/learn",
  instructorController.viewCourseAsStudent
);

// Classroom-wide lesson pacing — makes a lesson available to (or holds it
// back from) every student in a classroom, on top of each student's own
// individual progress. State-changing, so both routes require the
// instructor role AND (checked in the controller) that this instructor
// actually teaches the given classroom.
router.post(
  "/classrooms/:classroomId/lessons/:lessonId/release",
  ensureInstructorOrAdmin,
  instructorController.releaseLessonToClassroom
);
router.post(
  "/classrooms/:classroomId/lessons/:lessonId/unrelease",
  ensureInstructorOrAdmin,
  instructorController.unreleaseLessonFromClassroom
);

// Was wired to viewStudentProgress, which reads req.params.id (a
// student id) — this route only ever supplies :courseId, so every hit
// silently 403'd ("Not authorized to view this student"). The two
// buttons that linked here (dashboard.ejs, assigned_courses.ejs) now
// call loadSection('students'/'students?classroom_id=...') directly
// instead (the real "view students" feature, already built) — this
// route is kept only as a safe fallback for any stray bookmark/link.
router.get("/courses/:courseId/students", (req, res) => {
  res.redirect("/instructor/dashboard");
});

// router.get(
//   "/lessons/:lessonId/preview",ensureInstructorOrAdmin,
//   instructorController.previewLesson
// );

// router.get("/assignment/:assignId/preview", instructorController.previewAssignment);
// router.get("/quiz/:quizId/preview", instructorController.previewQuiz);

// Unified preview route
router.get("/preview/:type/:id", instructorController.previewContent);


// router.get("/chats", adminController.getInstructorChats);
// router.get("/chats/:studentId", adminController.getChatWithStudent);


module.exports = router;
