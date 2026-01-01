const express = require("express");
const router = express.Router();
const controller = require("../controllers/ministryController");

router.get("/ministry", controller.showForm);
router.post("/ministry", controller.saveInfo);

module.exports = router;
