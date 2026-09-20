// app.js
const express = require("express");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const bodyParser = require("body-parser");
const path = require("path");
const createTables = require("./models/initTables");
const { ensureAvrCoreInstalled } = require("./services/arduinoCompileService");
require("./cron/assignmentReminderJobs");
require("./cron/newsletterCron");
require("./cron/analyticsReportCron");
require("./cron/lessonReminderJob");
require("./cron/parentWeeklyDigest");
require("./cron/parentAtRiskAlert");
require("./cron/spacedReviewNudge");
require("./cron/weeklyLeaderboardCoins");
const notificationRoutes = require("./routes/notificationRoutes");
// const runNewsletterScheduler = require("./cron/newsletterScheduler");
// const runDevotionalScheduler = require("./cron/cronJobs");
require("dotenv").config(); // Load .env variables
const pool = require("./models/db"); // adjust path based on your folder structure
const methodOverride = require("method-override");

const app = express();
const layout = require("express-ejs-layouts");
const cookieParser = require("cookie-parser");
app.use(cookieParser());


// app.use(express.json());
// app.use(bodyParser.urlencoded({ extended: false }));

app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ extended: true, limit: "100mb" }));

// Set EJS as view engine
app.set("view engine", "ejs");

app.set("views", path.join(__dirname, "views"));
app.use(layout);

// Set default layout file (optional)
// app.set('layout', 'partials/adminLayout'); // default layout for all .ejs files unless overridden

// Middleware

app.set("view engine", "ejs");
app.set("view cache", false);
// Almost every view already renders its own complete <!DOCTYPE html>...
// document (via a header partial or its own <head>), so wrapping every
// res.render() in views/layout.ejs by default produced a second, nested
// <html>/<head>/<body> on nearly every page — the extra <title> from the
// layout silently won in the browser tab over each page's real title.
// Layouts are now opt-in per render call (pass { layout: 'layout' }) for
// the handful of pages that actually rely on it for their shell.
app.set("layout", false);
app.use(express.static(path.join(__dirname, "public")));
// app.use(bodyParser.urlencoded({ extended: false }));
app.use(
  session({
    // connect-pg-simple was imported but never actually wired in as the
    // store — sessions were silently running on express-session's default
    // in-memory store, which its own docs call out as unfit for
    // production (unbounded memory growth, and every server
    // restart/redeploy silently logs everyone out since nothing
    // persists). Backing it with Postgres fixes both.
    store: new pgSession({ pool, createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false, // Change to true only in HTTPS
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000, // 1 day
    },
  })
);
app.use((req, res, next) => {
  // Both names are set, always — this codebase inconsistently uses
  // `user` (singular) in some views/partials and `users` (plural, e.g.
  // partials/header.ejs's school_admin nav check, partials/adminHeader.ejs
  // throughout) for the exact same "currently logged-in person" concept.
  // Without this, any view/partial that references either bare local
  // throws "X is not defined" for a genuinely anonymous visitor — these
  // were previously only ever set when someone WAS logged in, so a
  // logged-out visitor got a 500 on any page that touched either one.
  // That's easy to misread as "this page requires login" when it's
  // really just an unguarded template variable crashing (see
  // views/singleCourse.ejs and views/partials/header.ejs for two real
  // examples this broke).
  const currentUser = (req.session && req.session.user) || null;
  if (currentUser) {
    req.user = currentUser; // 👈 Attach user to req
  }
  res.locals.user = currentUser;
  res.locals.users = currentUser;
  next();
});

// Same "always define it" pattern as user/users above, for the same
// reason: partials/adminHeader.ejs, header.ejs, and userHeader.ejs are
// shared across public and authenticated pages alike, and now render a
// <meta name="csrf-token"> tag referencing csrfToken. Deliberately NOT
// touching req.session here (that's middlewares/csrf.js's
// ensureCsrfToken, applied only inside already-authenticated routers) —
// this app uses saveUninitialized: false specifically so an anonymous
// visitor never gets a session row created just from browsing a public
// page, and this default must stay session-free to preserve that. A
// gated router's ensureCsrfToken overrides this null with a real token
// later in the same request.
app.use((req, res, next) => {
  res.locals.csrfToken = res.locals.csrfToken || null;
  next();
});

// Exposed to EVERY view (not just student pages) so the shared
// partials/userHeader.ejs — included on ~48 pages — can render an
// equipped avatar frame around the small header avatar for whichever
// student/user is logged in, without every one of those 48 controllers
// needing to look up the frame themselves. req.session.user.equipped_avatar_frame
// is set at login (controllers/adminController.js) and kept in sync live
// whenever it changes (studentController.equipAvatarFrame).
const { getFrameByKey } = require("./utils/avatarFrames");
app.use((req, res, next) => {
  res.locals.getFrameByKey = getFrameByKey;
  next();
});

app.locals.vapidPublicKey = process.env.VAPID_PUBLIC_KEY;

app.use(methodOverride("_method"));

// Was unconditionally logging the full session object (user id/email/
// role/etc.) to stdout on every single request in production — real PII
// piling up in server logs with no way to turn it off. Gate it behind an
// explicit opt-in env var for local debugging instead.
if (process.env.DEBUG_SESSION_LOGGING === "true") {
  app.use((req, res, next) => {
    console.log("🧾 SESSION:", req.session);
    next();
  });
}

app.use((req, res, next) => {
  res.locals.title = "Company"; // Default title
  next();
});

// Make the admin-configured company info (logo, name) available to every
// view by default, so headers show the real branding even on routes whose
// controller forgot to fetch and pass its own `info`. A controller that
// does pass `info` to res.render() still takes precedence over this.
app.use(async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const info = result.rows[0] || {};
    if (typeof info.company_name === "string") {
      info.company_name = info.company_name.trim();
    }
    res.locals.info = info;
  } catch (err) {
    console.error("Failed to load company_info:", err.message);
    res.locals.info = res.locals.info || {};
  }
  next();
});


