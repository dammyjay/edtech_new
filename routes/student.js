const express = require("express");
const router = express.Router();
const multer = require("multer");
// const upload = multer({ dest: 'uploads/' }); // temp local storage
// const upload = require("../middlewares/upload");
const { upload, lessonUpload } = require("../middlewares/upload");
const activityLoggerMiddleware = require("../middlewares/activityMiddleware");
const studentController = require("../controllers/studentController");
const externalProjectController = require("../controllers/externalProjectController");

const { ensureAuthenticated } = require("../middlewares/auth");
const { ensureCsrfToken, verifyCsrfToken } = require("../middlewares/csrf");

// CSRF protection — see the matching comment in routes/adminRoutes.js.
// Mounted at "/student" (a specific prefix, not "/"), so a path-less
// router.use() here is safe. Unlike the other role routers, this file has
// no consistent router-wide auth gate of its own (ensureAuthenticated is
// applied ad hoc per-route below, a separate pre-existing gap — see the
// tracker) — but every view it renders either includes partials/header.ejs
// directly (confirmed for all 8 views this controller renders) or has no
// forms/fetch calls at all, so it's safe to add CSRF here regardless of
// that inconsistency.
router.use(ensureCsrfToken, verifyCsrfToken);

router.get("/dashboard", studentController.getDashboard);
router.get("/courses", studentController.getEnrolledCourses);
router.get("/past-courses/:courseId", ensureAuthenticated, studentController.viewPastCourse);
router.get("/terms/:termId/reactivate", ensureAuthenticated, studentController.viewTermReactivation);
router.post("/terms/:termId/reactivate", ensureAuthenticated, studentController.payTermReactivation);
router.get("/analytics", studentController.getAnalytics);
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
//     const { lessonId, duration, endTime } = req.body;
//     const userId = req.user.id;

//     const result = await pool.query(
//       `UPDATE activities
//        SET
//          duration_seconds = $1,
//          end_time = to_timestamp($2/1000.0)
//        WHERE user_id = $3
//          AND action = 'Lesson Session'
//          AND details = $4
//          AND end_time IS NULL
//        RETURNING *`,
//       [duration, endTime, userId, `Lesson ${lessonId}`],
//     );

//     console.log("UPDATED ROW:", result.rows);

//     res.json({ success: true });
//   } catch (err) {
//     console.error("LESSON TIME ERROR:", err);
//     res.status(500).json({ success: false });
//   }
// });

// router.post("/lesson-start", ensureAuthenticated, async (req, res) => {
//   try {
//     const { lessonId, startTime } = req.body;
//     const userId = req.user.id;

//     const result = await pool.query(
//       `INSERT INTO activities
//        (user_id, action, details, start_time, duration_seconds)
//        VALUES ($1, $2, $3, to_timestamp($4/1000.0), 0)
//        RETURNING *`,
//       [userId, "Lesson Session", `Lesson ${lessonId}`, startTime],
//     );

//     console.log("START INSERTED:", result.rows);

//     res.json({ success: true });
//   } catch (err) {
//     console.error("LESSON START ERROR:", err);
//     res.status(500).json({ success: false });
//   }
// });

