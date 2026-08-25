const pool = require("../models/db");
const webpush = require("./webpushConfig");

// Every one of these helpers swallows its own errors and never rejects —
// they're always called from inside an existing chat/message send handler,
// and a notification failure must never turn a successful message send into
// a 500 for the caller.

const DASHBOARD_URL_BY_ROLE = {
  admin: "/admin/dashboard",
  school_admin: "/school-admin/dashboard",
  teacher: "/teacher/dashboard",
  instructor: "/instructor/dashboard",
  parent: "/parent/dashboard",
  student: "/student/dashboard",
  user: "/student/dashboard",
};

function preview(message) {
  const text = (message || "").trim();
  return text.length > 80 ? text.slice(0, 77) + "..." : text;
}

// Inserts the in-app row, then best-effort delivers a browser push to every
// subscription this user has. A dead subscription (404/410 from the push
// service) is deleted on the spot — self-healing, unlike the existing
// cron/lessonReminderJob.js sender this pattern is based on.
async function notifyUser(userId, { type, title, message, url }) {
  if (!userId) return;

  try {
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, message, url) VALUES ($1,$2,$3,$4,$5)`,
      [userId, type, title, message || null, url || null]
    );
  } catch (err) {
    console.error("notifyUser: failed to insert notification:", err.message);
  }

  let subs;
  try {
    subs = await pool.query(`SELECT id, endpoint, keys FROM push_subscriptions WHERE user_id = $1`, [userId]);
  } catch (err) {
    console.error("notifyUser: failed to load push subscriptions:", err.message);
    return;
  }

  const payload = JSON.stringify({ title, message, url });
  for (const sub of subs.rows) {
    let keys;
    try {
      keys = typeof sub.keys === "string" ? JSON.parse(sub.keys) : sub.keys;
    } catch {
      continue;
    }
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys }, payload);
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await pool.query(`DELETE FROM push_subscriptions WHERE id = $1`, [sub.id]).catch(() => {});
      } else {
        console.error("notifyUser: push send failed:", err.message);
      }
    }
  }
}

async function notifyClassroom(classroomId, excludeUserId, payload) {
  let roster;
  try {
    roster = await pool.query(
      `SELECT user_id FROM user_school WHERE classroom_id = $1 AND role_in_school = 'student' AND approved = true
       UNION
       SELECT teacher_id AS user_id FROM classroom_teachers WHERE classroom_id = $1`,
      [classroomId]
    );
  } catch (err) {
    console.error("notifyClassroom: failed to load roster:", err.message);
    return;
  }
  await Promise.all(
    roster.rows.filter((r) => r.user_id !== excludeUserId).map((r) => notifyUser(r.user_id, payload))
  );
}

async function notifyNewDirectMessage({ senderId, receiverId, message }) {
  if (!receiverId || String(receiverId) === String(senderId)) return;
  try {
    const [senderRes, receiverRes] = await Promise.all([
      pool.query(`SELECT fullname FROM users2 WHERE id = $1`, [senderId]),
      pool.query(`SELECT role FROM users2 WHERE id = $1`, [receiverId]),
    ]);
    const senderName = senderRes.rows[0]?.fullname || "Someone";
    const url = DASHBOARD_URL_BY_ROLE[receiverRes.rows[0]?.role] || "/";

    await notifyUser(receiverId, {
      type: "direct_message",
      title: `New message from ${senderName}`,
      message: preview(message),
      url,
    });
  } catch (err) {
    console.error("notifyNewDirectMessage failed:", err.message);
  }
}

// Recipients are derived (class_messages/classroom_announcements have no
// receiver column) via the same classroom-roster join used by
// teacherController.renderClassChat, with the role hardcoded per branch
// (cheaper than joining users2 for it, and every teacher notification needs
// the special AJAX-shell deep link below regardless).
async function getClassroomRosterWithRoles(classroomId) {
  const roster = await pool.query(
    `SELECT user_id, 'student' AS role FROM user_school WHERE classroom_id = $1 AND role_in_school = 'student' AND approved = true
     UNION
     SELECT teacher_id AS user_id, 'teacher' AS role FROM classroom_teachers WHERE classroom_id = $1`,
    [classroomId]
  );
  return roster.rows;
}

function teacherClassroomChatUrl(classroomId) {
  return `/teacher/dashboard?target=${encodeURIComponent(
    `/teacher/class-chat/${classroomId}`
  )}&section=classes`;
}

async function notifyNewClassMessage({ senderId, classroomId, message }) {
  try {
    const senderRes = await pool.query(`SELECT fullname FROM users2 WHERE id = $1`, [senderId]);
    const senderName = senderRes.rows[0]?.fullname || "Someone";
    const roster = await getClassroomRosterWithRoles(classroomId);
    const teacherUrl = teacherClassroomChatUrl(classroomId);

    await Promise.all(
      roster
        .filter((r) => r.user_id !== senderId)
        .map((r) =>
          notifyUser(r.user_id, {
            type: "class_message",
            title: `New class message from ${senderName}`,
            message: preview(message),
            url: r.role === "teacher" ? teacherUrl : DASHBOARD_URL_BY_ROLE.student,
          })
        )
    );
  } catch (err) {
    console.error("notifyNewClassMessage failed:", err.message);
  }
}

// Classroom announcements are surfaced inside the same classroom-chat panel
// as class messages, so this shares that URL scheme rather than inventing
// a new one.
async function notifyClassroomAnnouncement({ senderId, classroomId, title, message }) {
  try {
    const roster = await getClassroomRosterWithRoles(classroomId);
    const teacherUrl = teacherClassroomChatUrl(classroomId);

    await Promise.all(
      roster
        .filter((r) => r.user_id !== senderId)
        .map((r) =>
          notifyUser(r.user_id, {
            type: "announcement",
            title: `📌 New announcement: ${title}`,
            message: preview(message),
            url: r.role === "teacher" ? teacherUrl : DASHBOARD_URL_BY_ROLE.student,
          })
        )
    );
  } catch (err) {
    console.error("notifyClassroomAnnouncement failed:", err.message);
  }
}

module.exports = {
  notifyUser,
  notifyClassroom,
  notifyNewDirectMessage,
  notifyNewClassMessage,
  notifyClassroomAnnouncement,
  DASHBOARD_URL_BY_ROLE,
};
