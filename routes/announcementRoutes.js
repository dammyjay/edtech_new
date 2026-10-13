const express = require("express");
const router = express.Router();

const { upload } = require("../middlewares/upload");
const announcementController = require("../controllers/announcementController");
const { ensureCsrfToken, verifyCsrfToken } = require("../middlewares/csrf");

// Mounted entirely at /admin/announcements — every route here is
// admin-only (the create/update/delete/publish/archive handlers all
// check req.session.user.role internally), so a router-wide CSRF gate
// is safe.
router.use(ensureCsrfToken, verifyCsrfToken);

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

router.post("/:id/view", announcementController.recordView);

router.post("/:id/click", announcementController.recordClick);

router.post(
  "/:id/dismiss",
  announcementController.dismissAnnouncement,
);

module.exports = router;