// public/js/instructorReminders.js
//
// Loaded persistently (see views/instructor/dashboard.ejs), same reason
// as instructorArcadeSession.js — the instructor dashboard shell swaps
// sections via main.innerHTML=, which never executes embedded <script>
// tags. afterSectionLoad() (instructorDashboard.js) calls
// loadInstructorReminders() each time the Reminders tab opens.
let remindersCache = [];
let schoolsCache = [];

function escapeHtmlIR(str) {
  return (str || "").toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function statusPillClassIR(status) {
  if (status === "understood" || status === "followup_sent") return "jk-pill--active";
  if (status === "unclear") return "jk-pill--on";
  return "jk-pill--inactive";
}

function statusLabelIR(status) {
  return (
    {
      pending: "Awaiting reply",
      understood: "Understood",
      unclear: "Reply unclear",
      followup_sent: "Follow-up sent",
    }[status] || status
  );
}

function loadInstructorReminders() {
  fetch("/instructor/reminders/list")
    .then((res) => res.json())
    .then((data) => {
      remindersCache = data.reminders || [];
      renderInstructorReminders();
    })
    .catch((err) => {
      console.error(err);
      const grid = document.getElementById("instReminderGrid");
      if (grid) grid.innerHTML = "<p>Failed to load reminders.</p>";
    });
}

function renderInstructorReminders() {
  const grid = document.getElementById("instReminderGrid");
  if (!grid) return;
  if (!remindersCache.length) {
    grid.innerHTML = '<p>No reminders yet. Click "+ New Reminder" to send one.</p>';
    return;
  }
  grid.innerHTML = remindersCache
    .map(
      (r) => `
    <div class="jk-term-card">
      <div class="jk-tc-head">
        <div>
          <p class="jk-tc-name">${escapeHtmlIR(r.title)}</p>
          <p class="jk-tc-period">Due ${new Date(r.due_date).toLocaleDateString()} · resends every ${r.resend_interval_days}d</p>
        </div>
        <span class="jk-pill ${r.status === "active" ? "jk-pill--active" : "jk-pill--inactive"}">${r.status}</span>
      </div>
      <p style="margin:8px 0; font-size:13px; color:#6E6350;">${escapeHtmlIR(r.message).slice(0, 140)}${r.message.length > 140 ? "…" : ""}</p>
      <p style="font-size:13px;"><strong>${r.understood_schools}</strong> / ${r.total_schools} schools have responded</p>
      <div class="jk-tc-actions">
        <button class="jk-btn-outline-sm" onclick="openReminderDetailModal(${r.id})">View</button>
        ${r.status === "active" ? `<button class="jk-btn-outline-sm" onclick="closeInstructorReminder(${r.id})">Close</button>` : ""}
      </div>
    </div>
  `
    )
    .join("");
}

function loadSchoolsForInstructorCreate() {
  fetch("/instructor/reminders/schools")
    .then((res) => res.json())
    .then((data) => {
      schoolsCache = data || [];
      const list = document.getElementById("irSchoolsList");
      if (!schoolsCache.length) {
        list.innerHTML = "<p>You're not assigned to any schools yet.</p>";
        return;
      }
      list.innerHTML = schoolsCache
        .map(
          (s) => `
        <label style="display:flex; align-items:center; gap:8px; margin-bottom:4px; font-weight:400;">
          <input type="checkbox" class="irSchoolCheckbox" value="${s.id}" style="width:auto; margin:0;"> ${escapeHtmlIR(s.name)}
        </label>
      `
        )
        .join("");
    })
    .catch((err) => {
      console.error(err);
      const list = document.getElementById("irSchoolsList");
      if (list) list.innerHTML = "<p>Failed to load schools.</p>";
    });
}

function openCreateReminderModal() {
  document.getElementById("irTitle").value = "";
  document.getElementById("irMessage").value = "";
  document.getElementById("irDueDate").value = "";
  document.getElementById("irResendDays").value = 2;
  document.querySelectorAll(".irRoleCheckbox").forEach((cb) => (cb.checked = true));
  loadSchoolsForInstructorCreate();
  document.getElementById("instCreateReminderOverlay").hidden = false;
}

function closeCreateReminderModal() {
  document.getElementById("instCreateReminderOverlay").hidden = true;
}

function submitInstructorReminder() {
  const title = document.getElementById("irTitle").value.trim();
  const message = document.getElementById("irMessage").value.trim();
  const dueDate = document.getElementById("irDueDate").value;
  const resendIntervalDays = document.getElementById("irResendDays").value;
  const schoolIds = Array.from(document.querySelectorAll(".irSchoolCheckbox:checked")).map((cb) => cb.value);
  const targetRoles = Array.from(document.querySelectorAll(".irRoleCheckbox:checked")).map((cb) => cb.value);

  if (!title || !message || !dueDate) {
    showAlert("Title, message, and due date are required.");
    return;
  }
  if (!schoolIds.length) {
    showAlert("Select at least one school.");
    return;
  }
  if (!targetRoles.length) {
    showAlert("Select at least one recipient group.");
    return;
  }

  fetch("/instructor/reminders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, message, dueDate, resendIntervalDays, schoolIds, targetRoles }),
  })
    .then((res) => res.json())
    .then((data) => {
      if (data.error) {
        showAlert(data.error);
        return;
      }
      closeCreateReminderModal();
      loadInstructorReminders();
    })
    .catch((err) => {
      console.error(err);
      showAlert("Failed to send reminder.");
    });
}

