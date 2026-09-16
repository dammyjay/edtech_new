// Arcade: 2048 — responsive grid + swipe/keyboard controls. Mounted by
// views/student/arcade.ejs through window.ArcadeGames['2048'].start(container).
(function () {
  const SIZE = 4;
  const TILE_COLORS = {
    0: "rgba(255,255,255,0.06)", 2: "#eee4da", 4: "#ede0c8", 8: "#f2b179", 16: "#f59563",
    32: "#f67c5f", 64: "#f65e3b", 128: "#edcf72", 256: "#edcc61",
    512: "#edc850", 1024: "#edc53f", 2048: "#edc22e", 4096: "#3c3a32",
  };

  function start(container) {
    container.classList.add("arcade-game");
    container.style.setProperty("--game-accent", "#f59e0b");
    container.innerHTML = `
      <p class="arcade-game-hint">Swipe or use arrow keys. Matching tiles merge — reach 2048!</p>
      <div class="arcade-scoreboard">
        <div class="arcade-score-pill"><span class="label">Score</span><span class="value" id="g2048Score">0</span></div>
        <div class="arcade-score-pill"><span class="label">Best</span><span class="value" id="g2048Best">${Number(localStorage.getItem("arcade_2048_best") || 0)}</span></div>
      </div>
      <div id="g2048BoardWrap" style="display:inline-block; max-width:100%;">
        <div id="g2048Board" style="display:grid; grid-template-columns:repeat(${SIZE}, 1fr); gap:8px; background:rgba(255,255,255,0.05); padding:8px; border-radius:14px; margin:0 auto; width:min(92vw, 360px); aspect-ratio:1;"></div>
      </div>
    `;

    const board = container.querySelector("#g2048Board");
    const scoreEl = container.querySelector("#g2048Score");
    const bestEl = container.querySelector("#g2048Best");

    let grid, score, over, won, overlayEl, removeSwipe;

    function emptyGrid() {
      return Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
    }

    function addRandomTile() {
      const empties = [];
      for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (grid[r][c] === 0) empties.push([r, c]);
      if (!empties.length) return;
      const [r, c] = empties[Math.floor(Math.random() * empties.length)];
      grid[r][c] = Math.random() < 0.9 ? 2 : 4;
    }

    function reset() {
      if (overlayEl) { overlayEl.remove(); overlayEl = null; }
      grid = emptyGrid();
      score = 0;
      over = false;
      won = false;
      addRandomTile();
      addRandomTile();
      render();
    }

    function render() {
      board.innerHTML = "";
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          const v = grid[r][c];
          const cellEl = document.createElement("div");
          cellEl.style.cssText = `border-radius:8px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:${v >= 1000 ? "5vw" : "6vw"};max-font-size:26px;color:${v && v <= 4 ? "#776e65" : "#fff"};background:${TILE_COLORS[v] || "#3c3a32"};transition:background .15s;`;
          cellEl.style.fontSize = v >= 1000 ? "clamp(14px, 5vw, 22px)" : "clamp(16px, 6vw, 26px)";
          cellEl.textContent = v || "";
          board.appendChild(cellEl);
        }
      }
      scoreEl.textContent = String(score);
    }

    function slideRowLeft(row) {
      const vals = row.filter((v) => v !== 0);
      const merged = [];
      for (let i = 0; i < vals.length; i++) {
        if (i < vals.length - 1 && vals[i] === vals[i + 1]) {
          const mergedVal = vals[i] * 2;
          merged.push(mergedVal);
          score += mergedVal;
          if (mergedVal === 2048) won = true;
          i++;
        } else {
          merged.push(vals[i]);
        }
      }
      while (merged.length < SIZE) merged.push(0);
      return merged;
    }

    function rotateGridCW(g) {
      const n = g.length;
      const res = emptyGrid();
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) res[c][n - 1 - r] = g[r][c];
      return res;
    }

    function hasMoves() {
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          if (grid[r][c] === 0) return true;
          if (c < SIZE - 1 && grid[r][c] === grid[r][c + 1]) return true;
          if (r < SIZE - 1 && grid[r][c] === grid[r + 1][c]) return true;
        }
      }
      return false;
    }

    function finish(text, emoji) {
      over = true;
      const best = Math.max(score, Number(localStorage.getItem("arcade_2048_best") || 0));
      localStorage.setItem("arcade_2048_best", String(best));
      bestEl.textContent = String(best);
      if (won) ArcadeEngine.confetti(container);
      overlayEl = ArcadeEngine.overlay(container, { emoji, title: text, subtitle: `Score: ${score}`, buttonLabel: "Play Again", onRestart: reset });
    }

    function move(direction) {
      if (over) return;
      let rotations = { left: 0, up: 1, right: 2, down: 3 }[direction];
      if (rotations === undefined) return;
      let working = grid;
      for (let i = 0; i < rotations; i++) working = rotateGridCW(working);

      const before = JSON.stringify(working);
      working = working.map(slideRowLeft);
      const changed = JSON.stringify(working) !== before;

      for (let i = 0; i < (4 - rotations) % 4; i++) working = rotateGridCW(working);
      grid = working;

      if (changed) {
        ArcadeEngine.vibrate(10);
        addRandomTile();
        render();
        if (won) finish("🎉 You reached 2048!", "🏆");
        else if (!hasMoves()) finish("No more moves", "😵");
      }
    }

    function onKey(e) {
      const map = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
      const dir = map[e.key];
      if (!dir) return;
      e.preventDefault();
      move(dir);
    }

    document.addEventListener("keydown", onKey);
    removeSwipe = ArcadeEngine.bindSwipe(board, { onSwipe: move });
    container._cleanup = () => {
      document.removeEventListener("keydown", onKey);
      if (removeSwipe) removeSwipe();
    };

    reset();
  }

  function stop(container) {
    if (container && container._cleanup) container._cleanup();
  }

  window.ArcadeGames = window.ArcadeGames || {};
  window.ArcadeGames["2048"] = { start, stop };
})();
