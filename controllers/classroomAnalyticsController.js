const pool = require("../models/db");
const generatePdf = require("../utils/generatePdf");
const { computeClassroomTermAnalytics, buildClassroomAnalyticsPdfHtml } = require("../services/classroomTermAnalyticsService");
const { getLockedStudentsForRoster, reactivateTerm } = require("../services/termReactivationService");

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

    // Ended-term reactivation panel: for each roster student, the same
    // prorated price a student would see/pay for themselves, so the
    // platform admin can reactivate it for free on their behalf.
    // Reactivation is deliberately a platform-admin-only action — school
    // admins can see this same breakdown (read-only) on their own
    // classroom dashboard, but can't trigger it themselves.
    //
    // Batched (see getLockedStudentsForRoster) rather than one lock
    // check per student — this DB has real per-query network latency,
    // and a sequential per-student chain turns a large roster into a
    // painfully slow page load.
    let lockedStudents = [];
    if (result.selectedTerm && result.selectedTerm.is_ended) {
      const studentIds = result.studentMetrics.map((stu) => stu.id);
      const lockedByStudent = await getLockedStudentsForRoster(studentIds, classroomId, result.selectedTerm.id);
      lockedStudents = result.studentMetrics
        .filter((stu) => lockedByStudent.has(stu.id))
        .map((stu) => ({ id: stu.id, fullname: stu.fullname, priceInfo: lockedByStudent.get(stu.id) }));
    }

    res.render("admin/classroom-dashboard", {
      ...result,
      students: studentsRes.rows,
      info,
      role: req.userRole || "admin",
      currentPage: "schools",
      users: req.session.user,
      lockedStudents,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Server Error");
  }
};

// POST: platform admin manually reactivates a specific student's ended
// term for free (no wallet involved) — see the paid student-facing
// equivalent in studentController.payTermReactivation. Deliberately not
// available to school admins (see getClassroomDashboard above).
exports.reactivateStudentTerm = async (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.status(403).send("Access denied");
  }

  try {
    const { classroomId, termId, studentId } = req.params;

    const classroomLookup = await pool.query(
      "SELECT school_id FROM classrooms WHERE id = $1",
      [classroomId]
    );
    if (!classroomLookup.rows.length) return res.status(404).send("Classroom not found");
    const schoolId = classroomLookup.rows[0].school_id;

    const enrollmentRes = await pool.query(
      `SELECT ste.term_id, at.is_ended
       FROM student_term_enrollments ste
       JOIN academic_terms at ON at.id = ste.term_id
       WHERE ste.student_id = $1 AND ste.term_id = $2 AND ste.classroom_id = $3`,
      [studentId, termId, classroomId]
    );
    const enrollment = enrollmentRes.rows[0];
    if (!enrollment || !enrollment.is_ended) {
      return res.status(400).send("Term not found or not ended");
    }

    await reactivateTerm(studentId, schoolId, termId, {
      reactivatedBy: "admin",
      reactivatedByUserId: req.session.user.id,
      amountPaid: 0,
    });

    res.redirect(`/admin/classrooms/${classroomId}/dashboard?term_id=${termId}`);
  } catch (err) {
    console.error("Error reactivating student term:", err);
    res.status(500).send("Server error");
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
