// public/js/instructorDashboard.js
//
// Loaded ONCE, persistently, from the instructor dashboard shell
// (views/instructor/dashboard.ejs) — not from any of the individual
// views/instructor/sections/*.ejs files. That matters: loadSection()
// below swaps #main-content's innerHTML on every tab click, and a
// browser never executes <script> tags that arrive via innerHTML= (the
// same fact already documented in public/js/attendance.js's own
// comment, which is why THAT file also lives in the persistent shell
// rather than inside sections/attendance.ejs). Every section-specific
// piece of interactive JS this dashboard needs — the award modal, the
// class-report CKEditor composer, sortable tables, the reply box — is
// defined here for the same reason, and reached from the swapped-in
// HTML via plain onclick="..." attributes (which DO still work after
// innerHTML=, since the browser evaluates them at click time against
// the global scope) or via afterSectionLoad()'s explicit re-init calls
// below (the same pattern the old shell already used for
// bindSchoolSelector(), just consolidated into one place instead of
// being defined twice).

let currentSection = "dashboard";

async function loadSection(section) {
  const baseSection = section.split("?")[0];
  const schoolSelect = document.getElementById("schoolSelect");
  const schoolId = schoolSelect ? schoolSelect.value : null;

  let url = `/instructor/section/${section}`;
  if (schoolId && !section.includes("school_id")) {
    url += (section.includes("?") ? "&" : "?") + `school_id=${schoolId}`;
  }

  currentSection = baseSection;

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === baseSection);
  });

  const main = document.getElementById("main-content");
  try {
    const res = await fetch(url);
    const html = await res.text();
    main.innerHTML = html;
    afterSectionLoad(baseSection);
  } catch (err) {
    console.error("Load section error:", err);
    main.innerHTML = "<p style='color:red'>Failed to load section</p>";
  }
}

function afterSectionLoad(section) {
  bindSchoolSelector();
  bindSortableTables();
  if (section === "students") refreshAwardBudget();
  if (section === "class_reports") initClassReportsSection();
  if (section === "schools") renderAnalyticsCharts();
}

function bindSchoolSelector() {
  const schoolSelect = document.getElementById("schoolSelect");
  if (!schoolSelect || schoolSelect.dataset.bound) return;
  schoolSelect.dataset.bound = "true";
  schoolSelect.addEventListener("change", async () => {
    await fetch("/instructor/set-school", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ school_id: schoolSelect.value }),
    });
    loadSection(currentSection);
  });
}

// Same client-side sort adminHeader.ejs already ships for every other
// dashboard's .sortable-table, extracted so it can be re-run after each
// AJAX section swap — adminHeader's own copy only ever runs once, on the
// page's initial DOMContentLoaded, before #main-content even has real
// content in it (it's still showing "Loading dashboard…" at that point).
function bindSortableTables(root) {
  (root || document).querySelectorAll(".sortable-table").forEach((table) => {
    if (table.dataset.sortBound) return;
    table.dataset.sortBound = "true";

    const headers = table.querySelectorAll("thead th");
    headers.forEach((header, columnIndex) => {
      header.classList.add("sortable");
      let ascending = true;

      header.addEventListener("click", () => {
        const tbody = table.querySelector("tbody");
        const rows = Array.from(tbody.querySelectorAll("tr"));

        headers.forEach((h) => h.classList.remove("sort-asc", "sort-desc"));

        rows.sort((a, b) => {
          const aText = a.children[columnIndex]?.innerText.trim() || "";
          const bText = b.children[columnIndex]?.innerText.trim() || "";

          const aNum = parseFloat(aText.replace(/[^\d.-]/g, ""));
          const bNum = parseFloat(bText.replace(/[^\d.-]/g, ""));
          if (!isNaN(aNum) && !isNaN(bNum)) return ascending ? aNum - bNum : bNum - aNum;

          const aDate = Date.parse(aText);
          const bDate = Date.parse(bText);
          if (!isNaN(aDate) && !isNaN(bDate)) return ascending ? aDate - bDate : bDate - aDate;

          return ascending ? aText.localeCompare(bText) : bText.localeCompare(aText);
        });

        tbody.innerHTML = "";
        rows.forEach((row) => tbody.appendChild(row));
        header.classList.add(ascending ? "sort-asc" : "sort-desc");
        ascending = !ascending;
      });
    });
  });
}

