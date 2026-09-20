// Lightweight session-bound synchronizer-token CSRF protection —
// hand-rolled rather than a library (csurf is deprecated and unmaintained;
// this app already has express-session wired up, which is all a
// synchronizer token actually needs). Same pattern Django/Rails use: one
// random token per session, embedded in every form/AJAX call this app
// protects, checked against the session's copy on every state-changing
// request.
//
// Being rolled out incrementally, router by router, rather than as one
// app-wide gate — each router needs its rendered views confirmed to
// actually carry the token (via the shared <meta name="csrf-token"> tag
// + public/js/csrf.js, which auto-attaches it to same-origin fetch()
// calls and form submits) before it's safe to enforce. ensureCsrfToken is
// cheap and side-effect-free, so it's applied app-wide (app.js) to make
// the token available everywhere; verifyCsrfToken is applied per-router
// as each one is confirmed covered.
const crypto = require("crypto");

function ensureCsrfToken(req, res, next) {
  if (req.session && !req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  }
  res.locals.csrfToken = req.session ? req.session.csrfToken : null;
  next();
}

// Accepts the token either as an X-CSRF-Token header (used by this app's
// fetch()-based AJAX calls) or a _csrf body field (used by native <form>
// submits) — checked against the session's token via a constant-time
// comparison so response timing can't be used to guess it. Safe methods
// (GET/HEAD/OPTIONS) are never state-changing, so they pass through
// unchecked — lets this run as a blanket router.use() without needing to
// be threaded onto only the POST/PUT/PATCH/DELETE routes individually.
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function verifyCsrfToken(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const sessionToken = req.session && req.session.csrfToken;
  const submittedToken = req.headers["x-csrf-token"] || (req.body && req.body._csrf);

  if (
    !sessionToken ||
    !submittedToken ||
    typeof submittedToken !== "string" ||
    submittedToken.length !== sessionToken.length ||
    !crypto.timingSafeEqual(Buffer.from(submittedToken), Buffer.from(sessionToken))
  ) {
    return res
      .status(403)
      .send("Invalid or expired form session. Please refresh the page and try again.");
  }

  // Deliberately NOT deleting req.body._csrf here (an earlier version did).
  // routes/adminRoutes.js mounts at the general "/admin" prefix, and its
  // router.use(ensureCsrfToken, verifyCsrfToken) — like its ensureAdmin
  // gate — runs for ANY "/admin/*" request that reaches it, including ones
  // that don't match a route defined in that file and fall through to a
  // sibling router mounted at a more specific prefix (/admin/db, /admin/
  // newsletters, /admin/faqs via adminFaqRoutes at "/", etc.) registered
  // later in app.js. That means a single request can legitimately pass
  // through this exact check twice, once per router. Deleting the token
  // after the first (redundant) pass left nothing for the second, real
  // check to find — a real bug this comment is here to stop someone from
  // "helpfully" reintroducing. Every handler that reads req.body destructures
  // the specific fields it wants, so an unconsumed _csrf field is harmless.
  next();
}

module.exports = { ensureCsrfToken, verifyCsrfToken };
