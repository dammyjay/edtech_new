// The /admin/archive screen — where everything "Delete" now archives
// first (see services/archiveService.js) lands for review: restore it,
// or take the separate, explicit "delete permanently" action. Admin-only,
// gated the same way as every other route in routes/adminRoutes.js.
const archiveService = require("../services/archiveService");
const { logActivityForUser } = require("../utils/activityLogger");

const VALID_ENTITIES = Object.keys(archiveService.ENTITY_CONFIG);

function isValidEntity(entity) {
  return VALID_ENTITIES.includes(entity);
}

// GET /admin/archive — lists archived rows for all five entity types so
// the whole archive is visible on one page (tabbed client-side); an
// optional ?search= narrows every tab's list, ?role= narrows the users tab.
exports.getArchivePage = async (req, res) => {
  const search = (req.query.search || "").trim() || null;
  const role = (req.query.role || "").trim() || null;

  try {
    const [users, schools, courses, modules, lessons] = await Promise.all([
      archiveService.listArchived("user", { search, role }),
      archiveService.listArchived("school", { search }),
      archiveService.listArchived("course", { search }),
      archiveService.listArchived("module", { search }),
      archiveService.listArchived("lesson", { search }),
    ]);

    res.render("admin/archive", {
      users,
      schools,
      courses,
      modules,
      lessons,
      search: search || "",
      role: role || "",
    });
  } catch (err) {
    console.error("getArchivePage error:", err.message);
    res.status(500).send("Server error loading the archive.");
  }
};

// A reusable "archive this record" handler for entities that don't
// already have their own dedicated delete-turned-archive controller
// action (schools — there was no delete route for schools before this).
exports.archiveEntity = (entity) => async (req, res) => {
  if (!isValidEntity(entity)) return res.status(400).json({ success: false, message: "Unknown entity." });

  try {
    const byUserId = req.session?.user?.id || null;
    const item = await archiveService.archive(entity, req.params.id, byUserId);
    if (!item) return res.status(404).json({ success: false, message: "Not found or already archived." });

    await logActivityForUser(req, `${entity[0].toUpperCase()}${entity.slice(1)} archived`, `id: ${req.params.id}`);

    if (req.headers.accept?.includes("application/json") || req.xhr) {
      return res.json({ success: true, item });
    }
    res.redirect("back");
  } catch (err) {
    console.error(`archiveEntity(${entity}) error:`, err.message);
    res.status(500).json({ success: false, message: "Server error." });
  }
};

// POST /admin/archive/:entity/:id/restore
exports.restoreEntity = async (req, res) => {
  const { entity, id } = req.params;
  if (!isValidEntity(entity)) return res.status(400).json({ success: false, message: "Unknown entity." });

  try {
    const item = await archiveService.restore(entity, id);
    if (!item) return res.status(404).json({ success: false, message: "Not found." });

    await logActivityForUser(req, `${entity[0].toUpperCase()}${entity.slice(1)} restored`, `id: ${id}`);
    res.json({ success: true, item });
  } catch (err) {
    console.error(`restoreEntity(${entity}) error:`, err.message);
    res.status(500).json({ success: false, message: "Server error." });
  }
};

// POST /admin/archive/:entity/:id/delete-permanent — the real, cascading
// delete. Only ever acts on a row that's actually archived, so this can
// never become a back-door for skipping the archive step.
exports.deleteEntityPermanently = async (req, res) => {
  const { entity, id } = req.params;
  if (!isValidEntity(entity)) return res.status(400).json({ success: false, message: "Unknown entity." });

  try {
    const counts = await archiveService.getDependencyCounts(entity, id);
    const ok = await archiveService.permanentlyDelete(entity, id);
    if (!ok) return res.status(404).json({ success: false, message: "Not found." });

    await logActivityForUser(
      req,
      `${entity[0].toUpperCase()}${entity.slice(1)} permanently deleted`,
      `id: ${id}, dependents: ${JSON.stringify(counts)}`
    );
    res.json({ success: true });
  } catch (err) {
    console.error(`deleteEntityPermanently(${entity}) error:`, err.message);
    res.status(500).json({ success: false, message: "Server error." });
  }
};

// GET /admin/archive/:entity/:id/impact — dependency counts, fetched by
// the confirm dialog before a permanent delete.
exports.getImpact = async (req, res) => {
  const { entity, id } = req.params;
  if (!isValidEntity(entity)) return res.status(400).json({ success: false, message: "Unknown entity." });

  try {
    const counts = await archiveService.getDependencyCounts(entity, id);
    res.json({ success: true, counts });
  } catch (err) {
    console.error(`getImpact(${entity}) error:`, err.message);
    res.status(500).json({ success: false, message: "Server error." });
  }
};
