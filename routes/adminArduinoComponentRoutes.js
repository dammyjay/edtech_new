const express = require("express");
const router = express.Router();
const adminArduinoComponentController = require("../controllers/adminArduinoComponentController");

router.get("/", adminArduinoComponentController.getAdminArduinoComponents);

router.post("/category", adminArduinoComponentController.createCategory);
router.post("/category/delete/:id", adminArduinoComponentController.deleteCategory);

router.post("/add", adminArduinoComponentController.addComponent);
router.post("/edit/:id", adminArduinoComponentController.updateComponent);
router.post("/toggle/:id", adminArduinoComponentController.toggleComponent);
router.post("/delete/:id", adminArduinoComponentController.deleteComponent);

module.exports = router;