// =====================================================================
// Reply-to-message box (dashboard section's "Recent Messages")
// =====================================================================

function openReplyBox(receiverId, name) {
  const box = document.getElementById("replyBox");
  if (!box) return;
  box.style.display = "block";
  document.getElementById("replyToName").textContent = name;
  document.getElementById("replyReceiverId").value = receiverId;
}

function closeReplyBox() {
  const box = document.getElementById("replyBox");
  if (!box) return;
  box.style.display = "none";
  document.getElementById("replyMessage").value = "";
}

async function sendReply() {
  const receiverId = document.getElementById("replyReceiverId").value;
  const message = document.getElementById("replyMessage").value.trim();
  if (!message) return showAlert("Please type a message.", "warning");

  try {
    const res = await fetch("/instructor/instructor/chat/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receiverId, message }),
    });
    const data = await res.json();
    if (data.success) {
      showAlert("Reply sent!", "success");
      closeReplyBox();
      loadSection(currentSection);
    } else {
      showAlert(data.message || "Couldn't send reply.", "error");
    }
  } catch (err) {
    console.error("Reply error:", err);
    showAlert("Server error sending reply.", "error");
  }
}

// =====================================================================
// GAMIFIED POINTS/COINS — award modal (views/instructor/sections/students.ejs)
// =====================================================================

let selectedAwardCategory = null;
let selectedAwardStudentId = null;
let selectedAwardClassroomId = null;

function openAwardModal(studentId, classroomId, studentName) {
  selectedAwardStudentId = studentId;
  selectedAwardClassroomId = classroomId;
  selectedAwardCategory = null;

  const nameEl = document.getElementById("awardModalStudentName");
  if (nameEl) nameEl.textContent = studentName;
  document.querySelectorAll(".award-category-chip").forEach((chip) => chip.classList.remove("selected"));
  const noteEl = document.getElementById("awardNote");
  if (noteEl) noteEl.value = "";

  document.getElementById("awardModal").style.display = "flex";
  refreshAwardBudget();
}

function closeAwardModal() {
  const modal = document.getElementById("awardModal");
  if (modal) modal.style.display = "none";
}

function selectAwardCategory(key, chipEl) {
  selectedAwardCategory = key;
  document.querySelectorAll(".award-category-chip").forEach((chip) => chip.classList.remove("selected"));
  chipEl.classList.add("selected");
}

async function refreshAwardBudget() {
  try {
    const res = await fetch(
      `/instructor/awards/recent${selectedAwardClassroomId ? "?classroom_id=" + selectedAwardClassroomId : ""}`
    );
    const data = await res.json();
    if (!data.success) return;

    const { spentToday, remaining, budget } = data.budget;
    const pct = budget > 0 ? Math.min(100, Math.round((spentToday / budget) * 100)) : 0;
    const fillEl = document.getElementById("awardBudgetFill");
    if (fillEl) fillEl.style.width = pct + "%";
    const labelEl = document.getElementById("awardBudgetLabel");
    if (labelEl) labelEl.textContent = `${spentToday} / ${budget} coins awarded today (${remaining} left)`;

    renderRecentAwards(data.awards || []);
  } catch (err) {
    console.error("Award budget refresh error:", err);
  }
}

function renderRecentAwards(awards) {
  const list = document.getElementById("recentAwardsList");
  if (!list) return;
  if (!awards.length) {
    list.innerHTML = "<p style='color:#999; font-size:13px;'>No awards given yet — pick a student and recognize their work!</p>";
    return;
  }
  list.innerHTML = awards
    .map(
      (a) => `
      <li>
        <span>${a.categoryLabel} — <strong>${a.student_name}</strong>${a.classroom_name ? " (" + a.classroom_name + ")" : ""}</span>
        <span class="award-amount">+${a.amount} 🪙</span>
      </li>`
    )
    .join("");
}

