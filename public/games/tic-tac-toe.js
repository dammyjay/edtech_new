// Arcade: Tic-Tac-Toe — vs computer, full minimax (trivial search space
// for 3x3, so the computer plays perfectly / never loses).
(function () {
  const WINS = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
  ];

  function winner(board) {
    for (const [a, b, c] of WINS) {
      if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
    }
    return board.every((c) => c) ? "draw" : null;
  }

  function minimax(board, player) {
    const w = winner(board);
    if (w === "O") return { score: 1 };
    if (w === "X") return { score: -1 };
    if (w === "draw") return { score: 0 };

    const moves = [];
    board.forEach((c, i) => {
      if (c) return;
      const next = board.slice();
      next[i] = player;
      const result = minimax(next, player === "O" ? "X" : "O");
      moves.push({ index: i, score: result.score });
    });

    if (player === "O") {
      return moves.reduce((best, m) => (m.score > best.score ? m : best));
    }
    return moves.reduce((best, m) => (m.score < best.score ? m : best));
  }

  function start(container) {
    container.classList.add("arcade-game");
    container.style.setProperty("--game-accent", "#0891b2");
    container.innerHTML = `
      <p class="arcade-game-hint">You're X. Tap a square. The computer plays perfectly — a draw is a great result!</p>
      <div class="arcade-scoreboard">
        <div class="arcade-score-pill"><span class="label">Wins</span><span class="value" id="tttWins">0</span></div>
        <div class="arcade-score-pill"><span class="label">Draws</span><span class="value" id="tttDraws">0</span></div>
        <div class="arcade-score-pill"><span class="label">Losses</span><span class="value" id="tttLosses">0</span></div>
      </div>
      <div id="tttBoard" style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; max-width:280px; margin:0 auto;"></div>
    `;

    const boardEl = container.querySelector("#tttBoard");
    const winsEl = container.querySelector("#tttWins");
    const drawsEl = container.querySelector("#tttDraws");
    const lossesEl = container.querySelector("#tttLosses");

    let board, turn, over, overlayEl;
    let wins = 0, draws = 0, losses = 0;
    const cellEls = [];

    for (let i = 0; i < 9; i++) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.style.cssText = "aspect-ratio:1; border-radius:10px; border:none; background:rgba(255,255,255,0.08); font-size:clamp(28px,8vw,40px); font-weight:900; cursor:pointer; color:#fff;";
      cell.addEventListener("click", () => onCellClick(i));
      boardEl.appendChild(cell);
      cellEls.push(cell);
    }

    function render() {
      board.forEach((v, i) => {
        cellEls[i].textContent = v || "";
        cellEls[i].style.color = v === "X" ? "#38bdf8" : "#f87171";
      });
    }

    function onCellClick(i) {
      if (over || board[i] || turn !== "X") return;
      board[i] = "X";
      render();
      ArcadeEngine.vibrate(10);
      checkEnd();
      if (!over) {
        turn = "O";
        setTimeout(computerMove, 380);
      }
    }

    function computerMove() {
      if (over) return;
      const { index } = minimax(board, "O");
      board[index] = "O";
      render();
      turn = "X";
      checkEnd();
    }

    function checkEnd() {
      const w = winner(board);
      if (!w) return;
      over = true;
      if (w === "X") { wins++; winsEl.textContent = String(wins); }
      else if (w === "O") { losses++; lossesEl.textContent = String(losses); }
      else { draws++; drawsEl.textContent = String(draws); }

      const messages = { X: ["🎉", "You win!"], O: ["🤖", "Computer wins"], draw: ["🤝", "Draw!"] };
      const [emoji, title] = messages[w];
      if (w === "X") ArcadeEngine.confetti(container);
      overlayEl = ArcadeEngine.overlay(container, { emoji, title, buttonLabel: "Play Again", onRestart: reset });
    }

    function reset() {
      if (overlayEl) { overlayEl.remove(); overlayEl = null; }
      board = Array(9).fill(null);
      turn = "X";
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
  window.ArcadeGames["tic-tac-toe"] = { start, stop };
})();
