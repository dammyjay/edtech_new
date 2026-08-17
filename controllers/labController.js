const pool = require("../models/db");

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
  res.render("labs/dashboard", {
    title: "Learning Labs",
    layout: "layout",
  });
};

exports.getWebLab = async (req, res) => {
  res.render("labs/web/editor", {
    title: "Web Playground",
    layout: "layout",
  });
};

exports.getBlocklyLab = async (req, res) => {
  res.render("labs/blockly/editor", {
    title: "Blockly Playground",
    layout: "layout",
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
