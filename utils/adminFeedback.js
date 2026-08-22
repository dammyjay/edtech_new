// Shared helper for admin CRUD redirects: appends a small toast payload to
// the redirect URL so the next page can show "Course updated" / "Thumbnail
// regenerated" etc. instead of silently landing the admin back on a list.
function withFeedback(url, message, type = "success") {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}toast=${encodeURIComponent(message)}&toastType=${encodeURIComponent(type)}`;
}

// Course/module CRUD forms carry a hidden redirect_to field so the admin
// lands back on whichever page they actually triggered the action from
// (main /admin/courses list vs. a pathway's /admin/pathways/:id/courses
// list). Only ever trust it if it's an internal /admin/... path — anything
// else (missing, absolute URL, protocol-relative "//host", etc.) falls back
// to a safe default instead, to avoid an open-redirect via a spoofed field.
function safeRedirectTarget(target, fallback) {
  if (typeof target === "string" && target.startsWith("/admin/") && !target.startsWith("//")) {
    return target;
  }
  return fallback;
}

module.exports = { withFeedback, safeRedirectTarget };
