// public/js/courseSearchSuggest.js
//
// Live-suggestion dropdown for the course search box in the public header
// (views/partials/userHeader.ejs, present on every public page). Talks to
// GET /courses/api/suggest (routes/publicRoutes.js). Same debounce/
// keyboard-nav shape as public/js/adminGlobalSearch.js, adapted for a
// single entity type and an unauthenticated audience.
//
// This script tag sits right after the header markup in the same file
// (not in <head>), so the elements below already exist by the time this
// runs — no DOMContentLoaded wrapper needed, unlike adminGlobalSearch.js.

(function () {
  const input = document.getElementById("headerCourseSearchInput");
  const dropdown = document.getElementById("headerCourseSearchResults");
  const form = document.getElementById("headerCourseSearchForm");
  if (!input || !dropdown) return; // header markup not present on this page

  let debounceTimer = null;
  let results = [];
  let activeIndex = -1;

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  function render(courses) {
    results = courses;
    activeIndex = -1;

    if (!courses.length) {
      dropdown.innerHTML = `<p class="header-search-empty">No courses match.</p>`;
      dropdown.hidden = false;
      return;
    }

    dropdown.innerHTML = courses
      .map(
        (c) => `
        <a class="header-search-row" href="/courses/${c.id}">
          <span class="header-search-row-title">${escapeHtml(c.title)}</span>
          <span class="header-search-row-detail">₦${Number(c.amount || 0).toLocaleString()}${c.pathway_name ? " · " + escapeHtml(c.pathway_name) : ""}</span>
        </a>
      `
      )
      .join("");
    dropdown.hidden = false;
  }

  function setActive(index) {
    const rows = dropdown.querySelectorAll(".header-search-row");
    rows.forEach((r) => r.classList.remove("active"));
    if (index >= 0 && rows[index]) {
      rows[index].classList.add("active");
      rows[index].scrollIntoView({ block: "nearest" });
    }
    activeIndex = index;
  }

  async function search(q) {
    try {
      const res = await fetch(`/courses/api/suggest?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!data.success) return;
      render(data.courses);
    } catch (err) {
      console.error("Course suggest error:", err);
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
    if (dropdown.hidden || !results.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(Math.min(activeIndex + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.max(activeIndex - 1, 0));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      // A highlighted suggestion wins over the form's own submit-to-
      // /courses?q= fallback — jump straight to that course instead.
      e.preventDefault();
      window.location.href = `/courses/${results[activeIndex].id}`;
    } else if (e.key === "Escape") {
      dropdown.hidden = true;
    }
  });

  document.addEventListener("click", (e) => {
    if (!dropdown.contains(e.target) && e.target !== input) {
      dropdown.hidden = true;
    }
  });

  // Pressing Enter with nothing highlighted, or clicking the search icon,
  // still falls through to the form's normal GET /courses?q= submit — the
  // full filtered-catalog fallback this box always had.
  if (form) {
    form.addEventListener("submit", () => {
      dropdown.hidden = true;
    });
  }
})();