async function closeInstructorReminder(id) {
  if (!(await showConfirm("Stop this reminder? No further resends or follow-ups will go out."))) return;
  fetch(`/instructor/reminders/${id}/close`, { method: "POST" })
    .then((res) => res.json())
    .then(() => loadInstructorReminders())
    .catch((err) => console.error(err));
}

function openReminderDetailModal(id) {
  document.getElementById("instReminderDetailBody").innerHTML = "<p>Loading…</p>";
  document.getElementById("instReminderDetailOverlay").hidden = false;
  fetch(`/instructor/reminders/${id}`)
    .then((res) => res.json())
    .then((data) => renderInstructorReminderDetail(data))
    .catch((err) => {
      console.error(err);
      document.getElementById("instReminderDetailBody").innerHTML = "<p>Failed to load reminder.</p>";
    });
}

function closeReminderDetailModal() {
  document.getElementById("instReminderDetailOverlay").hidden = true;
}

function renderInstructorReminderDetail(data) {
  const { reminder, targets } = data;
  document.getElementById("instReminderDetailTitle").textContent = reminder.title;
  document.getElementById("instReminderDetailBody").innerHTML = `
    <p style="color:#6E6350;">${escapeHtmlIR(reminder.message)}</p>
    <p style="font-size:13px; margin-bottom:16px;">Due ${new Date(reminder.due_date).toLocaleDateString()} · resends every ${reminder.resend_interval_days}d · status: ${reminder.status}</p>
    ${targets
      .map(
        (t) => `
      <div style="border-top:1px solid #F1ECDD; padding:12px 0;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <strong>${escapeHtmlIR(t.school_name)}</strong>
          <span class="jk-pill ${statusPillClassIR(t.status)}">${statusLabelIR(t.status)}</span>
        </div>
        <p style="font-size:12px; color:#8A7B55; margin:4px 0;">
          ${t.last_sent_at ? "Last sent " + new Date(t.last_sent_at).toLocaleString() : "Not sent yet"}
        </p>
        ${
          t.replies.length
            ? t.replies
                .map(
                  (rep) => `
              <div style="background:#FAF7EE; border-radius:8px; padding:8px 10px; margin-top:6px; font-size:13px;">
                <p style="margin:0 0 2px; color:#6E6350;"><strong>${escapeHtmlIR(rep.fullname || "Unknown")}</strong> via ${rep.channel} · ${new Date(rep.received_at).toLocaleString()}</p>
                <p style="margin:0;">${escapeHtmlIR(rep.raw_text)}</p>
                <p style="margin:4px 0 0; font-size:12px; color:${rep.ai_understood ? "#2E7D32" : "#A15400"};">AI: ${rep.ai_understood ? "Understood" : "Not clearly understood"}${rep.ai_summary ? " — " + escapeHtmlIR(rep.ai_summary) : ""}</p>
              </div>
            `
                )
                .join("")
            : '<p style="font-size:12px; color:#8A7B55;">No reply yet.</p>'
        }
      </div>
    `
      )
      .join("")}
  `;
}
