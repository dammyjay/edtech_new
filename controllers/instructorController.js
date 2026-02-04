const pool = require("../models/db");
const puppeteer = require("puppeteer");


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

// controllers/instructorController.js
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

exports.ajaxCourses = async (req, res) => {
  const instructorId = req.user.id;

  const result = await pool.query(`
    SELECT c.id, c.title,
    COUNT(ce.user_id) AS student_count
    FROM courses c
    LEFT JOIN course_enrollments ce ON ce.course_id = c.id
    WHERE c.instructor_id = $1
    GROUP BY c.id
  `, [instructorId]);

  res.json(result.rows);
};

exports.loadSection = async (req, res) => {
  try {
    
    const { section } = req.params;
    const instructorId = req.user.id;

    // Fetch shared data
    const info =
      (await pool.query("SELECT * FROM company_info ORDER BY id DESC LIMIT 1"))
        .rows[0] || {};

    const profilePic = req.session.user?.profile_picture || null;

    // Fetch schools
    const schoolsRes = await pool.query(`
      SELECT DISTINCT s.id, s.name
      FROM classroom_instructors ci
      JOIN classrooms c ON ci.classroom_id = c.id
      JOIN schools s ON c.school_id = s.id
      WHERE ci.instructor_id = $1
      ORDER BY s.name
    `, [instructorId]);
    const schools = schoolsRes.rows;
    const activeSchoolId = req.query.school_id || (schools[0] ? schools[0].id : null);

    let school = null;
    let classes = [];
    let students = [];
    let total_students = 0;
    let total_courses = 0;
    let total_modules = 0;
    let total_lessons = 0;
    let total_submissions = 0;
    let overview = {};
    let lessonsPerClass = [];

    if (activeSchoolId) {
      school = schools.find(s => String(s.id) === String(activeSchoolId));

      // Load classrooms as `classes`
      const classesRes = await pool.query(`
        SELECT c.id, c.name
        FROM classroom_instructors ci
        JOIN classrooms c ON ci.classroom_id = c.id
        WHERE ci.instructor_id = $1
          AND c.school_id = $2
        ORDER BY c.name
      `, [instructorId, activeSchoolId]);
      classes = classesRes.rows;

      // Students count
      const studentsCountRes = await pool.query(`
        SELECT COUNT(DISTINCT us.user_id) AS count
        FROM user_school us
        JOIN classrooms c ON us.classroom_id = c.id
        JOIN classroom_instructors ci ON ci.classroom_id = c.id
        WHERE ci.instructor_id = $1
          AND c.school_id = $2
          AND us.role_in_school = 'student'
          AND us.approved = true
      `, [instructorId, activeSchoolId]);
      total_students = Number(studentsCountRes.rows[0].count);

      // Courses count
      const coursesCountRes = await pool.query(`
        SELECT COUNT(DISTINCT cc.course_id) AS count
        FROM classroom_courses cc
        JOIN classrooms c ON cc.classroom_id = c.id
        JOIN classroom_instructors ci ON ci.classroom_id = c.id
        WHERE ci.instructor_id = $1
          AND c.school_id = $2
      `, [instructorId, activeSchoolId]);
      total_courses = Number(coursesCountRes.rows[0].count);

      // Modules count
      const modulesCountRes = await pool.query(`
        SELECT COUNT(DISTINCT m.id) AS count
        FROM modules m
        JOIN courses cr ON m.course_id = cr.id
        JOIN classroom_courses cc ON cc.course_id = cr.id
        JOIN classrooms c ON cc.classroom_id = c.id
        JOIN classroom_instructors ci ON ci.classroom_id = c.id
        WHERE ci.instructor_id = $1
          AND c.school_id = $2
      `, [instructorId, activeSchoolId]);
      total_modules = Number(modulesCountRes.rows[0].count);

      // Lessons count
      const lessonsCountRes = await pool.query(`
        SELECT COUNT(DISTINCT l.id) AS count
        FROM lessons l
        JOIN modules m ON l.module_id = m.id
        JOIN classroom_courses cc ON cc.course_id = m.course_id
        JOIN classrooms c ON cc.classroom_id = c.id
        JOIN classroom_instructors ci ON ci.classroom_id = c.id
        WHERE ci.instructor_id = $1
          AND c.school_id = $2
      `, [instructorId, activeSchoolId]);
      total_lessons = Number(lessonsCountRes.rows[0].count);


      if (section === "students" || section === "reports") {
        const classroomId = req.query.classroom_id || null;

        const studentsQuery = `
          SELECT u.id, u.fullname, u.email, c.name AS classroom_name
          FROM user_school us
          JOIN users2 u ON u.id = us.user_id
          JOIN classrooms c ON c.id = us.classroom_id
          JOIN classroom_instructors ci ON ci.classroom_id = c.id
          WHERE ci.instructor_id = $1
            AND us.role_in_school = 'student'
            AND us.approved = true
            ${classroomId ? "AND c.id = $2" : ""}
          ORDER BY u.fullname
        `;

        const params = classroomId
          ? [instructorId, classroomId]
          : [instructorId];

        const studentsRes = await pool.query(studentsQuery, params);
        students = studentsRes.rows;
      }


      // If section is classes, get lessons per class and student counts per class
      if (section === "classes") {
        const studentCountsPerClassRes = await pool.query(`
          SELECT c.id, COUNT(us.user_id) AS student_count
          FROM classrooms c
          JOIN classroom_instructors ci ON ci.classroom_id = c.id
          LEFT JOIN user_school us 
            ON us.classroom_id = c.id 
            AND us.role_in_school = 'student' 
            AND us.approved = true
          WHERE ci.instructor_id = $1
          GROUP BY c.id
        `, [instructorId]);

        const lessonsPerClassResDB = await pool.query(`
          SELECT c.id, COUNT(l.id) AS lesson_count
          FROM classrooms c
          JOIN classroom_instructors ci ON ci.classroom_id = c.id
          LEFT JOIN classroom_courses cc ON cc.classroom_id = c.id
          LEFT JOIN courses co ON co.id = cc.course_id
          LEFT JOIN modules m ON m.course_id = co.id
          LEFT JOIN lessons l ON l.module_id = m.id
          WHERE ci.instructor_id = $1
          GROUP BY c.id
        `, [instructorId]);

        lessonsPerClass = lessonsPerClassResDB.rows;

        overview = {
          total_classes: classes.length,
          total_students: studentCountsPerClassRes.rows.reduce((sum, c) => sum + parseInt(c.student_count || 0), 0),
          avg_quiz_score: "–",
          total_lessons: lessonsPerClass.reduce((sum, c) => sum + parseInt(c.lesson_count || 0), 0),
          avg_assignment_score: "–",
          engagement_last7: 0
        };
      }

      const assignedCoursesRes = await pool.query(`
        SELECT DISTINCT
          cr.id,
          cr.title,
          COUNT(DISTINCT us.user_id) AS student_count
        FROM classroom_courses cc
        JOIN courses cr ON cc.course_id = cr.id
        JOIN classrooms c ON cc.classroom_id = c.id
        JOIN classroom_instructors ci ON ci.classroom_id = c.id
        LEFT JOIN user_school us 
          ON us.classroom_id = c.id 
          AND us.role_in_school = 'student'
          AND us.approved = true
        WHERE ci.instructor_id = $1
          AND c.school_id = $2
        GROUP BY cr.id
        ORDER BY cr.title
      `, [instructorId, activeSchoolId]);

      const assignedCourses = assignedCoursesRes.rows;

    }

    // Messages
    const receivedMessages = (
      await pool.query(`
        SELECT m.id, m.sender_id, m.message, m.created_at,
               u.fullname AS sender_name, u.email AS sender_email
        FROM messages m
        JOIN users2 u ON u.id = m.sender_id
        WHERE m.receiver_id = $1
        ORDER BY m.created_at DESC
        LIMIT 10
      `, [instructorId])
    ).rows;

    // Courses
    const courses = (
      await pool.query(`
        SELECT c.id, c.title,
               COUNT(DISTINCT ce.user_id) AS student_count
        FROM courses c
        LEFT JOIN course_enrollments ce ON ce.course_id = c.id
        WHERE c.instructor_id = $1
        GROUP BY c.id
        ORDER BY c.title
      `, [instructorId])
    ).rows;

    const classroomIds = classes.map(c => c.id);

    let classroomCourse = { rows: [] };

    if (classroomIds.length > 0) {
      classroomCourse = await pool.query(`
        SELECT DISTINCT
          crs.id,
          crs.title,
          c.name AS classroom_name,
          (
            SELECT COUNT(*)
            FROM user_school us
            WHERE us.classroom_id = c.id
              AND us.role_in_school = 'student'
              AND us.approved = true
          ) AS student_count
        FROM classroom_courses cc
        JOIN courses crs ON cc.course_id = crs.id
        JOIN classrooms c ON cc.classroom_id = c.id
        WHERE cc.classroom_id = ANY($1::int[])
        ORDER BY crs.title
      `, [classroomIds]);
    }

  
    // Build final data object
    const data = {
      info,
      profilePic,
      schools,
      school,
      classes,
      classrooms: classes, // <-- add this line
      classroomCourse: classroomCourse.rows,
      students,
      courses,
      total_courses,
      total_modules,
      total_lessons,
      total_students,
      total_submissions,
      receivedMessages,
      selectedSchoolId: activeSchoolId,
      overview,
      lessonsPerClass
    };

    // Render section
    switch (section) {
      case "dashboard":
      case "schools":
      case "classes":
      case "students":
      case "reports":
      case "messages":
      case "assigned_courses":
        return res.render(`instructor/sections/${section}`, data);
      default:
        return res.send("<p>Section not found</p>");
    }
  } catch (err) {
    console.error("Load Section Error:", err);
    res.status(500).send("Error loading section");
  }
};


