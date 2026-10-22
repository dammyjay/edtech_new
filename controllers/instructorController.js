const pool = require("../models/db");
// const puppeteer = require("puppeteer");
const bcrypt = require("bcrypt");
const generatePdf = require("../utils/generatePdf");
const { renderQuizReportHtml, renderStudentFullReportHtml } = require("../utils/reportTemplate");
const { notifyNewDirectMessage, notifyNewClassMessage } = require("../utils/notify");
const instructorAwardService = require("../services/instructorAwardService");
const classroomPacingService = require("../services/classroomPacingService");
const generateDefaultPassword = require("../utils/generateDefaultPassword");
const { recalcAndPersistQuoteTotal } = require("../services/quoteCalcService");
const { generateUniqueStudentEmail, generateStudentPinAndAvatar } = require("../services/instructorStudentService");
const { computeClassroomTermAnalytics } = require("../services/classroomTermAnalyticsService");
const lessonTaskService = require("../services/lessonTaskService");

// Thin wrapper over computeClassroomTermAnalytics, scoped to ONE school —
// mirrors teacherController.js's getTeacherClassroomAnalytics (same shared
// service), but a teacher only ever has classrooms in one school while an
// instructor can span several (confirmed via the Dashboard's own school
// switcher), so this adds the school_id filter that wrapper doesn't need.
async function getInstructorClassroomAnalyticsForSchool(instructorId, schoolId, termId) {
  const classroomsRes = await pool.query(
    `SELECT c.id, c.school_id, c.name
     FROM classroom_instructors ci
     JOIN classrooms c ON c.id = ci.classroom_id
     WHERE ci.instructor_id = $1 AND c.school_id = $2 AND c.archived_at IS NULL
     ORDER BY c.name`,
    [instructorId, schoolId]
  );

  return Promise.all(
    classroomsRes.rows.map(async (classroom) => {
      try {
        const result = await computeClassroomTermAnalytics(classroom.school_id, classroom.id, termId);
        return { classroomId: classroom.id, classroomName: classroom.name, ...result };
      } catch (err) {
        console.error(`Instructor analytics failed for classroom ${classroom.id}:`, err.message);
        return { classroomId: classroom.id, classroomName: classroom.name, terms: [], selectedTerm: null, leaderboard: [], atRiskStudents: [] };
      }
    })
  );
}

// Same banned-word list as the student side (studentController.sendChatMessage)
// — kept in sync so instructor messages get the same moderation, now that
// this function is actually reachable (see routes/instructor.js).
const CHAT_BANNED_WORDS = ["stupid", "idiot", "hate", "fool", "nonsense"];

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

    const cleanMessage = message.toLowerCase();
    for (const word of CHAT_BANNED_WORDS) {
      if (cleanMessage.includes(word)) {
        return res.json({
          success: false,
          message: "Your message contains inappropriate words.",
        });
      }
    }

    await pool.query(
      `INSERT INTO messages (sender_id, receiver_id, message, is_read)
   VALUES ($1, $2, $3, FALSE)`,
      [senderId, receiverId, message]
    );
    await notifyNewDirectMessage({ senderId, receiverId, message });


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

