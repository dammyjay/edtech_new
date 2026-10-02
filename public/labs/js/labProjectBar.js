// Shared "project bar" behavior for all four lab editors (Web/Blockly/
// Arduino/Python) — the project-name field, "+ New Project" (coin-gated),
// and "My Projects" switcher. One implementation instead of four separate
// ones so the economy rules (coin cost, confirm copy) and the switch-via-
// reload mechanism can't drift between labs.
//
// Contract each editor.ejs must set up before this script runs:
//   window.LAB_TYPE                   — "web" | "blockly" | "arduino" | "python"
//   window.LAB_NEW_PROJECT_COIN_COST  — number, for the confirm dialog's copy
// and must include in its topbar markup, with these exact ids:
//   #projectNameInput  (text input)
//   #newProjectBtn     (button)
//   #myProjectsBtn     (button)
//   #myProjectsMenu    (initially-hidden dropdown container)
// and may optionally include:
//   #labCoinsValue     (any element — its textContent is the student's
//                        live coin balance, server-rendered on load and
//                        bumped by addCoins() after a Submit's coin award)
//
// Each lab's own init code calls window.LabProjectBar.setProject(id, name)
// once its own /labs/project/init call resolves (not auto-detected off
// window.currentProjectId — Arduino Lab's own convention is a bare
// top-level `currentProjectId`, not window.currentProjectId, so an
// explicit call is the one thing that works the same for all four).

