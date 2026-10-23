const express = require("express");
const router = express.Router();
const { upload } = require("../middlewares/upload");
const labAssetController = require("../controllers/labAssetController");
const { ensureCsrfToken, verifyCsrfToken } = require("../middlewares/csrf");

// Every route here is admin-only (controller checks req.session.user.role
// internally), so a router-wide CSRF gate is safe.
router.use(ensureCsrfToken, verifyCsrfToken);

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

// Higher cap than the sprite/background uploaders (20) — a costume set
// for one character (e.g. a full walk/run animation sequence) can
// realistically run into the dozens of frames in one batch.
router.post(
  "/sprite/:id/costumes",
  upload.array("sprite_costume_image", 100),
  labAssetController.uploadCostume
);
router.post(
  "/sprite/:id/costumes/:costumeId/delete",
  labAssetController.deleteCostume
);

router.post(
  "/sprite/:id/sounds",
  upload.array("sprite_sound_file", 100),
  labAssetController.uploadSound
);
router.post(
  "/sprite/:id/sounds/:soundId/delete",
  labAssetController.deleteSound
);

module.exports = router;