exports.getInstructorChats = async (req, res) => {
  try {
    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const info = infoResult.rows[0] || {};

    const instructorId = req.user.id;
    const schoolId = req.session.activeSchoolId;

    // 🔹 Get student chat list — one row per conversation, with a last-
    // message preview and per-conversation unread count for the
    // restyled conversation-list UI (badges, previews).
    const { rows } = await pool.query(
      `
      SELECT
        u.id AS student_id,
        u.fullname AS student_name,
        u.email,
        u.profile_picture,
        lm.message AS last_message,
        lm.created_at AS last_message_time,
        lm.sender_id AS last_message_sender_id,
        (
          SELECT COUNT(*) FROM messages
          WHERE sender_id = u.id AND receiver_id = $1 AND is_read = FALSE
        ) AS unread_count
      FROM users2 u
      JOIN LATERAL (
        SELECT message, created_at, sender_id
        FROM messages
        WHERE (sender_id = u.id AND receiver_id = $1)
           OR (sender_id = $1 AND receiver_id = u.id)
        ORDER BY created_at DESC
        LIMIT 1
      ) lm ON true
      WHERE u.role = 'student'
      ORDER BY lm.created_at DESC
      `,
      [instructorId]
    );

    // ✅ ADD THE CLASS QUERY HERE
    // const classResult = await pool.query(`
    //   SELECT DISTINCT c.id, c.name
    //   FROM classrooms c
    //   JOIN user_school us ON us.classroom_id = c.id
    //   WHERE us.role_in_school = 'student'
    // `);

    const classResult = await pool.query(`
      SELECT DISTINCT 
        c.id,
        c.name,
        s.name AS school_name
      FROM classrooms c
      JOIN user_school us ON us.classroom_id = c.id
      JOIN schools s ON s.id = us.school_id
      WHERE us.role_in_school = 'student' AND c.archived_at IS NULL
      ORDER BY s.name, c.name
    `);

    const profilePic = req.session.user
      ? req.session.user.profile_picture
      : null;

    res.render("instructor/chatList", {
      chats: rows,
      classes: classResult.rows, // ✅ THIS FIXES YOUR ERROR
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
    const schoolId = req.session.activeSchoolId;
    const studentId = req.params.studentId;

    const { rows } = await pool.query(
      `
      SELECT
        m.id, m.sender_id, m.receiver_id, m.message, m.created_at, m.is_read, m.is_delivered,
        CASE WHEN m.sender_id = $1 THEN 'self' ELSE 'other' END AS sender
      FROM messages m
      WHERE (m.sender_id = $1 AND m.receiver_id = $2)
         OR (m.sender_id = $2 AND m.receiver_id = $1)
      ORDER BY m.created_at ASC
      `,
      [instructorId, studentId]
    );

    const studentResult = await pool.query(
      `SELECT id, fullname, email, profile_picture FROM users2 WHERE id = $1`,
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

// Total unread direct-message count across every conversation — feeds
// the small badge on the "Chats" nav link (see partials/adminHeader.ejs),
// polled the same way the general notification bell already is.
exports.getUnreadChatCount = async (req, res) => {
  try {
    const instructorId = req.session.user?.id;
    if (!instructorId) {
      return res.status(401).json({ success: false, count: 0 });
    }

    const { rows } = await pool.query(
      `SELECT COUNT(*) AS count FROM messages WHERE receiver_id = $1 AND is_read = FALSE`,
      [instructorId]
    );

    res.json({ success: true, count: Number(rows[0].count) });
  } catch (err) {
    console.error("Get unread chat count error:", err);
    res.status(500).json({ success: false, count: 0 });
  }
};

exports.searchStudent = async (req, res) => {
  try {
    const instructorId = req.user.id;
    const schoolId = req.session.activeSchoolId;
    const query = req.query.q ? req.query.q.trim() : "";

    if (!query) return res.json([]);

    const { rows } = await pool.query(
      `
      SELECT u.id, u.fullname, u.email, us.classroom_id AS class_name
      FROM users2 u
      JOIN user_school us ON u.id = us.user_id
      WHERE us.role_in_school = 'student'
        AND u.archived_at IS NULL
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
    const schoolId = req.session.activeSchoolId;

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

exports.renderClassChat = async (req, res) => {
  try {

    const classroomId = req.params.classroomId;
    const userId = req.session.user?.id;

    if (!userId) {
      return res.redirect("/admin/login");
    }

    // company info (same as other pages)
    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const info = infoResult.rows[0] || {};

    // get classroom info
    const classResult = await pool.query(
      `SELECT id, name, chat_locked FROM classrooms WHERE id = $1`,
      [classroomId]
    );

    const classroom = classResult.rows[0];

    const studentsResult = await pool.query(
    `
    SELECT
      u.id,
      u.fullname,
      u.email,
      u.role,
      u.profile_picture,
      (ms.student_id IS NOT NULL) AS muted
    FROM users2 u
    JOIN user_school us ON us.user_id = u.id
    LEFT JOIN muted_students ms ON ms.classroom_id = us.classroom_id AND ms.student_id = u.id
    WHERE us.classroom_id = $1
    AND us.role_in_school = 'student'
    AND u.archived_at IS NULL
    ORDER BY u.fullname
    `,
    [classroomId]
    );

    // get class messages — role/profile_picture kept in sync with
    // getClassMessages below (the AJAX refresh), since classChatView.ejs
    // now renders both through the same client-side renderMessages()
    // function and needs the same fields either way.
    const { rows } = await pool.query(
      `
      SELECT
        cm.id,
        cm.message,
        cm.created_at,
        cm.sender_id,
        u.fullname,
        u.role,
        u.profile_picture
      FROM class_messages cm
      JOIN users2 u ON u.id = cm.sender_id
      WHERE cm.classroom_id = $1
      ORDER BY cm.created_at ASC
      `,
      [classroomId]
    );

    const profilePic = req.session.user
      ? req.session.user.profile_picture
      : null;

    res.render("instructor/classChatView", {
      classroom,
      messages: rows,
      students: studentsResult.rows,
      info,
      profilePic,
      role: "instructor",
      user: req.session.user,
    });

  } catch (err) {
    console.error("Render class chat error:", err);
    res.status(500).send("Error loading class chat");
  }
};

// Shared by the class-chat moderation actions below — none of them
// previously verified the calling instructor actually teaches the
// classroomId they were handed, so any logged-in instructor could
// mute/unmute/lock/unlock/delete-message in a classroom they have
// nothing to do with.
async function instructorOwnsClassroom(classroomId, instructorId) {
  const result = await pool.query(
    `SELECT 1 FROM classroom_instructors WHERE classroom_id = $1 AND instructor_id = $2`,
    [classroomId, instructorId]
  );
  return result.rowCount > 0;
}

exports.muteStudent = async (req, res) => {
  try {

    const { classroomId, studentId } = req.body
    const instructorId = req.session.user.id

    if (!(await instructorOwnsClassroom(classroomId, instructorId))) {
      return res.status(403).json({ success: false, message: "You don't teach this classroom." });
    }

    await pool.query(
    `INSERT INTO muted_students (classroom_id, student_id, muted_by)
     VALUES ($1,$2,$3)
     ON CONFLICT DO NOTHING`,
    [classroomId, studentId, instructorId]
    )

    res.json({success:true})

  } catch(err){
    console.error(err)
    res.json({success:false})
  }
}

exports.unmuteStudent = async (req, res) => {
  try {

    const { classroomId, studentId } = req.body
    const instructorId = req.session.user.id

    if (!(await instructorOwnsClassroom(classroomId, instructorId))) {
      return res.status(403).json({ success: false, message: "You don't teach this classroom." });
    }

    await pool.query(
      `DELETE FROM muted_students
       WHERE classroom_id = $1 AND student_id = $2`,
      [classroomId, studentId]
    )

    res.json({ success: true })

  } catch (err) {
    console.error("Unmute error:", err)
    res.json({ success: false })
  }
}

exports.sendClassMessage = async (req, res) => { 
  try {
    const { classroomId, message } = req.body;
    const senderId = req.session.user?.id;

    if (!senderId) {
      return res.status(401).json({ success: false });
    }

    if (!message.trim()) {
      return res.status(400).json({ success: false });
    }

    const muteCheck = await pool.query(
      `
        SELECT * FROM muted_students
        WHERE classroom_id=$1 AND student_id=$2
      `,
      [classroomId, senderId]
      )

      if(muteCheck.rows.length>0){
      return res.status(403).json({
      success:false,
      message:"You are muted in this class"
      })
    }

    await pool.query(
      `INSERT INTO class_messages (classroom_id, sender_id, message)
       VALUES ($1,$2,$3)`,
      [classroomId, senderId, message]
    );
    await notifyNewClassMessage({ senderId, classroomId, message });

    res.json({ success: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success:false });
  }
};

exports.deleteClassMessage = async (req,res)=>{
  try{

    const { messageId } = req.body
    const instructorId = req.session.user?.id;
    if (!instructorId) {
      return res.status(401).json({ success: false });
    }

    const msgRes = await pool.query(
      `SELECT classroom_id FROM class_messages WHERE id = $1`,
      [messageId]
    );
    if (!msgRes.rows.length) {
      return res.status(404).json({ success: false });
    }
    if (!(await instructorOwnsClassroom(msgRes.rows[0].classroom_id, instructorId))) {
      return res.status(403).json({ success: false, message: "You don't teach this classroom." });
    }

    await pool.query(
      `DELETE FROM class_messages WHERE id=$1`,
      [messageId]
    )

    res.json({success:true})

  }catch(err){
    console.error(err)
    res.json({success:false})
  }
}

exports.getClassMessages = async (req, res) => {
  try {
    const classroomId = req.params.classroomId;
    const instructorId = req.session.user?.id;
    if (!instructorId) {
      return res.status(401).json([]);
    }
    if (!(await instructorOwnsClassroom(classroomId, instructorId))) {
      return res.status(403).json([]);
    }

    const { rows } = await pool.query(
      `
      SELECT 
        cm.id,
        cm.message,
        cm.created_at,
        cm.sender_id,
        u.fullname,
        u.role,
        u.profile_picture
      FROM class_messages cm
      JOIN users2 u ON u.id = cm.sender_id
      WHERE cm.classroom_id = $1
      ORDER BY cm.created_at ASC
      `,
      [classroomId]
    );

    res.json(rows);

  } catch (err) {
    console.error(err);
    res.status(500).json([]);
  }
};

exports.lockClassChat = async (req,res)=>{
  try{

    const { classroomId } = req.body
    const instructorId = req.session.user?.id;
    if (!instructorId) {
      return res.status(401).json({ success: false });
    }
    if (!(await instructorOwnsClassroom(classroomId, instructorId))) {
      return res.status(403).json({ success: false, message: "You don't teach this classroom." });
    }

    await pool.query(
      `UPDATE classrooms
       SET chat_locked = true
       WHERE id = $1`,
      [classroomId]
    )

    res.json({success:true})

  }catch(err){
    console.error(err)
    res.json({success:false})
  }
}

exports.unlockClassChat = async (req,res)=>{
  try{

    const { classroomId } = req.body
    const instructorId = req.session.user?.id;
    if (!instructorId) {
      return res.status(401).json({ success: false });
    }
    if (!(await instructorOwnsClassroom(classroomId, instructorId))) {
      return res.status(403).json({ success: false, message: "You don't teach this classroom." });
    }

    await pool.query(
      `UPDATE classrooms
       SET chat_locked = false
       WHERE id = $1`,
      [classroomId]
    )

    res.json({success:true})

  }catch(err){
    console.error(err)
    res.json({success:false})
  }
}

exports.getInstructorClasses = async (req,res)=>{
  try{

  const { rows } = await pool.query(
  `
  SELECT DISTINCT c.id,c.name
  FROM classrooms c
  JOIN user_school us ON us.classroom_id = c.id
  WHERE us.role_in_school = 'student' AND c.archived_at IS NULL
  `
  )

  res.render("instructor/classChatList",{
  classes:rows
  })

  }catch(err){
  console.error(err)
  }
}

// exports.setActiveSchool = (req, res) => {
//   req.session.activeSchoolId = req.body.school_id;
//   res.json({ success: true });
// };

exports.setActiveSchool = (req, res) => {
  req.session.activeSchoolId = req.body.school_id;

  req.session.save((err) => {
    if (err) {
      console.error("Session save error:", err);
      return res.status(500).json({ success: false });
    }
    res.json({ success: true });
  });
};

// controllers/instructorController.js
exports.getInstructorDashboard = async (req, res) => {


  // const instructorId = req.user.id;
  const instructorId = req.session.user.id;
  // const schoolId = req.session.activeSchoolId;
  // let schoolId = req.session.activeSchoolId;
  let schoolId = req.query.school_id || req.session.activeSchoolId;

  if (req.query.school_id) {
    req.session.activeSchoolId = req.query.school_id;
  }

  console.log("INSTRUCTOR ID:", instructorId);
  console.log("ACTIVE SCHOOL:", schoolId);

  try {
    // --- Company Info
    const info =
      (await pool.query("SELECT * FROM company_info ORDER BY id DESC LIMIT 1"))
        .rows[0] || {};

    const profilePic = req.session.user?.profile_picture || null;

    // --- Schools instructor has access to
   const schoolsRes = await pool.query(
     `
      SELECT DISTINCT 
        s.id,
        s.name
      FROM classroom_instructors ci
      JOIN classrooms c ON c.id = ci.classroom_id
      JOIN schools s ON s.id = c.school_id
      WHERE ci.instructor_id = $1
    `,
     [instructorId],
   );

    console.log("RAW SCHOOL DEBUG:", schoolsRes.rows);

    const schools = schoolsRes.rows;
    const selectedSchoolId = schoolId || schools[0]?.id || null;

    if (!schoolId) {
      schoolId = req.session.activeSchoolId || null;
    }

    const test = await pool.query(
      `SELECT * FROM classroom_instructors WHERE instructor_id = $1`,
      [instructorId]
    );

    console.log("Instructor classrooms:", test.rows);

    // --- Classrooms instructor teaches
    // const classroomsRes = await pool.query(
    //   `
    //   SELECT c.id, c.name
    //   FROM classrooms c
    //   JOIN classroom_instructors ci ON ci.classroom_id = c.id
    //   WHERE ci.instructor_id = $1
    //   AND c.school_id = $2
    //   `,
    //   [instructorId, schoolId]
    // );

    let classroomQuery = `
  SELECT c.id, c.name
  FROM classrooms c
  JOIN classroom_instructors ci ON ci.classroom_id = c.id
  WHERE ci.instructor_id = $1
`;

    let params = [instructorId];

    if (schoolId) {
      classroomQuery += ` AND c.school_id = $2`;
      params.push(schoolId);
    }

    const classroomsRes = await pool.query(classroomQuery, params);

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
        [req.query.classroom],
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
        [req.query.course],
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
        [req.query.module],
      );
      lessons = lessonsRes.rows;
    }

    console.log("Instructor ID:", instructorId);
    console.log("Schools:", schools);
    console.log("Active School:", schoolId);
    res.render("instructor/dashboard", {
      info,
      profilePic,
      classrooms,
      courses,
      modules,
      lessons,
      schools,
      selectedSchoolId,
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
  const schoolId = req.session.activeSchoolId;

  const result = await pool.query(
    `
    SELECT c.id, c.title,
    COUNT(ce.user_id) AS student_count
    FROM courses c
    LEFT JOIN course_enrollments ce ON ce.course_id = c.id
    JOIN classrooms cl ON cl.course_id = c.id
    WHERE c.instructor_id = $1
      AND cl.school_id = $2
      AND c.archived_at IS NULL
    GROUP BY c.id
  `,
    [instructorId, schoolId],
  );

  res.json(result.rows);
};

exports.loadSection = async (req, res) => {
  try {
    
    const { section } = req.params;
    const instructorId = req.user.id;

    if (req.query.school_id) {
      req.session.activeSchoolId = req.query.school_id;
    }

    // Fetch shared data
    const info =
      (await pool.query("SELECT * FROM company_info ORDER BY id DESC LIMIT 1"))
        .rows[0] || {};

    const profilePic = req.session.user?.profile_picture || null;

    // req.session.user only ever stores id/email/role/profile_picture/
    // equipped_avatar_frame (set at login, adminController.js's login) —
    // fullname was never included, so dashboard.ejs's "Welcome, <name>"
    // greeting has always rendered blank via the global `user` local
    // every view gets from res.locals.user. Fixing the session shape
    // itself is platform-wide and out of scope here; this just fetches
    // the real name for this one render instead.
    const instructorNameRes = await pool.query("SELECT fullname FROM users2 WHERE id = $1", [instructorId]);
    const instructorFullname = instructorNameRes.rows[0]?.fullname || "";

    const schoolsRes = await pool.query(`
      SELECT DISTINCT s.id, s.name
      FROM classroom_instructors ci
      JOIN classrooms c ON c.id = ci.classroom_id
      JOIN schools s ON s.id = c.school_id
      WHERE ci.instructor_id = $1
    `, [instructorId]);

    const schools = schoolsRes.rows;

    // req.session.activeSchoolId only ever gets set when a request
    // explicitly carries ?school_id= (the <select id="schoolSelect"> on
    // the Dashboard tab sends this on every subsequent tab click) — but
    // that select only exists once the Dashboard tab's own AJAX call has
    // rendered it. If the instructor clicks straight to another tab
    // (Attendance, Students, ...) before that happens — or in a fresh
    // session before Dashboard is ever opened — activeSchoolId stays
    // unset, the `if (activeSchoolId)` block below never runs, and every
    // classroom-dependent list (attendance's classroom dropdown among
    // them) silently renders empty instead of erroring, which is
    // confusing to debug from the UI alone. Default to (and persist) the
    // instructor's first school so every tab works standalone.
    let activeSchoolId = req.session.activeSchoolId || null;
    if (!activeSchoolId && schools.length) {
      activeSchoolId = schools[0].id;
      req.session.activeSchoolId = activeSchoolId;
    }

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
    let studentCountsPerClass = [];
    let terms = [];
    // "Classroom Analytics" tab (sections/schools.ejs) state — see the
    // section === "schools" block below for where these get populated.
    let avgProgress = 0;
    let avgQuiz = 0;
    let topStudent = {};
    let genderSummary = [];
    let progressDist = { low: 0, mid: 0, high: 0 };
    let selectedClassroomId = null;
    let classReports = [];
    let classroomAnalytics = null;
    // Dashboard "Top Students" — top 3 per classroom, for the active
    // school only (see the section === "dashboard" block below).
    let topStudentsPerClassroom = [];

    if (activeSchoolId) {
      
      const termsRes = await pool.query(`
        SELECT id AS term_id, name AS term_name
        FROM academic_terms
        WHERE school_id = $1 AND archived_at IS NULL
        ORDER BY id DESC
      `, [activeSchoolId]);
      terms = termsRes.rows;

      // school = schools.find(s => String(s.id) === String(activeSchoolId));
      // school.terms = terms;
      
      school = schools.find(s => String(s.id) === String(activeSchoolId)) || {};
      school.terms = terms;

      // Load classrooms as `classes`
      const classesRes = await pool.query(`
        SELECT c.id, c.name
        FROM classroom_instructors ci
        JOIN classrooms c ON ci.classroom_id = c.id
        WHERE ci.instructor_id = $1
          AND c.school_id = $2
          AND c.archived_at IS NULL
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


      // if (section === "students" || section === "reports") {
      //   const classroomId = req.query.classroom_id || null;

      //   const studentsQuery = `
      //     SELECT u.id, u.fullname, u.email, c.name AS classroom_name
      //     FROM user_school us
      //     JOIN users2 u ON u.id = us.user_id
      //     JOIN classrooms c ON c.id = us.classroom_id
      //     JOIN classroom_instructors ci ON ci.classroom_id = c.id
      //     WHERE ci.instructor_id = $1
      //       AND us.role_in_school = 'student'
      //       AND us.approved = true
      //       ${classroomId ? "AND c.id = $2" : ""}
      //     ORDER BY u.fullname
      //   `;

      //   const params = classroomId
      //     ? [instructorId, classroomId]
      //     : [instructorId];

      //   const studentsRes = await pool.query(studentsQuery, params);
      //   students = studentsRes.rows;
      // }

      if (section === "students" || section === "reports") {
        const classroomId = req.query.classroom_id || null;

        // c.id/c.name both selected (not just the name) — the "Award
        // Points" button on the students section needs the classroom id
        // to pass along, and coins is shown so the instructor sees each
        // student's current balance before awarding more.
        const studentsQuery = `
          SELECT DISTINCT u.id, u.fullname, u.email, u.profile_picture,
                 COALESCE(u.coins, 0) AS coins,
                 u.pin, u.classroom_login_enabled,
                 c.id AS classroom_id, c.name AS classroom_name,
                 COALESCE(sx.xp, 0) AS xp, COALESCE(sx.level, 1) AS level
          FROM user_school us
          JOIN users2 u ON u.id = us.user_id
          JOIN classrooms c ON c.id = us.classroom_id
          JOIN classroom_instructors ci ON ci.classroom_id = c.id
          LEFT JOIN student_xp sx ON sx.user_id = u.id
          WHERE ci.instructor_id = $1
            AND c.school_id = $2
            AND us.role_in_school = 'student'
            AND us.approved = true
            AND u.archived_at IS NULL
            ${classroomId ? "AND c.id = $3" : ""}
          ORDER BY u.fullname
        `;

        const params = classroomId
          ? [instructorId, activeSchoolId, classroomId]
          : [instructorId, activeSchoolId];

        const studentsRes = await pool.query(studentsQuery, params);
        students = studentsRes.rows;
      }

      // Dashboard "Top Students" — top 3 per classroom, for the
      // currently selected school only (previously this pooled XP across
      // every school the instructor teaches at, regardless of which one
      // was selected — a real scoping bug). Now uses the same
      // completion% -> quizAvg -> pace ranking as the admin/teacher
      // leaderboards (computeClassroomTermAnalytics), so "why" a student
      // is top is the same two numbers shown in the row.
      if (section === "dashboard" && activeSchoolId) {
        const schoolAnalytics = await getInstructorClassroomAnalyticsForSchool(instructorId, activeSchoolId);
        topStudentsPerClassroom = schoolAnalytics.flatMap((a) =>
          (a.leaderboard || []).slice(0, 3).map((s, i) => ({
            classroomName: a.classroomName,
            rank: i + 1,
            ...s,
          }))
        );
      }

      // If section is classes, get lessons per class and student counts per class
      if (section === "classes") {
        const studentCountsPerClassRes = await pool.query(
          `
          SELECT c.id, COUNT(us.user_id) AS student_count
          FROM classrooms c
          JOIN classroom_instructors ci ON ci.classroom_id = c.id
          LEFT JOIN user_school us
            ON us.classroom_id = c.id
            AND us.role_in_school = 'student'
            AND us.approved = true
          WHERE ci.instructor_id = $1
          AND c.school_id = $2
          AND c.archived_at IS NULL
          GROUP BY c.id
        `,
          [instructorId, activeSchoolId],
        );

        const lessonsPerClassResDB = await pool.query(`
          SELECT c.id, COUNT(l.id) AS lesson_count
          FROM classrooms c
          JOIN classroom_instructors ci ON ci.classroom_id = c.id
          LEFT JOIN classroom_courses cc ON cc.classroom_id = c.id
          LEFT JOIN courses co ON co.id = cc.course_id
          LEFT JOIN modules m ON m.course_id = co.id
          LEFT JOIN lessons l ON l.module_id = m.id
          WHERE ci.instructor_id = $1
            AND c.school_id = $2
            AND c.archived_at IS NULL
          GROUP BY c.id
        `, [instructorId, activeSchoolId]);

        lessonsPerClass = lessonsPerClassResDB.rows;
        studentCountsPerClass = studentCountsPerClassRes.rows;

        // Was hardcoded to the literal string "–" (never actually
        // computed) — real averages across every student in the
        // instructor's classes in this school, all-time.
        const scoresRes = await pool.query(
          `SELECT
             (SELECT ROUND(AVG(qs.score::numeric), 1)
              FROM quiz_submissions qs
              JOIN user_school us ON us.user_id = qs.student_id
              JOIN classroom_instructors ci ON ci.classroom_id = us.classroom_id
              WHERE ci.instructor_id = $1 AND us.school_id = $2
                AND us.role_in_school = 'student' AND us.approved = true
             ) AS avg_quiz_score,
             (SELECT ROUND(AVG(asub.grade::numeric), 1)
              FROM assignment_submissions asub
              JOIN user_school us ON us.user_id = asub.student_id
              JOIN classroom_instructors ci ON ci.classroom_id = us.classroom_id
              WHERE ci.instructor_id = $1 AND us.school_id = $2
                AND us.role_in_school = 'student' AND us.approved = true
                AND asub.grade IS NOT NULL
             ) AS avg_assignment_score`,
          [instructorId, activeSchoolId]
        );
        const scores = scoresRes.rows[0];

        overview = {
          total_classes: classes.length,
          total_students: studentCountsPerClassRes.rows.reduce((sum, c) => sum + parseInt(c.student_count || 0), 0),
          avg_quiz_score: scores.avg_quiz_score !== null ? `${scores.avg_quiz_score}%` : "–",
          total_lessons: lessonsPerClass.reduce((sum, c) => sum + parseInt(c.lesson_count || 0), 0),
          avg_assignment_score: scores.avg_assignment_score !== null ? `${scores.avg_assignment_score}%` : "–",
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

      // "Classroom Analytics" tab (rendered by sections/schools.ejs — kept
      // that filename to avoid touching every reference, but the sidenav
      // now labels it "Classroom Analytics"). Now powered by the same
      // computeClassroomTermAnalytics service the admin and teacher
      // dashboards already use (services/classroomTermAnalyticsService.js)
      // instead of a separate hand-rolled query — gives this page the
      // same leaderboard (completion% -> quizAvg -> pace) and at-risk
      // (completion% < 40 OR quizAvg < 50) logic admin already has,
      // rather than a second, drifting implementation. Previously this
      // block picked a "top student" by quiz score alone; now matches
      // the shared service's ranking (lesson completion first).
      if (section === "schools") {
        const analyticsClassroomId = req.query.classroom_id || (classes[0] && classes[0].id) || null;

        if (analyticsClassroomId) {
          const analyticsResult = await computeClassroomTermAnalytics(
            activeSchoolId,
            analyticsClassroomId,
            req.query.term_id ? parseInt(req.query.term_id, 10) : undefined
          );

          const genderSummaryRes = await pool.query(
            `SELECT u.gender, COUNT(*)
             FROM user_school us
             JOIN users2 u ON u.id = us.user_id
             JOIN classroom_instructors ci ON ci.classroom_id = us.classroom_id
             WHERE us.classroom_id = $1 AND ci.instructor_id = $2
               AND us.role_in_school = 'student' AND us.approved = true
               AND u.archived_at IS NULL
             GROUP BY u.gender`,
            [analyticsClassroomId, instructorId]
          );

          const metrics = analyticsResult?.studentMetrics || [];
          const analyticsProgressDist = { low: 0, mid: 0, high: 0 };
          metrics.forEach((s) => {
            if (s.completionPercent < 50) analyticsProgressDist.low++;
            else if (s.completionPercent < 75) analyticsProgressDist.mid++;
            else analyticsProgressDist.high++;
          });

          genderSummary = genderSummaryRes.rows;
          classroomAnalytics = analyticsResult;
          topStudent = analyticsResult?.leaderboard?.[0] || null;
          avgProgress = analyticsResult?.averageCompletion || 0;
          avgQuiz = analyticsResult?.averageQuiz || 0;
          progressDist = analyticsProgressDist;
          selectedClassroomId = analyticsClassroomId;
        }
      }

      // Class Reports tab (sections/classReports.ejs) — the narrative
      // CKEditor write-up feature, distinct from the auto-generated PDF
      // "reports" section above.
      if (section === "class_reports") {
        const reportsClassroomId = req.query.classroom_id || null;
        const reportsQuery = `
          SELECT cr.id, cr.title, cr.content, cr.report_date, cr.created_at, cr.updated_at,
                 c.id AS classroom_id, c.name AS classroom_name,
                 t.name AS term_name
          FROM classroom_reports cr
          JOIN classrooms c ON c.id = cr.classroom_id
          JOIN classroom_instructors ci ON ci.classroom_id = c.id
          LEFT JOIN academic_terms t ON t.id = cr.term_id
          WHERE ci.instructor_id = $1
            AND c.school_id = $2
            ${reportsClassroomId ? "AND c.id = $3" : ""}
          ORDER BY cr.report_date DESC, cr.created_at DESC
        `;
        const reportsParams = reportsClassroomId
          ? [instructorId, activeSchoolId, reportsClassroomId]
          : [instructorId, activeSchoolId];
        const classReportsRes = await pool.query(reportsQuery, reportsParams);
        classReports = classReportsRes.rows;
        selectedClassroomId = reportsClassroomId || selectedClassroomId;
      }
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
          c.id AS classroom_id,
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

    // Lesson Tasks tab (sections/lesson_tasks.ejs): modules/lessons for
    // every course assigned to one of this instructor's classrooms (the
    // "assign lesson(s) as a task" picker), plus every task already
    // created, each with its live per-student completion status.
    let lessonTasks = [];
    let taskableCourses = [];
    if (section === "lesson_tasks") {
      const courseIds = [...new Set(classroomCourse.rows.map((cc) => cc.id))];
      if (courseIds.length > 0) {
        const modulesRes = await pool.query(
          `SELECT id, course_id, title, order_number
           FROM modules
           WHERE course_id = ANY($1::int[]) AND archived_at IS NULL
           ORDER BY order_number`,
          [courseIds]
        );
        const lessonsRes = await pool.query(
          `SELECT l.id, l.module_id, l.title, l.order_number
           FROM lessons l
           JOIN modules m ON m.id = l.module_id
           WHERE m.course_id = ANY($1::int[]) AND l.archived_at IS NULL AND m.archived_at IS NULL
           ORDER BY l.order_number`,
          [courseIds]
        );
        const lessonsByModule = {};
        lessonsRes.rows.forEach((l) => {
          (lessonsByModule[l.module_id] = lessonsByModule[l.module_id] || []).push(l);
        });

        const coursesById = {};
        classroomCourse.rows.forEach((cc) => {
          if (!coursesById[cc.id]) coursesById[cc.id] = { id: cc.id, title: cc.title, classroomIds: new Set() };
          coursesById[cc.id].classroomIds.add(cc.classroom_id);
        });
        modulesRes.rows.forEach((m) => {
          if (coursesById[m.course_id]) {
            (coursesById[m.course_id].modules = coursesById[m.course_id].modules || []).push({
              ...m,
              lessons: lessonsByModule[m.id] || [],
            });
          }
        });
        taskableCourses = Object.values(coursesById).map((c) => ({ ...c, classroomIds: [...c.classroomIds] }));
      }

      lessonTasks = await lessonTaskService.getLessonTasksForInstructor(instructorId);
    }

    // Build final data object
    const data = {
      info,
      profilePic,
      user: { ...req.session.user, fullname: instructorFullname },
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
      lessonsPerClass,
      studentCountsPerClass,
      topStudentsPerClassroom,
      terms,
      // Classroom Analytics tab (sections/schools.ejs)
      avgProgress,
      avgQuiz,
      topStudent,
      genderSummary,
      progressDist,
      selectedClassroomId,
      classReports,
      classroomAnalytics,
      lessonTasks,
      taskableCourses,
      // Award-points tab config (sections/students.ejs) — the fixed
      // category list + today's remaining budget, so the UI can show
      // both before the instructor even opens the award modal.
      awardCategories: instructorAwardService.getCategoryList(),
    };

    if (section === "students") {
      data.awardBudget = await instructorAwardService.getRemainingBudget(instructorId);
    }

    // Render section
    switch (section) {
      case "dashboard":
      case "schools":
      case "classes":
      case "students":
      case "reports":
      case "assigned_courses":
      case "attendance":
      case "class_reports":
      case "lesson_tasks":
        return res.render(`instructor/sections/${section}`, data);
      default:
        // A real 404 (not the default 200) so the client's loadSection()
        // treats it as a genuine failure rather than silently rendering
        // "Section not found" text as if it were normal page content —
        // this is also what a stray/typo tab key now surfaces instead of
        // a bare unstyled sentence with no way back for the instructor.
        return res.status(404).send(
          "<div class=\"instructor-empty\"><i class=\"fa-solid fa-compass\"></i><p>That section doesn't exist. Use the sidebar to pick another one.</p></div>"
        );
    }
  } catch (err) {
    console.error("Load Section Error:", err);
    res.status(500).send("Error loading section");
  }
};


exports.getInstructorStudentsSection = async (req, res) => {
  try {
    const instructorId = req.user.id;
    const schoolId = req.session.activeSchoolId;

    // Row shape (classroom_id, coins, profile_picture) kept in sync with
    // loadSection's "students" branch, since both render
    // instructor/sections/students.ejs — that view's Award Points button
    // needs classroom_id and its coin badge needs coins, neither of
    // which this query previously selected.
    const studentsRes = await pool.query(
      `
      SELECT DISTINCT u.id, u.fullname, u.email, u.profile_picture,
             COALESCE(u.coins, 0) AS coins,
             u.pin, u.classroom_login_enabled,
             c.id AS classroom_id, c.name AS classroom_name,
             COALESCE(sx.xp, 0) AS xp, COALESCE(sx.level, 1) AS level
      FROM user_school us
      JOIN users2 u ON u.id = us.user_id
      JOIN classrooms c ON c.id = us.classroom_id
      JOIN classroom_instructors ci ON ci.classroom_id = c.id
      LEFT JOIN student_xp sx ON sx.user_id = u.id
      WHERE ci.instructor_id = $1
        AND c.school_id = $2
        AND us.role_in_school = 'student'
        AND us.approved = true
        AND u.archived_at IS NULL
      ORDER BY u.fullname
      `,
      [instructorId, schoolId]
    );

    // This view is a bare fragment (no <html>/header — it's normally
    // injected into the dashboard shell's #main-content by loadSection's
    // AJAX flow), so hitting this route directly renders it unstyled and
    // without navigation. Not fixing that here — it's a separate,
    // pre-existing gap — but awardBudget/awardCategories are supplied so
    // it at least renders instead of throwing "awardBudget is not defined".
    const awardBudget = await instructorAwardService.getRemainingBudget(instructorId);

    // classes/terms: the Add Student modal on this view needs both for its
    // dropdowns. loadSection's AJAX path already supplies them, but a
    // direct hit on this route previously didn't — added here so the
    // modal works regardless of which entry point rendered the page.
    const classesRes = await pool.query(
      `SELECT c.id, c.name
       FROM classrooms c
       JOIN classroom_instructors ci ON ci.classroom_id = c.id
       WHERE ci.instructor_id = $1 AND c.school_id = $2 AND c.archived_at IS NULL
       ORDER BY c.name`,
      [instructorId, schoolId]
    );
    const termsRes = await pool.query(
      `SELECT id AS term_id, name AS term_name
       FROM academic_terms
       WHERE school_id = $1 AND archived_at IS NULL
       ORDER BY id DESC`,
      [schoolId]
    );

    res.render("instructor/sections/students", {
      students: studentsRes.rows,
      awardBudget,
      awardCategories: instructorAwardService.getCategoryList(),
      classes: classesRes.rows,
      classrooms: classesRes.rows,
      terms: termsRes.rows,
    });
  } catch (err) {
    console.error("Instructor Students Section Error:", err);
    res.status(500).send("<p>Error loading students</p>");
  }
};

exports.getInstructorReportsSection = async (req, res) => {
  try {
    const instructorId = req.user.id;
    const schoolId = req.session.activeSchoolId;
    // const reportsRes = await pool.query(
    //   `SELECT u.id, u.fullname, u.email, c.name AS classroom_name
    //    FROM user_school us
    //    JOIN users2 u ON u.id = us.user_id
    //    JOIN classrooms c ON c.id = us.classroom_id
    //    JOIN classroom_instructors ci ON ci.classroom_id = us.classroom_id
    //    WHERE ci.instructor_id = $1 AND us.role_in_school = 'student' AND us.approved = true AND c.school_id = $2`,
    //   [instructorId, schoolId]
    // );

    const reportsRes = await pool.query(
      `
      SELECT DISTINCT u.id, u.fullname, u.email, c.name AS classroom_name
      FROM user_school us
      JOIN users2 u ON u.id = us.user_id
      JOIN classrooms c ON c.id = us.classroom_id
      JOIN classroom_instructors ci ON ci.classroom_id = c.id
      WHERE ci.instructor_id = $1
        AND c.school_id = $2
        AND us.role_in_school = 'student'
        AND us.approved = true
        AND u.archived_at IS NULL
      ORDER BY u.fullname
      `,
      [instructorId, schoolId]
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
    const schoolId = req.session.activeSchoolId;
    const studentId = req.params.id;

    /* 🔒 1. Authorization: instructor must teach this student */
    const accessCheck = await pool.query(
      `
      SELECT 1
      FROM user_school us
      JOIN classrooms c
        ON c.id = us.classroom_id
      JOIN classroom_instructors ci
        ON ci.classroom_id = us.classroom_id
      WHERE us.user_id = $1
        AND ci.instructor_id = $2
        AND us.role_in_school = 'student'
        AND us.approved = true
        AND c.school_id = $3
      `,
      [studentId, instructorId, schoolId]
    );

    if (!accessCheck.rowCount) {
      return res.status(403).send("Not authorized to view this student");
    }

    /* 👤 2. Student info */
    const studentRes = await pool.query(
      `SELECT id, fullname, email, created_at, profile_picture FROM users2 WHERE id = $1`,
      [studentId]
    );

    if (!studentRes.rows.length) {
      return res.status(404).send("Student not found");
    }

    const student = studentRes.rows[0];

    // This view is reached via a full page navigation (not the AJAX
    // loadSection() tab-swap the rest of the dashboard uses), so it
    // needs its own layout data — previously missing entirely, which
    // meant this page rendered as an unstyled bare HTML fragment (no
    // <head>, no CSS, no CKEditor/alert scripts) whenever a student's
    // "View Progress" link was actually clicked.
    const layoutInfo = (await pool.query("SELECT * FROM company_info ORDER BY id DESC LIMIT 1")).rows[0] || {};
    const layoutData = { info: layoutInfo, role: "instructor", profilePic: req.session.user?.profile_picture || null };

    /* 📚 3. Courses instructor teaches this student — row shape kept
       identical to adminController.viewStudentProgress's query (see
       services/studentProgressAnalyticsService.js) so the same shared
       computation (engagement, mastery, risk, heatmap, etc.) can run
       on it; only the scoping differs (ci.instructor_id = instructorId,
       so an instructor can never see a course they don't actually
       teach this student). */
    const coursesRes = await pool.query(
      `
      SELECT DISTINCT ON (c.id) c.id, c.title AS course_title, c.thumbnail_url, cc.assigned_at AS enrolled_at
      FROM classroom_courses cc
      JOIN courses c ON c.id = cc.course_id
      JOIN classroom_instructors ci ON ci.classroom_id = cc.classroom_id
      JOIN user_school us ON us.classroom_id = cc.classroom_id
      WHERE us.user_id = $1
        AND ci.instructor_id = $2
      ORDER BY c.id, cc.assigned_at DESC
      `,
      [studentId, instructorId]
    );
    const courseIds = coursesRes.rows.map(c => c.id);

    const modulesRes = courseIds.length
      ? await pool.query(
          `SELECT id, title AS module_title, course_id FROM modules WHERE course_id = ANY($1::int[]) ORDER BY order_number`,
          [courseIds]
        )
      : { rows: [] };
    const moduleIds = modulesRes.rows.map(m => m.id);

    const lessonsRes = moduleIds.length
      ? await pool.query(
          `
          SELECT l.id, l.title AS lesson_title, l.module_id, ulp.completed_at
          FROM lessons l
          LEFT JOIN user_lesson_progress ulp ON ulp.lesson_id = l.id AND ulp.user_id = $1
          WHERE l.module_id = ANY($2::int[])
          ORDER BY l.order_number
          `,
          [studentId, moduleIds]
        )
      : { rows: [] };

    const quizzesRes = moduleIds.length
      ? await pool.query(
          `
          SELECT q.id, q.title, l.module_id, qs.score, qs.created_at AS taken_at, l.title AS lesson_title, qs.passed
          FROM quiz_submissions qs
          JOIN quizzes q ON qs.quiz_id = q.id
          JOIN lessons l ON q.lesson_id = l.id
          WHERE l.module_id = ANY($1::int[]) AND qs.student_id = $2
          ORDER BY qs.created_at DESC
          `,
          [moduleIds, studentId]
        )
      : { rows: [] };

    const assignmentsRes = moduleIds.length
      ? await pool.query(
          `
          SELECT ma.id, ma.title, ma.module_id, s.total, s.grade, s.ai_feedback, s.created_at AS submitted_at
          FROM assignment_submissions s
          JOIN module_assignments ma ON s.assignment_id = ma.id
          WHERE ma.module_id = ANY($1::int[]) AND s.student_id = $2
          ORDER BY s.created_at DESC
          `,
          [moduleIds, studentId]
        )
      : { rows: [] };

    const { computeStudentProgressAnalytics } = require("../services/studentProgressAnalyticsService");
    const analytics = await computeStudentProgressAnalytics(studentId, {
      courseRows: coursesRes.rows,
      moduleRows: modulesRes.rows,
      lessonRows: lessonsRes.rows,
      quizRows: quizzesRes.rows,
      assignmentRows: assignmentsRes.rows,
    });

    res.render("instructor/sections/studentProgress", {
      ...layoutData,
      student,
      membershipDuration: analytics.formatDuration(student.created_at),
      ...analytics,
    });

  } catch (err) {
    console.error("View Student Progress Error:", err);
    res.status(500).send("Error loading student progress");
  }
};

exports.downloadQuizReport = async (req, res) => {
  const { studentId, quizId } = req.params;

  try {
    /* 🔒 Authorization: instructor must teach this student — same
       classroom_instructors join used by viewStudentProgress above. This
       route previously had no check at all beyond the router-level
       ensureInstructorOrAdmin, so any instructor could pull any other
       instructor's student's quiz report by guessing an id. */
    const accessCheck = await pool.query(
      `SELECT 1
       FROM user_school us
       JOIN classroom_instructors ci ON ci.classroom_id = us.classroom_id
       WHERE us.user_id = $1
         AND ci.instructor_id = $2
         AND us.role_in_school = 'student'
         AND us.approved = true`,
      [studentId, req.user.id]
    );
    if (!accessCheck.rowCount) {
      return res.status(403).send("Not authorized to view this student's report");
    }

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
      `SELECT id, score, passed, created_at, review_data
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

    // --- Build HTML (shared gamified report template)
    const html = renderQuizReportHtml({
      info,
      student,
      courseTitle: quiz.course_title,
      moduleTitle: quiz.module_title,
      lessonTitle: quiz.lesson_title,
      quizTitle: quiz.quiz_title,
      score: submission ? submission.score : null,
      passed: submission ? submission.passed : false,
      takenAt: submission ? submission.created_at : null,
      reviewData,
    });

    // --- Generate PDF
    const pdf = await generatePdf(html);

    // --- File name with student + quiz
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${student.fullname.replace(/\s+/g, "_")}_${
        quiz.lesson_title
      }_Quiz_Report.pdf`
    );
    res.setHeader("Content-Type", "application/pdf");
    res.send(pdf);
  } catch (err) {
    console.error("Quiz PDF Error:", err);
    res.status(500).send("Error generating quiz report");
  }
};

exports.downloadStudentReport = async (req, res) => {
  try {
    const studentId = req.params.id;

    /* 🔒 Authorization: instructor must teach this student */
    const accessCheck = await pool.query(
      `SELECT 1
       FROM user_school us
       JOIN classroom_instructors ci ON ci.classroom_id = us.classroom_id
       WHERE us.user_id = $1
         AND ci.instructor_id = $2
         AND us.role_in_school = 'student'
         AND us.approved = true`,
      [studentId, req.user.id]
    );
    if (!accessCheck.rowCount) {
      return res.status(403).send("Not authorized to view this student's report");
    }

    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const info = infoResult.rows[0] || {};

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
      `SELECT badge_name, badge_image, awarded_at, module_id
       FROM user_badges
       WHERE user_id = $1`,
      [studentId]
    );
    const badgeMap = {};
    badgesRes.rows.forEach(b => {
      if (!badgeMap[b.module_id]) badgeMap[b.module_id] = [];
      badgeMap[b.module_id].push(b);
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

    // Build HTML (shared gamified report template) + generate PDF
    const html = renderStudentFullReportHtml({
      info,
      student,
      xp: xpData.xp,
      level: xpData.level,
      courses: courses.map((course) => ({
        title: course.course_title,
        certificate: course.certificate,
        modules: course.modules.map((m) => ({
          title: m.module_title,
          lessons: m.lessons.map((l) => ({ title: l.lesson_title, completed_at: l.completed })),
          quizzes: m.quizzes,
          assignments: m.assignments.map((a) => ({ title: a.assignment_title, total: a.grade })),
          badges: m.badges || [],
        })),
        badges: course.modules.flatMap((m) =>
          (m.badges || []).map((b) => ({ ...b, module_title: m.module_title }))
        ),
      })),
    });

    const pdf = await generatePdf(html);

    // 1️⃣3️⃣ Send PDF
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${student.fullname.replace(/\s+/g, "_")}_Progress_Report.pdf`
    );
    res.send(pdf);

  } catch (err) {
    console.error("Download Student Report Error:", err);
    res.status(500).send("<p>Error generating student report</p>");
  }
};

exports.previewContent = async (req, res) => {
  const { type, id } = req.params; // lesson | assignment | quiz
  const { part } = req.query;      // lesson_plan | video | content | quiz

  try {

    // ================= LESSON =================
    if (type === "lesson") {
      const lessonRes = await pool.query(
        "SELECT id, title, content, video_url, lesson_plan, lesson_file_url FROM lessons WHERE id = $1",
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

      // 📊 SLIDE DECK (PPT/PPTX)
      if (part === "presentation") {
        return res.json({
          type: "presentation",
          title: lesson.title,
          lesson_file_url: lesson.lesson_file_url || null
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

  // The "Teach" button on assigned_courses.ejs passes ?classroomId= so
  // this view knows which classroom's pacing to show/control — without
  // it (or if it doesn't belong to this instructor) this stays a plain
  // read-only preview with no release controls, same as before this
  // feature existed.
  let classroomId = req.query.classroomId ? parseInt(req.query.classroomId, 10) : null;
  if (classroomId) {
    const ownsClassroomRes = await pool.query(
      `SELECT 1 FROM classroom_instructors WHERE classroom_id = $1 AND instructor_id = $2`,
      [classroomId, instructor.id]
    );
    if (!ownsClassroomRes.rows.length) classroomId = null;
  }

  const infoResult = await pool.query(
    "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
  );
  const info = infoResult.rows[0] || {};
  // Fetch course
  const course = await pool.query("SELECT * FROM courses WHERE id = $1", [courseId]);

  // Fetch modules
  const modules = await pool.query(
    "SELECT * FROM modules WHERE course_id = $1 AND archived_at IS NULL ORDER BY order_number ASC",
    [courseId]
  );

  // Fetch lessons
  const lessons = await pool.query(
    `SELECT l.* FROM lessons l
     JOIN modules m ON m.id = l.module_id
     WHERE m.course_id = $1 AND l.archived_at IS NULL AND m.archived_at IS NULL
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

  // Per-lesson release state for the "Release to Class" controls —
  // only meaningful (and only computed) when this view is scoped to a
  // classroom this instructor actually teaches.
  if (classroomId) {
    const lessonIds = lessons.rows.map((l) => l.id);
    const [firstLessonIds, releasedLessonIds] = await Promise.all([
      classroomPacingService.getFirstLessonIdsForCourses([courseId]),
      classroomPacingService.getReleasedLessonIds(classroomId, lessonIds),
    ]);
    lessons.rows.forEach((lesson) => {
      lesson.isFirst = firstLessonIds.has(lesson.id);
      lesson.released = lesson.isFirst || releasedLessonIds.has(lesson.id);
    });
  }

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
    users: req.session.user,
    role: "instructor",
    instructor,
    course: course.rows[0],
    modules: modules.rows,
    moduleLessons,
    moduleQuizzes,
    moduleAssignments,
    classroomId
  });
};

// POST /instructor/classrooms/:classroomId/lessons/:lessonId/release
// Makes a lesson available to every student in the classroom, on top of
// (not instead of) each student's own individual unlocked_lessons
// progress — see services/classroomPacingService.js for the combined
// check both students.getLessonQuiz/submitLessonQuiz/viewLesson and this
// view's own lesson list use.
exports.releaseLessonToClassroom = async (req, res) => {
  const instructorId = req.user.id;
  const classroomId = parseInt(req.params.classroomId, 10);
  const lessonId = parseInt(req.params.lessonId, 10);

  try {
    const ownsClassroomRes = await pool.query(
      `SELECT 1 FROM classroom_instructors WHERE classroom_id = $1 AND instructor_id = $2`,
      [classroomId, instructorId]
    );
    if (!ownsClassroomRes.rows.length) {
      return res.status(403).json({ success: false, message: "You don't teach this classroom." });
    }

    await classroomPacingService.releaseLesson(classroomId, lessonId, instructorId);
    res.json({ success: true });
  } catch (err) {
    console.error("releaseLessonToClassroom error:", err.message);
    res.status(500).json({ success: false });
  }
};

// POST /instructor/lesson-tasks
// Bundles one or more lessons (quiz and/or lab task) as a task for a
// classroom, with a due_class_date computed from the school's
// class_days (see services/lessonTaskService.js). Ownership is
// verified inside the service itself, not just here.
exports.createLessonTask = async (req, res) => {
  const instructorId = req.user.id;
  const { classroomId, lessonIds, title, instructions } = req.body;

  try {
    const parsedClassroomId = parseInt(classroomId, 10);
    const parsedLessonIds = Array.isArray(lessonIds)
      ? lessonIds.map((id) => parseInt(id, 10))
      : [parseInt(lessonIds, 10)];

    if (!parsedClassroomId || !title || !title.trim()) {
      return res.status(400).json({ success: false, message: "Classroom and title are required." });
    }

    const task = await lessonTaskService.createLessonTask(
      instructorId,
      parsedClassroomId,
      parsedLessonIds,
      title.trim(),
      instructions
    );
    res.json({ success: true, task });
  } catch (err) {
    console.error("createLessonTask error:", err.message);
    const status = err.message === "You don't teach this classroom." ? 403 : 400;
    res.status(status).json({ success: false, message: err.message });
  }
};

// POST /instructor/classrooms/:classroomId/lessons/:lessonId/unrelease
// Refuses on the first lesson of a course server-side (not just a
// disabled button) — that one is always available to a classroom.
exports.unreleaseLessonFromClassroom = async (req, res) => {
  const instructorId = req.user.id;
  const classroomId = parseInt(req.params.classroomId, 10);
  const lessonId = parseInt(req.params.lessonId, 10);

  try {
    const ownsClassroomRes = await pool.query(
      `SELECT 1 FROM classroom_instructors WHERE classroom_id = $1 AND instructor_id = $2`,
      [classroomId, instructorId]
    );
    if (!ownsClassroomRes.rows.length) {
      return res.status(403).json({ success: false, message: "You don't teach this classroom." });
    }

    const result = await classroomPacingService.unreleaseLesson(classroomId, lessonId);
    if (!result.ok) {
      return res.json({ success: false, message: result.reason });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("unreleaseLessonFromClassroom error:", err.message);
    res.status(500).json({ success: false });
  }
};

exports.assignedCoursesSection = async (req, res) => {
  const instructorId = req.user.id;
  // const schoolId = parseInt(req.query.school_id, 10);
  const schoolId = req.session.activeSchoolId;

  // if (!schoolId) {
  //   return res.send("<p>Please select a school</p>");
  // }

  if (!schoolId) {
  return res.send("<p>No school selected. Please choose a school first.</p>");
  }
  
  try {
    // 1️⃣ Get instructor classrooms in this school
    const classroomsResult = await pool.query(`
      SELECT c.id, c.name
      FROM classroom_instructors ci
      JOIN classrooms c ON ci.classroom_id = c.id
      WHERE ci.instructor_id = $1
        AND c.school_id = $2
        AND c.archived_at IS NULL
    `, [instructorId, schoolId]);

    if (classroomsResult.rows.length === 0) {
      return res.send("<p>No classrooms assigned in this school.</p>");
    }

    // 2️⃣ Get courses assigned to those classrooms
    const coursesResult = await pool.query(`
      SELECT DISTINCT
        crs.id,
        crs.title,
        c.id AS classroom_id,
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
      // The template reads `classroomCourse` (it renders one card per
      // (classroom, course) pair, since an instructor's classroom_courses
      // join can return the same course multiple times across
      // classrooms) — this was previously passed as `courses`, which the
      // template never reads, throwing "classroomCourse is not defined"
      // on every render of this section.
      classroomCourse: coursesResult.rows
    });

  } catch (err) {
    console.error("Assigned courses error:", err);
    res.send("<p>Error loading assigned courses</p>");
  }
};


exports.getAttendanceStudents = async (req, res) => {
  const { term_id, classroom_id } = req.query;

  try {
    if (!term_id || !classroom_id) {
      return res
        .status(400)
        .json({ error: "term_id and classroom_id are required" });
    }

    const result = await pool.query(
      `
      SELECT 
        u.id,
        u.fullname
      FROM student_term_enrollments ts
      JOIN users2 u ON ts.student_id = u.id
      JOIN user_school us ON us.user_id = u.id
      WHERE ts.term_id = $1
      AND us.classroom_id = $2
      AND u.archived_at IS NULL
      ORDER BY u.fullname ASC
    `,
      [term_id, classroom_id],
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching attendance students:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// exports.saveAttendance = async (req, res) => {
//   // const { term_id, classroom_id, date, records, session_status, note } =
//   //   req.body;
//   const {
//     term_id,
//     classroom_id,
//     date,
//     records,
//     session_status,
//     note,
//     week_number,
//   } = req.body;
//   const userId = req.session.user.id;
  

//   try {
//     // 1. Create session
//     const sessionResult = await pool.query(
//       `
//       INSERT INTO attendance_sessions
//       (school_id, term_id, classroom_id, taken_by, date, session_status, note, week_number)
//       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
//       ON CONFLICT (term_id, classroom_id, date)
//       DO UPDATE SET
//         taken_by = EXCLUDED.taken_by,
//         session_status = EXCLUDED.session_status,
//         note = EXCLUDED.note
//       RETURNING id, session_status
//     `,
//       [
//         req.body.school_id,
//         term_id,
//         classroom_id,
//         userId,
//         date,
//         session_status,
//         note || null,
//         week_number
//       ],
//     );

//     const sessionId = sessionResult.rows[0].id;

//     if (session_status !== "held") {

//       // 🔥 CLEAR OLD RECORDS
//       await pool.query(
//         `DELETE FROM attendance_records WHERE session_id = $1`,
//         [sessionId]
//       );

//       return res.json({
//         success: true,
//         message: "Session saved without attendance",
//       });
//     }

//     // 2. Save student attendance
//     for (const r of records) {
//       await pool.query(
//         `
//         INSERT INTO attendance_records (session_id, student_id, status)
//         VALUES ($1, $2, $3)
//         ON CONFLICT (session_id, student_id)
//         DO UPDATE SET status = EXCLUDED.status
//       `,
//         [sessionId, r.student_id, r.status],
//       );
//     }

//     res.json({ success: true });
//   } catch (err) {
//     console.error(err);
//     res.status(500).send("Error saving attendance");
//   }
// };

exports.saveAttendance = async (req, res) => {
  const {
    term_id,
    classroom_id,
    date,
    records,
    session_status,
    note,
    week_number,
  } = req.body;

  const userId = req.session.user.id;
  const schoolId = req.session.activeSchoolId; // ✅ FIX

  // classroom_id arrives as "" when the filter is still on "All" (its
  // default) — that used to reach the INSERT below as-is and crash with
  // an unhandled "invalid input syntax for type integer" 500, instead of
  // a clear message telling the instructor to pick a real classroom.
  if (!classroom_id || !term_id || !date) {
    return res.status(400).json({ success: false, message: "Please select a term, a specific classroom, and a date." });
  }

  try {
    const sessionResult = await pool.query(
      `
      INSERT INTO attendance_sessions
      (school_id, term_id, classroom_id, taken_by, date, session_status, note, week_number)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (term_id, classroom_id, date)
      DO UPDATE SET 
        taken_by = EXCLUDED.taken_by,
        session_status = EXCLUDED.session_status,
        note = EXCLUDED.note
      RETURNING id, session_status
    `,
      [
        schoolId, // ✅ FIXED
        term_id,
        classroom_id,
        userId,
        date,
        session_status,
        note || null,
        week_number,
      ],
    );

    const sessionId = sessionResult.rows[0].id;

    if (session_status !== "held") {
      await pool.query(`DELETE FROM attendance_records WHERE session_id = $1`, [
        sessionId,
      ]);

      return res.json({
        success: true,
        message: "Session saved without attendance",
      });
    }

    for (const r of records) {
      await pool.query(
        `
        INSERT INTO attendance_records (session_id, student_id, status)
        VALUES ($1, $2, $3)
        ON CONFLICT (session_id, student_id)
        DO UPDATE SET status = EXCLUDED.status
      `,
        [sessionId, r.student_id, r.status],
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error saving attendance");
  }
};

exports.getWeeklyAttendanceStats = async (req, res) => {
  const { term_id, classroom_id } = req.query;

  try {
    const result = await pool.query(
      `
      SELECT 
        s.week_number,

        COUNT(r.id) FILTER (WHERE r.status='present') AS present,
        COUNT(r.id) FILTER (WHERE r.status='absent') AS absent,
        COUNT(r.id) FILTER (WHERE r.status='late') AS late,
        COUNT(r.id) AS total,

        ROUND(
          (COUNT(r.id) FILTER (WHERE r.status='present') * 100.0) / NULLIF(COUNT(r.id),0),
          2
        ) AS attendance_percent

      FROM attendance_sessions s
      LEFT JOIN attendance_records r ON r.session_id = s.id
      WHERE s.term_id = $1
      ${classroom_id ? "AND s.classroom_id = $2" : ""}
      GROUP BY s.week_number
      ORDER BY s.week_number
      `,
      classroom_id ? [term_id, classroom_id] : [term_id],
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).send("Error");
  }
};

// exports.getAttendanceHistory = async (req, res) => {
//   const { term_id, classroom_id } = req.query;

//   try {
//     const result = await pool.query(
//       `
//       SELECT
//         s.id,
//         s.date,
//         s.session_status,
//         c.name AS classroom,
//         u.fullname AS taken_by,

//         -- ✅ ADD THIS
//         COUNT(ar.id) AS student_count

//       FROM attendance_sessions s

//       LEFT JOIN classrooms c ON s.classroom_id = c.id
//       LEFT JOIN users2 u ON s.taken_by = u.id

//       -- ✅ JOIN attendance records
//       LEFT JOIN attendance_records ar ON ar.session_id = s.id

//       WHERE s.term_id = $1
//       ${classroom_id ? "AND s.classroom_id = $2" : ""}

//       -- ✅ IMPORTANT for COUNT
//       GROUP BY s.id, c.name, u.fullname

//       ORDER BY s.date DESC
//     `,
//       classroom_id ? [term_id, classroom_id] : [term_id],
//     );

//     res.json(result.rows);
//   } catch (err) {
//     console.error(err);
//     res.status(500).send("Error loading attendance history");
//   }
// };

exports.getAttendanceHistory = async (req, res) => {
  const { term_id, classroom_id } = req.query;
  // const instructorId = req.user.id;
  const instructorId = req.session.user.id;
  const schoolId = req.session.activeSchoolId;

  try {
    // const result = await pool.query(
    //   `
    //   SELECT 
    //     s.id,
    //     s.date,
    //     s.session_status,
    //     c.name AS classroom,
    //     u.fullname AS taken_by,
    //     COUNT(ar.id) AS student_count

    //   FROM attendance_sessions s

    //   -- ✅ ONLY instructor classes
    //   JOIN classroom_instructors ci 
    //     ON ci.classroom_id = s.classroom_id

    //   LEFT JOIN classrooms c ON s.classroom_id = c.id
    //   LEFT JOIN users2 u ON s.taken_by = u.id
    //   LEFT JOIN attendance_records ar ON ar.session_id = s.id

    //   WHERE s.term_id = $1
    //   AND ci.instructor_id = $2
    //   ${classroom_id ? "AND s.classroom_id = $3" : ""}

    //   GROUP BY s.id, c.name, u.fullname
    //   ORDER BY s.date DESC
    //   `,
    //   classroom_id
    //     ? [term_id, instructorId, classroom_id]
    //     : [term_id, instructorId],
    // );

    const result = await pool.query(
      `
      SELECT 
        s.id,
        s.date,
        s.session_status,
        c.name AS classroom,
        u.fullname AS taken_by,
        COUNT(ar.id) AS student_count

      FROM attendance_sessions s

      JOIN classroom_instructors ci 
        ON ci.classroom_id = s.classroom_id

      LEFT JOIN classrooms c ON s.classroom_id = c.id
      LEFT JOIN users2 u ON s.taken_by = u.id
      LEFT JOIN attendance_records ar ON ar.session_id = s.id

      WHERE s.term_id = $1
      AND ci.instructor_id = $2
      AND s.school_id = $3
      ${classroom_id ? "AND s.classroom_id = $4" : ""}

      GROUP BY s.id, c.name, u.fullname
      ORDER BY s.date DESC
      `,
      classroom_id
        ? [term_id, instructorId, schoolId, classroom_id]
        : [term_id, instructorId, schoolId]
    );
    
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error loading attendance history");
  }
};

exports.getAttendanceSessionDetails = async (req, res) => {
  const { id } = req.params;

  try {
    /* 🔒 Authorization: instructor must teach this session's classroom.
       Previously had no check at all — any request could read any
       classroom's attendance roster by guessing a session id. */
    const accessCheck = await pool.query(
      `SELECT 1 FROM attendance_sessions s
       JOIN classroom_instructors ci ON ci.classroom_id = s.classroom_id
       WHERE s.id = $1 AND ci.instructor_id = $2`,
      [id, req.user.id]
    );
    if (!accessCheck.rowCount) {
      return res.status(403).send("Not authorized to view this attendance session");
    }

    const result = await pool.query(`
      SELECT 
        u.fullname,
        ar.status
      FROM attendance_records ar
      JOIN users2 u ON ar.student_id = u.id
      WHERE ar.session_id = $1
      ORDER BY u.fullname
    `, [id]);

    res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).send("Error loading attendance details");
  }
};

exports.getAttendanceSession = async (req, res) => {
  const { id } = req.params;

  try {
    const session = await pool.query(
      `SELECT * FROM attendance_sessions WHERE id=$1`,
      [id]
    );

    const records = await pool.query(
      `SELECT id, student_id, status FROM attendance_records WHERE session_id=$1`,
      [id]
    );

    res.json({
      session: session.rows[0],
      records: records.rows
    });

  } catch (err) {
    res.status(500).send("Error");
  }
};

exports.exportAttendancePDF = async (req, res) => {
  const { sessionId } = req.params;

  try {
    /* 🔒 Authorization: instructor must teach this session's classroom. */
    const accessCheck = await pool.query(
      `SELECT 1 FROM attendance_sessions s
       JOIN classroom_instructors ci ON ci.classroom_id = s.classroom_id
       WHERE s.id = $1 AND ci.instructor_id = $2`,
      [sessionId, req.user.id]
    );
    if (!accessCheck.rowCount) {
      return res.status(403).send("Not authorized to export this attendance session");
    }

    const session = await pool.query(
      `SELECT * FROM attendance_sessions WHERE id=$1`,
      [sessionId]
    );

    const students = await pool.query(
      `SELECT u.fullname, r.status
       FROM attendance_records r
       JOIN users2 u ON r.student_id = u.id
       WHERE r.session_id=$1`,
      [sessionId]
    );

    // const html = `
    // <html>
    // <body style="font-family:Calibri;">
    //   <div style="text-align:center;">
    //     <h2>ATTENDANCE REPORT</h2>
    //     <p>Week ${session.rows[0].week_number}</p>
    //     <p>${session.rows[0].date}</p>
    //   </div>

    //   <table width="100%" border="1" cellspacing="0">
    //     <tr>
    //       <th>Student</th>
    //       <th>Status</th>
    //     </tr>

    //     ${students.rows.map(s => `
    //       <tr>
    //         <td>${s.fullname}</td>
    //         <td>${s.status}</td>
    //       </tr>
    //     `).join("")}
    //   </table>
    // </body>
    // </html>
    // `;

    const html = `
      <html>
      <head>
      <style>
      body {
        font-family: Arial;
        padding: 30px;
      }

      .header {
        text-align: center;
        border-bottom: 2px solid #333;
        margin-bottom: 20px;
      }

      .header h2 {
        margin: 0;
      }

      .meta {
        display: flex;
        justify-content: space-between;
        margin-bottom: 20px;
        font-size: 14px;
      }

      table {
        width: 100%;
        border-collapse: collapse;
      }

      th {
        background: #222;
        color: white;
        padding: 10px;
      }

      td {
        padding: 8px;
        border-bottom: 1px solid #ddd;
      }

      .status-present { color: green; }
      .status-absent { color: red; }
      .status-late { color: orange; }
      </style>
      </head>

      <body>

      <div class="header">
        <h2>ATTENDANCE REPORT</h2>
      </div>

      <div class="meta">
        <div>Week: ${session.rows[0].week_number}</div>
        <div>Date: ${session.rows[0].date}</div>
      </div>

      <table>
      <tr>
        <th>Student</th>
        <th>Status</th>
      </tr>

      ${students.rows
        .map(
          (s) => `
      <tr>
        <td>${s.fullname}</td>
        <td class="status-${s.status}">${s.status}</td>
      </tr>
      `,
        )
        .join("")}

      </table>

      </body>
      </html>
      `;

    // const browser = await puppeteer.launch({ args: ["--no-sandbox"] });
    // const page = await browser.newPage();
    // await page.setContent(html);

    // const pdf = await page.pdf({ format: "A4" });
    // await browser.close();

    const pdf = await generatePdf(html);

    res.setHeader("Content-Type", "application/pdf");
    res.send(pdf);

  } catch (err) {
    res.status(500).send("PDF error");
  }
};

exports.exportAttendanceExcel = async (req, res) => {
  const { termId } = req.params;

  const ExcelJS = require("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Attendance");

  const data = await pool.query(
    `
    SELECT 
      s.week_number,
      s.date,
      c.name AS classroom,
      COUNT(r.id) FILTER (WHERE r.status='present') AS present,
      COUNT(r.id) FILTER (WHERE r.status='absent') AS absent
    FROM attendance_sessions s
    LEFT JOIN attendance_records r ON r.session_id=s.id
    LEFT JOIN classrooms c ON s.classroom_id=c.id
    WHERE s.term_id=$1
    GROUP BY s.id, c.name
    ORDER BY s.week_number
    `,
    [termId]
  );

  sheet.columns = [
    { header: "Week", key: "week" },
    { header: "Date", key: "date" },
    { header: "Class", key: "class" },
    { header: "Present", key: "present" },
    { header: "Absent", key: "absent" }
  ];

  data.rows.forEach(r => {
    sheet.addRow({
      week: r.week_number,
      date: r.date,
      class: r.classroom,
      present: r.present,
      absent: r.absent
    });
  });

  res.setHeader(
    "Content-Disposition",
    "attachment; filename=attendance.xlsx"
  );

  await workbook.xlsx.write(res);
  res.end();
};


// exports.updateAttendanceSession = async (req, res) => {
//   const { id } = req.params;
//   const { session_status, note, week_number, date } = req.body;

//   try {
//     // 🔥 Get existing session first
//     const existing = await pool.query(
//       `SELECT term_id, classroom_id, session_status FROM attendance_sessions WHERE id = $1`,
//       [id],
//     );

//     const session = existing.rows[0];

//     await pool.query(
//       `
//       UPDATE attendance_sessions
//       SET session_status = $1,
//           note = $2,
//           week_number = $3,
//           date = $4
//       WHERE id = $5
//       `,
//       [session_status, note, week_number, date, id],
//     );

//     // ✅ IF changed to "held" AND no records exist → recreate students
//     if (session_status === "held") {
//       const check = await pool.query(
//         `SELECT COUNT(*) FROM attendance_records WHERE session_id = $1`,
//         [id],
//       );

//       const count = Number(check.rows[0].count);

//       // if (count === 0) {
//       //   // 🔥 fetch students in that class + term
//       //   const students = await pool.query(
//       //     `
//       //     SELECT student_id
//       //     FROM student_term_enrollments
//       //     WHERE term_id = $1 AND classroom_id = $2
//       //     `,
//       //     [session.term_id, session.classroom_id],
//       //   );

//       //   // insert default records
//       //   for (const s of students.rows) {
//       //     await pool.query(
//       //       `
//       //       INSERT INTO attendance_records (session_id, student_id, status)
//       //       VALUES ($1, $2, 'present')
//       //       ON CONFLICT DO NOTHING
//       //       `,
//       //       [id, s.student_id],
//       //     );
//       //   }
//       // }

//       if (session_status === "held") {
//         // get all students in class
//         const students = await pool.query(
//           `
//           SELECT student_id
//           FROM student_term_enrollments
//           WHERE term_id = $1 AND classroom_id = $2
//           `,
//           [session.term_id, session.classroom_id],
//         );

//         for (const s of students.rows) {
//           await pool.query(
//             `
//       INSERT INTO attendance_records (session_id, student_id, status)
//       VALUES ($1, $2, 'present')
//       ON CONFLICT (session_id, student_id)
//       DO NOTHING
//       `,
//             [id, s.student_id],
//           );
//         }
//       }
//     }

//     res.json({ success: true });
//   } catch (err) {
//     console.error(err);
//     res.status(500).send("Update failed");
//   }
// };

// exports.deleteAttendanceSession = async (req, res) => {
//   const { id } = req.params;

//   try {
//     await pool.query(`DELETE FROM attendance_records WHERE session_id=$1`, [
//       id,
//     ]);
//     await pool.query(`DELETE FROM attendance_sessions WHERE id=$1`, [id]);

//     res.json({ success: true });
//   } catch (err) {
//     res.status(500).send("Delete failed");
//   }
// };

// exports.updateAttendanceRecord = async (req, res) => {
//   const { id } = req.params;
//   const { status } = req.body;

//   try {
//     await pool.query(`
//       UPDATE attendance_records
//       SET status = $1
//       WHERE id = $2
//     `, [status, id]);

//     res.json({ success: true });
//   } catch (err) {
//     res.status(500).send("Update failed");
//   }
// };

// =====================================================================
// GAMIFIED POINTS/COINS — instructor awards a student real coins from a
// fixed, capped set of categories. See services/instructorAwardService.js
// for the actual rules (anti-bias caps enforced there, not here).
// =====================================================================

exports.awardStudentPoints = async (req, res) => {
  try {
    const instructorId = req.user.id;
    const studentId = req.params.id;
    const { category, classroom_id, note } = req.body;

    const result = await instructorAwardService.awardPoints({
      req,
      instructorId,
      studentId,
      classroomId: classroom_id,
      category,
      note,
    });

    if (!result.ok) {
      const messages = {
        invalid_request: "Missing or invalid award details.",
        not_authorized: "You don't teach this student.",
        student_daily_limit: `This student has already received the maximum of ${instructorAwardService.MAX_AWARDS_PER_STUDENT_PER_DAY} awards today.`,
        category_already_used_today: "You've already used this category for this student today — try a different one.",
        daily_budget_exhausted: `You've used today's ${instructorAwardService.MAX_COINS_PER_INSTRUCTOR_PER_DAY}-coin award budget. It resets tomorrow.`,
      };
      return res.status(400).json({
        success: false,
        reason: result.reason,
        message: messages[result.reason] || "Couldn't award points right now.",
        remaining: result.remaining,
      });
    }

    res.json({ success: true, ...result });
  } catch (err) {
    console.error("Award student points error:", err);
    res.status(500).json({ success: false, message: "Server error awarding points" });
  }
};

exports.getRecentAwards = async (req, res) => {
  try {
    const instructorId = req.user.id;
    const classroomId = req.query.classroom_id || null;
    const [awards, budget] = await Promise.all([
      instructorAwardService.getRecentAwards({ instructorId, classroomId }),
      instructorAwardService.getRemainingBudget(instructorId),
    ]);
    res.json({ success: true, awards, budget });
  } catch (err) {
    console.error("Get recent awards error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Lets an instructor add a student directly to one of their own classrooms
// in a single step — name in, everything else (email, password, PIN,
// avatar, classroom/term enrollment) generated and wired up server-side.
// No single admin endpoint does this today; it's composed from the same
// tables the admin "add student" + "assign classroom" + "assign term"
// flows write to, so the new student shows up correctly everywhere those
// already read from (see services/instructorStudentService.js for why the
// email/avatar generation isn't just reused as-is from adminController.js).
exports.addStudentDirect = async (req, res) => {
  const instructorId = req.user.id;
  const { fullname, classroom_id, term_id } = req.body;
  const classroomId = parseInt(classroom_id, 10);
  const termId = term_id ? parseInt(term_id, 10) : null;

  if (!fullname || !fullname.trim() || !classroomId) {
    return res.status(400).json({ success: false, message: "Student name and classroom are required." });
  }

  // Ownership check BEFORE opening a transaction — ensureInstructorOrAdmin
  // is role-only (no per-classroom ownership check), so a crafted
  // classroom_id must be explicitly rejected here rather than trusted
  // because the client's own <select> happened to only list owned
  // classrooms. Reuses the same check createClassReport already uses.
  const classroom = await instructorOwnsClassroom(classroomId, instructorId);
  if (!classroom) {
    return res.status(403).json({ success: false, message: "You do not teach this classroom." });
  }
  const schoolId = classroom.school_id;

  const schoolRes = await pool.query("SELECT name FROM schools WHERE id = $1", [schoolId]);
  const schoolName = schoolRes.rows[0]?.name || "school";

  if (termId) {
    const termCheck = await pool.query(
      "SELECT 1 FROM academic_terms WHERE id = $1 AND school_id = $2",
      [termId, schoolId]
    );
    if (termCheck.rowCount === 0) {
      return res.status(400).json({ success: false, message: "Invalid term for this school." });
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const email = await generateUniqueStudentEmail(client, fullname.trim(), schoolName);
    const generatedPassword = generateDefaultPassword();
    const hashed = await bcrypt.hash(generatedPassword, 10);

    const userRes = await client.query(
      `INSERT INTO users2 (fullname, email, password, role, profile_picture, created_at)
       VALUES ($1, $2, $3, 'student', '/profile.webp', NOW())
       RETURNING id`,
      [fullname.trim(), email, hashed]
    );
    const studentId = userRes.rows[0].id;

    await client.query(
      `INSERT INTO user_school (user_id, school_id, role_in_school, classroom_id, approved)
       VALUES ($1, $2, 'student', $3, true)`,
      [studentId, schoolId, classroomId]
    );

    if (termId) {
      await client.query(
        `INSERT INTO student_term_enrollments (student_id, school_id, term_id, classroom_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (student_id, term_id) DO UPDATE SET classroom_id = EXCLUDED.classroom_id`,
        [studentId, schoolId, termId, classroomId]
      );
    }

    const { pin, avatarSeed, avatarUrl } = generateStudentPinAndAvatar(studentId);
    await client.query(
      `UPDATE users2
       SET pin = $1, avatar_seed = $2, avatar_url = $3,
           login_type = 'avatar_pin', classroom_login_enabled = true
       WHERE id = $4`,
      [pin, avatarSeed, avatarUrl, studentId]
    );

    await client.query("COMMIT");

    // Billing recalc happens after commit — a quote-service failure
    // shouldn't roll back a student who was successfully created; it's
    // reported back as a non-fatal warning instead. This is the same
    // side effect adminController.assignStudentsToTerm performs when a
    // student joins a paying term — skipping it would silently leave the
    // school under-billed for the new student.
    let warning = null;
    if (termId) {
      try {
        const quoteIdRes = await pool.query("SELECT id FROM quotes WHERE term_id = $1", [termId]);
        const quoteId = quoteIdRes.rows[0]?.id;
        if (quoteId) await recalcAndPersistQuoteTotal(quoteId);
      } catch (quoteErr) {
        console.error("addStudentDirect: quote recalc failed", quoteErr);
        warning = "Student created, but the school's billing total could not be recalculated automatically.";
      }
    }

    return res.status(201).json({
      success: true,
      student: { id: studentId, fullname: fullname.trim(), classroom_id: classroomId },
      credentials: { email, password: generatedPassword, pin, avatarUrl },
      warning,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("addStudentDirect error:", err);
    return res.status(500).json({ success: false, message: "Could not create student." });
  } finally {
    client.release();
  }
};

// =====================================================================
// CLASS REPORTS — narrative CKEditor write-ups an instructor keeps per
// classroom, visible to the instructor themselves and to the school
// admin overseeing that school (controllers/schoolAdminController.js).
// =====================================================================

async function instructorOwnsClassroom(classroomId, instructorId) {
  const result = await pool.query(
    `SELECT c.school_id FROM classrooms c
     JOIN classroom_instructors ci ON ci.classroom_id = c.id
     WHERE c.id = $1 AND ci.instructor_id = $2`,
    [classroomId, instructorId]
  );
  return result.rows[0] || null;
}

exports.createClassReport = async (req, res) => {
  try {
    const instructorId = req.user.id;
    const { classroom_id, term_id, title, content, report_date } = req.body;

    if (!title?.trim() || !content?.trim()) {
      return res.status(400).json({ success: false, message: "Title and content are required" });
    }

    const classroom = await instructorOwnsClassroom(classroom_id, instructorId);
    if (!classroom) {
      return res.status(403).json({ success: false, message: "Not your classroom" });
    }

    const result = await pool.query(
      `INSERT INTO classroom_reports
         (classroom_id, school_id, instructor_id, term_id, title, content, report_date)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, CURRENT_DATE))
       RETURNING id, title, content, report_date, created_at`,
      [classroom_id, classroom.school_id, instructorId, term_id || null, title.trim(), content, report_date || null]
    );

    res.json({ success: true, report: result.rows[0] });
  } catch (err) {
    console.error("Create class report error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getClassReport = async (req, res) => {
  try {
    const instructorId = req.user.id;
    const { id } = req.params;

    const result = await pool.query(
      `SELECT cr.*, c.name AS classroom_name, t.name AS term_name
       FROM classroom_reports cr
       JOIN classrooms c ON c.id = cr.classroom_id
       JOIN classroom_instructors ci ON ci.classroom_id = cr.classroom_id
       LEFT JOIN academic_terms t ON t.id = cr.term_id
       WHERE cr.id = $1 AND ci.instructor_id = $2`,
      [id, instructorId]
    );
    if (!result.rowCount) {
      return res.status(404).json({ success: false, message: "Report not found" });
    }
    res.json({ success: true, report: result.rows[0] });
  } catch (err) {
    console.error("Get class report error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.updateClassReport = async (req, res) => {
  try {
    const instructorId = req.user.id;
    const { id } = req.params;
    const { title, content, report_date, term_id } = req.body;

    if (!title?.trim() || !content?.trim()) {
      return res.status(400).json({ success: false, message: "Title and content are required" });
    }

    // Only the original author may edit — matches
    // deleteClassroomAnnouncement's ownership-check convention in
    // teacherController.js, tightened to author-only (not just
    // any co-instructor of the classroom) since this is one person's
    // written narrative, not a shared classroom fixture.
    const result = await pool.query(
      `UPDATE classroom_reports
       SET title = $1, content = $2,
           report_date = COALESCE($3, report_date),
           term_id = COALESCE($4, term_id),
           updated_at = NOW()
       WHERE id = $5 AND instructor_id = $6
       RETURNING id, title, content, report_date, updated_at`,
      [title.trim(), content, report_date || null, term_id || null, id, instructorId]
    );

    if (!result.rowCount) {
      return res.status(403).json({ success: false, message: "Not authorized to edit this report" });
    }
    res.json({ success: true, report: result.rows[0] });
  } catch (err) {
    console.error("Update class report error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.deleteClassReport = async (req, res) => {
  try {
    const instructorId = req.user.id;
    const { id } = req.params;

    const result = await pool.query(
      `DELETE FROM classroom_reports WHERE id = $1 AND instructor_id = $2 RETURNING id`,
      [id, instructorId]
    );
    if (!result.rowCount) {
      return res.status(403).json({ success: false, message: "Not authorized to delete this report" });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Delete class report error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