async function submitAward() {
  if (!selectedAwardCategory) {
    showAlert("Pick a category first.", "warning");
    return;
  }
  const noteEl = document.getElementById("awardNote");
  const note = noteEl ? noteEl.value.trim() : "";

  try {
    const res = await fetch(`/instructor/students/${selectedAwardStudentId}/award`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: selectedAwardCategory, classroom_id: selectedAwardClassroomId, note }),
    });
    const data = await res.json();
    if (data.success) {
      showAlert(`🎉 Awarded ${data.amount} coins for "${data.category}"!`, "success");
      closeAwardModal();
      loadSection(currentSection);
    } else {
      showAlert(data.message || "Couldn't award points.", "error");
    }
  } catch (err) {
    console.error("Submit award error:", err);
    showAlert("Server error awarding points.", "error");
  }
}

// =====================================================================
// CLASSROOM ANALYTICS — Chart.js (views/instructor/sections/schools.ejs)
// =====================================================================

let analyticsCharts = [];

function renderAnalyticsCharts() {
  const dataEl = document.getElementById("analyticsChartData");
  if (!dataEl || typeof Chart === "undefined") return;

  // Destroy any previous instances before reusing the same canvas ids —
  // Chart.js throws "Canvas is already in use" otherwise, and every
  // section swap creates fresh <canvas> elements anyway.
  analyticsCharts.forEach((c) => c.destroy());
  analyticsCharts = [];

  let payload;
  try {
    payload = JSON.parse(dataEl.textContent);
  } catch (err) {
    console.error("Analytics chart data parse error:", err);
    return;
  }

  const genderEl = document.getElementById("genderChart");
  if (genderEl) {
    analyticsCharts.push(
      new Chart(genderEl, {
        type: "doughnut",
        data: {
          labels: payload.genderLabels,
          datasets: [{ data: payload.genderCounts, backgroundColor: ["#36A2EB", "#FF6384", "#FFCE56"] }],
        },
      })
    );
  }

  const progressEl = document.getElementById("progressChart");
  if (progressEl) {
    analyticsCharts.push(
      new Chart(progressEl, {
        type: "bar",
        data: {
          labels: ["0–49%", "50–74%", "75–100%"],
          datasets: [
            {
              label: "Number of Students",
              data: [payload.progressDist.low, payload.progressDist.mid, payload.progressDist.high],
              backgroundColor: ["#e74c3c", "#f39c12", "#27ae60"],
            },
          ],
        },
        options: { responsive: true, plugins: { legend: { display: false } } },
      })
    );
  }

  const quizEl = document.getElementById("quizChart");
  if (quizEl) {
    analyticsCharts.push(
      new Chart(quizEl, {
        type: "bar",
        data: {
          labels: payload.studentNames,
          datasets: [{ label: "Avg Quiz Score", data: payload.studentQuizAvgs, backgroundColor: "#2980b9" }],
        },
        options: { responsive: true, plugins: { legend: { display: false } } },
      })
    );
  }
}

// =====================================================================
// CLASS REPORTS — CKEditor composer (views/instructor/sections/classReports.ejs)
// =====================================================================

let classReportEditor = null;
let editingReportId = null;

function initClassReportsSection() {
  // CKEditor itself is only created lazily when the compose/edit modal
  // actually opens (ensureReportEditor) — nothing to do on section load.
}

function ensureReportEditor() {
  if (classReportEditor) return;
  classReportEditor = CKEDITOR.replace("reportContentField", { height: 280 });
}

function openNewReportModal() {
  editingReportId = null;
  document.getElementById("reportModalTitle").textContent = "📝 New Class Report";
  document.getElementById("reportTitleInput").value = "";
  document.getElementById("reportDateInput").value = new Date().toISOString().split("T")[0];
  const classroomRow = document.getElementById("reportClassroomRow");
  if (classroomRow) classroomRow.hidden = false;

  ensureReportEditor();
  const clear = () => classReportEditor.setData("");
  if (classReportEditor.status === "ready") clear();
  else classReportEditor.once("instanceReady", clear);

  document.getElementById("classReportModal").style.display = "flex";
}