exports.getInstructorClassesSection = async (req, res) => {
  try {
    const instructorId = req.user.id;

    // Fetch instructor's classes
    const classesRes = await pool.query(
      `SELECT c.id, c.name
       FROM classrooms c
       JOIN classroom_instructors ci ON ci.classroom_id = c.id
       WHERE ci.instructor_id = $1`,
      [instructorId]
    );
    const classes = classesRes.rows;

    // Students per class
    const studentCountsRes = await pool.query(
      `SELECT c.id, COUNT(us.user_id) AS student_count
       FROM classrooms c
       JOIN classroom_instructors ci ON ci.classroom_id = c.id
       LEFT JOIN user_school us 
         ON us.classroom_id = c.id 
        AND us.role_in_school = 'student' 
        AND us.approved = true
       WHERE ci.instructor_id = $1
       GROUP BY c.id`,
      [instructorId]
    );

    // Lessons per class
    const lessonsPerClassRes = await pool.query(
      `SELECT c.id, COUNT(l.id) AS lesson_count
       FROM classrooms c
       JOIN classroom_instructors ci ON ci.classroom_id = c.id
       LEFT JOIN classroom_courses cc ON cc.classroom_id = c.id
       LEFT JOIN courses co ON co.id = cc.course_id
       LEFT JOIN modules m ON m.course_id = co.id
       LEFT JOIN lessons l ON l.module_id = m.id
       WHERE ci.instructor_id = $1
       GROUP BY c.id`,
      [instructorId]
    );

    // Build overview
    const totalClasses = classes.length;
    const totalStudents = studentCountsRes.rows.reduce(
      (sum, c) => sum + parseInt(c.student_count || 0),
      0
    );

    const overview = {
      total_classes: totalClasses,
      total_students: totalStudents,
      avg_quiz_score: "–",
      total_lessons: lessonsPerClassRes.rows.reduce(
        (sum, c) => sum + parseInt(c.lesson_count || 0),
        0
      ),
      avg_assignment_score: "–",
      engagement_last7: 0,
    };

    res.render("instructor/sections/classes", {
      classes,
      overview,
      lessonsPerClass: lessonsPerClassRes.rows,
    });
  } catch (err) {
    console.error("Instructor Classes Section Error:", err);
    res.status(500).send("<p>Error loading classes</p>");
  }
};

