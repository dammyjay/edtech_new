// Arcade: Connect Four — vs computer (depth-limited minimax w/ alpha-beta
// pruning over a line-counting heuristic — genuinely challenging, still
// beatable, and fast enough to run synchronously on tap).
(function () {
  const COLS = 7, ROWS = 6, PLAYER = "R", AI = "Y", DEPTH = 5;

  function emptyBoard() {
    return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  }

  function dropRow(board, col) {
    for (let r = ROWS - 1; r >= 0; r--) if (!board[r][col]) return r;
    return -1;
  }

  function checkWinner(board) {
    const lines = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (c + 3 < COLS) lines.push([[r, c], [r, c + 1], [r, c + 2], [r, c + 3]]);
      if (r + 3 < ROWS) lines.push([[r, c], [r + 1, c], [r + 2, c], [r + 3, c]]);
      if (r + 3 < ROWS && c + 3 < COLS) lines.push([[r, c], [r + 1, c + 1], [r + 2, c + 2], [r + 3, c + 3]]);
      if (r - 3 >= 0 && c + 3 < COLS) lines.push([[r, c], [r - 1, c + 1], [r - 2, c + 2], [r - 3, c + 3]]);
    }
    for (const line of lines) {
      const vals = line.map(([r, c]) => board[r][c]);
      if (vals[0] && vals.every((v) => v === vals[0])) return { winner: vals[0], line };
    }
    if (board[0].every((c) => c)) return { winner: "draw", line: null };
    return null;
  }

  function scoreWindow(vals, player) {
    const opp = player === AI ? PLAYER : AI;
    const mine = vals.filter((v) => v === player).length;
    const opps = vals.filter((v) => v === opp).length;
    const empty = vals.filter((v) => !v).length;
    if (mine === 4) return 1000;
    if (opps === 4) return -1000;
    if (mine === 3 && empty === 1) return 40;
    if (mine === 2 && empty === 2) return 8;
    if (opps === 3 && empty === 1) return -60;
    return 0;
  }

  function evaluate(board, player) {
    let score = 0;
    const center = board.map((row) => row[Math.floor(COLS / 2)]).filter((v) => v === player).length;
    score += center * 6;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (c + 3 < COLS) score += scoreWindow([board[r][c], board[r][c + 1], board[r][c + 2], board[r][c + 3]], player);
      if (r + 3 < ROWS) score += scoreWindow([board[r][c], board[r + 1][c], board[r + 2][c], board[r + 3][c]], player);
      if (r + 3 < ROWS && c + 3 < COLS) score += scoreWindow([board[r][c], board[r + 1][c + 1], board[r + 2][c + 2], board[r + 3][c + 3]], player);
      if (r - 3 >= 0 && c + 3 < COLS) score += scoreWindow([board[r][c], board[r - 1][c + 1], board[r - 2][c + 2], board[r - 3][c + 3]], player);
    }
    return score;
  }

  function validCols(board) {
    const cols = [];
    for (let c = 0; c < COLS; c++) if (!board[0][c]) cols.push(c);
    return cols;
  }

  function minimax(board, depth, alpha, beta, maximizing) {
    const w = checkWinner(board);
    if (w || depth === 0) {
      if (w?.winner === AI) return { score: 1000000 };
      if (w?.winner === PLAYER) return { score: -1000000 };
      if (w?.winner === "draw") return { score: 0 };
      return { score: evaluate(board, AI) };
    }

    const cols = validCols(board);
    let best = { col: cols[0], score: maximizing ? -Infinity : Infinity };

    for (const c of cols) {
      const r = dropRow(board, c);
      board[r][c] = maximizing ? AI : PLAYER;
      const result = minimax(board, depth - 1, alpha, beta, !maximizing);
      board[r][c] = null;

      if (maximizing) {
        if (result.score > best.score) best = { col: c, score: result.score };
        alpha = Math.max(alpha, result.score);
      } else {
        if (result.score < best.score) best = { col: c, score: result.score };
        beta = Math.min(beta, result.score);
      }
      if (beta <= alpha) break;
    }
    return best;
  }

  function start(container) {
    container.classList.add("arcade-game");
    container.style.setProperty("--game-accent", "#2563eb");
    container.innerHTML = `
      <p class="arcade-game-hint">Tap a column to drop your disc. Connect four in a row to win.</p>
      <div class="arcade-scoreboard">
        <div class="arcade-score-pill"><span class="label">Wins</span><span class="value" id="c4Wins">0</span></div>
        <div class="arcade-score-pill"><span class="label">Losses</span><span class="value" id="c4Losses">0</span></div>
      </div>
      <div id="c4Board" style="display:inline-grid; grid-template-columns:repeat(${COLS}, 1fr); gap:5px; background:#1e3a8a; padding:8px; border-radius:12px; max-width:420px; width:92vw;"></div>
    `;

    const boardWrap = container.querySelector("#c4Board");
    const winsEl = container.querySelector("#c4Wins");
    const lossesEl = container.querySelector("#c4Losses");
    let wins = 0, losses = 0;

    let board, over, overlayEl, cellEls;

    function render() {
      boardWrap.innerHTML = "";
      cellEls = [];
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const cell = document.createElement("div");
          const v = board[r][c];
          cell.style.cssText = `aspect-ratio:1; border-radius:50%; background:${v === PLAYER ? "#ef4444" : v === AI ? "#facc15" : "rgba(255,255,255,0.15)"}; transition:background .15s;`;
          boardWrap.appendChild(cell);
          cellEls.push(cell);
        }
      }
    }

    function onColClick(c) {
      if (over || dropRow(board, c) === -1) return;
      const r = dropRow(board, c);
      board[r][c] = PLAYER;
      render();
      ArcadeEngine.vibrate(10);
      const w = checkWinner(board);
      if (w) return finish(w);
      over = true; // lock input while computer "thinks"
      setTimeout(() => {
        const { col } = minimax(board, DEPTH, -Infinity, Infinity, true);
        const rr = dropRow(board, col);
        if (rr !== -1) board[rr][col] = AI;
        render();
        over = false;
        const w2 = checkWinner(board);
        if (w2) finish(w2);
      }, 400);
    }

    // Column tap targets — an invisible overlay row above the board,
    // one button per column, taller hit target than the disc cells alone.
    const colButtons = document.createElement("div");
    colButtons.style.cssText = `display:grid; grid-template-columns:repeat(${COLS}, 1fr); gap:5px; max-width:420px; width:92vw; margin:0 auto 6px;`;
    for (let c = 0; c < COLS; c++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "▼";
      btn.style.cssText = "background:rgba(255,255,255,0.08); border:none; color:#fff; border-radius:8px; padding:8px 0; cursor:pointer; font-size:12px;";
      btn.addEventListener("click", () => onColClick(c));
      colButtons.appendChild(btn);
    }
    boardWrap.insertAdjacentElement("beforebegin", colButtons);

    function finish(w) {
      over = true;
      if (w.winner === PLAYER) { wins++; winsEl.textContent = String(wins); ArcadeEngine.confetti(container); }
      else if (w.winner === AI) { losses++; lossesEl.textContent = String(losses); }
      const messages = { [PLAYER]: ["🎉", "You win!"], [AI]: ["🤖", "Computer wins"], draw: ["🤝", "Draw!"] };
      const [emoji, title] = messages[w.winner];
      overlayEl = ArcadeEngine.overlay(container, { emoji, title, buttonLabel: "Play Again", onRestart: reset });
    }

    function reset() {
      if (overlayEl) { overlayEl.remove(); overlayEl = null; }
      board = emptyBoard();
      over = false;
      render();
    }

    container._cleanup = () => {};
    reset();
  }

  function stop(container) {
    if (container && container._cleanup) container._cleanup();
  }

  window.ArcadeGames = window.ArcadeGames || {};
  window.ArcadeGames["connect-four"] = { start, stop };
})();
