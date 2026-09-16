// Arcade: Snake — responsive canvas + swipe/D-pad/keyboard controls via
// window.ArcadeEngine. Mounted by views/student/arcade.ejs through
// window.ArcadeGames.snake.start(container).
(function () {
  const GRID = 18; // cells per side

  function start(container) {
    container.classList.add("arcade-game");
    container.style.setProperty("--game-accent", "#22c55e");
    container.innerHTML = `
      <p class="arcade-game-hint">Swipe, use the D-pad, or arrow keys / WASD. Eat the dot, don't hit yourself or the wall.</p>
      <div class="arcade-scoreboard">
        <div class="arcade-score-pill"><span class="label">Score</span><span class="value" id="snakeScore">0</span></div>
        <div class="arcade-score-pill"><span class="label">Best</span><span class="value" id="snakeBest">${Number(localStorage.getItem("arcade_snake_best") || 0)}</span></div>
      </div>
      <div class="arcade-canvas-wrap"><canvas id="snakeCanvas"></canvas></div>
      <div id="snakeDpadHolder"></div>
    `;

    const canvas = container.querySelector("#snakeCanvas");
    const scoreEl = container.querySelector("#snakeScore");
    const bestEl = container.querySelector("#snakeBest");
    let cell, ctx, dims;

    let snake, dir, nextDir, food, score, alive, loopId, overlayEl, removeResize, removeSwipe;

    function layout() {
      dims = ArcadeEngine.fitCanvas(canvas, 1, 420);
      ctx = dims.ctx;
      cell = dims.width / GRID;
      draw();
    }

    function randomFood() {
      let pos;
      do {
        pos = { x: Math.floor(Math.random() * GRID), y: Math.floor(Math.random() * GRID) };
      } while (snake.some((s) => s.x === pos.x && s.y === pos.y));
      return pos;
    }

    function reset() {
      if (overlayEl) { overlayEl.remove(); overlayEl = null; }
      snake = [{ x: 9, y: 9 }, { x: 8, y: 9 }, { x: 7, y: 9 }];
      dir = { x: 1, y: 0 };
      nextDir = dir;
      score = 0;
      alive = true;
      food = randomFood();
      scoreEl.textContent = "0";
      if (loopId) clearInterval(loopId);
      loopId = setInterval(tick, 115);
      layout();
    }

    function tick() {
      dir = nextDir;
      const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

      if (head.x < 0 || head.y < 0 || head.x >= GRID || head.y >= GRID || snake.some((s) => s.x === head.x && s.y === head.y)) {
        alive = false;
        clearInterval(loopId);
        const best = Math.max(score, Number(localStorage.getItem("arcade_snake_best") || 0));
        localStorage.setItem("arcade_snake_best", String(best));
        bestEl.textContent = String(best);
        overlayEl = ArcadeEngine.overlay(container, {
          emoji: "🐍", title: "Game Over", subtitle: `You scored ${score}. ${score >= best ? "New best!" : "Best: " + best}`,
          buttonLabel: "Play Again", onRestart: reset,
        });
        return;
      }

      snake.unshift(head);
      if (head.x === food.x && head.y === food.y) {
        score++;
        scoreEl.textContent = String(score);
        food = randomFood();
        ArcadeEngine.vibrate(15);
      } else {
        snake.pop();
      }
      draw();
    }

    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
      ctx.fill();
    }

    function draw() {
      if (!ctx) return;
      const g = ctx.createLinearGradient(0, 0, 0, dims.height);
      g.addColorStop(0, "#0f172a");
      g.addColorStop(1, "#1e293b");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, dims.width, dims.height);

      ctx.fillStyle = "#f59e0b";
      ctx.shadowColor = "#f59e0b";
      ctx.shadowBlur = 12;
      roundRect(food.x * cell + 2, food.y * cell + 2, cell - 4, cell - 4, cell * 0.3);
      ctx.shadowBlur = 0;

      snake.forEach((s, i) => {
        ctx.fillStyle = i === 0 ? "#4ade80" : "#22c55e";
        roundRect(s.x * cell + 1, s.y * cell + 1, cell - 2, cell - 2, cell * 0.28);
      });
    }

    function move(direction) {
      if (!alive) return;
      const map = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
      const next = map[direction];
      if (!next) return;
      if (next.x === -dir.x && next.y === -dir.y) return; // no 180s
      nextDir = next;
    }

    function onKey(e) {
      const map = { ArrowUp: "up", w: "up", ArrowDown: "down", s: "down", ArrowLeft: "left", a: "left", ArrowRight: "right", d: "right" };
      const dir2 = map[e.key];
      if (!dir2) return;
      e.preventDefault();
      move(dir2);
    }

    document.addEventListener("keydown", onKey);
    ArcadeEngine.dpad(container.querySelector("#snakeDpadHolder"), move);
    removeSwipe = ArcadeEngine.bindSwipe(canvas, { onSwipe: move });
    removeResize = ArcadeEngine.onResize(layout);

    container._cleanup = () => {
      document.removeEventListener("keydown", onKey);
      if (loopId) clearInterval(loopId);
      if (removeResize) removeResize();
      if (removeSwipe) removeSwipe();
    };

    reset();
  }

  function stop(container) {
    if (container && container._cleanup) container._cleanup();
  }

  window.ArcadeGames = window.ArcadeGames || {};
  window.ArcadeGames.snake = { start, stop };
})();
