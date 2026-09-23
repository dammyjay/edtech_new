// controllers/externalProjectController.js
//
// Course-agnostic "submit work built outside any in-app lab, get it
// AI-graded" system — see docs/external-project-grading-plan.docx for the
// full design and why this is a new, parallel system rather than a retrofit
// of module_assignments/assignment_submissions or the broken
// course_projects/project_submissions.
//
// A task (external_projects) attaches to exactly one of a lesson, module,
// or course, has a real structured rubric and a checklist of deliverables
// (each with its own accepted formats). A submission (external_project_
// submissions) holds one attachment per deliverable actually provided.
// Grading runs asynchronously right after insert (never blocks the
// student's request) via services/externalProjectGradingService.js.

const pool = require("../models/db");
const { notifyUser } = require("../utils/notify");
const { gradeSubmission } = require("../services/externalProjectGradingService");

// Resolves an external_projects row to the course it ultimately belongs to,
// regardless of which of the three levels it's actually attached at —
// needed for the teacher classroom-ownership check below, since
// classroom_courses only ever joins on course_id. Bare expression (no "AS
// alias") — this gets substituted directly inside a JOIN ... ON condition,
// where a SELECT-list-style alias isn't valid SQL.
const COURSE_ID_RESOLUTION = `COALESCE(ep.course_id, m.course_id, lm.course_id)`;
const RESOLVE_JOINS = `
  LEFT JOIN modules m ON m.id = ep.module_id
  LEFT JOIN lessons l ON l.id = ep.lesson_id
  LEFT JOIN modules lm ON lm.id = l.module_id
`;

function validateRubric(rubric) {
  if (!Array.isArray(rubric) || rubric.length === 0) return "At least one rubric criterion is required.";
  const total = rubric.reduce((sum, r) => sum + (Number(r.weight) || 0), 0);
  if (total !== 100) return `Rubric weights must sum to 100 (currently ${total}).`;
  if (rubric.some((r) => !r.criterion || !String(r.criterion).trim())) return "Every rubric row needs criterion text.";
  return null;
}

function validateDeliverables(deliverables) {
  if (!Array.isArray(deliverables) || deliverables.length === 0) return "At least one deliverable is required.";
  if (deliverables.some((d) => !d.label || !String(d.label).trim())) return "Every deliverable needs a label.";
  return null;
}

// ---------------------------------------------------------------------
// Authoring (admin)
// ---------------------------------------------------------------------

