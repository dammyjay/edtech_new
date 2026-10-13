
const express = require("express");
const router = express.Router();
const aboutController = require("../controllers/aboutController");
const multer = require("multer");
const upload = multer({ dest: "uploads/" }); // temp storage before Cloudinary
const { ensureCsrfToken, verifyCsrfToken } = require("../middlewares/csrf");

router.get("/about", aboutController.getAboutPage);
router.get("/admin/about", aboutController.getEditAboutPage);

// The three mutating routes below are all /admin/about/* and already
// admin-gated internally (aboutController checks req.session.user.role),
// so CSRF is safe to scope to that prefix without touching the public
// /about GET above.
router.use("/admin/about", ensureCsrfToken, verifyCsrfToken);

// Create About section (with optional image upload)
router.post(
  "/admin/about/create",
  upload.single("section_image"), // 👈 handles the <input type="file" name="section_image">
  aboutController.createAboutSection
);

// Update About section (with optional image upload)
router.post(
  "/admin/about/update/:id",
  upload.single("section_image"),
  aboutController.updateAboutSection
);
router.post("/admin/about/delete/:id", aboutController.deleteAboutSection);

module.exports = router;
