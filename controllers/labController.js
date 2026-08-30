const pool = require("../models/db");
const { notifyUser } = require("../utils/notify");
const { getLevelForXp } = require("../utils/xpLevels");
const { getStudentStreak } = require("../services/streakService");

/**
 * LAB TEMPLATES (your real system now)
 */
const LAB_TEMPLATES = {
  web: {
    title: "Web Development Lab",
    starter: { html: "<h1>Hello World</h1>", css: "", js: "" },
  },
  blockly: {
    title: "Blockly Lab",
    starter: {
      workspace: "",
      generatedCode: "",
    },
  },
  arduino: {
    title: "Arduino Lab",
    starter: {},
  },
  appinventor: {
    title: "App Inventor Lab",
    starter: {},
  },
  ai: {
    title: "AI Lab",
    starter: {},
  },
};

exports.getLabDashboard = async (req, res) => {
  try {
    const studentId = req.session.user.id;

    const studentRes = await pool.query(
      "SELECT id, fullname, xp, coins, profile_picture FROM users2 WHERE id = $1",
      [studentId]
    );
    const student = studentRes.rows[0] || { xp: 0, coins: 0 };
    const levelInfo = getLevelForXp(student.xp);
    const streak = await getStudentStreak(studentId);

    const projectsRes = await pool.query(
      `SELECT lab_type, COUNT(*) AS count, MAX(updated_at) AS last_updated
       FROM lab_projects WHERE student_id = $1 GROUP BY lab_type`,
      [studentId]
    );
    const projectsByType = {};
    projectsRes.rows.forEach((r) => {
      projectsByType[r.lab_type] = {
        count: parseInt(r.count, 10),
        lastUpdated: r.last_updated,
      };
    });

    res.render("labs/dashboard", {
      title: "Learning Labs",
      users: req.session.user,
      student,
      levelInfo,
      streak,
      projectsByType,
    });
  } catch (err) {
    console.error("getLabDashboard error:", err.message);
    res.status(500).send("Server error");
  }
};

exports.getWebLab = async (req, res) => {
  res.render("labs/web/editor", {
    title: "Web Playground",
    layout: "layout",
  });
};

exports.getBlocklyLab = async (req, res) => {
  const categoriesRes = await pool.query(
    `SELECT * FROM lab_asset_categories WHERE lab_type = 'blockly' ORDER BY name ASC`
  );
  const assetsRes = await pool.query(
    `SELECT * FROM lab_assets WHERE lab_type = 'blockly' ORDER BY name ASC`
  );

  const spriteCategories = categoriesRes.rows
    .filter((c) => c.asset_type === "sprite")
    .map((c) => ({
      ...c,
      assets: assetsRes.rows.filter((a) => a.asset_type === "sprite" && a.category_id === c.id),
    }));

  const backgroundCategories = categoriesRes.rows
    .filter((c) => c.asset_type === "background")
    .map((c) => ({
      ...c,
      assets: assetsRes.rows.filter((a) => a.asset_type === "background" && a.category_id === c.id),
    }));

  res.render("labs/blockly/editor", {
    title: "Blockly Playground",
    users: req.session.user,
    spriteCategories,
    backgroundCategories,
  });
};

exports.getArduinoLab = async (req, res) => {
  res.render("labs/arduino/editor", {
    title: "Arduino Playground",
    layout: "layout",
  });
};

exports.getAppInventorLab = async (req, res) => {
  res.render("labs/appinventor/editor", {
    title: "App Inventor Playground",
  });
};

exports.getAiLab = async (req, res) => {
  res.render("labs/ai/editor", {
    title: "AI Playground",
  });
};