exports.createExternalProject = async (req, res) => {
  try {
    const { title, instructions, level, level_id, points } = req.body;
    let { deliverables, rubric } = req.body;

    if (!title || !level || !level_id) {
      return res.status(400).json({ success: false, message: "Title, level, and level_id are required." });
    }
    if (!["lesson", "module", "course"].includes(level)) {
      return res.status(400).json({ success: false, message: "level must be lesson, module, or course." });
    }

    try {
      deliverables = typeof deliverables === "string" ? JSON.parse(deliverables) : deliverables;
      rubric = typeof rubric === "string" ? JSON.parse(rubric) : rubric;
    } catch {
      return res.status(400).json({ success: false, message: "deliverables/rubric must be valid JSON." });
    }

    const deliverablesError = validateDeliverables(deliverables);
    if (deliverablesError) return res.status(400).json({ success: false, message: deliverablesError });
    const rubricError = validateRubric(rubric);
    if (rubricError) return res.status(400).json({ success: false, message: rubricError });

    const lessonId = level === "lesson" ? level_id : null;
    const moduleId = level === "module" ? level_id : null;
    const courseId = level === "course" ? level_id : null;

    const result = await pool.query(
      `INSERT INTO external_projects (lesson_id, module_id, course_id, title, instructions, deliverables, rubric, points, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [lessonId, moduleId, courseId, title, instructions || null, JSON.stringify(deliverables), JSON.stringify(rubric), Number(points) || 10, req.session?.user?.id || null]
    );

    res.json({ success: true, project: result.rows[0] });
  } catch (err) {
    console.error("createExternalProject error:", err.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.editExternalProject = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, instructions, points } = req.body;
    let { deliverables, rubric } = req.body;

    try {
      deliverables = typeof deliverables === "string" ? JSON.parse(deliverables) : deliverables;
      rubric = typeof rubric === "string" ? JSON.parse(rubric) : rubric;
    } catch {
      return res.status(400).json({ success: false, message: "deliverables/rubric must be valid JSON." });
    }

    const deliverablesError = validateDeliverables(deliverables);
    if (deliverablesError) return res.status(400).json({ success: false, message: deliverablesError });
    const rubricError = validateRubric(rubric);
    if (rubricError) return res.status(400).json({ success: false, message: rubricError });

    const result = await pool.query(
      `UPDATE external_projects
       SET title=$1, instructions=$2, deliverables=$3, rubric=$4, points=$5
       WHERE id=$6 RETURNING *`,
      [title, instructions || null, JSON.stringify(deliverables), JSON.stringify(rubric), Number(points) || 10, id]
    );
    if (!result.rowCount) return res.status(404).json({ success: false, message: "Not found" });

    res.json({ success: true, project: result.rows[0] });
  } catch (err) {
    console.error("editExternalProject error:", err.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.deleteExternalProject = async (req, res) => {
  try {
    await pool.query(`DELETE FROM external_projects WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error("deleteExternalProject error:", err.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Lists every external project reachable from a course — attached directly
// to the course, to one of its modules, or to a lesson inside one of those
// modules — so the admin course page can show everything in one place
// regardless of which level each task was actually authored at.
exports.getExternalProjectsForCourse = async (req, res) => {
  try {
    const { courseId } = req.params;
    const result = await pool.query(
      `SELECT ep.*,
              CASE WHEN ep.lesson_id IS NOT NULL THEN 'lesson'
                   WHEN ep.module_id IS NOT NULL THEN 'module'
                   ELSE 'course' END AS level,
              l.title AS lesson_title, m.title AS module_title
       FROM external_projects ep
       LEFT JOIN lessons l ON l.id = ep.lesson_id
       LEFT JOIN modules lm2 ON lm2.id = l.module_id
       LEFT JOIN modules m ON m.id = ep.module_id
       WHERE ep.course_id = $1
          OR m.course_id = $1
          OR lm2.course_id = $1
       ORDER BY ep.created_at DESC`,
      [courseId]
    );
    res.json({ success: true, projects: result.rows });
  } catch (err) {
    console.error("getExternalProjectsForCourse error:", err.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ---------------------------------------------------------------------
// Student
// ---------------------------------------------------------------------

exports.viewExternalProject = async (req, res) => {
  try {
    const { id } = req.params;
    const studentId = req.session?.user?.id;

    const projectRes = await pool.query(`SELECT * FROM external_projects WHERE id = $1`, [id]);
    if (!projectRes.rowCount) return res.status(404).json({ success: false, message: "Not found" });
    const project = projectRes.rows[0];

    const guideRes = await pool.query(
      `SELECT * FROM learning_guides WHERE guide_type = 'external_project' LIMIT 1`
    );

    const submissionRes = await pool.query(
      `SELECT * FROM external_project_submissions
       WHERE external_project_id = $1 AND student_id = $2
       ORDER BY submitted_at DESC LIMIT 1`,
      [id, studentId]
    );

    res.json({
      success: true,
      project,
      guide: guideRes.rows[0] || null,
      submission: submissionRes.rows[0] || null,
    });
  } catch (err) {
    console.error("viewExternalProject error:", err.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// POST /student/external-projects/:id/submit — multipart, upload.any().
// One deliverable per checklist row, identified by index: a file arrives as
// a multipart file field named file_<index>; a link arrives as a plain body
// field named link_<index>. Whichever is present for a given index becomes
// that deliverable's attachment; a deliverable with neither is simply
// omitted from `attachments` (required-ness is enforced client-side against
// the same deliverables list the task defines — server-side enforcement of
// "required" is intentionally left to a later pass, see the plan doc's open
// decisions).
exports.submitExternalProject = async (req, res) => {
  try {
    const { id } = req.params;
    const studentId = req.session?.user?.id;
    if (!studentId) return res.status(401).json({ success: false, message: "Not logged in." });

    const projectRes = await pool.query(`SELECT * FROM external_projects WHERE id = $1`, [id]);
    if (!projectRes.rowCount) return res.status(404).json({ success: false, message: "Not found" });
    const project = projectRes.rows[0];

    const filesByField = {};
    (req.files || []).forEach((f) => {
      filesByField[f.fieldname] = f;
    });

    const attachments = [];
    (project.deliverables || []).forEach((deliverable, index) => {
      const file = filesByField[`file_${index}`];
      const link = req.body[`link_${index}`];
      if (file) {
        attachments.push({ label: deliverable.label, type: "file", url: file.path });
      } else if (link && String(link).trim()) {
        const isGithub = /github\.com/i.test(link);
        attachments.push({ label: deliverable.label, type: isGithub ? "github_link" : "link", url: link.trim() });
      }
    });

    if (!attachments.length) {
      return res.status(400).json({ success: false, message: "At least one deliverable must be submitted." });
    }

    const insertRes = await pool.query(
      `INSERT INTO external_project_submissions (external_project_id, student_id, attachments, notes, status)
       VALUES ($1,$2,$3,$4,'grading') RETURNING *`,
      [id, studentId, JSON.stringify(attachments), req.body.notes || null]
    );
    const submission = insertRes.rows[0];

    // Respond immediately — grading (a zip/PDF read + a GitHub API round
    // trip + an AI call) can take a real number of seconds and shouldn't
    // block the student's submit click on it, unlike the older
    // assignment_submissions flow this deliberately does NOT copy.
    res.json({ success: true, submissionId: submission.id, status: "grading" });

    gradeSubmission(project, submission)
      .then(async (result) => {
        await pool.query(
          `UPDATE external_project_submissions
           SET status=$1, score=$2, feedback=$3, criteria_breakdown=$4, graded_at=NOW()
           WHERE id=$5`,
          [result.status, result.score, result.feedback, result.criteriaBreakdown ? JSON.stringify(result.criteriaBreakdown) : null, submission.id]
        );
        await notifyUser(studentId, {
          type: "grade_posted",
          title: result.status === "graded" ? "Your project was graded" : "There was a problem grading your project",
          message: `${project.title} — ${result.status === "graded" ? `score: ${result.score}/100` : "a teacher will need to review this one"}`,
          url: "/student/dashboard",
        });
      })
      .catch((err) => {
        console.error("Async grading failed for submission", submission.id, err.message);
        pool
          .query(`UPDATE external_project_submissions SET status='grading_failed' WHERE id=$1`, [submission.id])
          .catch(() => {});
      });
  } catch (err) {
    console.error("submitExternalProject error:", err.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getMyExternalProjectSubmissions = async (req, res) => {
  try {
    const studentId = req.session?.user?.id;
    const result = await pool.query(
      `SELECT eps.*, ep.title AS project_title
       FROM external_project_submissions eps
       JOIN external_projects ep ON ep.id = eps.external_project_id
       WHERE eps.student_id = $1
       ORDER BY eps.submitted_at DESC`,
      [studentId]
    );
    res.json({ success: true, submissions: result.rows });
  } catch (err) {
    console.error("getMyExternalProjectSubmissions error:", err.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ---------------------------------------------------------------------
// Teacher review / override
// ---------------------------------------------------------------------

exports.getExternalProjectGradingQueue = async (req, res) => {
  try {
    const teacherId = req.user.id;
    const result = await pool.query(
      `SELECT eps.*, ep.title AS project_title, ep.instructions, ep.rubric,
              u.id AS student_id, u.fullname AS student_name
       FROM external_project_submissions eps
       JOIN external_projects ep ON ep.id = eps.external_project_id
       ${RESOLVE_JOINS}
       JOIN classroom_courses cc ON cc.course_id = ${COURSE_ID_RESOLUTION}
       JOIN classroom_teachers ct ON ct.classroom_id = cc.classroom_id
       JOIN users2 u ON u.id = eps.student_id
       WHERE ct.teacher_id = $1
       ORDER BY eps.submitted_at DESC`,
      [teacherId]
    );
    res.render("teacher/sections/externalProjectGrading", { submissions: result.rows });
  } catch (err) {
    console.error("getExternalProjectGradingQueue error:", err.message);
    res.status(500).send("<p>Error loading grading queue</p>");
  }
};

exports.overrideExternalProjectGrade = async (req, res) => {
  try {
    const { submissionId } = req.params;
    const { score, teacher_feedback } = req.body;
    const teacherId = req.user.id;

    const ownershipCheck = await pool.query(
      `SELECT eps.student_id, ep.title AS project_title
       FROM external_project_submissions eps
       JOIN external_projects ep ON ep.id = eps.external_project_id
       ${RESOLVE_JOINS}
       JOIN classroom_courses cc ON cc.course_id = ${COURSE_ID_RESOLUTION}
       JOIN classroom_teachers ct ON ct.classroom_id = cc.classroom_id
       WHERE eps.id = $1 AND ct.teacher_id = $2`,
      [submissionId, teacherId]
    );
    if (!ownershipCheck.rowCount) {
      return res.status(403).json({ success: false, message: "Not authorized to grade this submission" });
    }

    await pool.query(
      `UPDATE external_project_submissions
       SET score=$1, teacher_feedback=$2, graded_by=$3, status='graded', graded_at=NOW()
       WHERE id=$4`,
      [score || null, teacher_feedback || null, teacherId, submissionId]
    );

    const { student_id, project_title } = ownershipCheck.rows[0];
    await notifyUser(student_id, {
      type: "grade_posted",
      title: "Your project grade was updated by a teacher",
      message: `${project_title || "A project"} — score: ${score}`,
      url: "/student/dashboard",
    });

    res.json({ success: true });
  } catch (err) {
    console.error("overrideExternalProjectGrade error:", err.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
