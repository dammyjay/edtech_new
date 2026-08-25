const express = require("express");
const router = express.Router();
const teacherController = require("../controllers/teacherController");
const { ensureTeacher } = require("../middlewares/auth");

// Every /teacher/* route requires a logged-in teacher — previously this
// file had no guard at all, so any session could reach these endpoints.
router.use(ensureTeacher);

// ------------------ MAIN DASHBOARD WRAPPER ------------------
router.get("/dashboard", (req, res) => {
  teacherController.getDashboard(req, res);
});

// ------------------ AJAX CONTENT LOADER ------------------
router.get("/dashboard/data", (req, res) => {
  teacherController.getDashboardData(req, res);
});

router.get("/section/:name", async (req, res) => {
  const { name } = req.params;
  try {
    switch (name) {
      case "dashboard":
        return teacherController.getDashboardData(req, res);
      case "classes":
        return teacherController.getClassesSection(req, res);
      case "students":
        return teacherController.getStudentsSection(req, res);
      case "reports":
        return teacherController.getReportsSection(req, res);
      case "attendance":
        return teacherController.getAttendanceSection(req, res);
      case "grading":
        return teacherController.getGradingQueue(req, res);
      default:
        return res.status(404).send("<p>Section not found</p>");
    }
  } catch (err) {
    console.error("Teacher Section Load Error:", err);
    return res.status(500).send("<p>Error loading section</p>");
  }
});

// ------------------ CLASSROOM STUDENTS ------------------
router.get("/classroom/:id/students", (req, res) => {
  teacherController.viewClassroomStudents(req, res);
});

// ------------------ STUDENT PROGRESS ------------------
router.get("/student/:id/progress", (req, res) => {
  teacherController.viewStudentProgress(req, res);
});

// ------------------ VIEW REPORT (teachers can view, not download) ------------------
router.get("/student/:id/report", (req, res) => {
  teacherController.viewStudentReport(req, res);
});
router.get("/student/:id/report/:courseId", (req, res) => {
  teacherController.viewCourseReport(req, res);
});

// Teachers can VIEW a student's progress/reports but never download a file
// — explicitly blocked rather than removed outright, so a stale link or
// bookmark gets a clear message instead of a bare 404.
router.get("/student/:studentId/quizzes/:quizId/download", (req, res) => {
  res.status(403).send("Teachers can view student progress, but reports aren't downloadable.");
});

// studentRoutes.js
router.post("/chat/send", teacherController.sendChatMessage);
router.get("/chat/messages/:receiverId", teacherController.getChatMessages);
router.post("/chat/markRead/:receiverId", teacherController.markMessagesAsRead);

// ------------------ ATTENDANCE ------------------
router.get("/attendance/students", teacherController.getAttendanceStudents);
router.post("/attendance/save", teacherController.saveAttendance);
router.get("/attendance/history", teacherController.getAttendanceHistory);
router.get("/attendance/session/:id", teacherController.getAttendanceSessionDetails);
router.get("/attendance/export/pdf/:sessionId", teacherController.exportAttendancePDF);
router.get("/attendance/term-summary", teacherController.getTermAttendanceSummary);

// ------------------ GRADING ------------------
router.get("/grading", teacherController.getGradingQueue);
router.post("/grading/:submissionId", teacherController.submitGrade);

// ------------------ CLASSROOM-WIDE CHAT ------------------
router.get("/class-chat/:classroomId", teacherController.renderClassChat);
router.post("/class/send", teacherController.sendClassMessage);
router.get("/class/messages/:classroomId", teacherController.getClassMessages);
router.post("/mute-student", teacherController.muteStudent);
router.post("/unmute-student", teacherController.unmuteStudent);
router.post("/class/lock", teacherController.lockClassChat);
router.post("/class/unlock", teacherController.unlockClassChat);
router.post("/class/delete-message", teacherController.deleteClassMessage);

// ------------------ CLASSROOM ANNOUNCEMENTS ------------------
router.post("/classroom-announcements", teacherController.createClassroomAnnouncement);
router.delete("/classroom-announcements/:id", teacherController.deleteClassroomAnnouncement);

module.exports = router;
