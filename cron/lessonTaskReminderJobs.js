// cron/lessonTaskReminderJobs.js
//
// Daily poller (not a per-weekday cron.schedule like parentAtRiskAlert.js
// or weeklyLeaderboardCoins.js) because each school's class day(s) are a
// runtime DB value, not a fixed cron expression — one job checks every
// school's own schedule instead of needing a dynamically (re-)registered
// schedule per school.
//
// Exactly leadDays before a school's next class day, for every lesson
// task that isn't fully complete yet and hasn't already been reminded
// for that date, this reminds FOUR recipient groups by email (always)
// and WhatsApp (only if a usable number exists — see utils/phoneFormat.js):
//   - the SCHOOL ADMIN (schools.created_by -> users2 — the confirmed
//     real linkage; user_school.role_in_school='school_admin' has no
//     real rows), CC'ing every platform admin on the same email, plus a
//     separate WhatsApp send to each platform admin's own number
//     (WhatsApp has no native CC — a second send is the direct
//     equivalent, so the platform admin can confirm the reminder went
//     out, per the client's own request).
//   - every TEACHER assigned to a classroom with a pending task, one
//     combined email/WhatsApp per teacher covering every classroom of
//     theirs that has something pending — not one per task.
//   - every PARENT whose OWN child specifically hasn't finished a
//     pending task yet (never a parent whose child already has), one
//     combined email/WhatsApp per parent covering every child/task of
//     theirs that's still pending.
// Each recipient's message says what's due and links to a real
// read-only status page for their role (views/partials/lessonTasks.ejs
// for school admin, views/teacher/sections/lesson_tasks.ejs for
// teacher, views/parentLessonTaskView.ejs — scoped to just their own
// child — for a parent).
const cron = require("node-cron");
const pool = require("../models/db");
const sendEmail = require("../utils/sendEmail");
const { sendWhatsAppTemplate } = require("../utils/sendWhatsApp");
const { toWhatsAppNumber } = require("../utils/phoneFormat");
const { isReminderDueToday } = require("../services/classDayService");
const { getPendingTasksForSchool, markTasksReminded } = require("../services/lessonTaskService");

const LEAD_DAYS = 2;
// Same hardcoded production domain already used for every other
// absolute link in this codebase's emails (controllers/adminController.js).
const BASE_URL = "https://acad.jkthub.com";

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function taskSummaryLine(t) {
  return `${t.title} (${t.classroom_name}): ${t.completedStudents}/${t.totalStudents} done`;
}

async function getPlatformAdmins() {
  const res = await pool.query(`SELECT id, email, phone, fullname FROM users2 WHERE role = 'admin'`);
  return res.rows;
}

// One combined group per teacher, covering every classroom of theirs
// that has a pending task — mirrors the classroom_teachers join used
// throughout teacherController.js.
async function getTeacherGroupsForTasks(tasks) {
  const groups = new Map();
  const classroomIds = [...new Set(tasks.map((t) => t.classroom_id))];
  if (classroomIds.length === 0) return groups;

  const res = await pool.query(
    `SELECT ct.classroom_id, u.id, u.fullname, u.email, u.phone
     FROM classroom_teachers ct JOIN users2 u ON u.id = ct.teacher_id
     WHERE ct.classroom_id = ANY($1::int[])`,
    [classroomIds]
  );

  for (const row of res.rows) {
    const relevantTasks = tasks.filter((t) => t.classroom_id === row.classroom_id);
    if (!groups.has(row.id)) {
      groups.set(row.id, { teacher: { id: row.id, fullname: row.fullname, email: row.email, phone: row.phone }, tasks: [] });
    }
    groups.get(row.id).tasks.push(...relevantTasks);
  }
  return groups;
}

