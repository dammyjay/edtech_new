const express = require("express");
const router = express.Router();
const { upload } = require("../middlewares/upload");
const labAssetController = require("../controllers/labAssetController");

router.get("/", labAssetController.getAdminLabAssets);

router.post("/category", labAssetController.createCategory);
router.post("/category/delete/:id", labAssetController.deleteCategory);

// .array(...) accepts multiple files under one <input multiple> field —
// the same fieldnames the CloudinaryStorage folder-picker in
// middlewares/upload.js already keys off of, so no storage config change
// was needed to support bulk upload.
router.post(
  "/upload/sprite",
  upload.array("sprite_image", 20),
  labAssetController.uploadAsset
);
router.post(
  "/upload/background",
  upload.array("background_image", 20),
  labAssetController.uploadAsset
);

router.post(
  "/edit/sprite/:id",
  upload.single("sprite_image"),
  labAssetController.editAsset
);
router.post(
  "/edit/background/:id",
  upload.single("background_image"),
  labAssetController.editAsset
);

router.post("/delete/:id", labAssetController.deleteAsset);

module.exports = router;
