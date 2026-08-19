const pool = require("../models/db");
const generatePdf = require("../utils/generatePdf");
const { computeClassroomTermAnalytics, buildClassroomAnalyticsPdfHtml } = require("../services/classroomTermAnalyticsService");

// Same term-scoped analytics as the school admin's classroom dashboard
// (see services/classroomTermAnalyticsService.js) — the admin route
// isn't scoped to one school ahead of time the way the school admin's
// is, so schoolId is resolved from the classroom itself first.
exports.getClassroomDashboard = async (req, res) => {
  try {
    const { classroomId } = req.params;
    const requestedTermId = req.query.term_id ? Number(req.query.term_id) : null;

    const classroomLookup = await pool.query(
      "SELECT school_id FROM classrooms WHERE id = $1",
      [classroomId]
    );
    if (!classroomLookup.rows.length) {
      return res.status(404).send("Classroom not found");
    }
    const schoolId = classroomLookup.rows[0].school_id;

    const result = await computeClassroomTermAnalytics(schoolId, classroomId, requestedTermId);
    if (!result) return res.status(404).send("Classroom not found");

    // Full classroom roster (all-time, not term-scoped) — feeds the
    // Report Centre's "Student" dropdown below, which is independent of
    // the term-scoped analytics above (a report can be generated for
    // any student ever in the classroom, for whichever term is chosen
    // there).
    const studentsRes = await pool.query(
      `SELECT u.id, u.fullname
       FROM users2 u
       JOIN user_school us ON us.user_id = u.id
       WHERE us.classroom_id = $1 AND us.role_in_school = 'student'
       ORDER BY u.fullname`,
      [classroomId]
    );

    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const info = infoResult.rows[0] || {};

    res.render("admin/classroom-dashboard", {
      ...result,
      students: studentsRes.rows,
      info,
      role: req.userRole || "admin",
      currentPage: "schools",
      users: req.session.user,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Server Error");
  }
};

exports.exportClassroomSummary = async (req, res) => {
  try {
    const { classroomId } = req.params;
    const requestedTermId = req.query.term_id ? Number(req.query.term_id) : null;

    const classroomLookup = await pool.query(
      "SELECT school_id FROM classrooms WHERE id = $1",
      [classroomId]
    );
    if (!classroomLookup.rows.length) {
      return res.status(404).send("Classroom not found");
    }
    const schoolId = classroomLookup.rows[0].school_id;

    const result = await computeClassroomTermAnalytics(schoolId, classroomId, requestedTermId);
    if (!result) return res.status(404).send("Classroom not found");

    const html = buildClassroomAnalyticsPdfHtml(result);
    const pdf = await generatePdf(html);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${result.classroom.name}-analytics.pdf`
    );
    res.send(pdf);
  } catch (err) {
    console.error(err);
    res.status(500).send("Export failed");
  }
};
