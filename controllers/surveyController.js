// controllers/surveyController.js
//
// Admin management of the global module-feedback question bank, plus the
// two student-facing endpoints the compulsory survey modal uses (see
// services/surveyService.js for the gating logic itself).

const pool = require("../models/db");
const { getPendingFeedbackModules, getActiveQuestions, submitSurveyAnswers } = require("../services/surveyService");

// ===== Admin =====

exports.adminPage = async (req, res) => {
  try {
    const infoResult = await pool.query("SELECT * FROM company_info ORDER BY id DESC LIMIT 1");
    res.render("admin/moduleSurvey", {
      info: infoResult.rows[0] || {},
      role: "admin",
      title: "Module Feedback Survey",
    });
  } catch (err) {
    console.error("Survey admin page error:", err.message);
    res.status(500).send("Server error");
  }
};

exports.listQuestions = async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, question_text, question_type, options, category, order_number, is_active
       FROM survey_questions ORDER BY order_number ASC, id ASC`
    );
    res.json({ ok: true, questions: r.rows });
  } catch (err) {
    console.error("List survey questions error:", err.message);
    res.status(500).json({ error: "Failed to load questions." });
  }
};

exports.createQuestion = async (req, res) => {
  try {
    const { question_text, question_type, options, category } = req.body;
    if (!question_text || !question_text.trim()) {
      return res.status(400).json({ error: "Question text is required." });
    }
    const type = question_type === "text" ? "text" : "multiple_choice";
    let optionsJson = null;
    if (type === "multiple_choice") {
      const cleanOptions = Array.isArray(options) ? options.map((o) => String(o).trim()).filter(Boolean) : [];
      if (cleanOptions.length < 2) {
        return res.status(400).json({ error: "Multiple-choice questions need at least 2 options." });
      }
      optionsJson = JSON.stringify(cleanOptions);
    }
    const orderRes = await pool.query(`SELECT COALESCE(MAX(order_number), 0) + 1 AS next FROM survey_questions`);
    const result = await pool.query(
      `INSERT INTO survey_questions (question_text, question_type, options, category, order_number)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [question_text.trim(), type, optionsJson, category || null, orderRes.rows[0].next]
    );
    res.json({ ok: true, id: result.rows[0].id });
  } catch (err) {
    console.error("Create survey question error:", err.message);
    res.status(500).json({ error: "Failed to add question." });
  }
};

exports.updateQuestion = async (req, res) => {
  try {
    const { id } = req.params;
    const { question_text, question_type, options, category, is_active } = req.body;
    if (!question_text || !question_text.trim()) {
      return res.status(400).json({ error: "Question text is required." });
    }
    const type = question_type === "text" ? "text" : "multiple_choice";
    let optionsJson = null;
    if (type === "multiple_choice") {
      const cleanOptions = Array.isArray(options) ? options.map((o) => String(o).trim()).filter(Boolean) : [];
      if (cleanOptions.length < 2) {
        return res.status(400).json({ error: "Multiple-choice questions need at least 2 options." });
      }
      optionsJson = JSON.stringify(cleanOptions);
    }
    const result = await pool.query(
      `UPDATE survey_questions
       SET question_text = $1, question_type = $2, options = $3, category = $4,
           is_active = $5, updated_at = NOW()
       WHERE id = $6 RETURNING id`,
      [question_text.trim(), type, optionsJson, category || null, is_active !== false, id]
    );
    if (!result.rowCount) return res.status(404).json({ error: "Question not found." });
    res.json({ ok: true });
  } catch (err) {
    console.error("Update survey question error:", err.message);
    res.status(500).json({ error: "Failed to update question." });
  }
};

