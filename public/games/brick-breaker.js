// Arcade: Brick Breaker — canvas, drag/touch paddle + keyboard.
(function () {
  function start(container) {
    container.classList.add("arcade-game");
    container.style.setProperty("--game-accent", "#dc2626");
    container.innerHTML = `
      <p class="arcade-game-hint">Drag left/right (or arrow keys) to move the paddle. Smash every brick.</p>
      <div class="arcade-scoreboard">
        <div class="arcade-score-pill"><span class="label">Score</span><span class="value" id="bbScore">0</span></div>
        <div class="arcade-score-pill"><span class="label">Lives</span><span class="value" id="bbLives">3</span></div>
      </div>
      <div class="arcade-canvas-wrap"><canvas id="bbCanvas"></canvas></div>
    `;

    const canvas = container.querySelector("#bbCanvas");
    const scoreEl = container.querySelector("#bbScore");
    const livesEl = container.querySelector("#bbLives");

    let dims, ctx, paddle, ball, bricks, score, lives, running, rafId, overlayEl, removeResize;
    const ROWS = 5, COLS = 8;

    function layout() {
      dims = ArcadeEngine.fitCanvas(canvas, 0.75, 420);
      ctx = dims.ctx;
      if (!paddle) initEntities();
      else {
        paddle.w = dims.width * 0.2;
        paddle.y = dims.height - 22;
        if (paddle.x > dims.width - paddle.w) paddle.x = dims.width - paddle.w;
      }
    }

    function initEntities() {
      paddle = { w: dims.width * 0.2, h: 12, x: dims.width / 2 - dims.width * 0.1, y: dims.height - 22 };
      ball = { x: dims.width / 2, y: dims.height - 40, r: 6, vx: dims.width * 0.006, vy: -dims.width * 0.008 };
      bricks = [];
      const brickW = dims.width / COLS;
      const brickH = 18;
      const colors = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6"];
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          bricks.push({ x: c * brickW, y: r * brickH + 30, w: brickW - 3, h: brickH - 3, alive: true, color: colors[r % colors.length] });
        }
      }
    }

    function reset() {
      if (overlayEl) { overlayEl.remove(); overlayEl = null; }
      score = 0; lives = 3; running = true;
      scoreEl.textContent = "0"; livesEl.textContent = "3";
      initEntities();
      loop();
    }

    function launchBallReset() {
      ball.x = paddle.x + paddle.w / 2;
      ball.y = paddle.y - 10;
      ball.vx = dims.width * 0.006 * (Math.random() < 0.5 ? 1 : -1);
      ball.vy = -dims.width * 0.008;
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

    function step() {
      ball.x += ball.vx;
      ball.y += ball.vy;

      if (ball.x - ball.r < 0 || ball.x + ball.r > dims.width) ball.vx *= -1;
      if (ball.y - ball.r < 0) ball.vy *= -1;

      if (ball.y + ball.r >= paddle.y && ball.y + ball.r <= paddle.y + paddle.h + 6 && ball.x >= paddle.x && ball.x <= paddle.x + paddle.w && ball.vy > 0) {
        const hitPos = (ball.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2); // -1..1
        ball.vx = hitPos * dims.width * 0.01;
        ball.vy = -Math.abs(ball.vy);
        ArcadeEngine.vibrate(8);
      }

      bricks.forEach((b) => {
        if (!b.alive) return;
        if (ball.x + ball.r > b.x && ball.x - ball.r < b.x + b.w && ball.y + ball.r > b.y && ball.y - ball.r < b.y + b.h) {
          b.alive = false;
          ball.vy *= -1;
          score += 10;
          scoreEl.textContent = String(score);
          ArcadeEngine.vibrate(12);
        }
      });

      if (ball.y - ball.r > dims.height) {
        lives--;
        livesEl.textContent = String(lives);
        if (lives <= 0) {
          finish(false);
          return;
        }
        launchBallReset();
      }

      if (bricks.every((b) => !b.alive)) {
        finish(true);
      }
    }

    function draw() {
      const g = ctx.createLinearGradient(0, 0, 0, dims.height);
      g.addColorStop(0, "#1e1b4b");
      g.addColorStop(1, "#0f172a");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, dims.width, dims.height);

      bricks.forEach((b) => { if (b.alive) { ctx.fillStyle = b.color; roundRect(b.x, b.y, b.w, b.h, 3); } });

      ctx.fillStyle = "#e2e8f0";
      roundRect(paddle.x, paddle.y, paddle.w, paddle.h, 6);

      ctx.fillStyle = "#fbbf24";
      ctx.shadowColor = "#fbbf24";
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    function finish(won) {
      running = false;
      cancelAnimationFrame(rafId);
      if (won) ArcadeEngine.confetti(container);
      overlayEl = ArcadeEngine.overlay(container, {
        emoji: won ? "🏆" : "💥", title: won ? "All bricks smashed!" : "Game Over",
        subtitle: `Score: ${score}`, buttonLabel: "Play Again", onRestart: reset,
      });
    }

    function loop() {
      if (!running) return;
      step();
      draw();
      rafId = requestAnimationFrame(loop);
    }

    function movePaddleTo(clientX) {
      const rect = canvas.getBoundingClientRect();
      const scale = dims.width / rect.width;
      const x = (clientX - rect.left) * scale;
      paddle.x = Math.max(0, Math.min(dims.width - paddle.w, x - paddle.w / 2));
    }

    let dragging = false;
    const onTouchMove = (e) => { if (e.touches[0]) movePaddleTo(e.touches[0].clientX); };
    const onMouseDown = () => { dragging = true; };
    const onMouseUp = () => { dragging = false; };
    const onMouseMove = (e) => { if (dragging) movePaddleTo(e.clientX); };
    const onKey = (e) => {
      if (!paddle) return;
      if (e.key === "ArrowLeft") paddle.x = Math.max(0, paddle.x - dims.width * 0.05);
      if (e.key === "ArrowRight") paddle.x = Math.min(dims.width - paddle.w, paddle.x + dims.width * 0.05);
    };

    canvas.style.touchAction = "none";
    canvas.addEventListener("touchstart", onTouchMove, { passive: true });
    canvas.addEventListener("touchmove", onTouchMove, { passive: true });
    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("mousemove", onMouseMove);
    document.addEventListener("keydown", onKey);
    removeResize = ArcadeEngine.onResize(layout);

    container._cleanup = () => {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      canvas.removeEventListener("touchstart", onTouchMove);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("keydown", onKey);
      if (removeResize) removeResize();
    };

    layout();
    reset();
  }

  function stop(container) {
    if (container && container._cleanup) container._cleanup();
  }

  window.ArcadeGames = window.ArcadeGames || {};
  window.ArcadeGames["brick-breaker"] = { start, stop };
})();
