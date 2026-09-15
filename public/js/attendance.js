async function loadAttendanceHistory() {
  // Guards against a real (if narrow) race: saveAttendance() calls this
  // on success, but the instructor may have already clicked a different
  // sidebar tab in the meantime — loadSection() swaps #main-content's
  // whole innerHTML= before that fetch/response cycle finishes, so
  // these elements (and #attendanceTableBody below) can legitimately be
  // gone by the time this runs. Without this, that reads .value off
  // null and throws.
  const termEl = document.getElementById("attendanceFilterTerm");
  const classroomEl = document.getElementById("attendanceFilterClassroom");
  if (!termEl || !classroomEl) return;

  const term_id = termEl.value;
  const classroom_id = classroomEl.value;

  const tbody = document.getElementById("attendanceTableBody");
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="instructor-loading-inline"><div class="instructor-spinner small"></div> Loading history…</div></td></tr>`;
  }

  let data;
  try {
    const res = await fetch(
      `/instructor/attendance/history?term_id=${term_id}&classroom_id=${classroom_id}`,
    );
    data = await res.json();
  } catch (err) {
    console.error("Load attendance history error:", err);
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" style="color:red;">Failed to load history — try again.</td></tr>`;
    return;
  }

  let html = "";

  if (data.length === 0) {
    html = `<tr><td colspan="5">No attendance found</td></tr>`;
  } else {
    data.forEach((a) => {
      //   html += `
      //     <tr>
      //       <td>${new Date(a.date).toDateString()}</td>
      //       <td>${a.classroom}</td>
      //       <td>${a.session_status}</td>
      //       <td>${a.student_count}</td>
      //     </tr>
      //   `;

      html += `
        <tr>
        <td>${new Date(a.date).toDateString()}</td>
        <td>${a.classroom}</td>
        <td>${a.session_status}</td>
        <td>${a.student_count}</td>

        <td>
            <i class="fa fa-eye" style="cursor:pointer;color:blue;"
            onclick="toggleAttendanceDetails(${a.id})"></i>
        </td>
        </tr>

        <tr id="attendance-row-${a.id}" style="display:none;">
        <td colspan="5">
            <div id="attendance-details-${a.id}"></div>
        </td>
        </tr>
        `;
    });
  }

  // Reuse the same tbody reference captured (and null-checked) above —
  // a fresh getElementById here was the actual source of the
  // "setting innerHTML on null" race (this fetch can finish after the
  // instructor has already navigated to a different tab).
  if (tbody) tbody.innerHTML = html;
}

function openAttendanceModal() {
  document.getElementById("attendanceModal").style.display = "flex";
  loadAttendanceStudents();
}

function closeModal(id) {
  document.getElementById(id).style.display = "none";
}

async function loadAttendanceStudents() {
  const term_id = document.getElementById("attendanceFilterTerm").value;
  const classroom_id = document.getElementById(
    "attendanceFilterClassroom",
  ).value;

  const container = document.getElementById("attendanceStudentList");

  if (!classroom_id) {
    container.innerHTML =
      "<p style='color:#c0392b; font-weight:600;'>⚠️ Please select a classroom first</p>";
    return;
  }

  container.innerHTML = `<div class="instructor-loading-inline"><div class="instructor-spinner small"></div> Loading students…</div>`;

  let data;
  try {
    const res = await fetch(
      `/instructor/attendance/students?term_id=${term_id}&classroom_id=${classroom_id}`,
    );
    data = await res.json();
  } catch (err) {
    console.error("Load attendance students error:", err);
    container.innerHTML = `<p style="color:#c0392b;">Failed to load students — try again.</p>`;
    return;
  }

  if (!data.length) {
    container.innerHTML = `<p style="color:#999;">No students found in this classroom.</p>`;
    return;
  }

  let html = "<h4 style='margin:14px 0 8px;'>Mark Attendance</h4>";

  data.forEach((s) => {
    html += `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:8px 10px; border-radius:8px; background:#faf7f0; margin-bottom:6px;">
        <span style="font-weight:600; font-size:13.5px;">${s.fullname}</span>
        <select data-id="${s.id}">
          <option value="present">✅ Present</option>
          <option value="absent">❌ Absent</option>
          <option value="late">⏰ Late</option>
        </select>
      </div>
    `;
  });

  html += `<button class="btn-primary" id="saveAttendanceBtn" onclick="saveAttendance()" style="margin-top:10px; width:100%;">Save Attendance</button>`;

  container.innerHTML = html;
}

// This file is loaded once via a persistent <script src> in
// instructor/dashboard.ejs's shell, but #sessionStatus lives inside
// instructor/sections/attendance.ejs, an AJAX-loaded section swapped in
// later via plain innerHTML= (no script re-execution) — so attaching
// directly here would either throw (element not present yet) or silently
// never fire. Delegating from document works regardless of load order.
document.addEventListener("change", (e) => {
  if (e.target && e.target.id === "sessionStatus") loadAttendanceStudents();
  // Auto-reload the history table the moment either filter changes —
  // same delegation reason as above (these selects live inside an
  // AJAX-swapped section, not the persistent shell this file loads in).
  if (e.target && (e.target.id === "attendanceFilterTerm" || e.target.id === "attendanceFilterClassroom")) {
    loadAttendanceHistory();
  }
});

async function saveAttendance() {
  const term_id = document.getElementById("attendanceFilterTerm").value;
  const classroom_id = document.getElementById(
    "attendanceFilterClassroom",
  ).value;

  const records = [];

  document.querySelectorAll("#attendanceStudentList select").forEach((sel) => {
    records.push({
      student_id: sel.dataset.id,
      status: sel.value,
    });
  });


const payload = {
  term_id,
  classroom_id,
  date: document.getElementById("attendanceDate").value,
  session_status: document.getElementById("sessionStatus").value,
  week_number: document.getElementById("week_number").value,
  records,
};

  const saveBtn = document.getElementById("saveAttendanceBtn");
  const originalLabel = saveBtn ? saveBtn.textContent : null;
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = `<span class="instructor-spinner small" style="border-color:rgba(255,255,255,0.4); border-top-color:#fff; vertical-align:middle; margin-right:6px;"></span> Saving…`;
  }

  try {
    const res = await fetch("/instructor/attendance/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    showAlert(data.success ? "Attendance saved!" : (data.message || "Error saving attendance"), data.success ? "success" : "error");
    if (data.success) loadAttendanceHistory();
  } catch (err) {
    console.error("Save attendance error:", err);
    showAlert("Server error saving attendance.", "error");
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = originalLabel;
    }
  }
}

async function toggleAttendanceDetails(sessionId) {
  const row = document.getElementById(`attendance-row-${sessionId}`);
  const container = document.getElementById(`attendance-details-${sessionId}`);

  if (row.style.display === "none") {
    row.style.display = "table-row";

    if (!container.dataset.loaded) {
      const res = await fetch(`/instructor/attendance/session/${sessionId}`);
      const data = await res.json();

      if (data.length === 0) {
        container.innerHTML = "<p>No attendance records</p>";
      } else {
        let html = `
          <table class="user-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
        `;

        data.forEach((s) => {
          html += `
            <tr>
              <td>${s.fullname}</td>
              <td>${formatStatus(s.status)}</td>
            </tr>
          `;
        });

        html += "</tbody></table>";

        container.innerHTML = html;
      }

      container.dataset.loaded = "true";
    }
  } else {
    row.style.display = "none";
  }
}

function formatStatus(status) {
  if (status === "present") return "✅ Present";
  if (status === "absent") return "❌ Absent";
  if (status === "late") return "⏰ Late";
  return status;
}