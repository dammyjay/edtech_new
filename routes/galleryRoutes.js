const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = multer({ dest: "uploads/" }); // or Cloudinary config
const galleryController = require("../controllers/galleryController");

router.get("/gallery", galleryController.getGallery);
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
