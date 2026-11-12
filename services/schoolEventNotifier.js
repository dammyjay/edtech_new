// services/schoolEventNotifier.js
//
// Fire-and-forget notifications (in-app + email) for two oversight
// events school admins and platform admins want visibility into
// without having to go check manually: a teacher/instructor/admin
// taking attendance, and an instructor/teacher submitting a narrative
// Class Report. Both recipients, both channels — an explicit choice
// (over just the school admin, or in-app only) made when this was
// built.
//
// Always called fire-and-forget by its callers (never awaited) so a
// slow email send can never delay the actor's own save/submit response.
const pool = require("../models/db");
const sendEmail = require("../utils/sendEmail");
const { notifyUser } = require("../utils/notify");

const ADMIN_BASE_URL = "https://acad.jkthub.com/admin";
const SCHOOL_ADMIN_BASE_URL = "https://acad.jkthub.com/school-admin";

async function getClassroomContext(classroomId) {
  const res = await pool.query(
    `SELECT c.id, c.name, c.school_id, s.name AS school_name, s.created_by AS school_admin_id
     FROM classrooms c JOIN schools s ON s.id = c.school_id
     WHERE c.id = $1`,
    [classroomId]
  );
  return res.rows[0] || null;
}

async function getPlatformAdmins() {
  const res = await pool.query(`SELECT id, email, fullname FROM users2 WHERE role = 'admin'`);
  return res.rows;
}

async function getActorName(actorId) {
  if (!actorId) return null;
  const res = await pool.query(`SELECT fullname FROM users2 WHERE id = $1`, [actorId]);
  return res.rows[0]?.fullname || null;
}

function emailBody({ recipientName, message, url }) {
  return `
    <p>Hello ${recipientName || ""},</p>
    <p>${message}</p>
    <p><a href="${url}">View details</a></p>
  `;
}

async function dispatch({ recipients, excludeUserId, title, message, urlFor }) {
  const seen = new Set();
  for (const recipient of recipients) {
    if (!recipient || recipient.id === excludeUserId || seen.has(recipient.id)) continue;
    seen.add(recipient.id);
    const url = urlFor(recipient);

    notifyUser(recipient.id, { type: "school_oversight", title, message, url }).catch((err) =>
      console.error("schoolEventNotifier: in-app notify failed:", err.message)
    );
    if (recipient.email) {
      sendEmail(recipient.email, title, emailBody({ recipientName: recipient.fullname, message, url })).catch((err) =>
        console.error("schoolEventNotifier: email failed:", err.message)
      );
    }
  }
}

async function notifyAttendanceTaken({ classroomId, actorId, date }) {
  try {
    const classroom = await getClassroomContext(classroomId);
    if (!classroom) return;

    const [schoolAdminRes, platformAdmins, actorName] = await Promise.all([
      classroom.school_admin_id
        ? pool.query(`SELECT id, email, fullname FROM users2 WHERE id = $1`, [classroom.school_admin_id])
        : { rows: [] },
      getPlatformAdmins(),
      getActorName(actorId),
    ]);

    const title = `Attendance taken — ${classroom.name}`;
    const message = `${actorName || "A staff member"} took attendance for <strong>${classroom.name}</strong> (${classroom.school_name}) on ${new Date(date).toDateString()}.`;

    await dispatch({
      recipients: [...schoolAdminRes.rows, ...platformAdmins],
      excludeUserId: actorId,
      title,
      message,
      urlFor: (r) =>
        r.id === classroom.school_admin_id
          ? `${SCHOOL_ADMIN_BASE_URL}/dashboard?section=attendance`
          : `${ADMIN_BASE_URL}/schools/${classroom.school_id}`,
    });
  } catch (err) {
    console.error("notifyAttendanceTaken failed:", err.message);
  }
}

async function notifyClassReportSubmitted({ classroomId, authorId, reportTitle }) {
  try {
    const classroom = await getClassroomContext(classroomId);
    if (!classroom) return;

    const [schoolAdminRes, platformAdmins, authorName] = await Promise.all([
      classroom.school_admin_id
        ? pool.query(`SELECT id, email, fullname FROM users2 WHERE id = $1`, [classroom.school_admin_id])
        : { rows: [] },
      getPlatformAdmins(),
      getActorName(authorId),
    ]);

    const title = `New class report — ${classroom.name}`;
    const message = `${authorName || "A staff member"} submitted a class report for <strong>${classroom.name}</strong> (${classroom.school_name}): "${reportTitle}".`;

    await dispatch({
      recipients: [...schoolAdminRes.rows, ...platformAdmins],
      excludeUserId: authorId,
      title,
      message,
      urlFor: (r) =>
        r.id === classroom.school_admin_id
          ? `${SCHOOL_ADMIN_BASE_URL}/dashboard?section=classroom-reports`
          : `${ADMIN_BASE_URL}/schools/${classroom.school_id}`,
    });
  } catch (err) {
    console.error("notifyClassReportSubmitted failed:", err.message);
  }
}

module.exports = { notifyAttendanceTaken, notifyClassReportSubmitted };
