const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = multer({ dest: "uploads/" }); // or Cloudinary config
const galleryController = require("../controllers/galleryController");
const { ensureCsrfToken, verifyCsrfToken } = require("../middlewares/csrf");

router.get("/gallery", galleryController.getGallery);

// Scoped to /admin/gallery only — /gallery above is a genuinely public,
// anonymous-browsable page, and ensureCsrfToken would force a session
// row to be created for every anonymous visitor if applied blanket.
router.use("/admin/gallery", ensureCsrfToken, verifyCsrfToken);

router.get("/admin/gallery", galleryController.getAdminGallery);

router.post(
  "/admin/gallery/upload",
  upload.single("image"),
  galleryController.uploadGalleryImage
);
router.post("/admin/gallery/create-category", galleryController.createCategory);
router.post("/admin/gallery/delete-image/:id", galleryController.deleteImage);
router.post(
  "/admin/gallery/delete-category/:id",
  galleryController.deleteCategory
);

module.exports = router;
