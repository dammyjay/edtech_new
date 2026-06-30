const express = require("express");
const router = express.Router();

const { upload } = require("../middlewares/upload");
const announcementController = require("../controllers/announcementController");

console.log(announcementController);

router.get("/", announcementController.getAnnouncementsPage);

router.get("/all", announcementController.getAllAnnouncements);

router.post(
    "/create",
    upload.single("image"),
    announcementController.createAnnouncement
);

router.get("/:id", announcementController.getAnnouncement);

router.put(
    "/:id",
    upload.single("image"),
    announcementController.updateAnnouncement
);

router.delete("/:id", announcementController.deleteAnnouncement);

router.post("/:id/publish", announcementController.publishAnnouncement);

router.post("/:id/archive", announcementController.archiveAnnouncement);

module.exports = router;