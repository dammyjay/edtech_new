// controllers/adminReminderController.js
//
// Admin-facing CRUD for general school reminders (views/admin/adminReminders.ejs)
// — the business logic itself lives in services/adminReminderService.js.
const adminReminderService = require("../services/adminReminderService");

exports.adminPage = (req, res) => {
  res.render("admin/adminReminders", { info: req.user });
};

exports.listReminders = async (req, res) => {
  try {
    const reminders = await adminReminderService.listReminders();
    res.json({ reminders });
  } catch (err) {
    console.error("listReminders error:", err.message);
    res.status(500).json({ error: "Failed to load reminders." });
  }
};

exports.getReminderDetail = async (req, res) => {
  try {
    const detail = await adminReminderService.getReminderDetail(req.params.id);
    if (!detail) return res.status(404).json({ error: "Reminder not found." });
    res.json(detail);
  } catch (err) {
    console.error("getReminderDetail error:", err.message);
    res.status(500).json({ error: "Failed to load reminder." });
  }
};

exports.createReminder = async (req, res) => {
  try {
    const { title, message, dueDate, resendIntervalDays, schoolIds } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ error: "Title is required." });
    if (!message || !message.trim()) return res.status(400).json({ error: "Message is required." });
    if (!dueDate) return res.status(400).json({ error: "Due date is required." });
    if (!Array.isArray(schoolIds) || schoolIds.length === 0) {
      return res.status(400).json({ error: "Select at least one school." });
    }

    const reminder = await adminReminderService.createReminder({
      title: title.trim(),
      message: message.trim(),
      dueDate,
      resendIntervalDays: Math.max(1, parseInt(resendIntervalDays, 10) || 2),
      createdBy: req.user.id,
      schoolIds: schoolIds.map((id) => parseInt(id, 10)).filter(Boolean),
    });

    res.json({ ok: true, reminder });
  } catch (err) {
    console.error("createReminder error:", err.message);
    res.status(500).json({ error: "Failed to create reminder." });
  }
};

exports.closeReminder = async (req, res) => {
  try {
    await adminReminderService.closeReminder(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error("closeReminder error:", err.message);
    res.status(500).json({ error: "Failed to close reminder." });
  }
};

exports.markUnderstoodManually = async (req, res) => {
  try {
    await adminReminderService.markUnderstoodManually(req.params.targetId);
    res.json({ ok: true });
  } catch (err) {
    console.error("markUnderstoodManually error:", err.message);
    res.status(500).json({ error: "Failed to update status." });
  }
};
