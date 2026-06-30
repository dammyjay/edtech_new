const express = require("express");
const router = express.Router();

const { upload } = require("../middlewares/upload");
const controller = require("../controllers/announcementController");

router.get("/", controller.getAnnouncementsPage);

router.post(
    "/create",
    upload.single("image"),
    controller.createAnnouncement
);

router.get("/:id", controller.getAnnouncement);

router.put(
    "/:id",
    upload.single("image"),
    controller.updateAnnouncement
);

router.delete("/:id", controller.deleteAnnouncement);

router.post("/:id/publish", controller.publishAnnouncement);

router.post("/:id/archive", controller.archiveAnnouncement);

module.exports = router;