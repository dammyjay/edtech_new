// Shared replacement for the old res.status(500).send("Server error")
// pattern used across ~19 controllers. Renders views/error.ejs, which
// immediately shows the SAME modal component the rest of the app already
// uses for AJAX errors (public/js/uiAlerts.js's showAlert) — so a full
// page-load failure looks and behaves like every other error notification
// instead of a blank page with plain text, and actually says what went
// wrong instead of a generic "Internal Server Error".
//
// Usage: replace
//   } catch (err) {
//     console.error("...", err);
//     res.status(500).send("Server error");
//   }
// with
//   } catch (err) {
//     renderErrorPage(req, res, err, { context: "..." });
//   }
function renderErrorPage(req, res, err, options = {}) {
  console.error(options.context || "Error:", err);

  res.status(options.status || 500).render("error", {
    // err.message is shown deliberately, not swallowed into a generic
    // string — the whole point of this helper is to say what actually
    // broke (e.g. "column x.y does not exist") instead of hiding it.
    message: options.message || err?.message || "An unexpected error occurred.",
    backUrl: options.backUrl || req.get("referer") || "/",
    user: req.session?.user || null,
    users: req.session?.user || null,
    info: res.locals.info || {},
  });
}

module.exports = renderErrorPage;
