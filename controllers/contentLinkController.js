// controllers/contentLinkController.js
//
// GET /go/:type/:id — a stable, shareable deep link an instructor/admin can
// copy for a lesson/module/course and hand to a student. Deliberately NOT
// gated by any of middlewares/auth.js's role middlewares (it has to work
// for a logged-out visitor first) — it does its own login/access check and
// then redirects to wherever that content actually lives:
//   lesson  -> the dashboard's existing focused-module+auto-open-lesson view
//              (the real lesson "page" is just a JSON API, not a navigable
//              page — /student/dashboard?...&openLesson=X is the real one,
//              same URL shape dashboard.ejs's own "jump to this lesson"
//              button already builds at ~line 2850)
//   module  -> /student/modules/:id (a real page; hardened with the same
//              access check below, since it previously had none at all)
//   course  -> /student/dashboard?section=module&courseId=X (the module
//              grid — there's no dedicated course page in this app)
// Assignments are intentionally NOT included: /student/assignments/:id is a
// JSON API, not a page, so there's nothing sensible to redirect a browser
// to yet.
const pool = require("../models/db");
const { redirectToLogin } = require("../middlewares/auth");
const { studentHasCourseAccess } = require("../models/accessControl");
const renderErrorPage = require("../utils/errorPage");

const STAFF_ROLES = new Set(["admin", "instructor", "teacher"]);
const STUDENT_ROLES = new Set(["student", "user", "individual_student"]);

// Renders the same "message modal, then redirect" page renderErrorPage
// uses (views/error.ejs + uiAlerts.js's showAlert) for the two EXPECTED,
// non-error denial cases below — deliberately not going through
// renderErrorPage itself, since that helper always console.error()s, and
// "this student isn't enrolled yet" isn't a server error worth logging as
// one.
function renderDenied(req, res, message, backUrl) {
  res.status(403).render("error", {
    message,
    backUrl,
    user: req.session?.user || null,
    users: req.session?.user || null,
    info: res.locals.info || {},
    csrfToken: res.locals.csrfToken || null,
  });
}

async function resolveContent(type, id) {
  if (type === "lesson") {
    const result = await pool.query(
      `SELECT l.id AS lesson_id, l.module_id, m.course_id
       FROM lessons l JOIN modules m ON m.id = l.module_id
       WHERE l.id = $1 AND l.archived_at IS NULL`,
      [id]
    );
    if (!result.rows.length) return null;
    const row = result.rows[0];
    return {
      courseId: row.course_id,
      destination: `/student/dashboard?section=module&moduleId=${row.module_id}&openLesson=${row.lesson_id}`,
    };
  }

  if (type === "module") {
    const result = await pool.query(
      "SELECT id, course_id FROM modules WHERE id = $1 AND archived_at IS NULL",
      [id]
    );
    if (!result.rows.length) return null;
    return { courseId: result.rows[0].course_id, destination: `/student/modules/${id}` };
  }

  if (type === "course") {
    const result = await pool.query(
      "SELECT id FROM courses WHERE id = $1 AND archived_at IS NULL",
      [id]
    );
    if (!result.rows.length) return null;
    return { courseId: id, destination: `/student/dashboard?section=module&courseId=${id}` };
  }

  return undefined; // unknown type
}

exports.openContentLink = async (req, res) => {
  const { type, id } = req.params;

  if (!req.session.user) {
    return redirectToLogin(req, res);
  }

  try {
    const content = await resolveContent(type, id);
    if (content === undefined) {
      return res.status(404).send("Unknown link type");
    }
    if (content === null) {
      return res.status(404).send("That content no longer exists");
    }

    const role = req.session.user.role;

    if (STAFF_ROLES.has(role)) {
      return res.redirect(content.destination);
    }

    if (STUDENT_ROLES.has(role)) {
      const hasAccess = await studentHasCourseAccess(req.session.user.id, content.courseId);
      if (!hasAccess) {
        return renderDenied(
          req,
          res,
          "You don't have access to this content yet — check with your instructor or school admin.",
          "/student/dashboard"
        );
      }
      return res.redirect(content.destination);
    }

    // Any other role (parent, etc.) — this feature only covers students
    // and the staff who manage content, so say so plainly rather than
    // redirecting somewhere that won't make sense for them.
    return renderDenied(req, res, "This link is for students — log in with a student account to open it.", "/");
  } catch (err) {
    renderErrorPage(req, res, err, { context: "openContentLink" });
  }
};
