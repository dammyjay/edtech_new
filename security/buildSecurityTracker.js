// Builds/rebuilds security/security-audit-tracker.xlsx from the FINDINGS array
// below. Re-run this script any time findings are added or a status changes —
// it always writes a fresh file, so hand edits made directly in Excel will be
// overwritten; update FINDINGS instead and re-run.
const path = require("path");
const ExcelJS = require(
  "C:/Users/HP/Documents/Vs Code/edtech_new/node_modules/exceljs"
);

const OUT_PATH = path.join(
  "C:/Users/HP/Documents/Vs Code/edtech_new/security",
  "security-audit-tracker.xlsx"
);

// ---------- Brand palette (matches the app's own gold/brown theme) ----------
const BRAND_DARK = "FF4C3802";
const BRAND_GOLD = "FFD9A82C";
const BRAND_CREAM = "FFFFF8E7";
const WHITE = "FFFFFFFF";

const SEVERITY_COLORS = {
  Critical: { fill: "FFDC2626", font: WHITE },
  High: { fill: "FFEA580C", font: WHITE },
  Medium: { fill: "FFD97706", font: WHITE },
  Low: { fill: "FF2563EB", font: WHITE },
  Info: { fill: "FF6B7280", font: WHITE },
  Resolved: { fill: "FF16A34A", font: WHITE },
};

const STATUS_COLORS = {
  Open: { fill: "FFFDE8E8", font: "FF7A1212" },
  "In Progress": { fill: "FFFEF3C7", font: "FF7A4E0A" },
  Fixed: { fill: "FFDCFCE7", font: "FF14532D" },
  "Verified Secure": { fill: "FFE0F2FE", font: "FF075985" },
  "Won't Fix": { fill: "FFF3F4F6", font: "FF374151" },
  "Accepted Risk": { fill: "FFF3F4F6", font: "FF374151" },
};

const STATUS_OPTIONS = Object.keys(STATUS_COLORS);

// ---------- Findings data ----------
const FOUND_DATE = "2026-09-19";
const FIXED_DATE = "2026-09-19";
const FOUND_DATE_2 = "2026-09-20";
const FIXED_DATE_2 = "2026-09-20";

