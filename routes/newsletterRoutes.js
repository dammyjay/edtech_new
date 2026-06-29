const express = require("express");
const pool = require("../models/db");
const router = express.Router();
const { upload } = require("../middlewares/upload");

const newsletterController = require("../controllers/newsletterController");

// Newsletter Dashboard
router.get("/", newsletterController.getNewslettersPage);

module.exports = router;

router.post(
  "/create",
  upload.single("image"),
  newsletterController.createNewsletter,
);

router.get("/schools", newsletterController.getSchools);

router.get("/classrooms/:schoolId", newsletterController.getClassrooms);

router.get("/courses", newsletterController.getCourses);

router.get("/users/search", newsletterController.searchUsers);

router.get("/audience/:type", newsletterController.getAudienceSummary);