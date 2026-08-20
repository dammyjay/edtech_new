
// middleware/upload.js
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../utils/cloudinary");

// Cloudinary public_ids reject characters like &, (), and other punctuation
// (confirmed via a real upload failure: "public_id (...) is invalid" for a
// filename containing "&" and parentheses). Strip anything that isn't a
// letter/digit/dash/underscore so any original filename is safe to use.
function sanitizeForPublicId(name) {
  const cleaned = name
    .replace(/[^\w\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned.slice(0, 100) || "file";
}

/* ============================
   📂 General Upload Storage
   Handles: thumbnails, curriculums, logos, etc.
============================ */
const generalStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    let folder = "uploads";
    const isModuleRoute = req.originalUrl && req.originalUrl.includes("/modules/");

    if (file.fieldname === "thumbnail") folder = isModuleRoute ? "modules" : "courses/thumbnails";
    else if (file.fieldname === "badge_image") folder = "badges";
    else if (file.fieldname === "curriculum") folder = "courses/curriculums";
    else if (file.fieldname === "logo") folder = "ministry-logos";

    return {
      folder,
      resource_type: "auto", // auto-detects image, video, or doc
      use_filename: true,
      unique_filename: false,
      public_id: `${Date.now()}-${sanitizeForPublicId(file.originalname.split(".")[0])}`,
    };
  },
});
const upload = multer({ storage: generalStorage });

/* ============================
   📘 Lesson File Upload Storage
   Handles: PDF / DOC / DOCX / PPT / PPTX lesson files (incl. slide decks)
============================ */
const ALLOWED_LESSON_FILE_EXTENSIONS = ["pdf", "doc", "docx", "ppt", "pptx"];

const lessonStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    const ext = file.originalname.split(".").pop().toLowerCase();
    const baseName = file.originalname.replace(/\.[^/.]+$/, "");

    return {
      folder: "lessons/files",
      resource_type: "raw", // ensure file integrity
      // NOTE: no `allowed_formats` here — Cloudinary's format validation
      // doesn't recognize document formats like ppt/pptx ("An unknown file
      // format not allowed") even when explicitly named. Extension is
      // enforced below via multer's fileFilter instead.
      format: ext, // keeps the correct extension on the delivered URL
      public_id: `${Date.now()}-${sanitizeForPublicId(baseName)}`,
    };
  },
});
// NOTE: Cloudinary rejects any raw file (pdf/doc/docx/ppt/pptx) over 10MB on
// this account's current plan — confirmed directly against the API, and it
// applies even to chunked/upload_large uploads, so there's no way to raise
// this from the app side without upgrading the Cloudinary plan. The limit
// below matches that cap so oversized files fail fast (before spending time
// uploading) instead of failing only after the browser finishes uploading.
const MAX_LESSON_FILE_BYTES = 10 * 1024 * 1024;

const lessonUpload = multer({
  storage: lessonStorage,
  limits: {
    fileSize: MAX_LESSON_FILE_BYTES,
    fieldSize: 10 * 1024 * 1024, // 10MB, applies to text fields (lesson content/plan HTML)
  },
  fileFilter: (req, file, cb) => {
    const ext = file.originalname.split(".").pop().toLowerCase();
    if (!ALLOWED_LESSON_FILE_EXTENSIONS.includes(ext)) {
      return cb(
        new Error(
          `Unsupported file type ".${ext}". Allowed: ${ALLOWED_LESSON_FILE_EXTENSIONS.join(", ")}`
        )
      );
    }
    cb(null, true);
  },
});

/* ============================
   ⚠️ Safe wrapper for lesson slide upload
   Cloudinary/multer sometimes reject a file with a plain object
   instead of an Error, which Express then renders as "[object Object]".
   This wrapper always surfaces a readable message and logs the raw
   error server-side so the real cause is visible.
============================ */
function lessonSlideUpload(req, res, next) {
  lessonUpload.single("slide_file")(req, res, (err) => {
    if (!err) return next();

    console.error("Lesson slide upload error:", err);
    const isTooLarge =
      err.code === "LIMIT_FILE_SIZE" || /file size too large/i.test(err.message || "");
    const message = isTooLarge
      ? "This slide deck is larger than 10MB, which is the maximum this app currently accepts. Try compressing the images in the presentation (or exporting a smaller version) and upload again."
      : (err && err.message) ||
        (err && err.error && err.error.message) ||
        "Upload rejected by storage provider (check file type/size).";

    return res.status(400).send(`
      <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 60px auto; text-align: center;">
        <h2 style="color:#c0392b;">Slide deck upload failed</h2>
        <p>${message}</p>
        <a href="javascript:history.back()" style="display:inline-block; margin-top:16px; padding:10px 20px; background:#2563eb; color:#fff; text-decoration:none; border-radius:6px;">Go back</a>
      </div>
    `);
  });
}

/* ============================
   ✅ Export both
============================ */
module.exports = {
  upload,         // for general uploads (thumbnails, curriculums, logos)
  lessonUpload,   // for lesson files
  lessonSlideUpload, // safe wrapper for lesson create/edit routes
};