const FINDINGS = [
  // ===== CRITICAL =====
  {
    severity: "Critical",
    category: "Broken Access Control",
    title: "Unauthenticated admin password reset (full account takeover)",
    location: "controllers/adminController.js:171 (resetPassword) — routes/adminRoutes.js:178",
    description:
      "resetPassword sets any user's password from req.body.newPassword for req.params.userId with zero session/auth check. Route has no middleware.",
    risk:
      "Anyone, without logging in, can reset any user's password (including an admin's) and log in as them.",
    fix: "Add ensureAdmin/ensureInstructorOrAdmin-equivalent middleware to this route; verify caller is admin and, ideally, log the action.",
    status: "Fixed",
    dateFixed: FIXED_DATE,
    fixImplemented:
      "Fixed middlewares/auth.js's broken isAdmin (checked a Passport.js method this app never uses) and re-exported it as a working ensureAdmin. Applied router.use(ensureAdmin) in routes/adminRoutes.js right after the genuinely public routes. Verified live: unauthenticated POST now 302s to /admin/login instead of resetting the password; a real admin session still reaches it fine.",
  },
  {
    severity: "Critical",
    category: "Broken Access Control",
    title: "Unauthenticated privilege escalation via user edit",
    location: "controllers/adminController.js:2383 (updateUser) — routes/adminRoutes.js:175",
    description:
      "updateUser writes fullname/email/phone/gender/role/wallet_balance2 straight from req.body for any req.params.id, with zero auth check.",
    risk: "Anyone can set role='admin' on any account id — instant privilege escalation, no login required.",
    fix: "Add admin-only middleware. Also consider disallowing role changes through this generic form entirely; route role changes through a dedicated, audited endpoint.",
    status: "Fixed",
    dateFixed: FIXED_DATE,
    fixImplemented: "Covered by the same routes/adminRoutes.js router.use(ensureAdmin) gate described above. Verified live via curl (unauthenticated POST -> 302).",
  },
  {
    severity: "Critical",
    category: "Broken Access Control",
    title: "Unauthenticated user deletion",
    location: "controllers/adminController.js:2404 (deleteUser) — routes/adminRoutes.js:174",
    description: "Deletes any user by id with zero auth check.",
    risk: "Anyone can permanently delete any account, including admins, students, or instructors.",
    fix: "Add admin-only middleware.",
    status: "Fixed",
    dateFixed: FIXED_DATE,
    fixImplemented: "Covered by the same routes/adminRoutes.js router.use(ensureAdmin) gate. Verified live via curl (unauthenticated POST -> 302).",
  },
  {
    severity: "Critical",
    category: "Broken Access Control",
    title: "routes/adminRoutes.js has no auth middleware anywhere in the file",
    location: "routes/adminRoutes.js (whole file, ~180 routes) — imports a nonexistent ensureAdmin",
    description:
      "The file imports { ensureAdmin } from middlewares/auth.js, but that export doesn't exist there, so the import silently does nothing. No router.use() guard and no per-route middleware exists anywhere in the file. ~110+ controller functions in adminController.js / learningController.js (course, module, lesson, classroom, term, event, pathway, quote, benefit CRUD, bulk user import, attendance edits, etc.) also have no in-body session check, so they are fully unauthenticated end to end.",
    risk: "The entire /admin/* write surface (beyond the 3 items above) is reachable by anyone with no login at all.",
    fix: "Add a real ensureAdmin/ensureInstructorOrAdmin export and apply it as a router.use() at the top of adminRoutes.js (matching the pattern already used correctly in routes/teacher.js and routes/schoolAdmin.js), then carve out explicit exceptions only for genuinely public routes (login, forgot-password, etc.).",
    status: "Fixed",
    dateFixed: FIXED_DATE,
    fixImplemented:
      "Added a real ensureAdmin export to middlewares/auth.js and applied router.use(ensureAdmin) in routes/adminRoutes.js immediately after the public block (login, avatar-login, forgot/reset-password, and the login page's school->classroom->student picker API, GET /admin/classrooms/:id/students, which was moved up above the gate since the unauthenticated login page itself depends on it). Boot-tested twice on isolated ports (3097, 3098) with curl: every previously-open mutating route now redirects when unauthenticated, every public route still returns 200, and a real admin login still reaches the dashboard and every gated route.",
  },
  {
    severity: "Critical",
    category: "Broken Access Control",
    title: "Unauthenticated download of any student's grades/quiz report",
    location:
      "controllers/instructorController.js:1619 (downloadQuizReport), :1711 (downloadStudentReport) — routes/instructor.js:28-32",
    description:
      "Both functions look up the student purely by req.params.studentId with no session/ownership check. Routes have no middleware (unlike the ensureInstructorOrAdmin-guarded routes just below them in the same file).",
    risk: "Anyone can download any student's full grades, quiz scores, and progress report by guessing/iterating a student id.",
    fix: "Add ensureInstructorOrAdmin plus an ownership check (instructor must teach that student's classroom), matching the pattern already used in viewStudentProgress in the same file.",
    status: "Fixed",
    dateFixed: FIXED_DATE,
    fixImplemented:
      "Added router.use(ensureInstructorOrAdmin) app-wide in routes/instructor.js (right after the one public /login route), PLUS a specific per-function ownership check in both downloadQuizReport and downloadStudentReport (instructor must teach the student, via a classroom_instructors/user_school join — same pattern as viewStudentProgress). Also removed the dead duplicate unguarded /dashboard route in the same file.",
  },
  {
    severity: "Critical",
    category: "Broken Access Control",
    title: "Unauthenticated attendance session data exposure",
    location:
      "controllers/instructorController.js:2642 (getAttendanceSessionDetails), :2688 (exportAttendancePDF) — routes/instructor.js:47,49",
    description: "Queries attendance by raw session id with no instructor/classroom ownership check, no route middleware.",
    risk: "Anyone can view or export any classroom's attendance roster (student names + status) by guessing a session id.",
    fix: "Add the same ownership join used in teacherController.js's equivalent functions (classroom_teachers / classroom_instructors).",
    status: "Fixed",
    dateFixed: FIXED_DATE,
    fixImplemented:
      "Covered by the routes/instructor.js router-wide gate, plus added an explicit ownership check (instructor must teach the session's classroom, via attendance_sessions -> classroom_instructors) inside both getAttendanceSessionDetails and exportAttendancePDF.",
  },
  {
    severity: "Critical",
    category: "Broken Access Control",
    title: "Unauthenticated classroom chat moderation (lock/unlock/delete/mute)",
    location:
      "controllers/instructorController.js: muteStudent(434), unmuteStudent(455), deleteClassMessage(517), getClassMessages(535), lockClassChat(565), unlockClassChat(585) — routes/instructor.js:172,185-189",
    description: "None of these check who is calling or whether they teach the classroom in question; several have no login check at all.",
    risk: "Anyone can read, lock, unlock, or wipe any classroom's chat, or mute/unmute any student, with a plain unauthenticated POST.",
    fix: "Add ensureInstructorOrAdmin plus a teachesClassroom(classroomId, instructorId) check, matching teacherController.js's already-correct equivalent.",
    status: "Fixed",
    dateFixed: FIXED_DATE,
    fixImplemented:
      "Covered by the router-wide instructor gate, plus added a shared instructorOwnsClassroom(classroomId, instructorId) helper (instructorController.js) and wired it into muteStudent, unmuteStudent, deleteClassMessage (resolves the message's classroom first), getClassMessages, lockClassChat, and unlockClassChat — each now 403s if the caller doesn't teach that classroom. Verified live via curl (unauthenticated POST /instructor/class/lock -> 302).",
  },
  {
    severity: "Critical",
    category: "Broken Access Control / Data Exposure",
    title: "Unrestricted raw-database admin panel exposes every table, including users2",
    location: "controllers/adminDbController.js + routes/adminDbRoutes.js (mounted at /admin/db)",
    description:
      "Full CRUD (create/read/update/delete) over every table in utils/allowedTables.js, including users2 (password hashes, roles, emails) and financial tables (school_payments, transactions, parent_training_invoices). Gated only by a per-function 'role === admin' session check — no CSRF token, no audit log, no rate limiting. The router-level isAdmin guard is present in code but commented out.",
    risk:
      "If any admin session is ever compromised (weak password, credential stuffing, XSS, session fixation — see related findings), this single surface grants total platform compromise: grant self admin role, overwrite any password hash, dump all PII/financial data.",
    fix: "Restore the commented-out router-level admin middleware as defense-in-depth, add CSRF protection to this panel specifically, add an audit log of every write, and strongly consider removing users2 and financial tables from allowedTables unless there is a specific operational need.",
    status: "Fixed",
    dateFixed: FIXED_DATE,
    fixImplemented:
      "Restored and fixed the router-level guard: routes/adminDbRoutes.js now does router.use(ensureAdmin) (the commented-out isAdmin import was also broken — same Passport.js bug as the other guards). This is defense-in-depth on top of adminDbController.js's existing per-function checks, which were already correct. Verified live: unauthenticated GET /admin/db/users2 -> 302; authenticated admin -> 200. Also fixed: raw SQL error messages this panel returned to the client on failure now log server-side and return a generic message instead (see the Information Disclosure finding). Also now has full CSRF token protection (see the CSRF finding below) — this was the first, highest-value target for that work specifically because of how much this panel can do. Write-audit-logging is still not implemented; worth a follow-up if this panel's usage grows.",
  },

  // ===== HIGH =====
  {
    severity: "High",
    category: "CSRF",
    title: "No CSRF protection anywhere in the application",
    location: "Whole app — confirmed zero hits for csrf/csurf across the codebase",
    description: "No CSRF middleware or token pattern exists on any state-changing route.",
    risk: "Combined with the missing-auth findings above, and even on properly-authenticated routes, cross-site request forgery can trigger unwanted actions while a user (including an admin) is logged in.",
    fix: "Add a CSRF middleware (e.g. csrf-csrf / double-submit cookie pattern compatible with Express 5) to all state-changing routes, prioritizing /admin/*, /admin/db/*, and /instructor/*.",
    status: "Fixed",
    dateFixed: FIXED_DATE_2,
    fixImplemented:
      "App-wide mitigation: session cookie sets sameSite: 'lax' explicitly (app.js). Full token-based protection built as reusable infrastructure rather than hand-wired per view: middlewares/csrf.js (hand-rolled session-bound synchronizer token — csurf is deprecated/unmaintained, and this app already has express-session, which is all a synchronizer token needs; verifyCsrfToken auto-skips GET/HEAD/OPTIONS so it's safe to apply as a blanket router.use()) plus public/js/csrf.js, a client-side script that auto-patches window.fetch to attach an X-CSRF-Token header on same-origin unsafe-method requests and auto-injects a hidden _csrf field into same-origin POST forms on submit — so protecting a router doesn't require editing every one of its views by hand, only confirming each view actually loads the token+script (via a shared <meta name=\"csrf-token\"> tag). Added a session-free global default (res.locals.csrfToken = null in app.js) so pages outside the rollout don't throw. Rolled out and verified live (real browser via Puppeteer plus extensive curl round-tripping, checking every rendered view for token coverage first each time) across every major role surface: routes/adminDbRoutes.js, routes/adminRoutes.js, routes/instructor.js, routes/adminFaqRoutes.js, routes/teacher.js, routes/schoolAdmin.js, routes/student.js, and the one public flow with a real login session (GET /make-payment, POST /verify-payment in routes/publicRoutes.js, applied per-route rather than router-wide since that file is mounted at the app root — see the mis-scoped-middleware findings below for exactly why that distinction matters). Wired the meta+script into partials/adminHeader.ejs, header.ejs, and userHeader.ejs (covering the large majority of views across every role) plus standalone pages that render their own <head> (adminProfile.ejs, editFaq.ejs, students.ejs, teacher/dashboard.ejs, payment.ejs). Deliberately NOT applied to GET /pay-event/:regId or POST /verify-event-payment — that flow has no session/login at all, so a CSRF token would add no real protection; see the new Critical/High findings below for the actual, more serious problems found there instead. Remaining smaller admin utility routers (newsletters, announcements, lab-assets, arduino-components, etc.) haven't been individually audited for CSRF — lower-value, lower-traffic surfaces; worth a follow-up pass if time allows, but the major role dashboards and highest-value admin panels are now fully covered.",
  },
  {
    severity: "High",
    category: "Brute Force / Rate Limiting",
    title: "No rate limiting or brute-force protection anywhere, including login",
    location: "Whole app — confirmed zero hits for express-rate-limit/rateLimit; adminController.js:203 login has no attempt counting",
    description: "Login does a bare bcrypt.compare with no lockout, delay, or attempt tracking. No endpoint in the app has any rate limit.",
    risk: "Login is brute-forceable at unlimited speed; any endpoint can be hammered for DoS or credential stuffing.",
    fix: "Add express-rate-limit globally (a generous default) plus a stricter limiter on /admin/login, /instructor/login, and password-reset routes.",
    status: "Fixed",
    dateFixed: FIXED_DATE,
    fixImplemented:
      "Installed express-rate-limit. Added middlewares/rateLimiters.js exporting a generous globalLimiter (600 req/5min per IP, applied app-wide in app.js) and a strict loginLimiter (10 req/15min per IP), applied to /admin/login, /instructor/login, /admin/student/avatar-login, /admin/forgot-password, and /admin/reset-password/:token. Verified live: 12 rapid login attempts got HTTP 429 starting around the 8th (earlier requests in the same test window included other loginLimiter-covered calls, consistent with the shared 10-attempt window).",
  },
  {
    severity: "High",
    category: "Session Management",
    title: "Session not regenerated on login (session fixation)",
    location: "controllers/adminController.js:265-271 (login) — grep for session.regenerate returns zero hits app-wide",
    description: "Login mutates the existing req.session.user object in place instead of calling req.session.regenerate() first.",
    risk: "An attacker who fixes a victim's pre-auth session id (e.g. via a shared network or subdomain cookie drop) inherits a valid authenticated session once the victim logs in.",
    fix: "Call req.session.regenerate() (or express-session's recommended pattern) before setting req.session.user at login.",
    status: "Fixed",
    dateFixed: FIXED_DATE,
    fixImplemented: "adminController.js's login now calls req.session.regenerate() (wrapped in a Promise) before setting req.session.user. Verified live end-to-end: login -> authenticated dashboard access still works correctly with the new session id.",
  },
  {
    severity: "High",
    category: "Information Disclosure",
    title: "User enumeration via forgot-password flow",
    location: "controllers/adminController.js:96 (handleForgotPassword)",
    description: "Returns a distinct 'Email does not exist.' message when the email isn't found, vs. a different success message otherwise (unlike login, which correctly uses one generic message).",
    risk: "Lets an attacker enumerate valid registered emails on the platform.",
    fix: "Always show the same generic message ('If that email exists, a reset link has been sent.') regardless of whether the account exists.",
    status: "Fixed",
    dateFixed: FIXED_DATE,
    fixImplemented: "Both branches of handleForgotPassword now render the identical message: \"If that email is registered, a reset link has been sent.\" Verified live via curl with both a real and a fake email — byte-identical response.",
  },
  {
    severity: "High",
    category: "Weak Credentials",
    title: "Predictable default password + guessable email for bulk-created accounts",
    location: "controllers/schoolAdminController.js:835-836, controllers/adminController.js:1139, email pattern at schoolAdminController.js:902-903",
    description: "Every CSV-bulk-created account gets the fixed password '12345678'; emails are deterministically generated as name@schoolschool.com.",
    risk: "Anyone who knows a student's name and school can derive their login email; the password is identical and guessable for every bulk-created account until devices change it.",
    fix: "Generate a random per-account temporary password, force a password change on first login, and/or send credentials via a secure out-of-band channel instead of a predictable pattern.",
    status: "Fixed",
    dateFixed: FIXED_DATE,
    fixImplemented:
      "Added utils/generateDefaultPassword.js (crypto.randomInt over an unambiguous-character alphabet). Replaced all 6 hardcoded \"12345678\" occurrences across schoolAdminController.js and adminController.js (single add-student, bulk CSV import x2, addUserToSchool, platformBulkAddUsers). Each now generates a random password per account: the single-student flow passes it back via the redirect query string, both bulk-import flows return a createdCredentials[] array in the JSON response, and addUserToSchool returns a generatedPassword field (only when the admin left the password field blank). Also fixed the student login-card PDF generator (adminController.js ~6220), which was printing the literal hardcoded string \"Password: 12345678\" on every card regardless of the account's real password — removed that line since it would now be actively wrong; the PIN-based login already shown on the same card is the accounts' real, working credential.",
  },
  {
    severity: "High",
    category: "Dependency Vulnerabilities",
    title: "npm audit (part 1): critical + high CVEs with clean, non-breaking fixes",
    location: "package-lock.json / node_modules",
    description:
      "Critical: basic-ftp (path traversal, CRLF injection). High: ws (memory disclosure/DoS), path-to-regexp (ReDoS), tmp (path traversal), nodemailer (ReDoS, recipient-domain bypass, 7 more). Moderate: qs (DoS), on-headers (response header manipulation).",
    risk: "Known, publicly documented exploit paths in dependencies used by the app (email sending, routing, session handling, static file serving).",
    fix: "Run `npm audit fix` for the safe fixes; remove nodemailer if genuinely unused.",
    status: "Fixed",
    dateFixed: FIXED_DATE,
    fixImplemented:
      "Ran `npm audit fix` (non-breaking): resolved basic-ftp, ws, path-to-regexp, qs, tmp, and on-headers. Discovered nodemailer (source of 9 of the CVEs) is not actually used anywhere live — only in one commented-out line; the real email path uses the Brevo API — so it was removed from package.json entirely rather than upgraded, eliminating those 9 findings with zero behavior risk. `npm audit` confirms 0 critical / 0 of these specific findings remain.",
  },
  {
    severity: "Medium",
    category: "Dependency Vulnerabilities",
    title: "npm audit (part 2): uuid + image-size — fixed via targeted overrides, not full package upgrades",
    location: "package.json \"overrides\" — uuid (via exceljs@4.4.0), image-size (via pptxgenjs@4.0.1)",
    description:
      "uuid <11.1.1 (moderate, missing buffer bounds check) and image-size <=2.0.2 (high, DoS via infinite loop in ICNS/JXL/HEIF parsing) are transitive dependencies npm's own `--force` fix would only resolve by downgrading exceljs to 3.4.0 and pptxgenjs to 2.2.0 — a regression, not a fix.",
    risk: "Known CVEs in the dependency tree, though investigation found low real-world reachability (see fixImplemented).",
    fix: "Use package.json's \"overrides\" field to pin just the vulnerable transitive package to a patched version, verified compatible with how the parent package actually uses it.",
    status: "Fixed",
    dateFixed: FIXED_DATE,
    fixImplemented:
      "Checked exceljs's actual usage of uuid first: it only calls the stable, unchanged uuidv4() function (one call site, cf-rule-ext-xform.js) — safe to override across major versions. Checked pptxgenjs's actual usage of image-size: found it's dead code — the only reference in the installed version's compiled bundle is inside a comment block explicitly marked \"FIXME: TODO: currently unused\"; this app's own services/pitchDecks/imageDimensions.js already implements its own JPEG/PNG dimension parser specifically because pptxgenjs's built-in sizing doesn't work from Node. Added `\"overrides\": { \"uuid\": \"^11.1.1\", \"image-size\": \"^2.0.4\" }` to package.json. Verified live: rebuilt security-audit-tracker.xlsx successfully (exercises exceljs's write+read path) and generated a real .pptx file with pptxgenjs — both work correctly with the patched versions. `npm audit` confirms both CVEs no longer appear.",
  },
  {
    severity: "Medium",
    category: "Dependency Vulnerabilities",
    title: "npm audit (part 3): puppeteer/extract-zip and cloudinary — deliberately accepted, not forced",
    location: "extract-zip (via @puppeteer/browsers, via puppeteer@24.43.1); cloudinary@1.41.3 (direct + via multer-storage-cloudinary)",
    description:
      "extract-zip: unvalidated symlink path traversal / arbitrary file write from a malicious zip archive. cloudinary: argument injection via unsanitized \"&\"-containing parameter values sent to the Cloudinary API. npm's only fix for either is a major version bump (puppeteer 24->25, cloudinary 1->2) across libraries used in ~30+ files for PDF/screenshot/thumbnail generation and nearly every file upload in the app.",
    risk: "Real CVEs in the abstract, but investigated for actual reachability in this app rather than assumed (see fixImplemented) — both currently have no exploitable path here.",
    fix: "A dedicated, staging-tested major-version upgrade pass for puppeteer and cloudinary, exercising every PDF/screenshot/upload feature before deploying.",
    status: "Accepted Risk",
    dateFixed: "",
    fixImplemented:
      "Not upgraded — investigated instead, and found: (1) extract-zip's vulnerable code path (unpackArchive, in @puppeteer/browsers' fileUtil.js) only runs when Puppeteer downloads and unzips its own Chromium binary at install time — this app never calls that install/fetch API at runtime, only puppeteer.launch() against an already-installed browser, so the vulnerable path isn't reachable by any request a remote attacker could send. (2) Grepped every cloudinary.uploader.upload() call site in the app (~30 across 10 controllers) — every `folder` param is a hardcoded string literal, and the one place that built a `format` param from a filename (middlewares/upload.js's lessonStorage) has been hardened separately regardless of SDK version (see the new finding below), so there is currently no live call site where attacker-controlled, unsanitized data reaches a Cloudinary API parameter. Given both are genuinely unreachable today, and both fixes are wide-blast-radius major-version bumps across heavily-used libraries, upgrading was deliberately deferred rather than forced blind. Re-evaluate if either library's usage in this app changes (e.g. cloudinary params ever start incorporating raw user input).",
  },
  {
    severity: "High",
    category: "Broken Access Control",
    title: "Course deletion missing ownership check for non-instructor roles",
    location: "controllers/adminController.js:2979 (deleteCourse)",
    description: "Ownership check (course.instructor_id !== req.user.id -> 403) only runs when req.user.role === 'instructor'; it's skipped entirely for every other role.",
    risk: "Any logged-in student/parent/teacher account can delete any course.",
    fix: "Apply the ownership/role check unconditionally, not only inside an instructor-role branch.",
    status: "Fixed",
    dateFixed: FIXED_DATE,
    fixImplemented:
      "Resolved as a direct side effect of the routes/adminRoutes.js and routes/instructor.js router-wide gates: deleteCourse is reachable only via those two routers, both of which now require the caller to be an admin or instructor, so the student/parent/teacher case this finding describes can no longer reach the function at all. Left the existing instructor-role ownership check as-is (admins can still delete any course, matching existing intent).",
  },
  {
    severity: "High",
    category: "Broken Access Control",
    title: "Student classroom chat: no membership/ownership check",
    location: "controllers/studentController.js:4847 (sendClassMessage), :4904 (getClassMessages) — routes/student.js:238",
    description: "sendClassMessage never verifies the student is enrolled in the target classroom before posting; getClassMessages has no auth check at all and reads any classroom's chat by id.",
    risk: "Any logged-in student can post into or read any classroom's chat, not just their own.",
    fix: "Add the same 'is this student actually in this classroom' check already used a few functions later in the same file for getClassroomAnnouncements.",
    status: "Fixed",
    dateFixed: FIXED_DATE,
    fixImplemented:
      "Added the same user_school membership check getClassroomAnnouncements already used to both sendClassMessage and getClassMessages in studentController.js — both now 403 if the student isn't enrolled in the target classroom. Also added ensureAuthenticated to their routes (and to /classroom/:id/announcements) in routes/student.js for defense-in-depth.",
  },

  // ===== MEDIUM =====
  {
    severity: "Medium",
    category: "File Upload",
    title: "Primary Cloudinary upload path has no file size limit or type filter",
    location: "middlewares/upload.js (generalStorage/upload) — used by ~30+ routes across admin/instructor/student",
    description: "No limits.fileSize and no fileFilter on the multer instance used for thumbnails, avatars, sprites, gallery images, logos, etc.",
    risk: "Any authenticated user can upload arbitrarily large files of any type; storage/bandwidth cost and abuse risk.",
    fix: "Apply the same pattern already used correctly for lessonUpload in the same file (10MB limit + extension allowlist).",
    status: "Fixed",
    dateFixed: FIXED_DATE,
    fixImplemented:
      "Added limits.fileSize (25MB) to the shared `upload` multer instance in middlewares/upload.js. Deliberately did NOT add a fileFilter/type allowlist here (unlike lessonUpload) — confirmed this single instance is genuinely reused for very different content types across its ~30+ call sites, including arbitrary-type student assignment submissions (routes/student.js '/assignments/:id/submit'), so a type restriction risked rejecting legitimate uploads without knowing every caller's real needs. The size cap alone closes the unbounded-upload DoS/cost risk without that tradeoff.",
  },
  {
    severity: "Medium",
    category: "File Upload",
    title: "Local-disk bulk CSV uploads: no size/type limit and files never cleaned up",
    location: "routes/adminRoutes.js:37-49 + routes/schoolAdmin.js:16-25 (upload2), used by bulk-add-users/bulk-add-students",
    description: "No limits or fileFilter; uploaded files are streamed and parsed but never deleted afterward. Confirmed leftover files (including a 4.3MB blob) still present in uploads/.",
    risk: "Disk exhaustion / unbounded accumulation of arbitrary uploaded content over time. Filenames are not user-controlled, so this is not a path-traversal risk, and the folder isn't served back to the web.",
    fix: "Add limits.fileSize + a .csv extension filter, and fs.unlink the temp file after processing (success or failure).",
    status: "Fixed",
    dateFixed: FIXED_DATE,
    fixImplemented:
      "Both multer instances (routes/adminRoutes.js's upload2, routes/schoolAdmin.js's upload) now have limits.fileSize (5MB) and a fileFilter rejecting anything but .csv. Added fs.unlink(req.file.path) after the CSV stream finishes in both platformBulkAddUsers (adminController.js) and bulkAddStudents (schoolAdminController.js). Pre-existing orphaned files already sitting in uploads/ from before this fix were left in place (not this session's data to delete) — safe to clean up manually at any time.",
  },
  {
    severity: "Medium",
    category: "CSRF",
    title: "GET request creates a database row (one-click CSRF-able write)",
    location: "controllers/learningController.js:500 (getOrCreateLessonQuiz) — routes/adminRoutes.js:385, routes/instructor.js:113",
    description: "A plain GET request inserts a new quizzes row if one doesn't exist yet for the lesson.",
    risk: "Low-impact but a genuine GET-based write; forgeable via a simple <img>/link from another site.",
    fix: "Split into a read-only GET plus a separate POST/PUT for the create-if-missing step, or at minimum treat this endpoint as idempotent-safe only after adding CSRF protection app-wide.",
    status: "Fixed",
    dateFixed: FIXED_DATE,
    fixImplemented:
      "Changed both routes (adminRoutes.js and instructor.js) from GET to POST, and updated the one real caller (views/partials/lessons.ejs's openQuizModal) to fetch with { method: 'POST' }. Verified live end-to-end with a real lesson id: POST returns the expected {success, quiz, questions} payload; the route is also now behind the router-wide auth gate.",
  },
  {
    severity: "Medium",
    category: "Broken Access Control",
    title: "Course/module/lesson/quiz/assignment edit & delete routes missing middleware",
    location: "routes/instructor.js:71-146 (courses, modules, lessons, quiz-question, assignments edit/delete)",
    description: "These routes were added before ensureInstructorOrAdmin was adopted lower in the same file and were never retrofitted; backing learningController.js functions also have no in-body check.",
    risk: "Same class of issue as the Critical items above, scoped to curriculum-editing endpoints.",
    fix: "Add ensureInstructorOrAdmin to each of these routes.",
    status: "Fixed",
    dateFixed: FIXED_DATE,
    fixImplemented: "Covered by the routes/instructor.js router.use(ensureInstructorOrAdmin) gate, which applies to every route in the file (after the one public /login route) rather than needing to be retrofitted route-by-route.",
  },
  {
    severity: "Medium",
    category: "Information Disclosure",
    title: "Full session object logged to console on every request",
    location: "app.js:111",
    description: "console.log(\"SESSION:\", req.session) runs unconditionally on every request in production.",
    risk: "Dumps user id/email/role/etc. into server logs continuously; a problem if logs are ever shared, shipped to a third party, or viewed by someone who shouldn't see PII.",
    fix: "Remove this log line, or gate it behind a DEBUG env flag that's off in production.",
    status: "Fixed",
    dateFixed: FIXED_DATE,
    fixImplemented: "Gated behind `if (process.env.DEBUG_SESSION_LOGGING === \"true\")` in app.js — off by default, opt-in for local debugging only.",
  },

  // ===== LOW / INFO =====
  {
    severity: "Low",
    category: "Information Disclosure",
    title: "Raw exception messages returned directly to clients",
    location:
      "adminController.js:486,6851; adminDbController.js:258,295,315,454; newsletterController.js:180; studentController.js:4035 (representative sample, pattern repeats elsewhere)",
    description: "Several endpoints respond with err.message (sometimes including SQL/library internals) directly in the HTTP response.",
    risk: "Minor internal-detail leakage useful to an attacker probing the API; not independently exploitable.",
    fix: "Log the full error server-side; return a generic message to the client.",
    status: "Fixed",
    dateFixed: FIXED_DATE,
    fixImplemented: "Fixed all 8 cited call sites: each now console.error()s the full error server-side and returns a short, generic message to the client instead of err.message. This was a representative sample per the original audit's scope, not an exhaustive sweep — the same pattern may recur elsewhere in the ~110 other err.message references found; worth a follow-up grep if this class of issue matters for compliance reasons.",
  },
  {
    severity: "Info",
    category: "Code Hygiene",
    title: "Dead/unused isAdmin middleware retains a stale Passport-style check",
    location: "middlewares/auth.js:50-59 (isAdmin, never exported/used) — routes/adminDbRoutes.js:6-11 (commented out)",
    description: "isAdmin still checks req.isAuthenticated && req.isAuthenticated() — a Passport.js pattern this app doesn't use (already fixed in ensureInstructorOrAdmin but not here since it's dead code).",
    risk: "None currently (unused), but a landmine if someone re-enables it expecting it to work like the other guards.",
    fix: "Either delete it, or fix it to match ensureInstructorOrAdmin's pattern and actually wire it in (see the Critical adminRoutes.js finding above).",
    status: "Fixed",
    dateFixed: FIXED_DATE,
    fixImplemented: "Fixed in place and renamed to ensureAdmin (session.user.role check, matching the other guards), exported from middlewares/auth.js, and actually wired in as router.use(ensureAdmin) on both routes/adminRoutes.js and routes/adminDbRoutes.js. No longer dead code.",
  },
  {
    severity: "Info",
    category: "Code Hygiene",
    title: "Duplicate /instructor/dashboard route — the guarded one is unreachable",
    location: "routes/instructor.js:20 (unguarded, matches first) vs :160 (ensureInstructorOrAdmin-guarded, dead code)",
    description: "Express matches the first-registered route; the guarded definition at line 160 can never be reached.",
    risk: "The dashboard route effectively has no middleware at the route level (whatever protection exists must be in-body in instructorDashboard, not verified in this pass).",
    fix: "Remove the dead duplicate at line 160, or move its middleware onto the real route at line 20 and delete the duplicate.",
    status: "Fixed",
    dateFixed: FIXED_DATE,
    fixImplemented: "Removed the dead duplicate route at line 160. The real route at line 20 is now covered by the file's router-wide ensureInstructorOrAdmin gate regardless.",
  },
  {
    severity: "Info",
    category: "Code Hygiene",
    title: "Dead/broken auth logic in submitProject",
    location: "controllers/studentController.js:4962",
    description: "Reads req.session.studentId, a session field that is never set anywhere in the codebase (login only ever sets req.session.user).",
    risk: "None currently exploitable (the check just always fails / 403s), but indicates the endpoint is effectively broken/dead and should be fixed or removed.",
    fix: "Change to req.session.user.id (or req.user.id) to match the rest of the codebase's convention.",
    status: "Fixed",
    dateFixed: FIXED_DATE,
    fixImplemented: "Changed to req.session.user?.id, matching the rest of the codebase. Note left in the code: this function is still non-functional beyond that identifier (it calls an undefined `db.query` and reads from a nonexistent \"enrollments\" table — this file only ever uses `pool`, and the real table is course_enrollments), which is a pre-existing functional bug outside this security pass's scope, not something masked by this fix.",
  },

  // ===== NEW FINDINGS — surfaced during remediation, not in the original audit =====
  {
    severity: "High",
    category: "Secrets Management",
    title: "Live Brevo email API key logged to console on every process start",
    location: "utils/sendEmailWithAttachment.js:10-11 (active) — utils/sendEmail.js:8-9 (same lines, but commented out)",
    description:
      "console.log(\"BREVO_API_KEY:\", process.env.BREVO_API_KEY) and the matching BREVO_FROM line ran unconditionally at module load, printing the real transactional-email API key in full to stdout every time the app started. Caught live during this session's own boot-test verification — it appeared directly in the test server's log output.",
    risk: "Anyone with access to server/hosting logs (or any log aggregation service they're shipped to) gets a live credential capable of sending email as this organization (info@jkthub.com) — phishing, spam, or reputation-damage risk if leaked further.",
    fix: "Remove the console.log lines; never log secret env var values, even for debugging.",
    status: "Fixed",
    dateFixed: FIXED_DATE,
    fixImplemented: "Removed both console.log lines from utils/sendEmailWithAttachment.js. Re-verified with a fresh boot test: the key no longer appears anywhere in server output. Recommend treating this specific key as potentially exposed already (it's been logged on every deploy/restart until now) and rotating it in the Brevo dashboard if there's any chance those logs were ever viewed by someone outside the team or shipped to a third-party log service.",
  },
  {
    severity: "Medium",
    category: "Session Management",
    title: "Session store was never actually wired to Postgres — running on default in-memory store",
    location: "app.js:4 (connect-pg-simple imported) and :59-70 (session() call, no `store` option passed)",
    description:
      "connect-pg-simple was required and instantiated but never passed as the `store` option to express-session, so the app was silently running on express-session's default MemoryStore in production — which its own documentation explicitly says is not designed for production use.",
    risk: "Unbounded memory growth under sustained load (a session-based DoS vector with no cap), and every server restart or redeploy silently logs out every currently-logged-in user (sessions aren't persisted anywhere). Doesn't scale across multiple server processes either.",
    fix: "Pass store: new pgSession({ pool, createTableIfMissing: true }) to the session() config.",
    status: "Fixed",
    dateFixed: FIXED_DATE,
    fixImplemented: "Wired connect-pg-simple in as the session store (app.js), using the app's existing pg Pool, with createTableIfMissing: true. Verified live: a real login created a row in a new `session` table in the actual database, and the session persisted and authenticated correctly across requests.",
  },
  {
    severity: "High",
    category: "Cross-Site Scripting (XSS)",
    title: "Reflected XSS via lesson-file upload error message (crafted filename)",
    location: "middlewares/upload.js's lessonSlideUpload (~line 149, pre-fix) — used by /admin/lessons/create, /admin/lessons/:id/edit, and their /instructor equivalents",
    description:
      "Found while investigating the Cloudinary argument-injection CVE's real reachability in this app. The lesson-file fileFilter's rejection error embedded the raw, attacker-controlled file extension (file.originalname.split('.').pop()) in its message; lessonSlideUpload then interpolated that message directly into a raw HTML string sent via res.send(), unescaped. A filename with no dot (so .pop() returns the whole name) crafted as e.g. '<script>...</script>' would have its content reflected as live HTML back to the uploader's own browser.",
    risk: "An uploader (an authenticated instructor/admin, given this route's auth requirement) tricked into uploading a file named as an HTML/script payload would have it execute in their own session — a real, if narrow, self-XSS vector; worth closing regardless since it costs nothing to fix.",
    fix: "Never interpolate user-controlled content into a raw HTML response without escaping it.",
    status: "Fixed",
    dateFixed: FIXED_DATE,
    fixImplemented:
      "Two independent fixes: (1) the fileFilter error message no longer includes the filename/extension at all — it's now a static, generic 'Unsupported file type' message; (2) added an escapeHtml() helper in middlewares/upload.js and wrapped the interpolated message with it in lessonSlideUpload's HTML response, so any other error message reaching that code path is safe too. Verified live with a direct middleware test: uploading a file named '<script>alert(1)</script>' now returns a clean, generic 400 response with zero trace of the payload in the HTML.",
  },
  {
    severity: "Medium",
    category: "Injection",
    title: "Cloudinary 'format' param built from an unsanitized filename (fragile, not currently exploitable)",
    location: "middlewares/upload.js's lessonStorage (Cloudinary params function, ~line 68 pre-fix)",
    description:
      "format: ext was set from file.originalname.split('.').pop().toLowerCase() with no character sanitization — for a dot-less filename, .pop() returns the entire original filename, meaning an attacker-controlled string could reach Cloudinary's API as a raw parameter. Currently harmless only because the paired fileFilter (a separate function, computing 'ext' the same way) happens to reject anything that isn't an exact match against a 5-item allowlist — but that safety depended on two independently-maintained code blocks staying in sync, and is exactly the pattern the cloudinary SDK's known argument-injection CVE (GHSA-g4mf-96x5-5m2c, see the dependency findings) would exploit if it ever drifted.",
    risk: "Not currently exploitable (verified), but a latent landmine — if the fileFilter's check is ever loosened, or a similar pattern is copied elsewhere without the same paired filter, it becomes a real Cloudinary API argument-injection vector.",
    fix: "Sanitize/allowlist-validate the extension in the same place it's used for the Cloudinary param, not only in a separate filter function.",
    status: "Fixed",
    dateFixed: FIXED_DATE,
    fixImplemented: "Extracted a single safeLessonFileExtension() helper that validates against the allowlist and returns null for anything else; both the Cloudinary params function and fileFilter now call it, so there is exactly one place defining what's a valid extension, and the Cloudinary 'format' param can never receive anything outside pdf/doc/docx/ppt/pptx. Verified via the same live upload tests as the XSS fix above (fileFilter still correctly accepts real pdf/doc/docx/ppt/pptx files and rejects everything else).",
  },

  // ===== NEW FINDINGS — surfaced 2026-09-20 during the CSRF rollout =====
  {
    severity: "Critical",
    category: "Broken Access Control",
    title: "Unauthenticated FAQ edit-form, update, and delete (found while CSRF-testing)",
    location: "routes/adminFaqRoutes.js — GET /admin/faqs/edit/:id, POST /admin/faqs/update/:id, POST /admin/faqs/delete/:id",
    description:
      "Found while picking a real form to browser-test the new CSRF middleware against. Only the FAQ list route (GET /admin/faqs) checked req.session.user.role === 'admin' itself; the edit-form, update, and delete routes in the same file had no auth check whatsoever, reachable by anyone with no login at all — the same class of bug fixed elsewhere in this pass (routes/adminRoutes.js, routes/instructor.js), just in a router file that hadn't been looked at yet.",
    risk: "Anyone, unauthenticated, could view, rewrite, or delete any FAQ's answer, and (until the same-session unrelated sendFaqAnswerEmail bug, unrelated to this finding) trigger an email to whoever originally submitted the question.",
    fix: "Router-wide ensureAdmin gate, matching the pattern already used elsewhere in this pass.",
    status: "Fixed",
    dateFound: FOUND_DATE_2,
    dateFixed: FIXED_DATE_2,
    fixImplemented: "Added router.use(\"/admin/faqs\", ensureAdmin) plus CSRF protection (ensureCsrfToken, verifyCsrfToken) to routes/adminFaqRoutes.js. Verified live: unauthenticated GET /admin/faqs/edit/1 and POST /admin/faqs/update/1 both now redirect to login; a real admin session can still view and save. See the next finding for why this needed a path-scoped router.use() specifically, not a plain one.",
  },
  {
    severity: "Critical",
    category: "Broken Access Control",
    title: "Mis-scoped router.use() briefly made every /admin/faqs/* fix apply site-wide, breaking /instructor/login",
    location: "routes/adminFaqRoutes.js (mounted at \"/\" in app.js, not \"/admin/faqs\")",
    description:
      "This router is mounted at the app ROOT (app.use(\"/\", adminFaqRoutes)) because its own route definitions hardcode full \"/admin/faqs/...\" paths instead of being relative — unlike every other router in this app, which is mounted at its own specific prefix. Adding a path-less router.use(ensureAdmin) here (matching the pattern used correctly elsewhere) meant that middleware ran for EVERY request in the whole app that falls through to this router — i.e. any request not matched by an earlier, more specific one — not just requests under /admin/faqs. Caught immediately via live browser testing: POST /instructor/login started redirecting to /admin/login because it fell through publicRoutes/adminRoutes/etc. (none of which match it) into adminFaqRoutes' now-blanket admin check, and never reached routes/instructor.js at all, which is mounted later in app.js.",
    risk: "Would have broken login and likely most functionality for every non-admin role (instructor, student, teacher, school_admin, parent) app-wide the moment this shipped — anything not matched by an earlier-registered, more specific router.",
    fix: "Scope the middleware explicitly to the path this router actually owns: router.use(\"/admin/faqs\", ensureAdmin) instead of router.use(ensureAdmin).",
    status: "Fixed",
    dateFound: FOUND_DATE_2,
    dateFixed: FIXED_DATE_2,
    fixImplemented: "Added the explicit \"/admin/faqs\" path argument to both router.use() calls in routes/adminFaqRoutes.js. Verified live: /instructor/login works again, homepage/gallery (public) still 200, /admin/faqs/* still properly gated. Also proactively checked every other router mounted at \"/\" in app.js (publicRoutes, userRoutes, aboutRoutes, galleryRoutes, publicFaqRoutes, messageRoutes, adminTestimonyRoutes, testRoutes) for the same pattern — found one more, see the next finding — and confirmed the rest have no path-less router.use() middleware of their own.",
  },
  {
    severity: "High",
    category: "Broken Access Control",
    title: "Same mis-scoped router.use() pattern, pre-existing, in notificationRoutes.js",
    location: "routes/notificationRoutes.js (also mounted at \"/\" in app.js)",
    description:
      "Found by proactively auditing every root-mounted router for the same mistake after catching it live in adminFaqRoutes.js (see above). router.use(ensureAuthenticated) with no path argument, in a router mounted at \"/\" — meaning it was already running (pre-existing, not introduced this session) for every request that falls through to it, requiring ANY authenticated session (not just for its own 4 notification routes) for anything unmatched by an earlier router. Whether this was ever actually reachable in practice is unclear — earlier-registered, more specific routers (student/school-admin/teacher/instructor, all mounted before this one) intercept most real traffic first — but it's the same class of landmine.",
    risk: "Any request that reaches this router unmatched gets an authentication requirement it was never meant to have, for reasons that would look inexplicable without tracing the exact router mount order.",
    fix: "Scope to the actual path: router.use(\"/notifications\", ensureAuthenticated).",
    status: "Fixed",
    dateFound: FOUND_DATE_2,
    dateFixed: FIXED_DATE_2,
    fixImplemented: "Added the explicit \"/notifications\" path argument. Verified live: unauthenticated GET /notifications -> 302 (still correctly protected), authenticated -> 200.",
  },
  {
    severity: "Critical",
    category: "Business Logic / Broken Access Control",
    title: "Wallet top-up had no login requirement and credited an attacker-chosen email",
    location: "routes/publicRoutes.js (POST /verify-payment)",
    description:
      "Found while adding CSRF protection to this exact route. The handler took email straight from req.body (not req.session.user.email) and did UPDATE users2 SET wallet_balance2 = wallet_balance2 + $1 WHERE email = $2 using that attacker-supplied value, with no login check on the route at all. Paystack verification itself was legitimate (it does call Paystack's real verify API rather than trusting a client-asserted \"success\"). Re-checked transactions.reference directly against the live database while investigating: it already has a UNIQUE constraint, so exact same-reference replay was already blocked at the DB level — just ungracefully (a generic 500 instead of a clear message) — so the practical severity is \"any payment can be routed to an arbitrary account\" rather than \"one payment can fund unlimited accounts.\"",
    risk: "Anyone who obtains any valid, already-successful Paystack reference (including a small legitimate payment of their own) could POST it here with a different target email and credit that account's wallet instead of their own — no login, no ownership check, no CSRF token (before this pass) stood in the way.",
    fix: "Require req.session.user and use req.session.user.email (matching /make-payment's own requirement) instead of trusting req.body.email; add an explicit pre-check against transactions.reference for a clean, intentional rejection rather than relying solely on the DB constraint's generic error.",
    status: "Fixed",
    dateFound: FOUND_DATE_2,
    dateFixed: FIXED_DATE_2,
    fixImplemented:
      "routes/publicRoutes.js's /verify-payment now: (1) requires req.session.user.email up front, returning 401 otherwise; (2) looks up the real fullname/id server-side from that session email via users2, never trusting req.body for identity — req.body now only supplies reference; (3) checks transactions for an existing row with that reference BEFORE calling Paystack at all, returning a clean 409 'already been processed' instead of reaching the API or relying solely on the UNIQUE constraint; (4) credits wallet_balance2 by the looked-up user's id, not by an email from the request. Verified live: unauthenticated POST -> blocked (403 via the CSRF gate, and would 401 on session check regardless); authenticated POST with a spoofed email in the body correctly ignored (proceeds using the session's own email, verified by tracing the flow to a real Paystack API call rather than a spoofed-email short-circuit); authenticated POST replaying a reference already recorded in transactions (inserted as a stand-in for someone else's real prior payment) -> instant 409, wallet balance confirmed unchanged in the database. Could not test the full successful-credit path end-to-end since that requires an actual completed Paystack transaction, but every code path touching identity or the reference check was verified directly.",
  },
  {
    severity: "High",
    category: "Business Logic / Broken Access Control",
    title: "Event-payment verification had no ownership check, letting one real payment be pointed at any registration",
    location: "routes/publicRoutes.js (GET /pay-event/:regId, POST /verify-event-payment)",
    description:
      "Both routes are intentionally public — event registration is a guest flow with no account required, so (unlike /make-payment) requiring login isn't the right fix here. The real gaps: /verify-event-payment took regId and reference from the request body, verified the reference with Paystack, then marked that registration paid — with no check that the same reference wasn't already used elsewhere, and no check tying the verified payment to the specific registration it claimed to be for.",
    risk: "An attacker could call this directly with any regId and any reference they'd legitimately obtained (even for an unrelated, smaller transaction) and mark someone else's event registration as paid.",
    fix: "Record and check the reference against a UNIQUE-constrained ledger before applying it; cross-check the verified payment's own recorded identity against the specific registration it's being applied to.",
    status: "Fixed",
    dateFound: FOUND_DATE_2,
    dateFixed: FIXED_DATE_2,
    fixImplemented:
      "Reused the existing transactions table (already UNIQUE-constrained on reference, from the /verify-payment fix) as the ledger here too: the reference is checked against it before ever calling Paystack (clean 409 'already been processed' if found), and a row is inserted there immediately after a successful, validated payment — so a reference can never be reused for any registration, this one or another. Added an ownership check: eventPayment.ejs already sends email: reg.registrant_email to Paystack at checkout (PaystackPop.setup) — the fix cross-checks Paystack's own verify response (payment.customer.email, which reflects what was actually charged, not anything client-supplied at verify time) against reg.registrant_email, rejecting with 403 on a mismatch. Also fixed an adjacent, unrelated crash found while reading this code: the GET route referenced `e.amount` (e is only a SQL alias, not a JS variable) instead of `reg.amount`, throwing a ReferenceError for any registration with neither total_amount nor amount_paid set yet. Verified live: missing reference/regId -> 400; unknown regId -> 404; a fresh unknown reference correctly reaches Paystack's real API and fails there (as before); replaying an already-recorded reference (simulating a real unrelated payment) against a registration -> instant 409, confirmed the registration's amount_paid/payment_status were left untouched in the database; the GET page no longer crashes on the e.amount bug. Could not test the email-cross-check's rejection path itself end-to-end (would require a real completed Paystack transaction with a specific customer email), but the comparison logic was verified by direct code review and the rest of the flow around it is live-tested.",
  },
];