// One combined group per parent, covering every (child, task) pair
// where that specific child hasn't finished yet — a parent whose child
// already completed everything is never included.
async function getParentGroupsForTasks(tasks) {
  const groups = new Map();

  const incompleteByChild = [];
  for (const task of tasks) {
    for (const student of task.students) {
      if (!student.completedAll) {
        incompleteByChild.push({ childId: student.id, childName: student.fullname, task });
      }
    }
  }
  if (incompleteByChild.length === 0) return groups;

  const childIds = [...new Set(incompleteByChild.map((x) => x.childId))];
  const res = await pool.query(
    `SELECT pc.child_id, pc.parent_id, u.fullname, u.email, u.phone
     FROM parent_children pc JOIN users2 u ON u.id = pc.parent_id
     WHERE pc.child_id = ANY($1::int[])`,
    [childIds]
  );

  const parentsByChild = new Map();
  for (const row of res.rows) {
    if (!parentsByChild.has(row.child_id)) parentsByChild.set(row.child_id, []);
    parentsByChild.get(row.child_id).push(row);
  }

  for (const item of incompleteByChild) {
    for (const p of parentsByChild.get(item.childId) || []) {
      if (!groups.has(p.parent_id)) {
        groups.set(p.parent_id, { parent: { id: p.parent_id, fullname: p.fullname, email: p.email, phone: p.phone }, items: [] });
      }
      groups.get(p.parent_id).items.push({ childName: item.childName, task: item.task });
    }
  }
  return groups;
}

function buildAdminEmailHtml(school, upcomingClassDateStr, tasks) {
  const rows = tasks.map((t) => `<li><strong>${t.title}</strong> — ${t.classroom_name}: ${t.completedStudents} of ${t.totalStudents} students done</li>`).join("");
  return `
    <h2>Upcoming Class Reminder</h2>
    <p>Hello,</p>
    <p>${school.name}'s next class is on <strong>${upcomingClassDateStr}</strong>. The following lesson tasks still have students who haven't finished:</p>
    <ul>${rows}</ul>
    <p>Please follow up with the students who still have pending tasks before class.</p>
    <p><a href="${BASE_URL}/school-admin/dashboard?section=lesson-tasks">View full status</a></p>
  `;
}

function buildTeacherEmailHtml(teacher, tasks, upcomingClassDateStr) {
  const rows = tasks
    .map((t) => {
      const pendingNames = t.students.filter((s) => !s.completedAll).map((s) => s.fullname).join(", ") || "—";
      const due = t.due_class_date ? new Date(t.due_class_date).toLocaleDateString() : "—";
      return `<li><strong>${t.title}</strong> — ${t.classroom_name} (due ${due}): ${t.completedStudents}/${t.totalStudents} done. Still pending: ${pendingNames}</li>`;
    })
    .join("");
  return `
    <h2>Pending Lesson Tasks</h2>
    <p>Hello ${teacher.fullname},</p>
    <p>Your next class is on <strong>${upcomingClassDateStr}</strong>. The following lesson tasks in your classroom(s) still have students who haven't finished:</p>
    <ul>${rows}</ul>
    <p><a href="${BASE_URL}/teacher/dashboard?section=lesson-tasks">View full status</a></p>
  `;
}

function buildParentEmailHtml(parent, items) {
  const rows = items
    .map(({ childName, task }) => {
      const due = task.due_class_date ? `, due by ${new Date(task.due_class_date).toLocaleDateString()}` : "";
      return `<li><strong>${childName}</strong> hasn't finished "${task.title}" (${task.classroom_name})${due} — <a href="${BASE_URL}/parent/lesson-task/${task.id}">view details</a></li>`;
    })
    .join("");
  return `
    <h2>Pending Class Task</h2>
    <p>Hello ${parent.fullname},</p>
    <ul>${rows}</ul>
    <p>Please encourage them to finish before the next class.</p>
  `;
}

