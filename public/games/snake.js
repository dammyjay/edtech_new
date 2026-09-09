// Arcade: Snake — self-contained, no dependencies. Mounted by
// views/student/arcade.ejs via window.ArcadeGames.snake.start(container).
(function () {
  const GRID = 20; // cells per side
  const CELL = 18; // px per cell

  function start(container) {
    container.innerHTML = `
      <div style="text-align:center;">
        <p style="margin:0 0 8px; font-size:14px; color:#555;">Arrow keys / WASD to move. Eat the dot, don't hit yourself or the wall.</p>
        <canvas id="snakeCanvas" width="${GRID * CELL}" height="${GRID * CELL}" style="background:#0f172a; border-radius:8px; touch-action:none;"></canvas>
        <p style="margin-top:8px; font-weight:bold;">Score: <span id="snakeScore">0</span></p>
        <div id="snakeOverlay" style="display:none; margin-top:8px;">
          <p style="color:#dc2626; font-weight:bold;">Game Over!</p>
          <button id="snakeRestart" class="btn" style="cursor:pointer;">Play Again</button>
        </div>
      </div>
    `;

    const canvas = container.querySelector("#snakeCanvas");
    const ctx = canvas.getContext("2d");
    const scoreEl = container.querySelector("#snakeScore");
    const overlay = container.querySelector("#snakeOverlay");
    const restartBtn = container.querySelector("#snakeRestart");

    let snake, dir, nextDir, food, score, alive, loopId;

    function randomFood() {
      let pos;
      do {
        pos = { x: Math.floor(Math.random() * GRID), y: Math.floor(Math.random() * GRID) };
      } while (snake.some((s) => s.x === pos.x && s.y === pos.y));
      return pos;
    }

    function reset() {
      snake = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
      dir = { x: 1, y: 0 };
      nextDir = dir;
      score = 0;
      alive = true;
      food = randomFood();
      scoreEl.textContent = "0";
      overlay.style.display = "none";
      if (loopId) clearInterval(loopId);
      loopId = setInterval(tick, 110);
    }

    function tick() {
      dir = nextDir;
      const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

      if (head.x < 0 || head.y < 0 || head.x >= GRID || head.y >= GRID || snake.some((s) => s.x === head.x && s.y === head.y)) {
        alive = false;
        clearInterval(loopId);
        overlay.style.display = "block";
        return;
      }

      snake.unshift(head);
      if (head.x === food.x && head.y === food.y) {
        score++;
        scoreEl.textContent = String(score);
        food = randomFood();
      } else {
        snake.pop();
      }
      draw();
    }

    function draw() {
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#f59e0b";
      ctx.fillRect(food.x * CELL, food.y * CELL, CELL - 2, CELL - 2);
      snake.forEach((s, i) => {
        ctx.fillStyle = i === 0 ? "#4ade80" : "#22c55e";
        ctx.fillRect(s.x * CELL, s.y * CELL, CELL - 2, CELL - 2);
      });
    }

    function onKey(e) {
      if (!alive) return;
      const map = {
        ArrowUp: { x: 0, y: -1 }, w: { x: 0, y: -1 },
        ArrowDown: { x: 0, y: 1 }, s: { x: 0, y: 1 },
        ArrowLeft: { x: -1, y: 0 }, a: { x: -1, y: 0 },
        ArrowRight: { x: 1, y: 0 }, d: { x: 1, y: 0 },
      };
      const next = map[e.key];
      if (!next) return;
      if (next.x === -dir.x && next.y === -dir.y) return; // no 180s
      nextDir = next;
      e.preventDefault();
    }

    document.addEventListener("keydown", onKey);
    restartBtn.addEventListener("click", reset);
    container._cleanup = () => {
      document.removeEventListener("keydown", onKey);
      if (loopId) clearInterval(loopId);
    };

    reset();
    draw();
  }

  function stop(container) {
    if (container && container._cleanup) container._cleanup();
  }

  window.ArcadeGames = window.ArcadeGames || {};
  window.ArcadeGames.snake = { start, stop };
})();