exports.deleteQuestion = async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(`DELETE FROM survey_questions WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error("Delete survey question error:", err.message);
    res.status(500).json({ error: "Failed to delete question." });
  }
};

// Aggregate counts per option for multiple-choice questions, plus the
// raw recent free-text answers for 'text' questions — enough for admin
// to actually see how students feel without building a full BI page.
exports.getResponses = async (req, res) => {
  try {
    // Counts distinct submissions that actually HAVE answers, not every
    // survey_submissions row — a backlog catch-up (services/surveyService.js)
    // inserts one bare exemption row per owed module but only attaches
    // real answers to one of them, so COUNT(*) on the table itself would
    // overcount how many times a student actually sat through the survey.
    const totalRes = await pool.query(`SELECT COUNT(DISTINCT submission_id) FROM survey_answers`);
    const totalSubmissions = parseInt(totalRes.rows[0].count, 10);

    const questionsRes = await pool.query(
      `SELECT id, question_text, question_type, options, order_number
       FROM survey_questions ORDER BY order_number ASC, id ASC`
    );

    const tallyRes = await pool.query(
      `SELECT question_id, answer_text, COUNT(*) AS cnt
       FROM survey_answers
       GROUP BY question_id, answer_text`
    );
    const tallyByQuestion = {};
    for (const row of tallyRes.rows) {
      if (!tallyByQuestion[row.question_id]) tallyByQuestion[row.question_id] = [];
      tallyByQuestion[row.question_id].push({ answer: row.answer_text, count: parseInt(row.cnt, 10) });
    }

    const textAnswersRes = await pool.query(
      `SELECT sa.question_id, sa.answer_text, s.fullname AS student_name, m.title AS module_title, ss.submitted_at
       FROM survey_answers sa
       JOIN survey_questions q ON q.id = sa.question_id
       JOIN survey_submissions ss ON ss.id = sa.submission_id
       JOIN users2 s ON s.id = ss.student_id
       JOIN modules m ON m.id = ss.module_id
       WHERE q.question_type = 'text'
       ORDER BY ss.submitted_at DESC
       LIMIT 200`
    );
    const textAnswersByQuestion = {};
    for (const row of textAnswersRes.rows) {
      if (!textAnswersByQuestion[row.question_id]) textAnswersByQuestion[row.question_id] = [];
      textAnswersByQuestion[row.question_id].push({
        answer: row.answer_text,
        studentName: row.student_name,
        moduleTitle: row.module_title,
        submittedAt: row.submitted_at,
      });
    }

    const questions = questionsRes.rows.map((q) => ({
      id: q.id,
      questionText: q.question_text,
      questionType: q.question_type,
      options: q.options || [],
      tally: tallyByQuestion[q.id] || [],
      textAnswers: textAnswersByQuestion[q.id] || [],
    }));

    res.json({ ok: true, totalSubmissions, questions });
  } catch (err) {
    console.error("Survey responses error:", err.message);
    res.status(500).json({ error: "Failed to load responses." });
  }
};

// ===== Student =====

exports.getActiveSurveyForStudent = async (req, res) => {
  try {
    const studentId = req.session?.student?.id || req.user?.id;
    const pendingModules = await getPendingFeedbackModules(studentId);
    if (!pendingModules.length) {
      return res.json({ ok: true, pending: false });
    }
    const questions = await getActiveQuestions();
    res.json({
      ok: true,
      pending: true,
      module: pendingModules[0],
      backlogCount: pendingModules.length,
      questions,
    });
  } catch (err) {
    console.error("Get active survey error:", err.message);
    res.status(500).json({ error: "Failed to load survey." });
  }
};

exports.submitSurvey = async (req, res) => {
  try {
    const studentId = req.session?.student?.id || req.user?.id;
    const { answers } = req.body;
    if (!answers || typeof answers !== "object") {
      return res.status(400).json({ success: false, message: "Missing answers." });
    }
    const result = await submitSurveyAnswers(studentId, answers);
    res.json(result);
  } catch (err) {
    console.error("Submit survey error:", err.message);
    res.status(500).json({ success: false, message: "Failed to submit feedback." });
  }
};
