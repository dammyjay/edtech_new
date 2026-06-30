const express = require("express");
const router = express.Router();

const announcementController = require("../controllers/announcementController");

console.log(announcementController);

// Homepage announcements
router.get(
    "/homepage",
    announcementController.getHomepageAnnouncements
);

// Dashboard announcements
router.get(
    "/dashboard",
    announcementController.getDashboardAnnouncements
);

// Record announcement view
router.post(
    "/:id/view",
    announcementController.recordView
);

// Dismiss popup
router.post(
    "/:id/dismiss",
    announcementController.dismissAnnouncement
);

module.exports = router;