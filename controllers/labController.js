const pool = require("../models/db");
const { notifyUser } = require("../utils/notify");
const { getLevelForXp } = require("../utils/xpLevels");
const { getStudentStreak } = require("../services/streakService");
const { awardCoins } = require("../services/coinService");
const { awardXp, maybeUnlockNextLesson } = require("../services/lessonCompletionService");
const { askTutor } = require("../utils/ai");

/**
 * LAB TEMPLATES (your real system now)
 */
const LAB_TEMPLATES = {
  web: {
    title: "Web Development Lab",
    // pages: multiple HTML files sharing one project-wide css/js — matches
    // how a real multi-page site works (one stylesheet linked from every
    // page). webLab.js falls back to the old flat {html,css,js} shape when
    // loading a project saved before this existed.
    starter: {
      pages: [
        { name: "index.html", html: "<h1>Hello World</h1>\n<p>Start building your site!</p>" },
      ],
      css: "body {\n  font-family: sans-serif;\n}",
      js: "",
      activePage: "index.html",
    },
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

// Shared by getWebLab/getBlocklyLab — looks up the lesson_labs row for
// ?labId=, if present, so the editor can show an instructions banner and
// the client-side JS knows to scope its project to this lesson instead of
// the student's freeform one. Returns null (not an error) for a missing/
// invalid labId — the editor just falls back to freeform mode.
async function getLessonLabContext(labId) {
  if (!labId) return null;
  // module_id (via the lesson this lab belongs to) lets the editor build a
  // working "Back to Lesson" deep link (/student/dashboard?section=module&
  // moduleId=&openLesson=) instead of just the bare dashboard.
  const res = await pool.query(
    `SELECT ll.id, ll.lesson_id, ll.title, ll.description, ll.instructions, ll.lab_type, ll.points,
            l.module_id
     FROM lesson_labs ll
     JOIN lessons l ON l.id = ll.lesson_id
     WHERE ll.id = $1`,
    [labId]
  );
  return res.rows[0] || null;
}

exports.getWebLab = async (req, res) => {
  const studentId = req.session.user.id;

  const studentRes = await pool.query(
    "SELECT id, xp, coins FROM users2 WHERE id = $1",
    [studentId]
  );
  const student = studentRes.rows[0] || { xp: 0, coins: 0 };
  const levelInfo = getLevelForXp(student.xp);
  const streak = await getStudentStreak(studentId);
  const lessonLab = await getLessonLabContext(req.query.labId);

  res.render("labs/web/editor", {
    title: "Web Playground",
    users: req.session.user,
    student,
    levelInfo,
    streak,
    lessonLab,
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

  const lessonLab = await getLessonLabContext(req.query.labId);

  res.render("labs/blockly/editor", {
    title: "Blockly Playground",
    users: req.session.user,
    spriteCategories,
    backgroundCategories,
    lessonLab,
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
    const { labType, labId } = req.body;

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

    // Lesson-attached lab task — a separate project per (lab_id, student),
    // independent of the student's freeform playground project below (see
    // controllers/lessonLabController.js for how a lesson_labs row is
    // created; lesson_labs.starter_code isn't populated in v1, so the
    // student still starts from the normal LAB_TEMPLATES starter).
    if (labId) {
      let lessonProject = await pool.query(
        `SELECT * FROM lab_projects WHERE lab_id = $1 AND student_id = $2`,
        [labId, studentId]
      );
      if (lessonProject.rows.length > 0) {
        // Lets the editor show the right confirm message/attempt count
        // before the student even hits Submit (see MAX_LAB_SUBMISSIONS
        // below and public/labs/js/{web,blockly}Lab.js's submit handlers).
        const subCountRes = await pool.query(
          "SELECT COUNT(*) FROM lab_submissions WHERE project_id = $1",
          [lessonProject.rows[0].id]
        );
        return res.json({
          success: true,
          project: lessonProject.rows[0],
          submissionCount: parseInt(subCountRes.rows[0].count, 10),
        });
      }

      const lessonLabRes = await pool.query(
        `SELECT title FROM lesson_labs WHERE id = $1 AND lab_type = $2`,
        [labId, labType]
      );
      if (!lessonLabRes.rows[0]) {
        return res.status(404).json({ success: false, message: "Lab task not found" });
      }

      const newLessonProject = await pool.query(
        `INSERT INTO lab_projects
          (lab_type, lab_id, student_id, project_name, project_data)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [labType, labId, studentId, lessonLabRes.rows[0].title, template.starter]
      );
      return res.json({ success: true, project: newLessonProject.rows[0], submissionCount: 0 });
    }

    // check existing freeform project — lab_id IS NULL so a lesson-linked
    // project for the same lab type never gets returned here by mistake.
    let project = await pool.query(
      `SELECT * FROM lab_projects
       WHERE lab_type = $1 AND student_id = $2 AND lab_id IS NULL`,
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

// GET /labs/project/lesson/:labId — mirrors loadProject below, but keyed
// by lab_id instead of lab_type, for the editor's initial-load path when
// arriving via a direct lesson link with a project already in progress.
exports.loadLessonLabProject = async (req, res) => {
  try {
    const studentId = req.user.id;
    const { labId } = req.params;

    const project = await pool.query(
      `SELECT * FROM lab_projects WHERE lab_id = $1 AND student_id = $2`,
      [labId, studentId]
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
       WHERE lab_type = $1 AND student_id = $2 AND lab_id IS NULL`,
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

// Reward once per project, on the FIRST submission only — matches the
// isNewCompletion pattern already used for quiz XP (studentController.js)
// so resubmitting after edits doesn't grind XP/coins indefinitely.
const SUBMIT_XP_REWARD = 15;
const SUBMIT_COIN_REWARD = 10;

// A lesson-linked lab task can be AI-graded (gradeLessonLabSubmission)
// at most this many times — each pass costs an AI call, and a student
// polishing the same task shouldn't be able to grind that unbounded.
const MAX_LAB_SUBMISSIONS = 3;

exports.submitProject = async (req, res) => {
  try {
    const studentId = req.user.id;
    const { projectId } = req.body;

    const existing = await pool.query(
      `SELECT status, lab_type, lab_id, project_data FROM lab_projects WHERE id = $1 AND student_id = $2`,
      [projectId, studentId]
    );
    const project = existing.rows[0];
    if (!project) {
      return res.status(404).json({ success: false, message: "Project not found" });
    }

    const isFirstSubmission = project.status !== "submitted";

    // Cap only applies to lesson-linked labs — freeform playground
    // resubmissions never call the AI, so there's nothing to bound there.
    let submissionCount = 0;
    if (project.lab_id) {
      const priorSubsRes = await pool.query(
        "SELECT COUNT(*) FROM lab_submissions WHERE project_id = $1",
        [projectId]
      );
      submissionCount = parseInt(priorSubsRes.rows[0].count, 10);
      if (submissionCount >= MAX_LAB_SUBMISSIONS) {
        return res.status(403).json({
          success: false,
          maxSubmissionsReached: true,
          submissionCount,
          message: `You've reached the maximum of ${MAX_LAB_SUBMISSIONS} submissions for this task.`,
        });
      }
    }

    await pool.query(
      `UPDATE lab_projects
       SET status = 'submitted',
           updated_at = NOW()
       WHERE id = $1 AND student_id = $2`,
      [projectId, studentId],
    );

    let levelUp = false;
    let unlockResult = null;
    let labFeedback = null;
    let labXpGained = 0;

    // A lesson-attached lab (lab_id set — see controllers/lessonLabController.js)
    // pays its own XP (lesson_labs.points) on first submission, then checks
    // whether the lesson's OTHER required part (its quiz, if it has one) is
    // also done — the next lesson only unlocks once everything the lesson
    // actually has is finished, not on whichever part finishes first.
    if (project.lab_id) {
      const lessonLabRes = await pool.query(
        `SELECT lesson_id, points, title, description, instructions FROM lesson_labs WHERE id = $1`,
        [project.lab_id]
      );
      const lessonLab = lessonLabRes.rows[0];
      if (lessonLab) {
        if (isFirstSubmission) {
          const awarded = await awardXp(
            studentId,
            lessonLab.points ?? 10,
            `Completed lab task for lesson ${lessonLab.lesson_id}`
          );
          labXpGained = awarded.xpGained;
          levelUp = awarded.levelUp;
        }

        unlockResult = await maybeUnlockNextLesson(studentId, lessonLab.lesson_id);
        labFeedback = await gradeLessonLabSubmission(project, lessonLab, projectId, studentId);
        submissionCount += 1;
      }
    }

    if (isFirstSubmission) {
      if (!project.lab_id) {
        // Freeform playground project — untouched flat reward.
        const beforeRes = await pool.query("SELECT xp FROM users2 WHERE id = $1", [studentId]);
        const xpBefore = beforeRes.rows[0]?.xp || 0;
        const levelBefore = getLevelForXp(xpBefore);
        const levelAfter = getLevelForXp(xpBefore + SUBMIT_XP_REWARD);
        levelUp = levelAfter.level > levelBefore.level;

        const reason = `Submitted a ${project.lab_type} lab project`;
        await pool.query(
          "UPDATE users2 SET xp = COALESCE(xp,0) + $1, redeemable_xp = COALESCE(redeemable_xp,0) + $1 WHERE id = $2",
          [SUBMIT_XP_REWARD, studentId]
        );
        await pool.query(
          "INSERT INTO xp_history (user_id, xp, activity) VALUES ($1, $2, $3)",
          [studentId, SUBMIT_XP_REWARD, reason]
        );
      }

      // Coins stay a flat per-submission reward either way — lesson_labs
      // has no coins column of its own, and this matches what freeform
      // submissions already paid out.
      const reason = `Submitted a ${project.lab_type} lab project`;
      await awardCoins(studentId, SUBMIT_COIN_REWARD, reason);
    }

    res.json({
      success: true,
      isFirstSubmission,
      xpGained: project.lab_id ? labXpGained : (isFirstSubmission ? SUBMIT_XP_REWARD : 0),
      coinsGained: isFirstSubmission ? SUBMIT_COIN_REWARD : 0,
      levelUp,
      lessonComplete: unlockResult ? unlockResult.unlocked : undefined,
      nextLessonId: unlockResult?.nextLessonId,
      nextLessonModuleId: unlockResult?.nextLessonModuleId,
      nextModuleUnlocked: unlockResult?.nextModuleUnlocked,
      nextModuleId: unlockResult?.nextModuleId,
      pendingLab: unlockResult?.pendingLab,
      labFeedback,
      submissionCount,
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({ success: false });
  }
};

// AI-grades a lesson-attached lab submission against its instructions —
// mirrors controllers/studentController.js:submitAssignment's AI grading
// (same askTutor call, same try/catch-with-friendly-fallback shape), but
// with a simpler prompt: a lab task is one free-text instructions blob,
// not a structured criteria/rubric like an assignment. Only ever called
// for lesson-linked submissions (project.lab_id set) — freeform playground
// projects have no instructions to grade against.
async function gradeLessonLabSubmission(project, lessonLab, projectId, studentId) {
  const data = project.project_data || {};
  let submissionText = "";
  if (project.lab_type === "blockly") {
    submissionText = data.generatedCode?.trim()
      ? data.generatedCode
      : "(No blocks were placed — the workspace is empty.)";
  } else {
    submissionText = (data.pages || [])
      .map((p) => `--- ${p.name} ---\n${p.html || ""}`)
      .join("\n\n");
    submissionText += `\n\n--- style.css ---\n${data.css || ""}\n\n--- script.js ---\n${data.js || ""}`;
  }

  const prompt = `
You are a friendly AI tutor grading a young student's coding lab task. Be encouraging and generous — give credit for genuine effort and partial progress, don't be harsh about style, and assume the student is still learning.

--- TASK: ${lessonLab.title} ---
${lessonLab.description || ""}
${lessonLab.instructions || "(No detailed instructions were provided — grade based on the title/description alone.)"}

--- STUDENT'S ${project.lab_type.toUpperCase()} SUBMISSION ---
${submissionText}

--- YOUR JOB ---
1. Decide how well the submission accomplishes exactly what the TASK above asked for — nothing more, nothing less. Judge it strictly against those instructions, not against a more advanced or more polished version you can imagine.
2. Give a score from 0-100. If the submission fully and correctly does what the instructions asked, that is a complete success — score it 95-100. Do NOT hold back points, and do NOT invent extra requirements, features, or polish that the instructions never mentioned, just to have something to critique.
3. Write short feedback (2-4 sentences).
   - If the task is fully and correctly done: say so plainly and confidently. Do not tack on a suggestion, an idea for "next time", or anything to add — a fully correct submission doesn't need one, and inventing one is misleading.
   - Only if something in the actual instructions is missing, wrong, or incomplete: explain what, and suggest ONE concrete fix for THAT specific gap (never a generic "you could also add..." for something outside the instructions).

Return ONLY valid JSON, matching this shape (the values below are just to show the format, not a suggested score):
{ "score": <number 0-100>, "feedback": "<string>" }
`;

  let score = null;
  let feedback = "Your work was submitted, but detailed feedback wasn't generated.";

  try {
    const raw = await askTutor({ question: prompt });
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (typeof parsed.score === "number") score = Math.max(0, Math.min(100, Math.round(parsed.score)));
      if (parsed.feedback) feedback = parsed.feedback;
    }
  } catch (err) {
    console.error("Lab AI grading failed:", err.message);
    feedback = "AI grading is unavailable right now — your work was submitted successfully.";
  }

  // A new row every submission (not an update) — keeps feedback history
  // across resubmissions, same as quiz_submissions allowing multiple
  // attempts. graded_by stays NULL: AI-graded, not yet human-reviewed —
  // same tri-state already used by assignment_submissions.graded_by.
  await pool.query(
    `INSERT INTO lab_submissions (project_id, submitted_by, score, feedback) VALUES ($1, $2, $3, $4)`,
    [projectId, studentId, score, feedback]
  );

  notifyUser(studentId, {
    type: "grade_posted",
    title: "Your lab task was graded",
    message: `${lessonLab.title} — ${score !== null ? `score: ${score}/100` : "graded"}`,
  }).catch((err) => console.error("Lab grade notification failed:", err.message));

  return { score, feedback };
}

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
