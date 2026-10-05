// public/js/showcaseSearch.js
//
// Live, as-you-type filtering for the public project showcase
// (views/public/showcase.ejs). Talks to routes/publicRoutes.js's
// GET /showcase/api/search. Mirrors the debounce/render-from-JS pattern
// already established in public/labs/js/labGallery.js for the in-app
// gallery, adapted for this page's anonymous-visitor teaser (the first
// SHOWCASE_CONTEXT.freeCount projects are real, the next 3 are blurred
// locked previews, then a "sign up" CTA card) — that teaser logic used to
// live server-side in the EJS template; it's reproduced here exactly so a
// client-side filter change still respects it.

(function () {
  const grid = document.getElementById("scGrid");
  if (!grid) return; // not on the showcase page

  const emptyEl = document.getElementById("scEmpty");
  const searchForm = document.getElementById("scSearchForm");
  const searchInput = document.getElementById("scSearchInput");
  const typeFilterGroup = document.getElementById("scTypeFilter");

  const ctx = window.SHOWCASE_CONTEXT || { isLoggedIn: false, freeCount: 9, labType: "", q: "" };
  const state = { labType: ctx.labType || "", q: ctx.q || "" };

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  const scIcon = (t) => (t === "blockly" ? "🧩" : t === "arduino" ? "🔌" : t === "python" ? "🐍" : "🌐");

  // Links the author's name to their public portfolio page only when
  // they've opted into public sharing — same consent gate as the rest of
  // this feature (public_profile_slug is only ever present server-side
  // when public_profile_enabled is also true, see fetchShowcaseProjects).
  function authorHtml(p) {
    const safeName = escapeHtml(p.displayName || "a student");
    if (p.public_profile_slug) {
      return `<a class="sc-card-author-link" href="/achievements/${encodeURIComponent(p.public_profile_slug)}">${safeName}</a>`;
    }
    return safeName;
  }

  function freeCardHtml(p) {
    const rating = Number(p.avg_rating) || 0;
    return `
      <div class="sc-card sc-card--clickable" data-id="${p.id}">
        <div class="sc-card-top">
          <span class="sc-card-icon">${scIcon(p.lab_type)}</span>
          <div>
            <p class="sc-card-title">${escapeHtml(p.project_name || "Untitled project")}</p>
            <p class="sc-card-author">by ${authorHtml(p)}</p>
          </div>
        </div>
        <div class="sc-card-badges">
          <span>❤️ ${p.like_count}</span>
          <span>${rating ? `★ ${rating.toFixed(1)}` : "☆ No ratings yet"}</span>
        </div>
      </div>
    `;
  }

  function lockedCardHtml(p) {
    return `
      <div class="sc-card sc-card--locked" aria-hidden="true">
        <div class="sc-card-top">
          <span class="sc-card-icon">${scIcon(p.lab_type)}</span>
          <div>
            <p class="sc-card-title">${escapeHtml(p.project_name || "Untitled project")}</p>
            <p class="sc-card-author">by ${escapeHtml(p.displayName || "a student")}</p>
          </div>
        </div>
        <div class="sc-card-badges"><span>❤️ ${p.like_count}</span></div>
        <div class="sc-lock-overlay">🔒</div>
      </div>
    `;
  }

  function unlockCardHtml(count) {
    return `
      <a class="sc-card sc-card--unlock" href="/signup?role=user&redirect=${encodeURIComponent("/showcase")}">
        <div class="sc-unlock-count">+${count}</div>
        <p class="sc-unlock-text">more project${count === 1 ? "" : "s"} to see</p>
        <span class="sc-unlock-btn">Sign up free →</span>
      </a>
    `;
  }

  grid.addEventListener("click", (e) => {
    if (e.target.closest(".sc-card-author-link")) return; // let that link navigate itself
    const card = e.target.closest(".sc-card--clickable");
    if (card) window.location.href = `/showcase/${card.dataset.id}`;
  });

  async function loadProjects() {
    grid.innerHTML = "";
    emptyEl.style.display = "none";

    try {
      const params = new URLSearchParams();
      if (state.labType) params.set("labType", state.labType);
      if (state.q) params.set("q", state.q);

      const res = await fetch(`/showcase/api/search?${params.toString()}`);
      const data = await res.json();
      if (!data.success) {
        grid.innerHTML = `<p class="sc-empty">Couldn't load the showcase right now.</p>`;
        return;
      }

      const projects = data.projects || [];
      if (!projects.length) {
        emptyEl.style.display = "block";
        return;
      }

      const freeProjects = projects.slice(0, ctx.freeCount);
      const lockedProjects = projects.slice(ctx.freeCount);

      let html = freeProjects.map(freeCardHtml).join("");
      if (lockedProjects.length) {
        html += lockedProjects.slice(0, 3).map(lockedCardHtml).join("");
        html += unlockCardHtml(lockedProjects.length);
      }
      grid.innerHTML = html;
    } catch (err) {
      console.error("Showcase search error:", err);
      grid.innerHTML = `<p class="sc-empty">Couldn't load the showcase right now.</p>`;
    }
  }

  if (searchForm) {
    searchForm.addEventListener("submit", (e) => e.preventDefault());
  }
  if (searchInput) {
    let searchDebounce = null;
    searchInput.addEventListener("input", () => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        state.q = searchInput.value.trim();
        loadProjects();
      }, 300);
    });
  }
  if (typeFilterGroup) {
    typeFilterGroup.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      typeFilterGroup.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.labType = btn.dataset.type || "";
      loadProjects();
    });
  }

  loadProjects();
})();