// Rate limiting — previously absent entirely, anywhere in the app,
// including on login. A generous global cap guards against raw
// flooding/DoS; a much stricter shared loginLimiter (middlewares/
// rateLimiters.js, applied per-route inside adminRoutes.js/instructor.js
// to /login and the password-reset routes) guards specifically against
// password brute-forcing, which had no attempt limit, delay, or lockout
// of any kind.
const { globalLimiter } = require("./middlewares/rateLimiters");
app.use(globalLimiter);

const publicRoutes = require("./routes/publicRoutes");
app.use("/", publicRoutes);

const adminRoutes = require("./routes/adminRoutes");
app.use("/admin", adminRoutes);

// const videoRoutes = require("./routes/videoRoutes");
// app.use("/admin", videoRoutes);

const userRoutes = require("./routes/userRoutes");
app.use("/", userRoutes);

const aboutRoutes = require("./routes/aboutRoutes");
app.use("/", aboutRoutes);

const galleryRoutes = require("./routes/galleryRoutes");
app.use("/", galleryRoutes);

const publicFaqRoutes = require("./routes/publicFaqRoutes.js");
app.use("/", publicFaqRoutes);

const adminFaqRoutes = require("./routes/adminFaqRoutes");
app.use("/", adminFaqRoutes);

const studentRoutes = require("./routes/student");
app.use("/student", studentRoutes);

const schoolAdminRoutes = require("./routes/schoolAdmin");
app.use("/school-admin", schoolAdminRoutes);

const teacherRoutes = require("./routes/teacher");
app.use("/teacher", teacherRoutes);

const instructorRoutes = require("./routes/instructor");
app.use("/instructor", instructorRoutes);

app.use("/", notificationRoutes);

const messageRoutes = require("./routes/messageRoutes");
app.use("/", messageRoutes);

const classroomAnalyticsRoutes = require("./routes/classroomAnalyticsRoutes");
app.use(classroomAnalyticsRoutes);

const adminDbRoutes = require("./routes/adminDbRoutes");
app.use("/admin/db", adminDbRoutes);

const labRoutes = require("./routes/labRoutes");
app.use("/labs", labRoutes);

app.get("/test", (req, res) => {
  res.send("✅ Test route works");
});

app.get("/api/check-school/:schoolId", async (req, res) => {
  try {
    const { schoolId } = req.params;
    const result = await pool.query(
      "SELECT name FROM schools WHERE school_id = $1",
      [schoolId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "School not found" });
    }

    res.json({ name: result.rows[0].name });
  } catch (err) {
    console.error("❌ Error checking school:", err.message);
    res.status(500).json({ message: "Internal server error" });
  }
});

const adminTestimonyRoutes = require("./routes/adminTestimonyRoutes");
app.use("/", adminTestimonyRoutes);

const testRoutes = require("./routes/testRoutes");
app.use("/", testRoutes);

const newsletterRoutes = require("./routes/newsletterRoutes");
app.use("/admin/newsletters", newsletterRoutes);

const announcementRoutes = require("./routes/announcementRoutes");
app.use("/admin/announcements", announcementRoutes);

const labAssetRoutes = require("./routes/labAssetRoutes");
app.use("/admin/lab-assets", labAssetRoutes);

const adminArduinoComponentRoutes = require("./routes/adminArduinoComponentRoutes");
app.use("/admin/arduino-components", adminArduinoComponentRoutes);

const publicAnnouncementRoutes = require("./routes/publicAnnouncementRoutes");
app.use("/announcements", publicAnnouncementRoutes);


// runNewsletterScheduler();



// Run table creation at startup
createTables();

// Arduino Lab's compile toolchain (services/arduinoCompileService.js) —
// fetches the AVR core (~60MB) once per container lifetime, not blocking
// server startup. If arduino-cli itself isn't installed on this host
// (e.g. a local dev machine that hasn't set it up), this just logs and
// leaves the Arduino Lab's compile endpoint erroring per-request rather
// than taking the whole app down — every other lab is unaffected either way.
ensureAvrCoreInstalled().catch((err) => {
  console.error("Arduino AVR core not ready:", err.message);
});

// Last-resort net for anything that throws and was never wrapped in its
// own try/catch (or calls next(err) directly) — without this, such an
// error fell through to Express's built-in handler, which is where the
// bare "Internal Server Error" page came from. Individual routes should
// still prefer utils/errorPage.js's renderErrorPage(req, res, err, ...)
// for a more specific message/back-link; this is only the final fallback.
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  if (res.headersSent) return next(err);

  const renderErrorPage = require("./utils/errorPage");
  renderErrorPage(req, res, err, { context: "Unhandled error" });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on https://localhost:${PORT}`);
});
