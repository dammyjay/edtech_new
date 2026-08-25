// Adapted from instructor's public/js/attendance.js, pointed at /teacher/*
// endpoints instead of /instructor/*. Kept as its own file (rather than
// parametrizing the instructor one) so instructor's page is never at risk
// of breaking from a teacher-side change.

// Whole-term attendance summary only makes sense once a term has actually
// ended, for one specific classroom (not "All") — shows/hides the button
// accordingly whenever either filter changes.
function updateTermSummaryButton() {
  const termSelect = document.getElementById("attendanceFilterTerm");
  const classroomId = document.getElementById("attendanceFilterClassroom").value;
  const btn = document.getElementById("termSummaryBtn");
  if (!termSelect || !btn) return;

  const selectedOption = termSelect.options[termSelect.selectedIndex];
  const isEnded = selectedOption && selectedOption.dataset.ended === "1";
  btn.style.display = isEnded && classroomId ? "inline-block" : "none";
}

function viewTermAttendanceSummary() {
  const term_id = document.getElementById("attendanceFilterTerm").value;
  const classroom_id = document.getElementById("attendanceFilterClassroom").value;
  if (typeof loadUrl === "function") {
    loadUrl(`/teacher/attendance/term-summary?term_id=${term_id}&classroom_id=${classroom_id}`, "attendance");
  }
}

document.addEventListener("DOMContentLoaded", updateTermSummaryButton);
// This script itself loads as part of an AJAX section fragment (via
// runScripts() in teacher_sidenav.ejs), after DOMContentLoaded has already
// fired once for the real page load — so also run it immediately here.
updateTermSummaryButton();

async function loadAttendanceHistory() {
  const term_id = document.getElementById("attendanceFilterTerm").value;
  const classroom_id = document.getElementById("attendanceFilterClassroom").value;

  const res = await fetch(`/teacher/attendance/history?term_id=${term_id}&classroom_id=${classroom_id}`);
  const data = await res.json();

  let html = "";

  if (!Array.isArray(data) || data.length === 0) {
    html = `<tr><td colspan="5" class="tc-empty">No attendance found</td></tr>`;
  } else {
    data.forEach((a) => {
      html += `
        <tr>
          <td>${new Date(a.date).toDateString()}</td>
          <td>${a.classroom}</td>
          <td>${a.session_status}</td>
          <td>${a.student_count}</td>
          <td>
            <i class="fa fa-eye" style="cursor:pointer;color:#A17807;margin-right:10px;"
               onclick="toggleAttendanceDetails(${a.id})" title="View details"></i>
            <a href="/teacher/attendance/export/pdf/${a.id}" style="color:#A17807;" title="Download PDF"><i class="fa fa-file-pdf"></i></a>
          </td>
        </tr>
        <tr id="attendance-row-${a.id}" style="display:none;">
          <td colspan="5"><div id="attendance-details-${a.id}"></div></td>
        </tr>
      `;
    });
  }

  document.getElementById("attendanceTableBody").innerHTML = html;
}

function openAttendanceModal() {
  const classroomId = document.getElementById("attendanceFilterClassroom").value;
  if (!classroomId) {
    showAlert("Please select a classroom before taking attendance.");
    return;
  }
  document.getElementById("attendanceModal").style.display = "flex";
  loadAttendanceStudents();
}

function closeModal(id) {
  document.getElementById(id).style.display = "none";
}

async function loadAttendanceStudents() {
  const term_id = document.getElementById("attendanceFilterTerm").value;
  const classroom_id = document.getElementById("attendanceFilterClassroom").value;

  if (!classroom_id) {
    document.getElementById("attendanceStudentList").innerHTML =
      "<p style='color:#D64545;'>⚠️ Please select a classroom first</p>";
    return;
  }

  const res = await fetch(`/teacher/attendance/students?term_id=${term_id}&classroom_id=${classroom_id}`);
  const data = await res.json();

  let html = "<h3 style='margin:12px 0 8px;'>Mark Attendance</h3>";

  data.forEach((s) => {
    html += `
      <div style="display:flex; justify-content:space-between; align-items:center; margin:6px 0;">
        <span>${s.fullname}</span>
        <select data-id="${s.id}">
          <option value="present">Present</option>
          <option value="absent">Absent</option>
          <option value="late">Late</option>
        </select>
      </div>
    `;
  });

  html += `<button class="tc-btn tc-btn-primary" style="margin-top:10px;" onclick="saveAttendance()">Save</button>`;

  document.getElementById("attendanceStudentList").innerHTML = html;
}

document.getElementById("sessionStatus").addEventListener("change", loadAttendanceStudents);

async function saveAttendance() {
  const term_id = document.getElementById("attendanceFilterTerm").value;
  const classroom_id = document.getElementById("attendanceFilterClassroom").value;

  const records = [];
  document.querySelectorAll("#attendanceStudentList select").forEach((sel) => {
    records.push({ student_id: sel.dataset.id, status: sel.value });
  });

  const payload = {
    term_id,
    classroom_id,
    date: document.getElementById("attendanceDate").value,
    session_status: document.getElementById("sessionStatus").value,
    week_number: document.getElementById("week_number").value,
    records,
  };

  const res = await fetch("/teacher/attendance/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  showAlert(data.success ? "Attendance saved!" : (data.message || "Error saving attendance"), data.success ? "success" : "error");
  if (data.success) {
    closeModal("attendanceModal");
    loadAttendanceHistory();
  }
}

async function toggleAttendanceDetails(sessionId) {
  const row = document.getElementById(`attendance-row-${sessionId}`);
  const container = document.getElementById(`attendance-details-${sessionId}`);

  if (row.style.display === "none") {
    row.style.display = "table-row";

    if (!container.dataset.loaded) {
      const res = await fetch(`/teacher/attendance/session/${sessionId}`);
      const data = await res.json();

      if (!Array.isArray(data) || data.length === 0) {
        container.innerHTML = "<p>No attendance records</p>";
      } else {
        let html = `<table class="user-table"><thead><tr><th>Student</th><th>Status</th></tr></thead><tbody>`;
        data.forEach((s) => {
          html += `<tr><td>${s.fullname}</td><td>${formatStatus(s.status)}</td></tr>`;
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