router.post("/lesson-time", ensureAuthenticated, async (req, res) => {
  try {
    const { activityId, duration, endTime } = req.body;
    console.log("UPDATE:", { activityId, duration, endTime });
    const result = await pool.query(
      `UPDATE activities
       SET duration_seconds = $1,
           end_time = to_timestamp($2/1000.0)
       WHERE id = $3
       RETURNING *`,
      [duration, endTime, activityId],
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

router.post("/lesson-start", ensureAuthenticated, async (req, res) => {
  try {
    const { lessonId, startTime } = req.body;
    const userId = req.user.id;

    const result = await pool.query(
      `INSERT INTO activities 
       (user_id, action, lesson_id, start_time, duration_seconds)
       VALUES ($1, $2, $3, to_timestamp($4/1000.0), 0)
       RETURNING id`,
      [userId, "Lesson Session", lessonId, startTime],
    );

    res.json({ success: true, activityId: result.rows[0].id });
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

// Get the lab task attached to a lesson (Blockly/Web)
router.get('/lessons/:lessonId/lab', studentController.getLessonLab);

router.post(
  "/lessons/:id/quiz/submit",
  express.json(),activityLoggerMiddleware(
      "Student submitted Quiz",
      (req) => `Lesson: ${req.params.id}, Score: ${req.body.score}`
    ),
  studentController.submitLessonQuiz
);

router.post("/lessons/:lessonId/reflect", express.json(), studentController.submitReflection);

router.post("/streak/freeze", express.json(), studentController.freezeStreak);
router.get("/avatar-frames", studentController.getAvatarFrames);
router.post("/avatar-frames/unlock", express.json(), studentController.unlockAvatarFrame);
router.post("/avatar-frames/equip", express.json(), studentController.equipAvatarFrame);
router.post("/xp/exchange", express.json(), studentController.exchangeXp);
router.post("/wallet/buy-coins", express.json(), studentController.buyCoinsFromWallet);

router.get("/shop", studentController.getShop);
router.post("/shop/unlock", express.json(), studentController.unlockShopItem);
router.post("/shop/equip", express.json(), studentController.equipShopItem);
router.post("/shop/xp-boost", express.json(), studentController.buyXpBoost);
router.post("/quizzes/:lessonId/hint", express.json(), studentController.useQuizHint);
router.post("/quizzes/:lessonId/fifty-fifty", express.json(), studentController.useFiftyFifty);
router.post("/quizzes/:lessonId/questions/:questionId/check-answer", express.json(), studentController.checkQuizAnswer);

router.get("/arcade", studentController.getArcade);
router.post("/arcade/:gameId/play", express.json(), studentController.playArcadeGame);

router.get("/quizzes/mine", studentController.getMyQuizzes);
router.get("/quizzes/submission/:id", studentController.getQuizSubmissionById);

router.get("/quizzes/:id/report/download", ensureAuthenticated, studentController.downloadMyQuizReport);
router.get("/modules/:id/report/download", ensureAuthenticated, studentController.downloadMyModuleReport);
router.get("/courses/:id/report/download", ensureAuthenticated, studentController.downloadMyCourseReport);




// routes/student.js
router.get('/lessons/:id', studentController.getLesson);


router.post("/ai/ask", ensureAuthenticated, studentController.askAITutor);

router.get("/mastery/signals", ensureAuthenticated, studentController.getMasterySignals);
router.post("/mastery/:id/dismiss", ensureAuthenticated, studentController.dismissMasterySignalRoute);

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

// External project submissions — work built outside any in-app lab (a real
// web server, a Docker deployment, OS-level automation), submitted as a
// file or a link. Separate system from assignments above — see
// controllers/externalProjectController.js.
router.get(
  "/external-projects/:id",
  ensureAuthenticated,
  activityLoggerMiddleware("Viewed External Project", (req) => `External Project ${req.params.id}`),
  externalProjectController.viewExternalProject
);
// upload.any()'s own errors (a corrupted file, Cloudinary rejecting
// something that isn't really the image/PDF/etc. type it claims to be —
// confirmed live: "Invalid image file") happen inside multer's own
// middleware, before externalProjectController.submitExternalProject's
// try/catch ever runs, and previously crashed to a generic HTML error page
// instead of the JSON response this route's client-side fetch() expects to
// parse. Same problem middlewares/upload.js's lessonSlideUpload wrapper
// already solves for a different route — this is that same fix, JSON
// instead of an HTML page since this route is fetch()-driven, not a native
// form submit.
function safeExternalProjectUpload(req, res, next) {
  upload.any()(req, res, (err) => {
    if (!err) return next();
    console.error("External project upload error:", err);
    const isTooLarge = err.code === "LIMIT_FILE_SIZE" || /file size too large/i.test(err.message || "");
    const message = isTooLarge
      ? "One of your files is too large (25MB max)."
      : (err && err.message) || (err && err.error && err.error.message) || "That upload was rejected — check the file and try again.";
    res.status(400).json({ success: false, message });
  });
}

router.post(
  "/external-projects/:id/submit",
  ensureAuthenticated,
  safeExternalProjectUpload, // field names are dynamic (file_0, file_1, ...) — one per deliverable the task defines
  activityLoggerMiddleware("Submitted External Project", (req) => `External Project ${req.params.id}`),
  externalProjectController.submitExternalProject
);
router.get(
  "/external-projects/mine/list",
  ensureAuthenticated,
  externalProjectController.getMyExternalProjectSubmissions
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

router.post("/class/send", ensureAuthenticated, studentController.sendClassMessage)
router.get("/class/messages/:classroomId", ensureAuthenticated, studentController.getClassMessages)
router.get("/classroom/:id/announcements", ensureAuthenticated, studentController.getClassroomAnnouncements)

router.post(
  "/projects/submit",
  upload.single("projectFile"),
  studentController.submitProject
);


module.exports = router;