exports.getInstructorStudentsSection = async (req, res) => {
  try {
    const instructorId = req.user.id;
    const studentsRes = await pool.query(
      `SELECT u.id, u.fullname, u.email, c.name AS classroom_name
       FROM user_school us
       JOIN users2 u ON u.id = us.user_id
       JOIN classrooms c ON c.id = us.classroom_id
       JOIN classroom_instructors ci ON ci.classroom_id = us.classroom_id
       WHERE ci.instructor_id = $1 AND us.role_in_school = 'student' AND us.approved = true`,
      [instructorId]
    );

    res.render("instructor/sections/students", { students: studentsRes.rows });
  } catch (err) {
    console.error("Instructor Students Section Error:", err);
    res.status(500).send("<p>Error loading students</p>");
  }
};

exports.getInstructorReportsSection = async (req, res) => {
  try {
    const instructorId = req.user.id;
    const reportsRes = await pool.query(
      `SELECT u.id, u.fullname, u.email, c.name AS classroom_name
       FROM user_school us
       JOIN users2 u ON u.id = us.user_id
       JOIN classrooms c ON c.id = us.classroom_id
       JOIN classroom_instructors ci ON ci.classroom_id = us.classroom_id
       WHERE ci.instructor_id = $1 AND us.role_in_school = 'student' AND us.approved = true`,
      [instructorId]
    );

    res.render("instructor/sections/reports", { students: reportsRes.rows });
  } catch (err) {
    console.error("Instructor Reports Section Error:", err);
    res.status(500).send("<p>Error loading reports</p>");
  }
};