async function runLessonTaskReminderJob() {
  const today = new Date();
  const upcomingClassDate = new Date(today);
  upcomingClassDate.setDate(today.getDate() + LEAD_DAYS);
  const upcomingClassDateStr = formatDate(upcomingClassDate);

  const platformAdmins = await getPlatformAdmins();

  const schoolsRes = await pool.query(
    `SELECT id, name, created_by, class_days FROM schools WHERE class_days IS NOT NULL`
  );

  for (const school of schoolsRes.rows) {
    if (!isReminderDueToday(school.class_days, today, LEAD_DAYS)) continue;

    const pendingTasks = await getPendingTasksForSchool(school.id, upcomingClassDateStr);
    if (pendingTasks.length === 0) continue;

    const summaryLine = pendingTasks.map(taskSummaryLine).join("; ");
    const schoolAdminLink = `${BASE_URL}/school-admin/dashboard?section=lesson-tasks`;

    // --- School admin (email CC'd to every platform admin; WhatsApp has
    //     no CC, so platform admins separately get their own send below) ---
    if (!school.created_by) {
      console.error(`Lesson task reminder: school ${school.id} (${school.name}) has no created_by admin to notify.`);
    } else {
      const adminRes = await pool.query(`SELECT email, phone, fullname FROM users2 WHERE id = $1`, [school.created_by]);
      const admin = adminRes.rows[0];
      if (!admin) {
        console.error(`Lesson task reminder: school ${school.id}'s created_by user ${school.created_by} not found.`);
      } else {
        if (admin.email) {
          try {
            await sendEmail(
              admin.email,
              `Upcoming class reminder for ${school.name}`,
              buildAdminEmailHtml(school, upcomingClassDateStr, pendingTasks),
              { cc: platformAdmins.map((a) => a.email).filter(Boolean) }
            );
          } catch (err) {
            console.error(`Lesson task reminder email failed for school ${school.id} admin:`, err.message);
          }
        }
        const adminNumber = toWhatsAppNumber(admin.phone);
        if (adminNumber) {
          try {
            await sendWhatsAppTemplate(adminNumber, [admin.fullname || "School Admin", summaryLine, upcomingClassDateStr, schoolAdminLink]);
          } catch (err) {
            console.error(`Lesson task reminder WhatsApp failed for school ${school.id} admin:`, err.message);
          }
        }
      }
    }

    // --- Platform admins' own WhatsApp copy ---
    for (const platformAdmin of platformAdmins) {
      const number = toWhatsAppNumber(platformAdmin.phone);
      if (!number) continue;
      try {
        await sendWhatsAppTemplate(number, [platformAdmin.fullname || "Admin", `${school.name}: ${summaryLine}`, upcomingClassDateStr, schoolAdminLink]);
      } catch (err) {
        console.error(`Lesson task reminder WhatsApp failed for platform admin ${platformAdmin.id}:`, err.message);
      }
    }

    // --- Teachers (one combined send per teacher) ---
    const teacherGroups = await getTeacherGroupsForTasks(pendingTasks);
    for (const { teacher, tasks } of teacherGroups.values()) {
      if (teacher.email) {
        try {
          await sendEmail(teacher.email, "Pending lesson tasks in your classroom(s)", buildTeacherEmailHtml(teacher, tasks, upcomingClassDateStr));
        } catch (err) {
          console.error(`Lesson task reminder email failed for teacher ${teacher.id}:`, err.message);
        }
      }
      const teacherNumber = toWhatsAppNumber(teacher.phone);
      if (teacherNumber) {
        try {
          await sendWhatsAppTemplate(teacherNumber, [teacher.fullname, tasks.map(taskSummaryLine).join("; "), upcomingClassDateStr, `${BASE_URL}/teacher/dashboard?section=lesson-tasks`]);
        } catch (err) {
          console.error(`Lesson task reminder WhatsApp failed for teacher ${teacher.id}:`, err.message);
        }
      }
    }

    // --- Parents (one combined send per parent, own child(ren) only) ---
    const parentGroups = await getParentGroupsForTasks(pendingTasks);
    for (const { parent, items } of parentGroups.values()) {
      if (parent.email) {
        try {
          await sendEmail(parent.email, "Reminder: pending class task", buildParentEmailHtml(parent, items));
        } catch (err) {
          console.error(`Lesson task reminder email failed for parent ${parent.id}:`, err.message);
        }
      }
      const parentNumber = toWhatsAppNumber(parent.phone);
      if (parentNumber) {
        const parentSummary = items.map(({ childName, task }) => `${childName} — ${task.title}`).join("; ");
        try {
          await sendWhatsAppTemplate(parentNumber, [parent.fullname, parentSummary, upcomingClassDateStr, `${BASE_URL}/parent/lesson-task/${items[0].task.id}`]);
        } catch (err) {
          console.error(`Lesson task reminder WhatsApp failed for parent ${parent.id}:`, err.message);
        }
      }
    }

    await markTasksReminded(pendingTasks.map((t) => t.id), upcomingClassDateStr);
  }
}

cron.schedule("0 18 * * *", () => {
  console.log("Checking lesson task reminders...");
  runLessonTaskReminderJob().catch((err) => console.error("Lesson task reminder job failed:", err.message));
});

module.exports = { runLessonTaskReminderJob };
