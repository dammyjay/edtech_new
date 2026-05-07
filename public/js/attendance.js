async function loadAttendanceHistory() {
  const term_id = document.getElementById("attendanceFilterTerm").value;
  const classroom_id = document.getElementById(
    "attendanceFilterClassroom",
  ).value;

  const res = await fetch(
    `/instructor/attendance/history?term_id=${term_id}&classroom_id=${classroom_id}`,
  );
  const data = await res.json();

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

  document.getElementById("attendanceTableBody").innerHTML = html;
}

function openAttendanceModal() {
  document.getElementById("attendanceModal").style.display = "flex";
  loadAttendanceStudents();
}

function closeModal(id) {
  document.getElementById(id).style.display = "none";
}

// async function loadAttendanceStudents() {
//   const term_id = document.getElementById("attendanceFilterTerm").value;
//   const classroom_id = document.getElementById(
//     "attendanceFilterClassroom",
//   ).value;

//   const res = await fetch(
//     `/instructor/attendance/students?term_id=${term_id}&classroom_id=${classroom_id}`,
//   );
//   const data = await res.json();

//   let html = "<h3>Mark Attendance</h3>";

//   data.forEach((s) => {
//     html += `
//       <div style="margin:5px 0;">
//         <span>${s.fullname}</span>
//         <select data-id="${s.id}">
//           <option value="present">Present</option>
//           <option value="absent">Absent</option>
//           <option value="late">Late</option>
//         </select>
//       </div>
//     `;
//   });

//   html += `<button onclick="saveAttendance()">Save</button>`;

//   document.getElementById("attendanceStudentList").innerHTML = html;
// }

async function loadAttendanceStudents() {
  const term_id = document.getElementById("attendanceFilterTerm").value;
  const classroom_id = document.getElementById(
    "attendanceFilterClassroom",
  ).value;

  if (!classroom_id) {
    document.getElementById("attendanceStudentList").innerHTML =
      "<p style='color:red;'>⚠️ Please select a classroom first</p>";
    return;
  }

  const res = await fetch(
    `/instructor/attendance/students?term_id=${term_id}&classroom_id=${classroom_id}`,
  );

  const data = await res.json();

  let html = "<h3>Mark Attendance</h3>";

  data.forEach((s) => {
    html += `
      <div style="margin:5px 0;">
        <span>${s.fullname}</span>
        <select data-id="${s.id}">
          <option value="present">Present</option>
          <option value="absent">Absent</option>
          <option value="late">Late</option>
        </select>
      </div>
    `;
  });

  html += `<button onclick="saveAttendance()">Save</button>`;

  document.getElementById("attendanceStudentList").innerHTML = html;
}

document
  .getElementById("sessionStatus")
  .addEventListener("change", loadAttendanceStudents);

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

  const res = await fetch("/instructor/attendance/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  alert(data.success ? "Saved!" : "Error saving");
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