exports.viewStudentProgress = async (req, res) => {
  try {
    const instructorId = req.user.id;
    const studentId = req.params.id;

    /* 🔒 1. Authorization: instructor must teach this student */
    const accessCheck = await pool.query(
      `
      SELECT 1
      FROM user_school us
      JOIN classroom_instructors ci
        ON ci.classroom_id = us.classroom_id
      WHERE us.user_id = $1
        AND ci.instructor_id = $2
        AND us.role_in_school = 'student'
        AND us.approved = true
      `,
      [studentId, instructorId]
    );

    if (!accessCheck.rowCount) {
      return res.status(403).send("Not authorized to view this student");
    }

    /* 👤 2. Student info */
    const studentRes = await pool.query(
      `SELECT id, fullname, email FROM users2 WHERE id = $1`,
      [studentId]
    );

    if (!studentRes.rows.length) {
      return res.status(404).send("Student not found");
    }

    const student = studentRes.rows[0];

    /* 📚 3. Courses instructor teaches this student */
    const coursesRes = await pool.query(
      `
      SELECT DISTINCT c.id, c.title AS course_title
      FROM classroom_courses cc
      JOIN courses c ON c.id = cc.course_id
      JOIN classroom_instructors ci ON ci.classroom_id = cc.classroom_id
      JOIN user_school us ON us.classroom_id = cc.classroom_id
      WHERE us.user_id = $1
        AND ci.instructor_id = $2
      ORDER BY c.title
      `,
      [studentId, instructorId]
    );

    if (!coursesRes.rows.length) {
      return res.render("instructor/sections/studentProgress", {
        student,
        courses: []
      });
    }

    const courseIds = coursesRes.rows.map(c => c.id);

    /* 📦 4. Modules */
    const modulesRes = await pool.query(
      `
      SELECT id, title AS module_title, course_id
      FROM modules
      WHERE course_id = ANY($1::int[])
      ORDER BY order_number
      `,
      [courseIds]
    );

    /* 📘 5. Lessons + completion */
    const lessonsRes = await pool.query(
      `
      SELECT l.id, l.title, l.module_id,
             CASE
               WHEN ulp.completed_at IS NOT NULL THEN true
               ELSE false
             END AS completed
      FROM lessons l
      LEFT JOIN user_lesson_progress ulp
        ON ulp.lesson_id = l.id
       AND ulp.user_id = $1
      WHERE l.module_id = ANY(
        SELECT id FROM modules WHERE course_id = ANY($2::int[])
      )
      ORDER BY l.order_number
      `,
      [studentId, courseIds]
    );

    /* 🧠 6. Quizzes */
    const quizzesRes = await pool.query(
      `
      SELECT q.id, q.title, l.module_id, l.id AS lesson_id,
             COALESCE(qs.score, NULL) AS score
      FROM quizzes q
      JOIN lessons l ON q.lesson_id = l.id
      LEFT JOIN quiz_submissions qs
        ON qs.quiz_id = q.id
       AND qs.student_id = $1
      WHERE l.module_id = ANY(
        SELECT id FROM modules WHERE course_id = ANY($2::int[])
      )
      ORDER BY q.id
      `,
      [studentId, courseIds]
    );

    /* 📑 7. Assignments */
    const assignmentsRes = await pool.query(
      `
      SELECT ma.id, ma.title, ma.module_id,
             COALESCE(asub.grade, NULL) AS grade,
             COALESCE(asub.total, NULL) AS total
      FROM module_assignments ma
      LEFT JOIN assignment_submissions asub
        ON asub.assignment_id = ma.id
       AND asub.student_id = $1
      WHERE ma.module_id = ANY(
        SELECT id FROM modules WHERE course_id = ANY($2::int[])
      )
      ORDER BY ma.id
      `,
      [studentId, courseIds]
    );

    /* 🧠 8. Build nested structure */
    const courses = coursesRes.rows.map(course => {
      const courseModules = modulesRes.rows.filter(
        m => m.course_id === course.id
      );

      const modules = courseModules.map(module => {
        const lessons = lessonsRes.rows.filter(
          l => l.module_id === module.id
        );

        const quizzes = quizzesRes.rows.filter(
          q => q.module_id === module.id
        );

        const assignments = assignmentsRes.rows.filter(
          a => a.module_id === module.id
        );

        const totalLessons = lessons.length;
        const completedLessons = lessons.filter(l => l.completed).length;

        return {
          ...module,
          lessons,
          quizzes,
          assignments,
          totalLessons,
          completedLessons,
          percent: totalLessons
            ? Math.round((completedLessons / totalLessons) * 100)
            : 0
        };
      });

      const totalLessons = modules.reduce((s, m) => s + m.totalLessons, 0);
      const completedLessons = modules.reduce(
        (s, m) => s + m.completedLessons,
        0
      );

      return {
        ...course,
        modules,
        totalLessons,
        completedLessons,
        percent: totalLessons
          ? Math.round((completedLessons / totalLessons) * 100)
          : 0
      };
    });

    /* 🎯 9. Render */
    res.render("instructor/sections/studentProgress", {
      student,
      courses
    });

  } catch (err) {
    console.error("View Student Progress Error:", err);
    res.status(500).send("Error loading student progress");
  }
};

