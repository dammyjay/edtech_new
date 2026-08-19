// controllers/reportsAdminController.js
//
// Admin endpoints for on-demand platform analytics reports and pitch
// decks. Kept out of the already-13k-line adminController.js. Follows
// the same inline session-guard convention used throughout adminController.js
// (there is no working ensureAdmin middleware in this codebase).

const pool = require("../models/db");
const { generatePlatformReport } = require("../services/reportOrchestratorService");
const {
  generatePitchDeck,
  generateProposalPreview,
  buildProposalDeckFromContent,
  getGalleryImages,
  getCurriculumPickerAssets,
} = require("../services/pitchDeckGeneratorService");
const { TEMPLATE_OPTIONS } = require("../services/pitchDecks/deckTheme");
const sendEmailWithAttachment = require("../utils/sendEmailWithAttachment");
const { sendEmailWithAttachments } = sendEmailWithAttachment;

const VALID_AUDIENCES = ["schools", "grants", "investors", "partners"];

function isAdminSession(req) {
  return req.session.user && req.session.user.role === "admin";
}

const VALID_FORMATS = ["pdf", "excel", "pptx"];

function parseFormats(input) {
  const requested = Array.isArray(input) ? input : String(input || "").split(",");
  const formats = requested.map((f) => String(f).trim().toLowerCase()).filter((f) => VALID_FORMATS.includes(f));
  return formats.length ? formats : VALID_FORMATS;
}

exports.generatePlatformReportFiles = async (req, res) => {
  if (!isAdminSession(req)) {
    return res.status(403).json({ success: false, message: "Admin access required" });
  }

  try {
    const { scope, year, month, formats } = req.body;

    const result = await generatePlatformReport({
      scope,
      year: year ? Number(year) : undefined,
      month: month ? Number(month) : undefined,
      formats: parseFormats(formats),
      triggeredBy: "admin",
      triggeredByUserId: req.session.user.id,
    });

    res.json({
      success: true,
      periodLabel: result.periodLabel,
      files: result.files.map((f) => ({
        format: f.format,
        filename: f.filename,
        mimeType: f.mimeType,
        base64: Buffer.from(f.buffer).toString("base64"),
      })),
    });
  } catch (err) {
    console.error("generatePlatformReportFiles error:", err);
    res.status(500).json({ success: false, message: "Failed to generate report" });
  }
};

exports.sendPlatformReportNow = async (req, res) => {
  if (!isAdminSession(req)) {
    return res.status(403).json({ success: false, message: "Admin access required" });
  }

  try {
    const { scope, year, month, formats } = req.body;

    const result = await generatePlatformReport({
      scope,
      year: year ? Number(year) : undefined,
      month: month ? Number(month) : undefined,
      formats: parseFormats(formats),
      triggeredBy: "admin",
      triggeredByUserId: req.session.user.id,
    });

    const to = req.session.user.email;
    const subject = `Platform Analytics Report — ${result.periodLabel}`;
    const html = `<p>Hi ${req.session.user.fullname || "Admin"},</p><p>Attached is the platform analytics report for <strong>${result.periodLabel}</strong>.</p>`;

    await sendEmailWithAttachments(
      to,
      subject,
      html,
      result.files.map((f) => ({ filename: f.filename, buffer: f.buffer })),
      ["jaykirchtechhub@gmail.com"]
    );

    res.json({ success: true, periodLabel: result.periodLabel, sentTo: to });
  } catch (err) {
    console.error("sendPlatformReportNow error:", err);
    res.status(500).json({ success: false, message: "Failed to generate/send report" });
  }
};

exports.downloadPitchDeck = async (req, res) => {
  if (!isAdminSession(req)) {
    return res.status(403).json({ success: false, message: "Admin access required" });
  }

  const audience = String(req.query.audience || "").toLowerCase();
  if (!VALID_AUDIENCES.includes(audience)) {
    return res.status(400).json({ success: false, message: "Invalid audience" });
  }

  try {
    const deck = await generatePitchDeck(audience, { triggeredByUserId: req.session.user.id });
    res.setHeader("Content-Type", deck.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename=${deck.filename}`);
    res.send(deck.buffer);
  } catch (err) {
    console.error("downloadPitchDeck error:", err);
    res.status(500).json({ success: false, message: "Failed to generate pitch deck" });
  }
};

exports.previewProposal = async (req, res) => {
  if (!isAdminSession(req)) {
    return res.status(403).json({ success: false, message: "Admin access required" });
  }

  try {
    const { recipientName, focusNotes, audience } = req.body;
    const normalizedAudience = String(audience || "schools").toLowerCase();
    if (!VALID_AUDIENCES.includes(normalizedAudience)) {
      return res.status(400).json({ success: false, message: "Invalid audience" });
    }

    const preview = await generateProposalPreview({
      audience: normalizedAudience,
      recipientName: String(recipientName || "").trim(),
      focusNotes: String(focusNotes || "").trim(),
      triggeredByUserId: req.session.user.id,
    });
    res.json({ success: true, content: preview, templateOptions: TEMPLATE_OPTIONS });
  } catch (err) {
    console.error("previewProposal error:", err);
    res.status(500).json({ success: false, message: "Failed to generate proposal preview" });
  }
};

exports.downloadProposal = async (req, res) => {
  if (!isAdminSession(req)) {
    return res.status(403).json({ success: false, message: "Admin access required" });
  }

  try {
    const content = req.body.content;
    if (!content || typeof content !== "object") {
      return res.status(400).json({ success: false, message: "Missing proposal content" });
    }

    const deck = await buildProposalDeckFromContent(content, { triggeredByUserId: req.session.user.id });
    res.setHeader("Content-Type", deck.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename=${deck.filename}`);
    res.send(deck.buffer);
  } catch (err) {
    console.error("downloadProposal error:", err);
    res.status(500).json({ success: false, message: "Failed to generate proposal deck" });
  }
};

exports.getProposalGalleryImages = async (req, res) => {
  if (!isAdminSession(req)) {
    return res.status(403).json({ success: false, message: "Admin access required" });
  }

  try {
    const images = await getGalleryImages();
    res.json({ success: true, images });
  } catch (err) {
    console.error("getProposalGalleryImages error:", err);
    res.status(500).json({ success: false, message: "Failed to load gallery images" });
  }
};

exports.getProposalCurriculumAssets = async (req, res) => {
  if (!isAdminSession(req)) {
    return res.status(403).json({ success: false, message: "Admin access required" });
  }

  try {
    const assets = await getCurriculumPickerAssets();
    res.json({ success: true, ...assets });
  } catch (err) {
    console.error("getProposalCurriculumAssets error:", err);
    res.status(500).json({ success: false, message: "Failed to load curriculum assets" });
  }
};

exports.getReportHistory = async (req, res) => {
  if (!isAdminSession(req)) {
    return res.status(403).json({ success: false, message: "Admin access required" });
  }

  try {
    const result = await pool.query(`
      SELECT id, report_type, scope, period_label, formats_generated, audience,
             triggered_by, status, error_message, created_at
      FROM report_generation_log
      ORDER BY created_at DESC
      LIMIT 30
    `);
    res.json({ success: true, history: result.rows });
  } catch (err) {
    console.error("getReportHistory error:", err);
    res.status(500).json({ success: false, message: "Failed to load report history" });
  }
};