exports.initProject = async (req, res) => {
  try {
    const studentId = req.user.id;
    const { labType } = req.body;

    if (!studentId) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    const template = LAB_TEMPLATES[labType];

    if (!template) {
      return res.status(400).json({
        success: false,
        message: "Invalid lab type",
      });
    }

    // check existing project
    let project = await pool.query(
      `SELECT * FROM lab_projects 
       WHERE lab_type = $1 AND student_id = $2`,
      [labType, studentId],
    );

    if (project.rows.length > 0) {
      return res.json({
        success: true,
        project: project.rows[0],
      });
    }

    // create new project
    const newProject = await pool.query(
      `INSERT INTO lab_projects 
        (lab_type, student_id, project_name, project_data)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [labType, studentId, template.title, template.starter],
    );

    return res.json({
      success: true,
      project: newProject.rows[0],
    });

  } catch (err) {
    console.log("INIT ERROR:", err);
    res.status(500).json({ success: false });
  }
};

// exports.saveProject = async (req, res) => {
//   try {
//     const studentId = req.user.id;
//     const { projectId, html, css, js } = req.body;

//     await pool.query(
//       `UPDATE lab_projects
//        SET project_data = $1,
//            updated_at = NOW()
//        WHERE id = $2 AND student_id = $3`,
//       [{ html, css, js }, projectId, studentId],
//     );

//     res.json({ success: true });
//   } catch (err) {
//     console.log("SAVE ERROR:", err);
//     res.status(500).json({ success: false });
//   }
// };
exports.saveProject = async (req, res) => {
  try {
    const studentId = req.user.id;

    const { projectId, projectData } = req.body;

    await pool.query(
      `
      UPDATE lab_projects
      SET project_data = $1,
          updated_at = NOW()
      WHERE id = $2
      AND student_id = $3
      `,
      [projectData, projectId, studentId],
    );

    res.json({
      success: true,
    });
  } catch (err) {
    console.log("SAVE ERROR:", err);

    res.status(500).json({
      success: false,
    });
  }
};


exports.loadProject = async (req, res) => {
  try {
    const studentId = req.user.id;
    const { labType } = req.params;

    const project = await pool.query(
      `SELECT * FROM lab_projects 
       WHERE lab_type = $1 AND student_id = $2`,
      [labType, studentId],
    );

    res.json({
      success: true,
      project: project.rows[0] || null,
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({ success: false });
  }
};

exports.submitProject = async (req, res) => {
  try {
    const studentId = req.user.id;
    const { projectId } = req.body;

    await pool.query(
      `UPDATE lab_projects
       SET status = 'submitted',
           updated_at = NOW()
       WHERE id = $1 AND student_id = $2`,
      [projectId, studentId],
    );

    res.json({ success: true });
  } catch (err) {
    console.log(err);
    res.status(500).json({ success: false });
  }
};

/**
 * PEER REVIEW ON PROJECTS
 */
const REVIEW_BANNED_WORDS = ["stupid", "idiot", "hate", "fool", "nonsense"];

exports.getReviewableProjects = async (req, res) => {
  try {
    const studentId = req.user.id;

    const classroomRes = await pool.query(
      `SELECT classroom_id FROM user_school
       WHERE user_id = $1 AND role_in_school = 'student' AND approved = true
       LIMIT 1`,
      [studentId]
    );
    const classroomId = classroomRes.rows[0]?.classroom_id;
    if (!classroomId) {
      return res.json({ success: true, projects: [] });
    }

    const projectsRes = await pool.query(
      `SELECT lp.id, lp.lab_type, lp.project_name, lp.updated_at,
              u.id AS student_id, u.fullname AS student_name,
              EXISTS(SELECT 1 FROM project_reviews pr WHERE pr.project_id = lp.id AND pr.reviewer_id = $2) AS already_reviewed
       FROM lab_projects lp
       JOIN users2 u ON u.id = lp.student_id
       JOIN user_school us ON us.user_id = lp.student_id
         AND us.classroom_id = $1 AND us.role_in_school = 'student' AND us.approved = true
       WHERE lp.status = 'submitted' AND lp.student_id != $2
       ORDER BY lp.updated_at DESC`,
      [classroomId, studentId]
    );

    res.json({ success: true, projects: projectsRes.rows });
  } catch (err) {
    console.error("getReviewableProjects error:", err);
    res.status(500).json({ success: false });
  }
};

exports.submitReview = async (req, res) => {
  try {
    const reviewerId = req.user.id;
    const { projectId, rating, comment } = req.body;

    const numericRating = parseInt(rating, 10);
    if (!projectId || !numericRating || numericRating < 1 || numericRating > 5) {
      return res.status(400).json({ success: false, message: "Invalid input" });
    }

    if (comment) {
      const cleanComment = comment.toLowerCase();
      for (const word of REVIEW_BANNED_WORDS) {
        if (cleanComment.includes(word)) {
          return res.json({ success: false, message: "Please keep your comment respectful" });
        }
      }
    }

    const projectRes = await pool.query(
      `SELECT id, student_id, project_name FROM lab_projects WHERE id = $1 AND status = 'submitted'`,
      [projectId]
    );
    const project = projectRes.rows[0];
    if (!project) {
      return res.status(404).json({ success: false, message: "Project not found" });
    }
    if (project.student_id === reviewerId) {
      return res.status(400).json({ success: false, message: "You can't review your own project" });
    }

    const classmateRes = await pool.query(
      `SELECT 1 FROM user_school a
       JOIN user_school b ON a.classroom_id = b.classroom_id
       WHERE a.user_id = $1 AND a.role_in_school = 'student' AND a.approved = true
         AND b.user_id = $2 AND b.role_in_school = 'student' AND b.approved = true`,
      [reviewerId, project.student_id]
    );
    if (classmateRes.rows.length === 0) {
      return res.status(403).json({ success: false, message: "Not authorized to review this project" });
    }

    await pool.query(
      `INSERT INTO project_reviews (project_id, reviewer_id, rating, comment)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (project_id, reviewer_id) DO UPDATE
         SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, created_at = NOW()`,
      [projectId, reviewerId, numericRating, comment || null]
    );

    await notifyUser(project.student_id, {
      type: "project_review",
      title: "You got a new project review!",
      message: `Someone reviewed "${project.project_name}" — ${numericRating}/5 stars.`,
      url: "/student/dashboard",
    });

    res.json({ success: true });
  } catch (err) {
    console.error("submitReview error:", err);
    res.status(500).json({ success: false });
  }
};

exports.getMyProjectReviews = async (req, res) => {
  try {
    const studentId = req.user.id;

    const reviewsRes = await pool.query(
      `SELECT pr.id, pr.rating, pr.comment, pr.created_at,
              lp.project_name, lp.lab_type,
              u.fullname AS reviewer_name
       FROM project_reviews pr
       JOIN lab_projects lp ON lp.id = pr.project_id
       JOIN users2 u ON u.id = pr.reviewer_id
       WHERE lp.student_id = $1
       ORDER BY pr.created_at DESC`,
      [studentId]
    );

    res.json({ success: true, reviews: reviewsRes.rows });
  } catch (err) {
    console.error("getMyProjectReviews error:", err);
    res.status(500).json({ success: false });
  }
};
