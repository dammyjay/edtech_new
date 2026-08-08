
// middleware/upload.js
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../utils/cloudinary");

/* ============================
   📂 General Upload Storage
   Handles: thumbnails, curriculums, logos, etc.
============================ */
const generalStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    let folder = "uploads";

    if (file.fieldname === "thumbnail") folder = "courses/thumbnails";
    else if (file.fieldname === "curriculum") folder = "courses/curriculums";
    else if (file.fieldname === "logo") folder = "ministry-logos";

    return {
      folder,
      resource_type: "auto", // auto-detects image, video, or doc
      use_filename: true,
      unique_filename: false,
      public_id: `${Date.now()}-${file.originalname.split(".")[0]}`,
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
      public_id: `${Date.now()}-${baseName}`,
    };
  },
});
const lessonUpload = multer({
  storage: lessonStorage,
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB, applies to the uploaded slide file
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
    const message =
      (err && err.message) ||
      (err && err.error && err.error.message) ||
      "Upload rejected by storage provider (check file type/size).";

    return res.status(400).send(`Error uploading slide deck: ${message}`);
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