exports.downloadQuizReport = async (req, res) => {
  const { studentId, quizId } = req.params;

  try {
    // --- Company Info
    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const info = infoResult.rows[0] || {};

    // --- Student + School info
    const studentRes = await pool.query(
      `SELECT u.id, u.fullname, u.email, 
              s.id AS school_id, s.name AS school_name, s.logo_url AS school_logo
       FROM users2 u
       LEFT JOIN user_school us ON u.id = us.user_id
       LEFT JOIN schools s ON us.school_id = s.id
       WHERE u.id = $1
       LIMIT 1`,
      [studentId]
    );
    if (!studentRes.rows.length)
      return res.status(404).send("Student not found");

    const student = studentRes.rows[0];

    // --- Quiz info + lesson/module/course
    const quizRes = await pool.query(
      `SELECT q.id, q.title AS quiz_title, l.title AS lesson_title, 
              m.title AS module_title, c.title AS course_title
       FROM quizzes q
       JOIN lessons l ON q.lesson_id = l.id
       JOIN modules m ON l.module_id = m.id
       JOIN courses c ON m.course_id = c.id
       WHERE q.id = $1`,
      [quizId]
    );
    if (!quizRes.rows.length) return res.status(404).send("Quiz not found");
    const quiz = quizRes.rows[0];

    // --- Submission info
    const submissionRes = await pool.query(
      `SELECT id, score, created_at, review_data
       FROM quiz_submissions
       WHERE quiz_id = $1 AND student_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [quizId, studentId]
    );
    const submission = submissionRes.rows[0];

    // Parse review_data
    let reviewData = [];
    if (submission && submission.review_data) {
      try {
        reviewData = JSON.parse(submission.review_data);
      } catch (e) {
        reviewData = [];
      }
    }

    // Calculate stats
    const totalQuestions = reviewData.length;
    const answeredCount = reviewData.filter(
      (r) => r.yourAnswer && r.yourAnswer.trim() !== ""
    ).length;
    const correctCount = reviewData.filter((r) => r.isCorrect).length;
    const wrongCount = answeredCount - correctCount;

    // --- Build HTML
    const html = `
  <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; padding: 30px; color: #2c3e50; }
        .header { text-align: center; margin-bottom: 30px; }
        .header img { max-height: 80px; margin: 0 10px; vertical-align: middle; }
        .header h1 { margin: 5px 0; color: #2c3e50; }
        .header h2 { margin: 0; font-size: 16px; color: #555; }
        h2 { margin-top: 30px; color: #2980b9; border-bottom: 2px solid #ddd; padding-bottom: 5px; }
        .meta { margin: 20px 0; padding: 10px; background: #ecf0f1; border-radius: 8px; }
        table { width: 100%; border-collapse: collapse; margin: 15px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; font-size: 12px; vertical-align: top; }
        th { background: #2c3e50; color: white; text-align: left; }
        tr:nth-child(even) { background: #f9f9f9; }
        .correct { color: #28a745; font-weight: bold; } /* green text */
        .wrong { color: #dc3545; font-weight: bold; }   /* red text */
        .footer { margin-top: 30px; font-size: 10px; text-align: center; color: gray; }
      </style>
    </head>
    <body>
      <div class="header">
        ${
          info.logo_url ? `<img src="${info.logo_url}" alt="Company Logo">` : ""
        }
        ${
          student.school_logo
            ? `<img src="${student.school_logo}" alt="School Logo">`
            : ""
        }
        <h1>${info.company_name || "Our Company"}</h1>
        <h2>${student.school_name || "Unknown School"}</h2>
      </div>

      <h1>📝 Quiz Report</h1>
      <p style="text-align:center; color: gray;">Generated on: ${new Date().toLocaleString()}</p>

      <div class="meta">
        <h2>👤 Student</h2>
        <p><strong>Name:</strong> ${student.fullname}</p>
        <p><strong>Email:</strong> ${student.email}</p>
      </div>

      <div class="meta">
        <h2>📚 Course Info</h2>
        <p><strong>Course:</strong> ${quiz.course_title}</p>
        <p><strong>Module:</strong> ${quiz.module_title}</p>
        <p><strong>Lesson:</strong> ${quiz.lesson_title}</p>
        <p><strong>Quiz:</strong> ${quiz.quiz_title}</p>
      </div>

      <div class="meta">
        <h2>📊 Quiz Result</h2>
        <p><strong>Score:</strong> ${submission ? submission.score : "N/A"}</p>
        <p><strong>Date:</strong> ${
          submission
            ? new Date(submission.created_at).toLocaleString()
            : "Not taken"
        }</p>
        <p><strong>Answered:</strong> ${answeredCount}/${totalQuestions}</p>
        <p><strong>Correct:</strong> ${correctCount}</p>
        <p><strong>Wrong:</strong> ${wrongCount}</p>
      </div>

      ${
        reviewData.length
          ? `
          <h2>📄 Answers</h2>
          <table>
            <tr>
              <th>Question</th>
              <th>Your Answer</th>
              <th>Correct Answer</th>
              <th>AI Feedback</th>
            </tr>
            ${reviewData
              .map(
                (r) => `
                <tr>
                  <td>${r.question}</td>
                  <td class="${r.isCorrect ? "correct" : "wrong"}">
                    ${r.yourAnswer || "—"}
                  </td>
                  <td>${r.correctAnswer}</td>
                  <td>${r.feedback || ""}</td>
                </tr>`
              )
              .join("")}
          </table>
        `
          : "<p>No answers recorded.</p>"
      }

      <div class="footer">© ${new Date().getFullYear()} ${
      info.company_name || "Company"
    } Quiz Report</div>
    </body>
  </html>
`;

    // --- Generate PDF
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({ format: "A4", printBackground: true });
    await browser.close();

    // --- File name with student + quiz
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${student.fullname.replace(/\s+/g, "_")}_${
        quiz.lesson_title
      }_Quiz_Report.pdf`
    );
    res.setHeader("Content-Type", "application/pdf");
    res.send(pdfBuffer);
  } catch (err) {
    console.error("Quiz PDF Error:", err);
    res.status(500).send("Error generating quiz report");
  }
};

exports.downloadStudentReport = async (req, res) => {
  try {
    const studentId = req.params.id;

    // 1️⃣ Fetch student info + classroom + school
    const studentRes = await pool.query(
      `SELECT u.id, u.fullname, u.email, c.name AS classroom_name,
              s.id AS school_id, s.name AS school_name, s.logo_url AS school_logo
       FROM users2 u
       JOIN user_school us ON us.user_id = u.id
       JOIN classrooms c ON c.id = us.classroom_id
       JOIN schools s ON c.school_id = s.id
       WHERE u.id = $1`,
      [studentId]
    );

    const student = studentRes.rows[0];
    if (!student) return res.status(404).send("<p>Student not found</p>");

    // 2️⃣ Fetch courses
    const coursesRes = await pool.query(
      `SELECT DISTINCT c.id, c.title AS course_title
       FROM classroom_courses cc
       JOIN courses c ON c.id = cc.course_id
       JOIN classroom_instructors ci ON ci.classroom_id = cc.classroom_id
       JOIN user_school us ON us.classroom_id = cc.classroom_id
       WHERE us.user_id = $1
       ORDER BY c.title`,
      [studentId]
    );
    const courseIds = coursesRes.rows.map(c => c.id);

    // 3️⃣ Fetch modules
    const modulesRes = await pool.query(
      `SELECT id, title AS module_title, course_id
       FROM modules
       WHERE course_id = ANY($1::int[])
       ORDER BY order_number`,
      [courseIds]
    );
    const moduleIds = modulesRes.rows.map(m => m.id);

    // 4️⃣ Fetch lessons + completion
    const lessonsRes = await pool.query(
      `SELECT l.id, l.title AS lesson_title, l.module_id,
              CASE WHEN ulp.completed_at IS NOT NULL THEN true ELSE false END AS completed
       FROM lessons l
       LEFT JOIN user_lesson_progress ulp
         ON ulp.lesson_id = l.id AND ulp.user_id = $1
       WHERE l.module_id = ANY($2::int[])
       ORDER BY l.order_number`,
      [studentId, moduleIds]
    );

    // 5️⃣ Fetch quizzes + scores
    // const quizzesRes = await pool.query(
    //   `SELECT q.id, q.title AS quiz_title, l.module_id,
    //           COALESCE(qs.score, NULL) AS score
    //    FROM quizzes q
    //    JOIN lessons l ON q.lesson_id = l.id
    //    LEFT JOIN quiz_submissions qs
    //      ON qs.quiz_id = q.id AND qs.student_id = $1
    //    WHERE l.module_id = ANY($2::int[])
    //    ORDER BY q.id`,
    //   [studentId, moduleIds]
    // );
    // 5️⃣ Fetch quizzes + scores (include lesson title)
    const quizzesRes = await pool.query(
      `SELECT q.id, q.title AS quiz_title, l.id AS lesson_id, l.title AS lesson_title, l.module_id,
              COALESCE(qs.score, NULL) AS score
      FROM quizzes q
      JOIN lessons l ON q.lesson_id = l.id
      LEFT JOIN quiz_submissions qs
        ON qs.quiz_id = q.id AND qs.student_id = $1
      WHERE l.module_id = ANY($2::int[])
      ORDER BY l.order_number, q.id`,
      [studentId, moduleIds]
    );


    // 6️⃣ Fetch assignments + grades
    const assignmentsRes = await pool.query(
      `SELECT ma.id, ma.title AS assignment_title, ma.module_id,
              COALESCE(asub.grade, NULL) AS grade,
              COALESCE(asub.total, NULL) AS total
       FROM module_assignments ma
       LEFT JOIN assignment_submissions asub
         ON asub.assignment_id = ma.id AND asub.student_id = $1
       WHERE ma.module_id = ANY($2::int[])
       ORDER BY ma.id`,
      [studentId, moduleIds]
    );

    // 7️⃣ Fetch badges per module
    const badgesRes = await pool.query(
      `SELECT badge_name, module_id
       FROM user_badges
       WHERE user_id = $1`,
      [studentId]
    );
    const badgeMap = {};
    badgesRes.rows.forEach(b => {
      if (!badgeMap[b.module_id]) badgeMap[b.module_id] = [];
      badgeMap[b.module_id].push(b.badge_name);
    });

    // 8️⃣ Fetch certificates per course
    const certificatesRes = await pool.query(
      `SELECT course_id, certificate_url, issued_at
       FROM user_certificates
       WHERE user_id = $1`,
      [studentId]
    );
    const certificateMap = {};
    certificatesRes.rows.forEach(c => (certificateMap[c.course_id] = c));

    // 9️⃣ Fetch XP and level
    const xpRes = await pool.query(
      `SELECT xp, level FROM student_xp WHERE user_id = $1`,
      [studentId]
    );
    const xpData = xpRes.rows[0] || { xp: 0, level: 1 };

    // 🔟 Build structured data
    const courses = coursesRes.rows.map(course => {
      const courseModules = modulesRes.rows.filter(m => m.course_id === course.id);
      const modules = courseModules.map(module => {
        const lessons = lessonsRes.rows
          .filter(l => l.module_id === module.id)
          .map(l => ({ ...l, status: l.completed ? "Completed" : "Pending" }));
        const quizzes = quizzesRes.rows.filter(q => q.module_id === module.id);
        const assignments = assignmentsRes.rows.filter(a => a.module_id === module.id);
        const badges = badgeMap[module.id] || [];

        const totalLessons = lessons.length;
        const completedLessons = lessons.filter(l => l.completed).length;
        const percentLessons = totalLessons ? Math.round((completedLessons / totalLessons) * 100) : 0;

        const avgQuiz = quizzes.length
          ? Math.round(quizzes.reduce((s, q) => s + (q.score || 0), 0) / quizzes.length)
          : "N/A";

        const avgAssignment = assignments.length
          ? Math.round(assignments.reduce((s, a) => s + (a.grade || 0), 0) / assignments.length)
          : "N/A";

        return {
          ...module,
          lessons,
          quizzes,
          assignments,
          badges,
          totalLessons,
          completedLessons,
          percentLessons,
          avgQuiz,
          avgAssignment
        };
      });

      const totalLessons = modules.reduce((s, m) => s + m.totalLessons, 0);
      const completedLessons = modules.reduce((s, m) => s + m.completedLessons, 0);
      const overallPercent = totalLessons ? Math.round((completedLessons / totalLessons) * 100) : 0;

      const certificate = certificateMap[course.id] || null;

      return { ...course, modules, totalLessons, completedLessons, overallPercent, certificate };
    });

    // 1️⃣1️⃣ Build HTML for PDF
    const html = `
<html>
<head>
<style>
body { font-family: Arial, sans-serif; padding: 30px; color: #2c3e50; }
h1 { text-align: center; color: #2c3e50; }
h2 { margin-top: 30px; color: #2980b9; border-bottom: 2px solid #ddd; padding-bottom: 5px; }
h3 { margin-top: 20px; color: #16a085; }
table { width: 100%; border-collapse: collapse; margin: 10px 0; }
th, td { border: 1px solid #ccc; padding: 6px; font-size: 12px; }
th { background-color: #34495e; color: white; }
tr:nth-child(even) { background-color: #f9f9f9; }
.meta { margin-top: 20px; padding: 10px; background: #ecf0f1; border-radius: 8px; }
.footer { margin-top: 30px; text-align: center; font-size: 10px; color: gray; }
.badges { color: #e67e22; font-weight: bold; }
.certificate { color: #27ae60; font-weight: bold; }
</style>
</head>
<body>
<h1>📑 Student Progress Report</h1>
<p style="text-align:center; color:gray;">Generated on ${new Date().toLocaleString()}</p>

<div class="meta">
<h2>👤 Student Info</h2>
<p><strong>Name:</strong> ${student.fullname}</p>
<p><strong>Email:</strong> ${student.email}</p>
<p><strong>Classroom:</strong> ${student.classroom_name}</p>
<p><strong>School:</strong> ${student.school_name}</p>
<p><strong>XP:</strong> ${xpData.xp} | Level: ${xpData.level}</p>
</div>

${courses.map(course => `
<div class="meta">
<h2>📚 Course: ${course.course_title} — Overall Progress: ${course.overallPercent}%</h2>
${course.certificate ? `<p class="certificate">🏆 Certificate Earned: <a href="${course.certificate.certificate_url}">View</a> (${new Date(course.certificate.issued_at).toLocaleDateString()})</p>` : ''}
${course.modules.map(module => `
<h3>Module: ${module.module_title} — ${module.percentLessons}% Lessons Completed</h3>
${module.badges.length ? `<p class="badges">🏅 Badges: ${module.badges.join(', ')}</p>` : ''}
<table>
<tr><th>Lesson</th><th>Status</th></tr>
${module.lessons.map(l => `<tr><td>${l.lesson_title}</td><td>${l.status}</td></tr>`).join('')}
</table>

<h4>Quizzes</h4>
${module.quizzes.length
  ? `<table>
       <tr><th>Quiz</th><th>Score</th></tr>
       ${module.quizzes
         .map(q => `<tr><td>Quiz for: ${q.lesson_title}</td><td>${q.score ?? 'N/A'}</td></tr>`)
         .join('')}
     </table>`
  : '<p>No quizzes yet</p>'}

<h4>Assignments</h4>
${module.assignments.length ? `<table><tr><th>Assignment</th><th>Score</th></tr>${module.assignments.map(a => `<tr><td>${a.assignment_title}</td><td>${a.grade ?? 'N/A'}</td></tr>`).join('')}</table>` : '<p>No assignments yet</p>'}

`).join('')}
</div>
`).join('')}

<div class="footer">© ${new Date().getFullYear()} Student Progress Report</div>
</body>
</html>
`;

    // 1️⃣2️⃣ Generate PDF
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({ format: "A4", printBackground: true });
    await browser.close();

    // 1️⃣3️⃣ Send PDF
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${student.fullname.replace(/\s+/g, "_")}_Progress_Report.pdf`
    );
    res.send(pdfBuffer);

  } catch (err) {
    console.error("Download Student Report Error:", err);
    res.status(500).send("<p>Error generating student report</p>");
  }
};

// exports.previewContent = async (req, res) => {
//   const { type, id } = req.params; // type = lesson | assignment | quiz, id = lessonId/assignId/quizId

//   try {
    
//     if (type === "lesson") {
//       const lesson = (await pool.query("SELECT * FROM lessons WHERE id = $1", [id])).rows[0];
//       if (!lesson) return res.status(404).json({ error: "Lesson not found" });

//       const lessonType = req.query.part; // video | content | quiz

//       if (lessonType === "video") {
//         return res.json({ type: "video", title: lesson.title, video_url: lesson.video_url });
//       } else if (lessonType === "content") {
//         return res.json({ type: "content", title: lesson.title, content: lesson.content });
//       } else if (lessonType === "lesson plan") {
//         return res.json({ type: "lesson plan", title: lesson.title, lesson_plan: lesson.lesson_plan });
//       } else if (lessonType === "quiz") {
//         // Fetch lesson quiz
//         const quizRes = await pool.query(
//           "SELECT * FROM quizzes WHERE lesson_id = $1",
//           [id]
//         );
//         const quiz = quizRes.rows[0];
//         if (!quiz) return res.status(404).json({ error: "No quiz found for this lesson" });

//         const questionsRes = await pool.query(
//           "SELECT * FROM quiz_questions WHERE quiz_id = $1 ORDER BY id ASC",
//           [quiz.id]
//         );

//         const questions = questionsRes.rows.map(q => ({
//           id: q.id,
//           question: q.question,
//           options: q.options || [],
//           correct_option: q.correct_option,
//           question_type: q.question_type
//         }));

//         return res.json({ type: "quiz", title: quiz.title, questions });
//       } else {
//         return res.status(400).json({ error: "Invalid lesson part type" });
//       }

//     } else if (type === "assignment") {
//       const assignmentRes = await pool.query(
//         "SELECT * FROM module_assignments WHERE id = $1",
//         [id]
//       );
//       const assignment = assignmentRes.rows[0];
//       if (!assignment) return res.status(404).json({ error: "Assignment not found" });

//       return res.json({
//         type: "assignment",
//         title: assignment.title,
//         description: assignment.instructions,
//         file_url: assignment.file_url || null
//       });

//     } else if (type === "quiz") {
//       const quizRes = await pool.query("SELECT * FROM quizzes WHERE id = $1", [id]);
//       const quiz = quizRes.rows[0];
//       if (!quiz) return res.status(404).json({ error: "Quiz not found" });

//       const questionsRes = await pool.query(
//         "SELECT * FROM quiz_questions WHERE quiz_id = $1 ORDER BY id ASC",
//         [id]
//       );

//       const questions = questionsRes.rows.map(q => ({
//         id: q.id,
//         question: q.question,
//         options: q.options || [],
//         correct_option: q.correct_option,
//         question_type: q.question_type
//       }));

//       return res.json({ type: "quiz", title: quiz.title, questions });

//     } else {
//       return res.status(400).json({ error: "Invalid content type" });
//     }

//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: "Failed to load content" });
//   }
// };

exports.previewContent = async (req, res) => {
  const { type, id } = req.params; // lesson | assignment | quiz
  const { part } = req.query;      // lesson_plan | video | content | quiz

  try {

    // ================= LESSON =================
    if (type === "lesson") {
      const lessonRes = await pool.query(
        "SELECT id, title, content, video_url, lesson_plan FROM lessons WHERE id = $1",
        [id]
      );

      const lesson = lessonRes.rows[0];
      if (!lesson) {
        return res.status(404).json({ error: "Lesson not found" });
      }

      // 🧑‍🏫 LESSON PLAN (CKEditor)
      if (part === "lesson_plan") {
        return res.json({
          type: "lesson_plan",
          title: lesson.title,
          lesson_plan: lesson.lesson_plan || ""
        });
      }

      // 📝 LESSON NOTE
      if (part === "content") {
        return res.json({
          type: "content",
          title: lesson.title,
          content: lesson.content || ""
        });
      }

      // 🎥 VIDEO
      if (part === "video") {
        return res.json({
          type: "video",
          title: lesson.title,
          video_url: lesson.video_url || null
        });
      }

      // 🧩 QUIZ (linked to lesson)
      if (part === "quiz") {
        const quizRes = await pool.query(
          "SELECT * FROM quizzes WHERE lesson_id = $1",
          [id]
        );

        const quiz = quizRes.rows[0];
        if (!quiz) {
          return res.status(404).json({ error: "No quiz found for this lesson" });
        }

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

        return res.json({
          type: "quiz",
          title: quiz.title,
          questions
        });
      }

      return res.status(400).json({ error: "Invalid lesson part" });
    }

    // ================= ASSIGNMENT =================
    if (type === "assignment") {
      const assignmentRes = await pool.query(
        "SELECT * FROM module_assignments WHERE id = $1",
        [id]
      );

      const assignment = assignmentRes.rows[0];
      if (!assignment) {
        return res.status(404).json({ error: "Assignment not found" });
      }

      return res.json({
        type: "assignment",
        title: assignment.title,
        description: assignment.instructions,
        file_url: assignment.file_url || null
      });
    }

    // ================= QUIZ =================
    if (type === "quiz") {
      const quizRes = await pool.query(
        "SELECT * FROM quizzes WHERE id = $1",
        [id]
      );

      const quiz = quizRes.rows[0];
      if (!quiz) {
        return res.status(404).json({ error: "Quiz not found" });
      }

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

      return res.json({
        type: "quiz",
        title: quiz.title,
        questions
      });
    }

    return res.status(400).json({ error: "Invalid content type" });

  } catch (err) {
    console.error("Preview error:", err);
    res.status(500).json({ error: "Failed to load content" });
  }
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


exports.assignedCoursesSection = async (req, res) => {
  const instructorId = req.user.id;
  const schoolId = parseInt(req.query.school_id, 10);

  if (!schoolId) {
    return res.send("<p>Please select a school</p>");
  }

  try {
    // 1️⃣ Get instructor classrooms in this school
    const classroomsResult = await pool.query(`
      SELECT c.id, c.name
      FROM classroom_instructors ci
      JOIN classrooms c ON ci.classroom_id = c.id
      WHERE ci.instructor_id = $1
        AND c.school_id = $2
    `, [instructorId, schoolId]);

    if (classroomsResult.rows.length === 0) {
      return res.send("<p>No classrooms assigned in this school.</p>");
    }

    // 2️⃣ Get courses assigned to those classrooms
    const coursesResult = await pool.query(`
      SELECT DISTINCT
        crs.id,
        crs.title,
        c.name AS classroom_name,
        (
          SELECT COUNT(*)
          FROM user_school us
          WHERE us.classroom_id = c.id
            AND us.role_in_school = 'student'
        ) AS student_count
      FROM classroom_courses cc
      JOIN courses crs ON cc.course_id = crs.id
      JOIN classrooms c ON cc.classroom_id = c.id
      WHERE cc.classroom_id = ANY($1::int[])
    `, [classroomsResult.rows.map(c => c.id)]);

    res.render("instructor/sections/assigned_courses", {
      classrooms: classroomsResult.rows,
      courses: coursesResult.rows
    });

  } catch (err) {
    console.error("Assigned courses error:", err);
    res.send("<p>Error loading assigned courses</p>");
  }
};
