// public/js/instructorArcadeSession.js
//
// Was inline <script> tags inside views/instructor/sections/arcade_session.ejs
// — but the instructor dashboard shell swaps sections via a plain
// main.innerHTML = html (see loadSection() in instructorDashboard.js),
// and a browser never executes <script> content inserted that way. Every
// function here (and the live-leaderboard polling) was silently dead:
// clicking "Start live session" / "End session" threw "is not defined".
// Loaded once, persistently, like attendance.js — afterSectionLoad()
// calls initArcadeSessionSection() each time this section opens instead.
let _arcadeSessionInterval = null;

function initArcadeSessionSection() {
  if (_arcadeSessionInterval) {
    clearInterval(_arcadeSessionInterval);
    _arcadeSessionInterval = null;
  }

  const liveEl = document.getElementById("arcadeSessionLive");
  if (!liveEl) return;
  const sessionId = liveEl.dataset.sessionId;

  function refresh() {
    fetch(`/instructor/arcade-session/${sessionId}/leaderboard`)
      .then((res) => res.json())
      .then((data) => {
        if (!data.success) return;
        const body = document.getElementById("arcadeSessionLeaderboardBody");
        if (!body) return;
        if (!data.leaderboard.length) {
          body.innerHTML = '<tr><td colspan="2">No one has joined yet.</td></tr>';
          return;
        }
        body.innerHTML = data.leaderboard.map((r) => `<tr><td>${r.fullname}</td><td>${r.score}</td></tr>`).join("");
      })
      .catch((err) => console.error(err));
  }
  refresh();
  _arcadeSessionInterval = setInterval(refresh, 4000);
}

async function endArcadeSession(id) {
  if (!(await showConfirm("End this live session?"))) return;
  if (_arcadeSessionInterval) {
    clearInterval(_arcadeSessionInterval);
    _arcadeSessionInterval = null;
  }
  fetch(`/instructor/arcade-session/${id}/end`, { method: "POST" })
    .then((res) => res.json())
    .then(() => loadSection("arcade_session"))
    .catch((err) => console.error(err));
}

function startArcadeSession() {
  const classroomEl = document.getElementById("asClassroom");
  const gameEl = document.getElementById("asGame");
  if (!classroomEl || !gameEl) return;
  const classroomId = classroomEl.value;
  const gameId = gameEl.value;
  if (!classroomId || !gameId) return;

  fetch("/instructor/arcade-session/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ classroomId, gameId }),
  })
    .then((res) => res.json())
    .then((data) => {
      if (!data.success) {
        showAlert(data.message || "Could not start session.", "error");
        return;
      }
      loadSection("arcade_session");
    })
    .catch((err) => console.error(err));
}
