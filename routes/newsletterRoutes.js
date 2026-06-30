// const express = require("express");
// const pool = require("../models/db");
// const router = express.Router();
// const { upload } = require("../middlewares/upload");

// const newsletterController = require("../controllers/newsletterController");

// // Newsletter Dashboard
// router.get("/", newsletterController.getNewslettersPage);

// module.exports = router;

// router.post(
//   "/create",
//   upload.single("image"),
//   newsletterController.createNewsletter,
// );

// router.get("/schools", newsletterController.getSchools);

// router.get("/classrooms/:schoolId", newsletterController.getClassrooms);

// router.get("/courses", newsletterController.getCourses);

// router.get("/users/search", newsletterController.searchUsers);

// router.get("/audience/:type", newsletterController.getAudienceSummary);


const express = require("express");
const router = express.Router();

const { upload } = require("../middlewares/upload");
const newsletterController = require("../controllers/newsletterController");

// ================= Dashboard =================

router.get("/", newsletterController.getNewslettersPage);

// ================= Create =================

router.post(
    "/create",
    upload.single("image"),
    newsletterController.createNewsletter
);

// ================= Audience =================

router.get(
    "/audience/:type",
    newsletterController.getAudienceSummary
);

router.get(
    "/audience/:type/users",
    newsletterController.getAudienceUsers
);

// ================= Lookup =================

router.get(
    "/schools",
    newsletterController.getSchools
);

router.get(
    "/classrooms/:schoolId",
    newsletterController.getClassrooms
);

router.get(
    "/courses",
    newsletterController.getCourses
);

router.get(
    "/users/search",
    newsletterController.searchUsers
);


// ================= Read =================

router.get("/:id", newsletterController.getNewsletter);

// Audience preview
router.get(
    "/:id/recipients",
    newsletterController.getNewsletterRecipients
);

// ================= Update =================

router.put(
    "/:id",
    upload.single("image"),
    newsletterController.updateNewsletter
);

// ================= Delete =================

router.delete(
    "/:id",
    newsletterController.deleteNewsletter
);

// ================= Actions =================

// Send now
router.post(
    "/:id/send",
    newsletterController.sendNewsletterNow
);

// Cancel scheduled newsletter
router.post(
    "/:id/cancel",
    newsletterController.cancelNewsletter
);

// Duplicate
router.post(
    "/:id/duplicate",
    newsletterController.duplicateNewsletter
);


module.exports = router;