const pool = require("../models/db");

exports.sendChatMessage = async (req, res) => {
  try {
    const { receiverId, message } = req.body;
    const senderId = req.session.user?.id; // Use logged-in user's ID

    if (!senderId) {
      return res.status(401).json({ success: false, message: "Not logged in" });
    }

    if (!receiverId || !message.trim()) {
      return res.status(400).json({ success: false, message: "Invalid input" });
    }

    await pool.query(
      `INSERT INTO messages (sender_id, receiver_id, message, is_read)
   VALUES ($1, $2, $3, FALSE)`,
      [senderId, receiverId, message]
    );


    res.json({ success: true, message: "Message sent successfully" });
  } catch (err) {
    console.error("Send chat message error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getChatMessages = async (req, res) => {
  try {
    const receiverId = req.params.receiverId;
    const senderId = req.session.user?.id;

    if (!senderId) {
      return res.status(401).json({ success: false, message: "Not logged in" });
    }

    // 1️⃣ Mark messages as delivered when fetched
    await pool.query(
      `UPDATE messages
       SET is_delivered = TRUE
       WHERE receiver_id = $1 AND sender_id = $2 AND is_delivered = FALSE`,
      [senderId, receiverId]
    );

    // 2️⃣ Fetch all chat messages
    const { rows } = await pool.query(
      `
      SELECT 
        id, sender_id, receiver_id, message, created_at, is_read, is_delivered,
        CASE WHEN sender_id = $1 THEN 'self' ELSE 'other' END AS sender
      FROM messages
      WHERE (sender_id = $1 AND receiver_id = $2)
         OR (sender_id = $2 AND receiver_id = $1)
      ORDER BY created_at ASC
      `,
      [senderId, receiverId]
    );

    // 3️⃣ Optionally mark as read
    await pool.query(
      `UPDATE messages 
       SET is_read = TRUE 
       WHERE receiver_id = $1 AND sender_id = $2 AND is_read = FALSE`,
      [senderId, receiverId]
    );

    res.json(rows);
  } catch (err) {
    console.error("Get chat messages error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ✅ Get all chat conversations (students who have messaged instructor)
exports.getInstructorChats = async (req, res) => {
  try {
    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const info = infoResult.rows[0] || {};
    const instructorId = req.user.id;

    const { rows } = await pool.query(
      `
      SELECT DISTINCT 
        u.id AS student_id,
        u.fullname AS student_name,
        u.email,
        MAX(m.created_at) AS last_message_time
      FROM messages m
      JOIN users2 u ON 
        (u.id = m.sender_id AND m.receiver_id = $1)
        OR (u.id = m.receiver_id AND m.sender_id = $1)
      WHERE u.role = 'student'
      GROUP BY u.id, u.fullname, u.email
      ORDER BY last_message_time DESC
      `,
      [instructorId]
    );

    const profilePic = req.session.user
      ? req.session.user.profile_picture
      : null;

    res.render("instructor/chatList", {
      chats: rows,
      info,
      profilePic,
      role: "instructor",
      user: req.session.user,
    });
  } catch (err) {
    console.error("Get instructor chats error:", err);
    res.status(500).send("Error loading chats");
  }
};

// ✅ Full chat conversation with one student
exports.getChatWithStudent = async (req, res) => {
  try {
    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const info = infoResult.rows[0] || {};
    const instructorId = req.user.id;
    const studentId = req.params.studentId;

    const { rows } = await pool.query(
      `
      SELECT 
        m.id, m.sender_id, m.receiver_id, m.message, m.created_at,
        CASE WHEN m.sender_id = $1 THEN 'self' ELSE 'other' END AS sender
      FROM messages m
      WHERE (m.sender_id = $1 AND m.receiver_id = $2)
         OR (m.sender_id = $2 AND m.receiver_id = $1)
      ORDER BY m.created_at ASC
      `,
      [instructorId, studentId]
    );

    const studentResult = await pool.query(
      `SELECT id, fullname, email FROM users2 WHERE id = $1`,
      [studentId]
    );


    const profilePic = req.session.user
      ? req.session.user.profile_picture
      : null;

    res.render("instructor/chatView", {
      student: studentResult.rows[0],
      messages: rows,
      info,
      profilePic,
      role: "instructor",
      user: req.session.user,
    });
  } catch (err) {
    console.error("Get chat with student error:", err);
    res.status(500).send("Error loading chat conversation");
  }
};

exports.markMessagesAsRead = async (req, res) => {
  try {
    const { receiverId } = req.params;
    const senderId = req.session.user?.id;

    await pool.query(
      `UPDATE messages
       SET is_read = TRUE
       WHERE receiver_id = $1 AND sender_id = $2 AND is_read = FALSE`,
      [senderId, receiverId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Mark read error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.searchStudent = async (req, res) => {
  try {
    const instructorId = req.user.id;
    const query = req.query.q ? req.query.q.trim() : "";

    if (!query) return res.json([]);

    const { rows } = await pool.query(
      `
      SELECT u.id, u.fullname, u.email, us.classroom_id AS class_name
      FROM users2 u
      JOIN user_school us ON u.id = us.user_id
      WHERE us.role_in_school = 'student'
        AND us.school_id = COALESCE(
          (SELECT school_id FROM user_school WHERE user_id = $2 LIMIT 1),
          us.school_id
        )
        AND (
          LOWER(u.fullname) LIKE LOWER($1)
          OR LOWER(u.email) LIKE LOWER($1)
          OR LOWER(CAST(us.classroom_id AS TEXT)) LIKE LOWER($1)
        )
      LIMIT 20
      `,
      [`%${query}%`, instructorId]
    );

    res.json(rows);
  } catch (err) {
    console.error("Search student error:", err);
    res.status(500).json([]);
  }
};

exports.getUnreadMessages = async (req, res) => {
  try {
    const instructorId = req.user.id;

    // ✅ Fetch unread (unopened) messages only
    const { rows } = await pool.query(
      `
      SELECT 
        m.id,
        m.sender_id,
        u.fullname AS sender_name,
        u.email AS sender_email,
        m.message,
        m.created_at
      FROM messages m
      JOIN users2 u ON m.sender_id = u.id
      WHERE m.receiver_id = $1
        AND m.is_read = FALSE
      ORDER BY m.created_at DESC
      `,
      [instructorId]
    );

    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const info = infoResult.rows[0] || {};

    const profilePic = req.session.user
      ? req.session.user.profile_picture
      : null;

    res.render("instructor/inbox", {
      receivedMessages: rows,
      info,
      profilePic,
      role: "instructor",
      user: req.session.user,
    });
  } catch (err) {
    console.error("Get unread messages error:", err);
    res.status(500).send("Error loading unread messages");
  }
};

// controllers/instructorDashboardController.js
exports.getInstructorDashboard = async (req, res) => {
  const instructorId = req.user.id;

  try {
    // --- Company Info
    const info = (await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    )).rows[0] || {};

    const profilePic = req.session.user?.profile_picture || null;

    // --- Classrooms instructor teaches
    const classroomsRes = await pool.query(
      `
      SELECT c.id, c.name
      FROM classrooms c
      JOIN classroom_instructors ci ON ci.classroom_id = c.id
      WHERE ci.instructor_id = $1
      `,
      [instructorId]
    );

    const classrooms = classroomsRes.rows;

    // --- Courses in selected classroom
    let courses = [];
    let modules = [];
    let lessons = [];

    if (req.query.classroom) {
      const coursesRes = await pool.query(
        `
        SELECT cr.*, p.title AS pathway_name
        FROM classroom_courses cc
        JOIN courses cr ON cc.course_id = cr.id
        LEFT JOIN career_pathways p ON cr.career_pathway_id = p.id
        WHERE cc.classroom_id = $1
        ORDER BY cr.title
        `,
        [req.query.classroom]
      );
      courses = coursesRes.rows;
    }

    // --- Modules (no unlock checks)
    if (req.query.course) {
      const modulesRes = await pool.query(
        `
        SELECT * FROM modules
        WHERE course_id = $1
        ORDER BY order_number ASC
        `,
        [req.query.course]
      );
      modules = modulesRes.rows;
    }

    // --- Lessons (no unlock checks)
    if (req.query.module) {
      const lessonsRes = await pool.query(
        `
        SELECT l.*,
               EXISTS(SELECT 1 FROM quizzes q WHERE q.lesson_id = l.id) AS has_quiz
        FROM lessons l
        WHERE l.module_id = $1
        ORDER BY order_number ASC
        `,
        [req.query.module]
      );
      lessons = lessonsRes.rows;
    }

    res.render("instructor/dashboard", {
      info,
      profilePic,
      classrooms,
      courses,
      modules,
      lessons,
      selected: req.query,
      user: req.session.user,
      role: "instructor",
    });

  } catch (err) {
    console.error("Instructor dashboard error:", err);
    res.status(500).send("Server error");
  }
};


// exports.previewContent = async (req, res) => {
//   const { type, id } = req.params; // type = lesson | assignment | quiz, id = lessonId/assignId/quizId

//   try {
//     if (type === "lesson") {
//       const lesson = (await pool.query("SELECT * FROM lessons WHERE id = $1", [id])).rows[0];
//       if (!lesson) return res.send("<p>Lesson not found</p>");

//       const lessonType = req.query.part; // video | content | quiz

//       if (lessonType === "video") {
//         res.send(`<video src="${lesson.video_url}" controls style="width:100%"></video>`);
//       } else if (lessonType === "content") {
//         res.send(`<div>${lesson.content}</div>`);
//       } else if (lessonType === "quiz") {
//         // Fetch lesson quiz
//         const quizRes = await pool.query(
//           "SELECT * FROM quizzes WHERE lesson_id = $1",
//           [id]
//         );
//         const quiz = quizRes.rows[0];
//         if (!quiz) return res.send("<p>No quiz found for this lesson.</p>");

//         // Inside previewContent, for lesson quiz or standalone quiz
//         const questionsRes = await pool.query(
//           "SELECT * FROM quiz_questions WHERE quiz_id = $1 ORDER BY id ASC",
//           [quiz.id] // or [id] if standalone
//         );

//         const questions = questionsRes.rows;
//         let html = `<h3>📝 ${quiz.title}</h3>`;

//         if (questions.length === 0) {
//           html += "<p>No questions added yet.</p>";
//         } else {
//           html += "<ol>";
//           questions.forEach(q => {
//             html += `<li>${q.question}</li>`; // ✅ use 'question' not 'question_text'

//             // Show options if available
//             if (Array.isArray(q.options)) {
//               q.options.forEach(opt => {
//                 html += `<label><input type="radio" name="q${q.id}" disabled> ${opt}</label><br>`;
//               });
//             }
//           });
//           html += "</ol>";
//         }

//         res.send(html);

//       } else {
//         res.send("<p>Invalid lesson part type</p>");
//       }

//     } else if (type === "assignment") {
//       const assignmentRes = await pool.query(
//         "SELECT * FROM module_assignments WHERE id = $1",
//         [id]
//       );
//       const assignment = assignmentRes.rows[0];
//       if (!assignment) return res.send("<p>Assignment not found</p>");

//       res.send(`
//         <h3>📑 ${assignment.title}</h3>
//         <p>${assignment.description || "No description provided."}</p>
//         ${assignment.file_url ? `<p>Attachment: <a href="${assignment.file_url}" target="_blank">Download</a></p>` : ""}
//       `);

//     } else if (type === "quiz") {
//       const quizRes = await pool.query("SELECT * FROM quizzes WHERE id = $1", [id]);
//       const quiz = quizRes.rows[0];
//       if (!quiz) return res.send("<p>Quiz not found</p>");

//       const questionsRes = await pool.query(
//         "SELECT * FROM quiz_questions WHERE quiz_id = $1 ORDER BY id ASC",
//         [id]
//       );

//       const questions = questionsRes.rows;
//       let html = `<h3>📝 ${quiz.title}</h3>`;
//       if (questions.length === 0) html += "<p>No questions added yet.</p>";
//       else {
//         html += "<ol>";
//         questions.forEach(q => html += `<li>${q.question_text}</li>`);
//         html += "</ol>";
//       }
//       res.send(html);

//     } else {
//       res.send("<p>Invalid content type</p>");
//     }

//   } catch (err) {
//     console.error(err);
//     res.send("<p style='color:red;'>Failed to load content</p>");
//   }
// };

exports.previewContent = async (req, res) => {
  const { type, id } = req.params; // type = lesson | assignment | quiz, id = lessonId/assignId/quizId

  try {
    if (type === "lesson") {
      const lesson = (await pool.query("SELECT * FROM lessons WHERE id = $1", [id])).rows[0];
      if (!lesson) return res.status(404).json({ error: "Lesson not found" });

      const lessonType = req.query.part; // video | content | quiz

      if (lessonType === "video") {
        return res.json({ type: "video", title: lesson.title, video_url: lesson.video_url });
      } else if (lessonType === "content") {
        return res.json({ type: "content", title: lesson.title, content: lesson.content });
      } else if (lessonType === "quiz") {
        // Fetch lesson quiz
        const quizRes = await pool.query(
          "SELECT * FROM quizzes WHERE lesson_id = $1",
          [id]
        );
        const quiz = quizRes.rows[0];
        if (!quiz) return res.status(404).json({ error: "No quiz found for this lesson" });

        const questionsRes = await pool.query(
          "SELECT * FROM quiz_questions WHERE quiz_id = $1 ORDER BY id ASC",
          [quiz.id]
        );

        const questions = questionsRes.rows.map(q => ({
          id: q.id,
          question: q.question,
          options: q.options || [],
          correct_option: q.correct_option,
          question_type: q.question_type
        }));

        return res.json({ type: "quiz", title: quiz.title, questions });
      } else {
        return res.status(400).json({ error: "Invalid lesson part type" });
      }

    } else if (type === "assignment") {
      const assignmentRes = await pool.query(
        "SELECT * FROM module_assignments WHERE id = $1",
        [id]
      );
      const assignment = assignmentRes.rows[0];
      if (!assignment) return res.status(404).json({ error: "Assignment not found" });

      return res.json({
        type: "assignment",
        title: assignment.title,
        description: assignment.description,
        file_url: assignment.file_url || null
      });

    } else if (type === "quiz") {
      const quizRes = await pool.query("SELECT * FROM quizzes WHERE id = $1", [id]);
      const quiz = quizRes.rows[0];
      if (!quiz) return res.status(404).json({ error: "Quiz not found" });

      const questionsRes = await pool.query(
        "SELECT * FROM quiz_questions WHERE quiz_id = $1 ORDER BY id ASC",
        [id]
      );

      const questions = questionsRes.rows.map(q => ({
        id: q.id,
        question: q.question,
        options: q.options || [],
        correct_option: q.correct_option,
        question_type: q.question_type
      }));

      return res.json({ type: "quiz", title: quiz.title, questions });

    } else {
      return res.status(400).json({ error: "Invalid content type" });
    }

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load content" });
  }
};


exports.viewStudentProgress = async (req, res) => {
  const studentId = req.params.studentId;

  const progress = await pool.query(
    `
    SELECT c.title, e.progress
    FROM course_enrollments e
    JOIN courses c ON c.id = e.course_id
    WHERE e.user_id = $1
    `,
    [studentId]
  );

  res.render("instructor/studentProgress", {
    progress: progress.rows
  });
};

exports.viewCourseAsStudent = async (req, res) => {
  const courseId = req.params.courseId;
  const instructor = req.user;

  const infoResult = await pool.query(
    "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
  );
  const info = infoResult.rows[0] || {};  
  // Fetch course
  const course = await pool.query("SELECT * FROM courses WHERE id = $1", [courseId]);

  // Fetch modules
  const modules = await pool.query(
    "SELECT * FROM modules WHERE course_id = $1 ORDER BY order_number ASC",
    [courseId]
  );

  // Fetch lessons
  const lessons = await pool.query(
    `SELECT l.* FROM lessons l
     JOIN modules m ON m.id = l.module_id
     WHERE m.course_id = $1
     ORDER BY l.order_number ASC`,
    [courseId]
  );

  // Fetch quizzes
  const quizzes = await pool.query(
    `SELECT q.* FROM quizzes q
     JOIN lessons l ON l.id = q.lesson_id
     JOIN modules m ON m.id = l.module_id
     WHERE m.course_id = $1`,
    [courseId]
  );

  // Fetch assignments
  const assignments = await pool.query(
    `SELECT a.* FROM module_assignments a
     JOIN modules m ON m.id = a.module_id
     WHERE m.course_id = $1`,
    [courseId]
  );

  // Convert lessons, quizzes, and assignments into objects keyed by module_id
  const moduleLessons = {};
  const moduleQuizzes = {};
  const moduleAssignments = {};

  lessons.rows.forEach(lesson => {
    if (!moduleLessons[lesson.module_id]) moduleLessons[lesson.module_id] = [];
    moduleLessons[lesson.module_id].push(lesson);
  });

  quizzes.rows.forEach(quiz => {
    if (!moduleQuizzes[quiz.module_id]) moduleQuizzes[quiz.module_id] = [];
    moduleQuizzes[quiz.module_id].push(quiz);
  });

  assignments.rows.forEach(assign => {
    if (!moduleAssignments[assign.module_id]) moduleAssignments[assign.module_id] = [];
    moduleAssignments[assign.module_id].push(assign);
  });

  res.render("instructor/courseContent", {
    info,
    profilePic: req.session.user?.profile_picture || null,
    user: req.session.user,
    role: "instructor",
    instructor,
    course: course.rows[0],
    modules: modules.rows,
    moduleLessons,
    moduleQuizzes,
    moduleAssignments
  });
};


