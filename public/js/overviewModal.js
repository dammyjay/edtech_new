// public/js/overviewModal.js
//
// Shared "View Overview" modal for courses and modules — a thumbnail +
// the CKEditor-authored description, styled with the same .lesson-doc
// card treatment the student lesson-note viewer already uses (see
// public/css/styles2.css's "LESSON DOCUMENT THEME" section), shown
// view-only in a popup instead of being dumped as a raw HTML blob
// inline on the page (the previous pattern on singleCourse.ejs and
// nowhere at all on moduleDetails.ejs).
//
// Load this once per page (views/singleCourse.ejs, views/student/
// moduleDetails.ejs, admin course/module lists, etc.) and call
// window.openOverviewModal({ kind, title, thumbnail, contentHtml, downloadUrl }):
//   kind        — "Course" or "Module" (drives the eyebrow label + badge emoji)
//   title       — course/module title
//   thumbnail   — image URL, or falsy to skip the thumbnail
//   contentHtml — the raw CKEditor HTML (course.description / module.description)
//   downloadUrl — ONLY passed by admin-facing callers; when present a
//                 "Download PDF" button is shown. Regular callers (student/
//                 parent-facing pages) must never pass this — view-only
//                 is the whole point for those.
(function () {
  const MODAL_ID = "sharedOverviewModal";

  function ensureModal() {
    let modal = document.getElementById(MODAL_ID);
    if (modal) return modal;

    modal = document.createElement("div");
    modal.id = MODAL_ID;
    modal.className = "modal-overlay";
    modal.innerHTML = `
      <div class="modal-content overview-modal-content">
        <span class="close" id="${MODAL_ID}Close">&times;</span>
        <div class="lesson-doc">
          <div class="lesson-doc-header">
            <span class="lesson-doc-badge" id="${MODAL_ID}Badge">📘</span>
            <div>
              <div class="lesson-doc-eyebrow" id="${MODAL_ID}Eyebrow">Overview</div>
              <div class="lesson-doc-title" id="${MODAL_ID}Title"></div>
            </div>
          </div>
          <img id="${MODAL_ID}Thumb" class="overview-modal-thumb" alt="" hidden />
          <div class="overview-modal-body">
            <div class="overview-content" id="${MODAL_ID}Content"></div>
          </div>
        </div>
        <div class="overview-modal-actions" id="${MODAL_ID}Actions" hidden>
          <a id="${MODAL_ID}Download" class="btn-primary" style="text-decoration:none;">⬇️ Download PDF</a>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const close = () => { modal.style.display = "none"; };
    modal.querySelector(`#${MODAL_ID}Close`).addEventListener("click", close);
    modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal.style.display === "flex") close();
    });

    return modal;
  }

  window.openOverviewModal = function ({ kind, title, thumbnail, contentHtml, downloadUrl }) {
    const modal = ensureModal();
    const badge = kind === "Module" ? "📦" : "📘";

    modal.querySelector(`#${MODAL_ID}Badge`).textContent = badge;
    modal.querySelector(`#${MODAL_ID}Eyebrow`).textContent = `${kind || "Course"} Overview`;
    modal.querySelector(`#${MODAL_ID}Title`).textContent = title || "";

    const thumbEl = modal.querySelector(`#${MODAL_ID}Thumb`);
    if (thumbnail) {
      thumbEl.src = thumbnail;
      thumbEl.alt = title || "";
      thumbEl.hidden = false;
    } else {
      thumbEl.hidden = true;
    }

    const contentEl = modal.querySelector(`#${MODAL_ID}Content`);
    contentEl.innerHTML = contentHtml && contentHtml.trim()
      ? contentHtml
      : '<p style="color:#999;">No overview has been added yet.</p>';

    const actions = modal.querySelector(`#${MODAL_ID}Actions`);
    const downloadLink = modal.querySelector(`#${MODAL_ID}Download`);
    if (downloadUrl) {
      downloadLink.href = downloadUrl;
      actions.hidden = false;
    } else {
      actions.hidden = true;
    }

    modal.style.display = "flex";
  };

  window.closeOverviewModal = function () {
    const modal = document.getElementById(MODAL_ID);
    if (modal) modal.style.display = "none";
  };

  // Declarative trigger: <button class="overview-trigger-btn"
  //   data-kind="Course|Module" data-title="…" data-thumbnail="…"
  //   data-content-id="idOfHiddenElementHoldingTheHtml"
  //   data-download-url="…(optional, admin-only callers set this)">
  // Delegated (not a per-button listener) so it works regardless of how
  // the button arrived in the DOM, and — the actual reason this exists —
  // so callers never have to embed JSON.stringify()'d title/thumbnail
  // text inside an inline onclick="..." attribute: that breaks the
  // instant the value contains a double-quote (JSON.stringify's own
  // wrapping quotes, guaranteed on every string), silently truncating
  // the attribute and leaving a syntax error in the rest of the page's
  // scripts. data-* attributes, written with EJS's escaping `<%= %>`,
  // don't have that problem.
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".overview-trigger-btn");
    if (!btn) return;
    const contentEl = btn.dataset.contentId ? document.getElementById(btn.dataset.contentId) : null;
    window.openOverviewModal({
      kind: btn.dataset.kind || "Course",
      title: btn.dataset.title || "",
      thumbnail: btn.dataset.thumbnail || null,
      contentHtml: contentEl ? contentEl.innerHTML : "",
      downloadUrl: btn.dataset.downloadUrl || null,
    });
  });
})();
