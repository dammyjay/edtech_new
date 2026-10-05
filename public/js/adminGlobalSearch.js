// public/js/adminGlobalSearch.js
//
// Live, as-you-type cross-entity search for the admin header
// (views/partials/adminHeader.ejs). Talks to
// GET /admin/search/suggest (controllers/adminController.js's
// globalSearchSuggest, routes/adminRoutes.js). Loaded on every admin AND
// instructor page (adminHeader.ejs is shared by both), but the search box
// markup only renders for role === 'admin' — on an instructor page
// #adminGlobalSearchInput simply doesn't exist, so this whole file no-ops
// below, matching the same "if (!el) return" guard convention already
// used by public/labs/js/labGallery.js.
//
// Loaded in <head> with no defer, so DOM elements may not exist yet when
// this script first runs — everything is wrapped in DOMContentLoaded.

document.addEventListener("DOMContentLoaded", function () {
  const input = document.getElementById("adminGlobalSearchInput");
  const dropdown = document.getElementById("adminGlobalSearchResults");
  if (!input || !dropdown) return;

  let debounceTimer = null;
  let flatResults = []; // flattened, in display order, for keyboard nav
  let activeIndex = -1;

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  function groupHtml(label, icon, rows, rowHtml) {
    if (!rows.length) return "";
    return `
      <div class="admin-search-group">
        <div class="admin-search-group-label">${icon} ${label}</div>
        ${rows.map(rowHtml).join("")}
      </div>
    `;
  }

  function render(results) {
    flatResults = [...results.students, ...results.courses, ...results.schools];
    activeIndex = -1;

    if (!flatResults.length) {
      dropdown.innerHTML = `<p class="admin-search-empty">No matches.</p>`;
      dropdown.hidden = false;
      return;
    }

    const html =
      groupHtml("Students", "👤", results.students, (s) => `
        <a class="admin-search-row" href="${s.url}" data-url="${s.url}">
          <span class="admin-search-row-title">${escapeHtml(s.fullname)}</span>
          <span class="admin-search-row-detail">${escapeHtml(s.email)}</span>
        </a>
      `) +
      groupHtml("Courses", "📚", results.courses, (c) => `
        <a class="admin-search-row" href="${c.url}" data-url="${c.url}">
          <span class="admin-search-row-title">${escapeHtml(c.title)}</span>
          <span class="admin-search-row-detail">₦${Number(c.amount || 0).toLocaleString()}</span>
        </a>
      `) +
      groupHtml("Schools", "🏫", results.schools, (s) => `
        <a class="admin-search-row" href="${s.url}" data-url="${s.url}">
          <span class="admin-search-row-title">${escapeHtml(s.name)}</span>
          <span class="admin-search-row-detail">${escapeHtml(s.email || "")}</span>
        </a>
      `);

    dropdown.innerHTML = html;
    dropdown.hidden = false;
  }

  function setActive(index) {
    const rows = dropdown.querySelectorAll(".admin-search-row");
    rows.forEach((r) => r.classList.remove("active"));
    if (index >= 0 && rows[index]) {
      rows[index].classList.add("active");
      rows[index].scrollIntoView({ block: "nearest" });
    }
    activeIndex = index;
  }

  async function search(q) {
    try {
      const res = await fetch(`/admin/search/suggest?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!data.success) return;
      render(data.results);
    } catch (err) {
      console.error("Admin global search error:", err);
    }
  }

  input.addEventListener("input", () => {
    const q = input.value.trim();
    clearTimeout(debounceTimer);
    if (q.length < 2) {
      dropdown.hidden = true;
      return;
    }
    debounceTimer = setTimeout(() => search(q), 300);
  });

  input.addEventListener("keydown", (e) => {
    if (dropdown.hidden || !flatResults.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(Math.min(activeIndex + 1, flatResults.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.max(activeIndex - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = activeIndex >= 0 ? flatResults[activeIndex] : flatResults[0];
      if (target) window.location.href = target.url;
    } else if (e.key === "Escape") {
      dropdown.hidden = true;
    }
  });

  document.addEventListener("click", (e) => {
    if (!dropdown.contains(e.target) && e.target !== input) {
      dropdown.hidden = true;
    }
  });
});
