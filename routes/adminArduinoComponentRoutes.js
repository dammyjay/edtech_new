const express = require("express");
const router = express.Router();
const adminArduinoComponentController = require("../controllers/adminArduinoComponentController");
const { ensureCsrfToken, verifyCsrfToken } = require("../middlewares/csrf");

// Every route here is admin-only (each handler already checks
// req.session.user.role === "admin" via its own requireAdmin helper), so a
// router-wide CSRF gate is safe — no anonymous visitor reaches this far.
router.use(ensureCsrfToken, verifyCsrfToken);

router.get("/", adminArduinoComponentController.getAdminArduinoComponents);

router.post("/category", adminArduinoComponentController.createCategory);
router.post("/category/delete/:id", adminArduinoComponentController.deleteCategory);

router.post("/add", adminArduinoComponentController.addComponent);
router.post("/edit/:id", adminArduinoComponentController.updateComponent);
router.post("/toggle/:id", adminArduinoComponentController.toggleComponent);
router.post("/delete/:id", adminArduinoComponentController.deleteComponent);

module.exports = router;