(function () {
  let currentId = null;
  let renameTimer = null;

  function labType() {
    return window.LAB_TYPE;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  function setProject(id, name) {
    currentId = id;
    const input = document.getElementById("projectNameInput");
    if (input && document.activeElement !== input) input.value = name || "";
  }

  // #labCoinsValue is server-rendered with the student's real balance on
  // page load; these two just keep it in sync afterward without a full
  // reload — a New Project/remix spend already triggers a reload (fresh
  // server-rendered value), but a Submit's coinsGained award doesn't.
  function setCoins(amount) {
    const el = document.getElementById("labCoinsValue");
    if (el) el.textContent = amount;
  }

  function addCoins(delta) {
    const el = document.getElementById("labCoinsValue");
    if (!el || !delta) return;
    el.textContent = (parseInt(el.textContent, 10) || 0) + delta;
  }

  function scheduleRename() {
    const input = document.getElementById("projectNameInput");
    if (!input || !currentId) return;
    clearTimeout(renameTimer);
    renameTimer = setTimeout(async () => {
      const name = input.value.trim();
      if (!name) return; // an empty name just doesn't save — the last real name stays shown on reload, never silently blanked server-side
      try {
        await fetch("/labs/project/rename", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: currentId, name }),
        });
      } catch (err) {
        console.error("Project rename failed:", err);
      }
    }, 1200); // same debounce ballpark as every lab's own autosave
  }

  async function createNewProject() {
    const cost = window.LAB_NEW_PROJECT_COIN_COST;
    const costLine = typeof cost === "number" && cost > 0 ? ` This costs ${cost} coins.` : "";
    const confirmFn = window.showConfirm || ((msg) => Promise.resolve(confirm(msg)));
    const confirmed = await confirmFn(`Start a new, separate ${labType()} project?${costLine}`, { confirmText: "Start New Project" });
    if (!confirmed) return;

    const btn = document.getElementById("newProjectBtn");
    if (btn) btn.disabled = true;
    try {
      const res = await fetch("/labs/project/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ labType: labType() }),
      });
      const data = await res.json();
      if (data.success) {
        window.location.href = `${window.location.pathname}?projectId=${data.project.id}`;
      } else if (data.notEnoughCoins) {
        (window.showAlert || alert)(data.message || "You don't have enough coins for a new project.");
      } else {
        (window.showAlert || alert)(data.message || "Couldn't start a new project — try again.");
      }
    } catch (err) {
      console.error("Create project failed:", err);
      (window.showAlert || alert)("Couldn't start a new project — try again.");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // The menu is `position: fixed` (see labProjectBar.css for why), so its
  // coordinates have to be set here from the toggle button's real
  // on-screen position — called both right as it opens (loading state)
  // and again once its real content is in (the width/height can change
  // a lot between "Loading…" and a populated list).
  function positionMyProjectsMenu() {
    const menu = document.getElementById("myProjectsMenu");
    const btn = document.getElementById("myProjectsBtn");
    if (!menu || !btn) return;
    const btnRect = btn.getBoundingClientRect();
    const menuWidth = menu.offsetWidth || 220;
    const left = Math.max(8, Math.min(btnRect.right - menuWidth, window.innerWidth - menuWidth - 8));
    menu.style.top = `${btnRect.bottom + 6}px`;
    menu.style.left = `${left}px`;
  }

  async function openMyProjects() {
    const menu = document.getElementById("myProjectsMenu");
    if (!menu) return;
    const isOpen = menu.style.display !== "none" && menu.style.display !== "";
    if (isOpen) {
      menu.style.display = "none";
      return;
    }
    menu.style.display = "block";
    menu.innerHTML = `<div class="lab-projects-menu-loading">Loading…</div>`;
    positionMyProjectsMenu();

    try {
      const res = await fetch(`/labs/project/list?labType=${encodeURIComponent(labType())}`);
      const data = await res.json();
      if (!data.success || !data.projects.length) {
        menu.innerHTML = `<div class="lab-projects-menu-empty">No other projects yet.</div>`;
        positionMyProjectsMenu();
        return;
      }
      menu.innerHTML = data.projects
        .map((p) => {
          const active = p.id === currentId;
          const when = p.updated_at ? new Date(p.updated_at).toLocaleDateString() : "";
          return `
            <button type="button" class="lab-projects-menu-item${active ? " active" : ""}" data-project-id="${p.id}">
              <span class="lab-projects-menu-name">${escapeHtml(p.project_name || "Untitled project")}</span>
              <span class="lab-projects-menu-meta">${active ? "Current" : when}${p.is_published ? " · 🖼️ Published" : ""}</span>
            </button>
          `;
        })
        .join("");
      positionMyProjectsMenu();
    } catch (err) {
      console.error("List projects failed:", err);
      menu.innerHTML = `<div class="lab-projects-menu-empty">Couldn't load your projects.</div>`;
      positionMyProjectsMenu();
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("projectNameInput")?.addEventListener("input", scheduleRename);
    document.getElementById("newProjectBtn")?.addEventListener("click", createNewProject);
    document.getElementById("myProjectsBtn")?.addEventListener("click", openMyProjects);

    document.getElementById("myProjectsMenu")?.addEventListener("click", (e) => {
      const item = e.target.closest(".lab-projects-menu-item");
      if (!item) return;
      const id = item.dataset.projectId;
      if (id && Number(id) !== currentId) {
        window.location.href = `${window.location.pathname}?projectId=${id}`;
      }
    });

    // Click-outside closes the dropdown — same convention as the image
    // export menu already used in the Arduino/other lab topbars.
    document.addEventListener("click", (e) => {
      const menu = document.getElementById("myProjectsMenu");
      const btn = document.getElementById("myProjectsBtn");
      if (!menu || menu.style.display === "none") return;
      if (menu.contains(e.target) || btn?.contains(e.target)) return;
      menu.style.display = "none";
    });
  });

  // Shared in-flight-button helper (Submit, Publish, etc. across all 4
  // labs) — swaps the button's own content for a small spinner + label
  // while `loading` is true, disabling it, and restores the exact
  // original content afterward (stashed on the element itself, so this
  // nests safely even if called again before a previous restore).
  function setButtonLoading(btn, loading, loadingText) {
    if (!btn) return;
    if (loading) {
      if (btn.dataset.loadingOriginalHtml === undefined) btn.dataset.loadingOriginalHtml = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = `<span class="lab-btn-spinner"></span> ${loadingText || "Working…"}`;
    } else {
      if (btn.dataset.loadingOriginalHtml !== undefined) {
        btn.innerHTML = btn.dataset.loadingOriginalHtml;
        delete btn.dataset.loadingOriginalHtml;
      }
      btn.disabled = false;
    }
  }

  window.LabProjectBar = { setProject, setButtonLoading, setCoins, addCoins };
})();
