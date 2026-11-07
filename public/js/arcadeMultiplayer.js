// public/js/arcadeMultiplayer.js
//
// Client side of the networked "play a real player" mode
// (controllers/arcadeMultiplayerController.js, services/arcadeMultiplayerService.js).
// Entirely separate from the existing vs-computer game modules in
// public/games/*.js — those render their own board and run a local AI;
// this module owns its own board rendering for the two games that
// support it (Tic-Tac-Toe, Connect Four) and polls the server for the
// authoritative state, since a real opponent's move can't be simulated
// locally the way the AI's can.
(function () {
  const MP_GAMES = {
    "tic-tac-toe": { label: "Tic-Tac-Toe", mySymbol: { 1: "X", 2: "O" } },
    "connect-four": { label: "Connect Four", mySymbol: { 1: "R", 2: "Y" } },
  };
  const MP_XP_DISPLAY = { win: 12, draw: 8, loss: 5 };

  let presenceTimer = null;
  let challengeTimer = null;
  let activeMatchId = null;
  let matchPollTimer = null;

  function startPresence() {
    if (presenceTimer) return;
    const ping = () => fetch("/student/arcade/presence/ping", { method: "POST" }).catch(() => {});
    ping();
    presenceTimer = setInterval(ping, 15000);
  }

  function startChallengeWatch() {
    if (challengeTimer) return;
    challengeTimer = setInterval(checkIncomingChallenges, 5000);
    checkIncomingChallenges();
  }

  function checkIncomingChallenges() {
    if (document.getElementById("mpChallengeModal")) return; // already showing one
    fetch("/student/arcade/challenges/incoming")
      .then((res) => res.json())
      .then((data) => {
        if (!data.success || !data.challenges.length) return;
        showIncomingChallenge(data.challenges[0]);
      })
      .catch(() => {});
  }

  function showIncomingChallenge(challenge) {
    const label = (MP_GAMES[challenge.game_id] || {}).label || challenge.game_id;
    const modal = document.createElement("div");
    modal.id = "mpChallengeModal";
    modal.className = "mp-modal-overlay";
    modal.innerHTML = `
      <div class="mp-modal-card">
        <h3>🎮 Challenge!</h3>
        <p><strong>${escapeHtml(challenge.challenger_name)}</strong> challenged you to ${escapeHtml(label)}.</p>
        <div class="mp-modal-actions">
          <button type="button" class="arcade-btn-primary" data-act="accept">Accept</button>
          <button type="button" class="arcade-btn-secondary" data-act="decline">Decline</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector('[data-act="accept"]').addEventListener("click", () => respondToChallenge(challenge.id, true, modal));
    modal.querySelector('[data-act="decline"]').addEventListener("click", () => respondToChallenge(challenge.id, false, modal));
  }

  function respondToChallenge(challengeId, accept, modal) {
    fetch(`/student/arcade/challenges/${challengeId}/${accept ? "accept" : "decline"}`, { method: "POST" })
      .then((res) => res.json())
      .then((data) => {
        modal.remove();
        if (accept && data.success && data.result && data.result.id) {
          openMatchStage(data.result.id);
        }
      })
      .catch(() => modal.remove());
  }

  function escapeHtml(str) {
    return (str || "").toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ---------------------------------------------------------------
  // Lobby: "Play a real player" — opened from a per-game button
  // arcade.ejs renders next to the existing vs-computer Play button.
  // ---------------------------------------------------------------
  function openLobby(gameId) {
    const label = (MP_GAMES[gameId] || {}).label || gameId;
    const modal = document.createElement("div");
    modal.id = "mpLobbyModal";
    modal.className = "mp-modal-overlay";
    modal.innerHTML = `
      <div class="mp-modal-card">
        <div class="mp-modal-head">
          <h3>👥 ${escapeHtml(label)} — Online Players</h3>
          <button type="button" class="mp-modal-close" data-act="close">✕</button>
        </div>
        <p class="mp-lobby-hint">Free to play — tap a name to challenge them.</p>
        <div id="mpLobbyList"><p>Loading…</p></div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector('[data-act="close"]').addEventListener("click", () => modal.remove());
    refreshLobby(gameId);
  }

  function refreshLobby(gameId) {
    const list = document.getElementById("mpLobbyList");
    if (!list) return;
    fetch("/student/arcade/online")
      .then((res) => res.json())
      .then((data) => {
        if (!list.isConnected) return;
        if (!data.success || !data.students.length) {
          list.innerHTML = "<p>No one else is online right now. Check back soon!</p>";
          return;
        }
        list.innerHTML = data.students
          .map(
            (s) => `
          <div class="mp-lobby-row">
            <span>${escapeHtml(s.fullname)}</span>
            <button type="button" class="arcade-btn-secondary" data-opponent="${s.id}">Challenge</button>
          </div>
        `
          )
          .join("");
        list.querySelectorAll("[data-opponent]").forEach((btn) => {
          btn.addEventListener("click", () => sendChallenge(gameId, btn.dataset.opponent, btn));
        });
      })
      .catch(() => {
        if (list.isConnected) list.innerHTML = "<p>Couldn't load online players.</p>";
      });
  }

  function sendChallenge(gameId, opponentId, btn) {
    btn.disabled = true;
    btn.textContent = "Sending…";
    fetch("/student/arcade/challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameId, opponentId }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (!data.success) {
          alert(data.message || "Could not send challenge.");
          btn.disabled = false;
          btn.textContent = "Challenge";
          return;
        }
        document.getElementById("mpLobbyModal")?.remove();
        watchPendingChallenge(data.match.id);
      })
      .catch(() => {
        btn.disabled = false;
        btn.textContent = "Challenge";
      });
  }

  function watchPendingChallenge(matchId) {
    const modal = document.createElement("div");
    modal.id = "mpWaitingModal";
    modal.className = "mp-modal-overlay";
    modal.innerHTML = `
      <div class="mp-modal-card">
        <h3>⏳ Challenge sent</h3>
        <p>Waiting for them to respond…</p>
        <button type="button" class="arcade-btn-secondary" data-act="cancel">Close</button>
      </div>
    `;
    document.body.appendChild(modal);
    const poll = setInterval(() => {
      fetch(`/student/arcade/matches/${matchId}`)
        .then((res) => res.json())
        .then((data) => {
          if (!data.success) return;
          if (data.match.status === "active") {
            clearInterval(poll);
            modal.remove();
            openMatchStage(matchId);
          } else if (data.match.status !== "pending") {
            clearInterval(poll);
            modal.remove();
            showToast(data.match.status === "declined" ? "They declined your challenge." : "Challenge expired.");
          }
        })
        .catch(() => {});
    }, 3000);
    modal.querySelector('[data-act="cancel"]').addEventListener("click", () => {
      clearInterval(poll);
      modal.remove();
    });
  }

  // ---------------------------------------------------------------
  // Match stage — renders into the same #arcadeGameContainer the solo
  // games use (arcade.ejs's closeGame() already knows how to tear it
  // down generically since it only calls window.ArcadeGames[id].stop).
  // ---------------------------------------------------------------
  function openMatchStage(matchId) {
    activeMatchId = matchId;
    const container = document.getElementById("arcadeGameContainer");
    const grid = document.getElementById("arcadeGrid");
    const filters = document.getElementById("arcadeFilters");
    const stage = document.getElementById("arcadeStage");
    if (!container || !stage) return;

    grid.style.display = "none";
    if (filters) filters.style.display = "none";
    stage.style.display = "block";
    container.innerHTML = "<p>Loading match…</p>";

    pollMatch(true);
    matchPollTimer = setInterval(() => pollMatch(false), 2000);
  }

  function stopMatchStage() {
    if (matchPollTimer) clearInterval(matchPollTimer);
    matchPollTimer = null;
    activeMatchId = null;
  }

  function pollMatch(isFirstLoad) {
    if (!activeMatchId) return;
    fetch(`/student/arcade/matches/${activeMatchId}`)
      .then((res) => res.json())
      .then((data) => {
        if (!data.success) return;
        renderMatch(data.match);
        if (data.match.status === "finished" && matchPollTimer) {
          clearInterval(matchPollTimer);
          matchPollTimer = null;
        }
      })
      .catch(() => {
        if (isFirstLoad) {
          const container = document.getElementById("arcadeGameContainer");
          if (container) container.innerHTML = "<p>Could not load this match.</p>";
        }
      });
  }

  function myRole(match) {
    return match.player1_id === window.__arcadeUserId ? 1 : 2;
  }

  function renderMatch(match) {
    const container = document.getElementById("arcadeGameContainer");
    if (!container) return;
    const role = myRole(match);
    const mySymbol = MP_GAMES[match.game_id].mySymbol[role];
    const opponentName = role === 1 ? match.player2_name : match.player1_name;
    const myTurn = match.status === "active" && match.turn_user_id === window.__arcadeUserId;

    let statusLine;
    if (match.status === "finished") {
      const outcome =
        match.result === "draw" ? "draw" : (match.result === "player1_win") === (role === 1) ? "win" : "loss";
      const messages = { win: "🎉 You won!", loss: "😔 You lost.", draw: "🤝 It's a draw." };
      statusLine = `${messages[outcome]} (+${MP_XP_DISPLAY[outcome]} XP)`;
    } else {
      statusLine = myTurn ? "Your turn!" : `Waiting for ${escapeHtml(opponentName)}…`;
    }

    const boardHtml =
      match.game_id === "tic-tac-toe" ? renderTicTacToeBoard(match, mySymbol, myTurn) : renderConnectFourBoard(match, mySymbol, myTurn);

    container.innerHTML = `
      <p class="arcade-game-hint">vs ${escapeHtml(opponentName)} — you're ${mySymbol}</p>
      <p class="mp-match-status">${statusLine}</p>
      ${boardHtml}
      ${match.status === "finished" ? '<button type="button" class="arcade-btn-primary" onclick="closeGame()" style="margin-top:14px;">Back to games</button>' : ""}
    `;

    if (match.status !== "finished") bindBoardClicks(match, myTurn);
  }

  function renderTicTacToeBoard(match, mySymbol, myTurn) {
    const cells = match.board
      .map((v, i) => {
        const clickable = myTurn && !v;
        const color = v === "X" ? "#38bdf8" : v === "O" ? "#f87171" : "#fff";
        return `<button type="button" data-cell="${i}" ${clickable ? "" : "disabled"} style="aspect-ratio:1; border-radius:10px; border:none; background:rgba(255,255,255,0.08); font-size:clamp(28px,8vw,40px); font-weight:900; cursor:${clickable ? "pointer" : "default"}; color:${color};">${v || ""}</button>`;
      })
      .join("");
    return `<div id="mpBoard" style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; max-width:280px; margin:0 auto;">${cells}</div>`;
  }

  function renderConnectFourBoard(match, mySymbol, myTurn) {
    const colButtons = Array.from({ length: 7 })
      .map((_, c) => {
        const full = match.board[0][c];
        const clickable = myTurn && !full;
        return `<button type="button" data-col="${c}" ${clickable ? "" : "disabled"} style="background:rgba(255,255,255,0.08); border:none; color:#fff; border-radius:8px; padding:8px 0; cursor:${clickable ? "pointer" : "default"}; font-size:12px;">▼</button>`;
      })
      .join("");
    const cells = [];
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 7; c++) {
        const v = match.board[r][c];
        const bg = v === "R" ? "#ef4444" : v === "Y" ? "#facc15" : "rgba(255,255,255,0.15)";
        cells.push(`<div style="aspect-ratio:1; border-radius:50%; background:${bg};"></div>`);
      }
    }
    return `
      <div style="display:grid; grid-template-columns:repeat(7, 1fr); gap:5px; max-width:420px; width:92vw; margin:0 auto 6px;">${colButtons}</div>
      <div id="mpBoard" style="display:inline-grid; grid-template-columns:repeat(7, 1fr); gap:5px; background:#1e3a8a; padding:8px; border-radius:12px; max-width:420px; width:92vw;">${cells.join("")}</div>
    `;
  }

  function bindBoardClicks(match, myTurn) {
    if (!myTurn) return;
    const container = document.getElementById("arcadeGameContainer");
    if (match.game_id === "tic-tac-toe") {
      container.querySelectorAll("[data-cell]").forEach((btn) => {
        btn.addEventListener("click", () => submitMove({ index: parseInt(btn.dataset.cell, 10) }));
      });
    } else {
      container.querySelectorAll("[data-col]").forEach((btn) => {
        btn.addEventListener("click", () => submitMove({ col: parseInt(btn.dataset.col, 10) }));
      });
    }
  }

  function submitMove(move) {
    if (!activeMatchId) return;
    fetch(`/student/arcade/matches/${activeMatchId}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(move),
    })
      .then((res) => res.json())
      .then((data) => {
        if (!data.success) {
          showToast(data.message || "Invalid move.");
          return;
        }
        renderMatch(data.match);
        if (data.match.status === "finished" && matchPollTimer) {
          clearInterval(matchPollTimer);
          matchPollTimer = null;
        }
      })
      .catch(() => showToast("Could not send your move."));
  }

  function showToast(msg) {
    if (window.showToast) window.showToast(msg);
    else alert(msg);
  }

  window.ArcadeMultiplayer = { startPresence, startChallengeWatch, openLobby, stopMatchStage };
})();
