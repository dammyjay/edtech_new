const express = require("express");
const router = express.Router();
const multer = require("multer");
// const upload = multer({ dest: 'uploads/' }); // temp local storage
// const upload = require("../middlewares/upload");
const { upload, lessonUpload } = require("../middlewares/upload");
const activityLoggerMiddleware = require("../middlewares/activityMiddleware");
const studentController = require("../controllers/studentController");

const { ensureAuthenticated } = require("../middlewares/auth");
router.get("/dashboard", studentController.getDashboard);
router.get("/courses", studentController.getEnrolledCourses);
router.get("/analytics", studentController.getAnalytics);
router.post("/update-xp", studentController.updateXP);
router.post("/award-badge", studentController.awardBadge);
// Mark lesson complete
router.post("/lessons/:lessonId/complete", studentController.completeLesson);
// router.post("/courses/enroll/:courseId", studentController.enrollInCourse); 

router.post(
  "/courses/enroll/:courseId",
  ensureAuthenticated,
  studentController.enrollInCourse
);

router.post(
  "/profile/edit",
  upload.single("profilePic"),
  studentController.editProfile
);

router.get(
  "/lessons/:lessonId",
  ensureAuthenticated,
  activityLoggerMiddleware(
    "Viewed Lesson",
    (req) => `Lesson ${req.params.lessonId}`,
  ),
  studentController.viewLesson,
);

// router.post("/lesson-time", ensureAuthenticated, async (req, res) => {
//   try {
//     const { lessonId, duration } = req.body;
//     const userId = req.user.id;

//     await pool.query(
//       `INSERT INTO activities
//         (user_id, action, details, duration_seconds)
//         VALUES ($1, $2, $3, $4)`,
//       [userId, "Lesson Time Spent", `Lesson ${lessonId}`, duration],
//     );

//     res.json({ success: true });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ success: false });
//   }
// });

router.post("/lesson-time", ensureAuthenticated, async (req, res) => {
  try {
    const { lessonId, duration, startTime, endTime } = req.body;
    const userId = req.user.id;

    await pool.query(
      `INSERT INTO activities 
   (user_id, action, details, duration_seconds, start_time, end_time)
   VALUES ($1, $2, $3, $4, to_timestamp($5/1000.0), to_timestamp($6/1000.0))
   ON CONFLICT (user_id, action, details)
   DO UPDATE SET
     duration_seconds = activities.duration_seconds + EXCLUDED.duration_seconds,
     end_time = EXCLUDED.end_time`,
      [
        userId,
        "Lesson Time Spent",
        `Lesson ${lessonId}`,
        duration,
        startTime,
        endTime,
      ],
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

router.get(
  "/modules/:moduleId",
  ensureAuthenticated,
  studentController.getModuleDetails
);

// Get quiz questions for a lesson
router.get('/lessons/:id/quiz', studentController.getLessonQuiz);

router.post(
  "/lessons/:id/quiz/submit",
  express.json(),activityLoggerMiddleware(
      "Student submitted Quiz",
      (req) => `Lesson: ${req.params.id}, Score: ${req.body.score}`
    ),
  studentController.submitLessonQuiz
);

router.get("/quizzes/mine", studentController.getMyQuizzes);
router.get("/quizzes/submission/:id", studentController.getQuizSubmissionById);




// routes/student.js
router.get('/lessons/:id', studentController.getLesson);


router.post("/ai/ask", ensureAuthenticated, studentController.askAITutor);

// router.get(
//   "/student/assignments/:id",
//   studentController.viewAssignment
// );

// router.post(
//   "/student/assignments/:id/submit",
//   upload.single("file"),
//   studentController.submitAssignment
// );

router.get(
  "/assignments/:id",
  ensureAuthenticated, // 🔑 protect
  activityLoggerMiddleware("Viewed Assignment", (req) => `Assignment ${req.params.id}`),
  studentController.viewAssignment
);

router.post(
  "/assignments/:id/submit",
  ensureAuthenticated, // 🔑 protect
  upload.single("file"),
    activityLoggerMiddleware("Submitted Assignment", (req) => `Assignment ${req.params.id}`),
  studentController.submitAssignment
);

// routes/student.js
router.get(
  "/assignments/mine",
  ensureAuthenticated,
  studentController.getMyAssignments
);
router.get(
  "/assignments/submission/:id",
  ensureAuthenticated,
  studentController.getSubmissionById
);

// ✅ Parent request response (approve / reject)
router.post(
  "/parent-request/respond",
  studentController.respondToParentRequest
);

// routes/student.js
router.get("/classroom", studentController.getClassroom);

// routes/student.js
router.get("/teacher", studentController.getTeacher);

// studentRoutes.js
router.post("/chat/send", studentController.sendChatMessage);
router.get("/chat/messages/:receiverId", studentController.getChatMessages);
router.post("/chat/markRead/:receiverId", studentController.markMessagesAsRead);

router.post("/class/send", studentController.sendClassMessage)
router.get("/class/messages/:classroomId",studentController.getClassMessages)

router.post(
  "/projects/submit",
  upload.single("projectFile"),
  studentController.submitProject
);


module.exports = router;
