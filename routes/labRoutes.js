const express = require("express");
const router = express.Router();

const labController = require("../controllers/labController");
const externalProjectController = require("../controllers/externalProjectController");
const { ensureAuthenticated } = require("../middlewares/auth");

// Deliberately BEFORE router.use(ensureAuthenticated) below — the one
// lab route an anonymous visitor can reach, for the public showcase's
// "Open Full Preview" link. getWebPreviewPage does its own, stricter
// access check (is_published + public_profile_enabled when logged out)
// instead of relying on this router's blanket auth gate.
router.get("/web-preview/:id", labController.getWebPreviewPage);

router.use(ensureAuthenticated);

router.get("/", labController.getLabDashboard);

router.get("/live-preview", labController.getLivePreviewPage);

router.get("/my-projects/:labType", labController.getMyProjectsPage);

router.get("/web", labController.getWebLab);

router.get("/blockly", labController.getBlocklyLab);

router.get("/python", labController.getPythonLab);

router.get("/arduino", labController.getArduinoLab);
router.post("/arduino/compile", labController.compileArduinoSketch);

router.get("/appinventor", labController.getAppInventorLab);

router.get("/ai", labController.getAiLab);

router.get("/gallery", labController.getGalleryPage);

router.post("/project/init", labController.initProject);

// Must come before /project/:labType — otherwise "lesson"/"list" would be
// captured as :labType and these routes would never be reached.
router.get("/project/lesson/:labId", labController.loadLessonLabProject);
router.post("/project/create", labController.createLabProject);
router.get("/project/list", labController.listLabProjects);
router.get("/project/view/:id", labController.viewLabProject);
router.post("/project/rename", labController.renameLabProject);
router.post("/project/:id/delete", labController.deleteLabProject);

router.get("/project/:labType", labController.loadProject);

router.post("/project/save", labController.saveProject);

router.post("/project/submit", labController.submitProject);

router.get("/peer-review/reviewable", labController.getReviewableProjects);
router.get("/peer-review/project/:id", labController.getReviewableProjectDetail);
router.post("/peer-review/submit", express.json(), labController.submitReview);
router.get("/peer-review/mine", labController.getMyProjectReviews);

router.get("/gallery/projects", labController.getGalleryProjects);
router.get("/gallery/projects/:id", labController.getGalleryProjectDetail);
router.get("/gallery/external-projects", externalProjectController.getFeaturedExternalProjects);
router.post("/gallery/publish", labController.publishProject);
router.post("/gallery/unpublish", labController.unpublishProject);
router.post("/gallery/like", labController.toggleLike);
router.post("/gallery/remix", labController.remixProject);
router.post("/gallery/report", labController.reportProject);

module.exports = router;
