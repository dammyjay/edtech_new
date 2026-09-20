const express = require("express");
const router = express.Router();
const controller = require("../controllers/adminDbController");
const { ensureAdmin } = require("../middlewares/auth");
const { ensureCsrfToken, verifyCsrfToken } = require("../middlewares/csrf");

// Router-level guard restored as defense-in-depth. Every handler in
// adminDbController.js already re-checks req.session.user.role === "admin"
// itself (so this was never actually reachable unauthenticated), but this
// mounts as its own router at /admin/db — separate from routes/adminRoutes.js
// and not covered by that file's own gate — so a future route added here
// without copy-pasting the in-body check would otherwise be wide open by
// default. This panel has full CRUD over every table in the app, including
// users2, so it gets its own explicit gate rather than relying solely on
// each handler remembering to check.
router.use(ensureAdmin);

// ensureCsrfToken makes res.locals.csrfToken available to every view this
// router renders; verifyCsrfToken rejects any POST/PUT/PATCH/DELETE below
// without a valid token (GET passes through untouched) — matches the
// blanket pattern now also used in routes/adminRoutes.js and
// routes/instructor.js, so a future route added here is covered by
// default instead of needing the check copy-pasted onto it.
router.use(ensureCsrfToken, verifyCsrfToken);

router.get("/", controller.showTables);
router.get("/:table", controller.viewTable);
router.post("/:table", controller.createRecord);
router.post("/:table/delete/:id", controller.deleteRecord);
router.post("/:table/update/:id", controller.updateRecord);
router.get("/:table/data", controller.getTableData);

module.exports = router;