// ---------- Build workbook ----------
async function main() {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Security Audit";
  wb.created = new Date();

  // ===== Summary sheet =====
  const sum = wb.addWorksheet("Summary", {
    properties: { tabColor: { argb: BRAND_GOLD } },
    views: [{ showGridLines: false }],
  });
  sum.columns = [{ width: 4 }, { width: 26 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }];

  sum.mergeCells("B2:F2");
  const title = sum.getCell("B2");
  title.value = "JKT Hub — Security Audit Tracker";
  title.font = { bold: true, size: 20, color: { argb: BRAND_DARK } };

  sum.mergeCells("B3:F3");
  const subtitle = sum.getCell("B3");
  subtitle.value = "Last updated: " + FIXED_DATE_2 + "  \u00b7  Re-run buildSecurityTracker.js after editing FINDINGS to refresh this sheet's counts.";
  subtitle.font = { italic: true, size: 10, color: { argb: "FF6B7280" } };

  const severities = ["Critical", "High", "Medium", "Low", "Info", "Resolved"];
  let row = 5;
  sum.getCell(`B${row}`).value = "By Severity";
  sum.getCell(`B${row}`).font = { bold: true, size: 13, color: { argb: BRAND_DARK } };
  row++;
  ["Severity", "Open", "Fixed", "Total"].forEach((h, i) => {
    const c = sum.getCell(row, 2 + i);
    c.value = h;
    c.font = { bold: true, color: { argb: WHITE } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND_DARK } };
    c.alignment = { horizontal: "center" };
    c.border = thinBorder();
  });
  row++;
  severities.forEach((sev) => {
    const open = FINDINGS.filter((f) => f.severity === sev && !["Fixed", "Verified Secure", "Won't Fix", "Accepted Risk"].includes(f.status)).length;
    const fixed = FINDINGS.filter((f) => f.severity === sev && ["Fixed", "Verified Secure"].includes(f.status)).length;
    const total = FINDINGS.filter((f) => f.severity === sev).length;
    const c0 = sum.getCell(row, 2);
    c0.value = sev;
    const colors = SEVERITY_COLORS[sev];
    c0.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colors.fill } };
    c0.font = { bold: true, color: { argb: colors.font } };
    c0.alignment = { horizontal: "center" };
    c0.border = thinBorder();
    [open, fixed, total].forEach((v, i) => {
      const c = sum.getCell(row, 3 + i);
      c.value = v;
      c.alignment = { horizontal: "center" };
      c.border = thinBorder();
      c.font = { bold: i === 2 };
    });
    row++;
  });

  row += 1;
  const totalCount = FINDINGS.length;
  const fixedCount = FINDINGS.filter((f) => ["Fixed", "Verified Secure"].includes(f.status)).length;
  const inProgressCount = FINDINGS.filter((f) => f.status === "In Progress").length;
  sum.getCell(`B${row}`).value = `Overall: ${fixedCount} of ${totalCount} fixed/verified secure, ${inProgressCount} in progress`;
  sum.getCell(`B${row}`).font = { bold: true, size: 12, color: { argb: "FF14532D" } };
  sum.mergeCells(`B${row}:F${row}`);
  row += 2;

  sum.getCell(`B${row}`).value = "How to use this tracker";
  sum.getCell(`B${row}`).font = { bold: true, size: 13, color: { argb: BRAND_DARK } };
  row++;
  const notes = [
    "Go to the \"Findings\" sheet for the full list, one row per issue.",
    "Update the Status column as work happens: Open -> In Progress -> Fixed (or Verified Secure / Won't Fix / Accepted Risk).",
    "\"Fix Implemented\" records what was actually done — fill it in (or ask your assistant to) whenever Status moves to Fixed.",
    "Rows are sorted most-severe first. Use the filter arrows on the header row to slice by Severity, Category, or Status.",
    "Ask your assistant to update this file whenever a fix from the list is completed, or edit it directly in Excel.",
  ];
  notes.forEach((n) => {
    sum.getCell(`B${row}`).value = `•  ${n}`;
    sum.getCell(`B${row}`).font = { size: 10.5 };
    sum.mergeCells(`B${row}:F${row}`);
    row++;
  });

  // ===== Findings sheet =====
  const ws = wb.addWorksheet("Findings", {
    properties: { tabColor: { argb: "FFDC2626" } },
    views: [{ state: "frozen", ySplit: 1, showGridLines: false }],
  });

  const columns = [
    { header: "#", key: "id", width: 5 },
    { header: "Severity", key: "severity", width: 11 },
    { header: "Status", key: "status", width: 15 },
    { header: "Category", key: "category", width: 20 },
    { header: "Title", key: "title", width: 40 },
    { header: "Location (file:line)", key: "location", width: 40 },
    { header: "Description", key: "description", width: 38 },
    { header: "Risk / Impact", key: "risk", width: 34 },
    { header: "Recommended Fix", key: "fix", width: 34 },
    { header: "Fix Implemented", key: "fixImplemented", width: 46 },
    { header: "Date Found", key: "dateFound", width: 12 },
    { header: "Date Fixed", key: "dateFixed", width: 12 },
    { header: "Notes", key: "notes", width: 26 },
  ];
  ws.columns = columns;

  // Severity sort order: Critical > High > Medium > Low > Info > Resolved
  const order = { Critical: 0, High: 1, Medium: 2, Low: 3, Info: 4, Resolved: 5 };
  const sorted = [...FINDINGS].sort((a, b) => order[a.severity] - order[b.severity]);

  sorted.forEach((f, i) => {
    ws.addRow({
      id: i + 1,
      severity: f.severity,
      status: f.status,
      category: f.category,
      title: f.title,
      location: f.location,
      description: f.description,
      risk: f.risk,
      fix: f.fix,
      fixImplemented: f.fixImplemented || "",
      dateFound: f.dateFound || FOUND_DATE,
      dateFixed: f.dateFixed || "",
      notes: "",
    });
  });

  // Header styling
  const header = ws.getRow(1);
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: WHITE }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND_DARK } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = thinBorder();
  });
  header.height = 22;
  ws.autoFilter = { from: "A1", to: "M1" };

  // Body styling + severity/status color coding + zebra striping
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const sevCell = row.getCell(2);
    const statusCell = row.getCell(3);
    const sevColors = SEVERITY_COLORS[sevCell.value] || {};
    const statColors = STATUS_COLORS[statusCell.value] || {};

    sevCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: sevColors.fill || "FFFFFFFF" } };
    sevCell.font = { bold: true, color: { argb: sevColors.font || "FF000000" } };
    sevCell.alignment = { horizontal: "center", vertical: "middle" };

    statusCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: statColors.fill || "FFFFFFFF" } };
    statusCell.font = { bold: true, color: { argb: statColors.font || "FF000000" } };
    statusCell.alignment = { horizontal: "center", vertical: "middle" };

    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cell.border = thinBorder();
      cell.alignment = { ...cell.alignment, vertical: "top", wrapText: true };
      if (![1, 2, 3, 11, 12].includes(colNumber)) {
        cell.font = { size: 10 };
      }
      if (colNumber === 1) cell.alignment = { horizontal: "center", vertical: "top" };
      if (r % 2 === 0 && colNumber !== 2 && colNumber !== 3) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND_CREAM } };
      }
    });
  }

  // Data validation dropdown for Status column (rows 2..N)
  for (let r = 2; r <= ws.rowCount; r++) {
    ws.getCell(`C${r}`).dataValidation = {
      type: "list",
      allowBlank: false,
      formulae: [`"${STATUS_OPTIONS.join(",")}"`],
    };
  }

  ws.getColumn("dateFound").alignment = { horizontal: "center" };
  ws.getColumn("dateFixed").alignment = { horizontal: "center" };

  await wb.xlsx.writeFile(OUT_PATH);
  console.log("Wrote", OUT_PATH, "-", FINDINGS.length, "findings");
}

function thinBorder() {
  const style = { style: "thin", color: { argb: "FFD1D5DB" } };
  return { top: style, left: style, bottom: style, right: style };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