async function openEditReportModal(id) {
  try {
    const res = await fetch(`/instructor/class-reports/${id}`);
    const data = await res.json();
    if (!data.success) {
      showAlert(data.message || "Couldn't load this report.", "error");
      return;
    }

    editingReportId = id;
    document.getElementById("reportModalTitle").textContent = "✏️ Edit Class Report";
    document.getElementById("reportTitleInput").value = data.report.title;
    document.getElementById("reportDateInput").value = (data.report.report_date || "").toString().split("T")[0];
    const classroomRow = document.getElementById("reportClassroomRow");
    if (classroomRow) classroomRow.hidden = true; // classroom isn't changeable once created

    ensureReportEditor();
    const setData = () => classReportEditor.setData(data.report.content || "");
    if (classReportEditor.status === "ready") setData();
    else classReportEditor.once("instanceReady", setData);

    document.getElementById("classReportModal").style.display = "flex";
  } catch (err) {
    console.error("Open edit report error:", err);
    showAlert("Server error loading report.", "error");
  }
}

function closeClassReportModal() {
  const modal = document.getElementById("classReportModal");
  if (modal) modal.style.display = "none";
}

async function submitClassReport() {
  const title = document.getElementById("reportTitleInput").value.trim();
  const reportDate = document.getElementById("reportDateInput").value || null;
  const classroomSelect = document.getElementById("reportClassroomSelect");
  const classroomId = classroomSelect ? classroomSelect.value : null;

  if (classReportEditor) classReportEditor.updateElement();
  const content = document.getElementById("reportContentField").value.trim();

  if (!title || !content) {
    showAlert("Please add a title and write something in the report.", "warning");
    return;
  }
  if (!editingReportId && !classroomId) {
    showAlert("Please select a classroom.", "warning");
    return;
  }

  const url = editingReportId ? `/instructor/class-reports/${editingReportId}/edit` : "/instructor/class-reports";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, content, classroom_id: classroomId, report_date: reportDate }),
    });
    const data = await res.json();
    if (data.success) {
      showAlert(editingReportId ? "Report updated!" : "Report saved!", "success");
      closeClassReportModal();
      loadSection("class_reports");
    } else {
      showAlert(data.message || "Couldn't save the report.", "error");
    }
  } catch (err) {
    console.error("Submit class report error:", err);
    showAlert("Server error saving report.", "error");
  }
}

async function deleteClassReportConfirm(id) {
  const ok = await showConfirm("Delete this class report? This can't be undone.", {
    confirmText: "Delete",
    type: "danger",
  });
  if (!ok) return;

  try {
    const res = await fetch(`/instructor/class-reports/${id}/delete`, { method: "POST" });
    const data = await res.json();
    if (data.success) {
      showAlert("Report deleted.", "success");
      loadSection("class_reports");
    } else {
      showAlert(data.message || "Couldn't delete report.", "error");
    }
  } catch (err) {
    console.error("Delete class report error:", err);
    showAlert("Server error deleting report.", "error");
  }
}

// =====================================================================
// Sidebar toggle (mobile) — same fixed off-canvas + hamburger pattern
// as the rest of the app's dashboards (views/partials/sidenav.ejs).
// =====================================================================

function initSidebarToggle() {
  const sidenav = document.getElementById("instructorSidenav");
  const toggleBtn = document.getElementById("instructorToggleBtn");
  if (!sidenav || !toggleBtn) return;

  toggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = sidenav.classList.toggle("active");
    toggleBtn.setAttribute("aria-expanded", isOpen);
  });

  // Close after picking a tab, but only on mobile — on desktop the
  // sidebar is always visible and this would be a no-op anyway.
  sidenav.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (window.innerWidth <= 900) {
        sidenav.classList.remove("active");
        toggleBtn.setAttribute("aria-expanded", "false");
      }
    });
  });

  document.addEventListener("click", (e) => {
    if (
      window.innerWidth <= 900 &&
      sidenav.classList.contains("active") &&
      !sidenav.contains(e.target) &&
      e.target !== toggleBtn
    ) {
      sidenav.classList.remove("active");
      toggleBtn.setAttribute("aria-expanded", "false");
    }
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 900) {
      sidenav.classList.remove("active");
      toggleBtn.setAttribute("aria-expanded", "false");
    }
  });
}

// =====================================================================
// Boot
// =====================================================================

// This <script> tag is loaded from the shell's <head>-ish area, before
// the sidebar/tab buttons exist in the DOM yet (they're rendered further
// down the page) — so the tab-button binding has to wait for
// DOMContentLoaded too, not just the initial loadSection() call.
window.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => loadSection(btn.dataset.tab));
  });
  initSidebarToggle();
  loadSection(currentSection);
});
