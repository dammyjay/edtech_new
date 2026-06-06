const express = require("express");
const router = express.Router();

const labController = require("../controllers/labController");
const { ensureAuthenticated } = require("../middlewares/auth");

router.use(ensureAuthenticated);

router.get("/", labController.getLabDashboard);

router.get("/web", labController.getWebLab);

router.get("/blockly", labController.getBlocklyLab);

router.get("/arduino", labController.getArduinoLab);

router.get("/appinventor", labController.getAppInventorLab);

router.get("/ai", labController.getAiLab);

router.post("/project/init", labController.initProject);

router.get("/project/:labType", labController.loadProject);

router.post("/project/save", labController.saveProject);

router.post("/project/submit", labController.submitProject);

module.exports = router;
