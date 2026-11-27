// public/js/copyLink.js
// Shared "Copy Link" handler for the /go/:type/:id share links (instructor/
// admin course-content views). Reuses uiAlerts.js's showAlert, already
// loaded site-wide, for the confirmation toast instead of inventing new
// toast markup.
function copyShareLink(path) {
  const full = window.location.origin + path;
  const notify = (msg, type) => {
    if (window.showAlert) window.showAlert(msg, type);
  };
  if (!navigator.clipboard) {
    notify("Couldn't copy link — copy it manually: " + full, "error");
    return;
  }
  navigator.clipboard
    .writeText(full)
    .then(() => notify("Link copied!", "success"))
    .catch(() => notify("Couldn't copy link", "error"));
}
