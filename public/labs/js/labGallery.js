// public/labs/js/labGallery.js
//
// Browse/like/remix/report for the platform-wide project gallery
// (views/labs/gallery.ejs). Talks to routes/labRoutes.js's /gallery/*
// JSON endpoints (controllers/labController.js's gallery* exports).
//
// Uses window.showConfirm/showAlert from public/js/uiAlerts.js (loaded
// globally via views/partials/header.ejs) for confirmation dialogs —
// remix in particular is destructive (see the warning in the confirm
// text below) and needs a real confirm, not a silent action.

(function () {
  const grid = document.getElementById("galleryGrid");
  const loadingEl = document.getElementById("galleryLoading");
  const emptyEl = document.getElementById("galleryEmpty");
  const loadMoreBtn = document.getElementById("galleryLoadMore");
  const typeFilterGroup = document.getElementById("galleryTypeFilter");
  const sortFilterGroup = document.getElementById("gallerySortFilter");
  const modal = document.getElementById("galleryModal");
  const modalBody = document.getElementById("galleryModalBody");
  const modalClose = document.getElementById("galleryModalClose");

  if (!grid) return; // not on the gallery page

  const state = { labType: "", sort: "new", page: 1, loading: false, exhausted: false };

  function showToast(message) {
    const toast = document.createElement("div");
    toast.textContent = message;
    Object.assign(toast.style, {
      position: "fixed", bottom: "20px", right: "20px", background: "rgba(0,0,0,0.75)",
      color: "#fff", padding: "10px 16px", borderRadius: "8px", zIndex: 9999,
      fontSize: "13px", transition: "opacity 0.3s",
    });
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = "0"; }, 1800);
    setTimeout(() => toast.remove(), 2200);
  }

  const labMeta = {
    web: { icon: "🌐", label: "Web Lab" },
    blockly: { icon: "🧩", label: "Blockly Lab" },
  };

  function cardHtml(p) {
    const meta = labMeta[p.lab_type] || { icon: "🛠️", label: p.lab_type };
    const rating = Number(p.avg_rating) || 0;
    return `
      <div class="gallery-card" data-id="${p.id}">
        ${p.remixed_from_id ? `<span class="gallery-remix-tag">🍴 Remix</span>` : ""}
        <div class="gallery-card-top">
          <span class="gallery-card-icon">${meta.icon}</span>
          <div>
            <p class="gallery-card-title">${escapeHtml(p.project_name || "Untitled project")}</p>
            <p class="gallery-card-author">by ${escapeHtml(p.student_name || "a student")}</p>
          </div>
        </div>
        <div class="gallery-card-badges">
          <span>❤️ ${p.like_count}</span>
          <span>${rating ? `★ ${rating.toFixed(1)} (${p.review_count})` : "☆ No ratings yet"}</span>
          ${p.remix_count ? `<span>🍴 ${p.remix_count}</span>` : ""}
        </div>
      </div>
    `;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  async function loadProjects(reset) {
    if (state.loading || (state.exhausted && !reset)) return;
    state.loading = true;
    if (reset) {
      state.page = 1;
      state.exhausted = false;
      grid.innerHTML = "";
      emptyEl.style.display = "none";
      loadingEl.style.display = "block";
    }

    try {
      const params = new URLSearchParams({ page: state.page, sort: state.sort });
      if (state.labType) params.set("labType", state.labType);

      const res = await fetch(`/labs/gallery/projects?${params.toString()}`);
      const data = await res.json();
      loadingEl.style.display = "none";

      if (!data.success) {
        grid.insertAdjacentHTML("beforeend", `<p class="gallery-empty">Couldn't load the gallery right now.</p>`);
        return;
      }

      const projects = data.projects || [];
      if (state.page === 1 && projects.length === 0) {
        emptyEl.style.display = "block";
      }

      grid.insertAdjacentHTML("beforeend", projects.map(cardHtml).join(""));

      state.exhausted = projects.length < 24;
      loadMoreBtn.style.display = state.exhausted ? "none" : "block";
      state.page += 1;
    } catch (err) {
      console.error("Gallery load error:", err);
      loadingEl.style.display = "none";
    } finally {
      state.loading = false;
    }
  }

  grid.addEventListener("click", (e) => {
    const card = e.target.closest(".gallery-card");
    if (card) openDetail(card.dataset.id);
  });

  typeFilterGroup.addEventListener("click", (e) => {
    const btn = e.target.closest(".gallery-filter-btn");
    if (!btn) return;
    typeFilterGroup.querySelectorAll(".gallery-filter-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.labType = btn.dataset.type || "";
    loadProjects(true);
  });

  sortFilterGroup.addEventListener("click", (e) => {
    const btn = e.target.closest(".gallery-filter-btn");
    if (!btn) return;
    sortFilterGroup.querySelectorAll(".gallery-filter-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.sort = btn.dataset.sort || "new";
    loadProjects(true);
  });

  loadMoreBtn.addEventListener("click", () => loadProjects(false));

  // ---- Detail modal ----------------------------------------------------

  function normalizeWebProjectData(raw) {
    if (raw && Array.isArray(raw.pages) && raw.pages.length) {
      const activePage = raw.pages.some((p) => p.name === raw.activePage) ? raw.activePage : raw.pages[0].name;
      const page = raw.pages.find((p) => p.name === activePage) || raw.pages[0];
      return { html: page.html || "", css: raw.css || "", js: raw.js || "" };
    }
    return { html: (raw && raw.html) || "", css: (raw && raw.css) || "", js: (raw && raw.js) || "" };
  }

  function buildWebPreviewSrcdoc(projectData) {
    const { html, css, js } = normalizeWebProjectData(projectData || {});
    return `<!DOCTYPE html><html><head><style>${css}</style></head><body>${html}<script>${js}<\/script></body></html>`;
  }

  function closeModal() {
    modal.style.display = "none";
    modalBody.innerHTML = "";
  }
  modalClose.addEventListener("click", closeModal);
  modal.querySelector(".gallery-modal-backdrop").addEventListener("click", closeModal);

  async function openDetail(id) {
    modal.style.display = "flex";
    modalBody.innerHTML = `<p class="gallery-empty">Loading…</p>`;

    try {
      const res = await fetch(`/labs/gallery/projects/${id}`);
      const data = await res.json();
      if (!data.success) {
        modalBody.innerHTML = `<p class="gallery-empty">Couldn't load this project.</p>`;
        return;
      }
      renderDetail(data);
    } catch (err) {
      console.error("Gallery detail error:", err);
      modalBody.innerHTML = `<p class="gallery-empty">Couldn't load this project.</p>`;
    }
  }

  function renderDetail(data) {
    const { project, isOwner, likeCount, likedByMe, reviews, remixCount } = data;
    const meta = labMeta[project.lab_type] || { icon: "🛠️", label: project.lab_type };

    let previewHtml;
    if (project.lab_type === "web") {
      // The iframe's srcdoc is set as a DOM property below, not embedded
      // here as an HTML attribute string — the student's HTML/CSS/JS is
      // full of double quotes (class="...", "use strict", ...) that would
      // otherwise break out of a quoted srcdoc="..." attribute.
      previewHtml = `<iframe class="gallery-preview-frame" id="galleryPreviewFrame" sandbox="allow-scripts"></iframe>`;
    } else if (project.lab_type === "blockly") {
      const code = (project.project_data && project.project_data.generatedCode) || "(No blocks were placed.)";
      previewHtml = `
        <pre class="gallery-preview-code">${escapeHtml(code)}</pre>
        <p style="font-size:12px; color:var(--text-secondary,#666);">Blockly projects show their generated code here — remix it to open the actual blocks in the editor.</p>
      `;
    } else {
      previewHtml = `<p class="gallery-empty">No preview available for this lab type yet.</p>`;
    }

    const remixAttribution = project.remixed_from_id
      ? `<p style="font-size:12px; color:var(--text-secondary,#666);">🍴 Remixed from "${escapeHtml(project.remixed_from_name || "a project")}" by ${escapeHtml(project.remixed_from_student_name || "a student")}</p>`
      : "";

    const actions = isOwner
      ? `<button type="button" class="gallery-action-btn unpublish" id="galleryUnpublishBtn">🚫 Unpublish</button>`
      : `
        <button type="button" class="gallery-action-btn like ${likedByMe ? "liked" : ""}" id="galleryLikeBtn">
          ${likedByMe ? "❤️ Liked" : "🤍 Like"} (${likeCount})
        </button>
        <button type="button" class="gallery-action-btn remix" id="galleryRemixBtn">🍴 Remix this</button>
        <button type="button" class="gallery-action-btn report" id="galleryReportBtn">🚩 Report</button>
      `;

    const reviewsHtml = reviews.length
      ? reviews.map((r) => `
          <div class="gallery-review">
            <strong>${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}</strong>
            ${r.comment ? `— ${escapeHtml(r.comment)}` : ""}
            <div style="color:var(--text-secondary,#666); font-size:11px;">${escapeHtml(r.reviewer_name)}</div>
          </div>
        `).join("")
      : `<p style="font-size:13px; color:var(--text-secondary,#666);">No reviews yet.</p>`;

    modalBody.innerHTML = `
      <div class="gallery-card-top" style="margin-bottom:4px;">
        <span class="gallery-card-icon">${meta.icon}</span>
        <div>
          <p class="gallery-card-title" style="font-size:19px;">${escapeHtml(project.project_name || "Untitled project")}</p>
          <p class="gallery-card-author">by ${escapeHtml(project.student_name)}${remixCount ? ` · 🍴 ${remixCount} remix${remixCount === 1 ? "" : "es"}` : ""}</p>
        </div>
      </div>
      ${remixAttribution}
      ${previewHtml}
      <div class="gallery-action-row">${actions}</div>
      <div class="gallery-reviews">
        <h4 style="margin:0 0 8px;">Reviews</h4>
        ${reviewsHtml}
      </div>
    `;

    const previewFrame = document.getElementById("galleryPreviewFrame");
    if (previewFrame) {
      previewFrame.srcdoc = buildWebPreviewSrcdoc(project.project_data);
    }

    const likeBtn = document.getElementById("galleryLikeBtn");
    if (likeBtn) {
      likeBtn.addEventListener("click", async () => {
        likeBtn.disabled = true;
        try {
          const res = await fetch("/labs/gallery/like", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId: project.id }),
          });
          const result = await res.json();
          if (result.success) {
            likeBtn.classList.toggle("liked", result.liked);
            likeBtn.textContent = `${result.liked ? "❤️ Liked" : "🤍 Like"} (${result.likeCount})`;
          } else {
            showToast(result.message || "Couldn't like this project.");
          }
        } catch (err) {
          console.error("Like error:", err);
        } finally {
          likeBtn.disabled = false;
        }
      });
    }

    const remixBtn = document.getElementById("galleryRemixBtn");
    if (remixBtn) {
      remixBtn.addEventListener("click", async () => {
        const confirmed = await window.showConfirm(
          `Remixing will REPLACE your current ${meta.label} project with a copy of this one. ` +
          `This can't be undone. Continue?`,
          { type: "danger", confirmText: "Remix it" }
        );
        if (!confirmed) return;

        remixBtn.disabled = true;
        try {
          const res = await fetch("/labs/gallery/remix", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId: project.id }),
          });
          const result = await res.json();
          if (result.success) {
            window.location.href = `/labs/${result.labType}`;
          } else {
            showToast(result.message || "Couldn't remix this project.");
            remixBtn.disabled = false;
          }
        } catch (err) {
          console.error("Remix error:", err);
          remixBtn.disabled = false;
        }
      });
    }

    const reportBtn = document.getElementById("galleryReportBtn");
    if (reportBtn) {
      reportBtn.addEventListener("click", async () => {
        const confirmed = await window.showConfirm("Report this project to admins as inappropriate?", { confirmText: "Report" });
        if (!confirmed) return;
        try {
          const res = await fetch("/labs/gallery/report", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId: project.id, reason: "Reported from gallery" }),
          });
          const result = await res.json();
          showToast(result.success ? "Reported — thanks for flagging it." : "Couldn't submit the report.");
        } catch (err) {
          console.error("Report error:", err);
        }
      });
    }

    const unpublishBtn = document.getElementById("galleryUnpublishBtn");
    if (unpublishBtn) {
      unpublishBtn.addEventListener("click", async () => {
        const confirmed = await window.showConfirm("Remove this project from the public gallery?", { confirmText: "Unpublish" });
        if (!confirmed) return;
        try {
          const res = await fetch("/labs/gallery/unpublish", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId: project.id }),
          });
          const result = await res.json();
          if (result.success) {
            closeModal();
            loadProjects(true);
          }
        } catch (err) {
          console.error("Unpublish error:", err);
        }
      });
    }
  }

  loadProjects(true);
})();
