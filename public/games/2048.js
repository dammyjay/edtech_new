// Arcade: 2048 — self-contained, no dependencies. Mounted by
// views/student/arcade.ejs via window.ArcadeGames['2048'].start(container).
(function () {
  const SIZE = 4;

  function start(container) {
    container.innerHTML = `
      <div style="text-align:center;">
        <p style="margin:0 0 8px; font-size:14px; color:#555;">Arrow keys to slide tiles. Matching tiles merge — reach 2048!</p>
        <div id="g2048Board" style="display:grid; grid-template-columns:repeat(${SIZE}, 64px); grid-template-rows:repeat(${SIZE}, 64px); gap:8px; background:#94867a; padding:8px; border-radius:8px; margin:0 auto; width:max-content;"></div>
        <p style="margin-top:8px; font-weight:bold;">Score: <span id="g2048Score">0</span></p>
        <div id="g2048Overlay" style="display:none; margin-top:8px;">
          <p id="g2048OverlayText" style="font-weight:bold;"></p>
          <button id="g2048Restart" class="btn" style="cursor:pointer;">Play Again</button>
        </div>
      </div>
    `;

    const board = container.querySelector("#g2048Board");
    const scoreEl = container.querySelector("#g2048Score");
    const overlay = container.querySelector("#g2048Overlay");
    const overlayText = container.querySelector("#g2048OverlayText");
    const restartBtn = container.querySelector("#g2048Restart");

    const TILE_COLORS = {
      0: "#cdc1b4", 2: "#eee4da", 4: "#ede0c8", 8: "#f2b179", 16: "#f59563",
      32: "#f67c5f", 64: "#f65e3b", 128: "#edcf72", 256: "#edcc61",
      512: "#edc850", 1024: "#edc53f", 2048: "#edc22e",
    };

    let grid, score, over, won;

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
      grid = emptyGrid();
      score = 0;
      over = false;
      won = false;
      addRandomTile();
      addRandomTile();
      overlay.style.display = "none";
      render();
    }

    function render() {
      board.innerHTML = "";
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          const v = grid[r][c];
          const cell = document.createElement("div");
          cell.style.cssText = `width:64px;height:64px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:${v >= 1000 ? 18 : 22}px;color:${v <= 4 ? "#776e65" : "#fff"};background:${TILE_COLORS[v] || "#3c3a32"};`;
          cell.textContent = v || "";
          board.appendChild(cell);
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

    function move(direction) {
      if (over) return;
      let rotations = { left: 0, up: 1, right: 2, down: 3 }[direction];
      let working = grid;
      for (let i = 0; i < rotations; i++) working = rotateGridCW(working);

      const before = JSON.stringify(working);
      working = working.map(slideRowLeft);
      const changed = JSON.stringify(working) !== before;

      for (let i = 0; i < (4 - rotations) % 4; i++) working = rotateGridCW(working);
      grid = working;

      if (changed) {
        addRandomTile();
        render();
        if (won) {
          over = true;
          overlayText.textContent = "🎉 You reached 2048!";
          overlay.style.display = "block";
        } else if (!hasMoves()) {
          over = true;
          overlayText.textContent = "Game Over — no more moves.";
          overlay.style.display = "block";
        }
      }
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

    function onKey(e) {
      const map = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
      const dir = map[e.key];
      if (!dir) return;
      e.preventDefault();
      move(dir);
    }

    document.addEventListener("keydown", onKey);
    restartBtn.addEventListener("click", reset);
    container._cleanup = () => document.removeEventListener("keydown", onKey);

    reset();
  }

  function stop(container) {
    if (container && container._cleanup) container._cleanup();
  }

  window.ArcadeGames = window.ArcadeGames || {};
  window.ArcadeGames["2048"] = { start, stop };
})();
