// Arcade: Flappy Block — canvas, tap/click/space to flap.
(function () {
  function start(container) {
    container.classList.add("arcade-game");
    container.style.setProperty("--game-accent", "#0ea5e9");
    container.innerHTML = `
      <p class="arcade-game-hint">Tap, click, or press Space to flap. Thread the gaps.</p>
      <div class="arcade-scoreboard">
        <div class="arcade-score-pill"><span class="label">Score</span><span class="value" id="fbScore">0</span></div>
        <div class="arcade-score-pill"><span class="label">Best</span><span class="value" id="fbBest">${Number(localStorage.getItem("arcade_flappy_best") || 0)}</span></div>
      </div>
      <div class="arcade-canvas-wrap"><canvas id="fbCanvas"></canvas></div>
    `;

    const canvas = container.querySelector("#fbCanvas");
    const scoreEl = container.querySelector("#fbScore");
    const bestEl = container.querySelector("#fbBest");

    let dims, ctx, bird, pipes, score, running, started, rafId, overlayEl, removeResize, spawnTimer;
    const GRAVITY = 0.45, FLAP = -7.2, PIPE_GAP_RATIO = 0.3, PIPE_W = 52;

    function layout() {
      dims = ArcadeEngine.fitCanvas(canvas, 0.72, 380);
      ctx = dims.ctx;
      if (bird) bird.x = dims.width * 0.28;
    }

    function reset() {
      if (overlayEl) { overlayEl.remove(); overlayEl = null; }
      bird = { x: dims.width * 0.28, y: dims.height / 2, vy: 0, r: 13 };
      pipes = [];
      score = 0;
      running = true;
      started = false;
      scoreEl.textContent = "0";
      spawnTimer = 0;
      draw();
    }

    function flap() {
      if (!running) return;
      if (!started) { started = true; loop(); }
      bird.vy = FLAP;
      ArcadeEngine.vibrate(10);
    }

    function spawnPipe() {
      const gap = dims.height * PIPE_GAP_RATIO;
      const margin = 40;
      const gapY = margin + Math.random() * (dims.height - margin * 2 - gap);
      pipes.push({ x: dims.width + PIPE_W, gapY, gap, passed: false });
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
      bird.vy += GRAVITY;
      bird.y += bird.vy;

      spawnTimer++;
      if (spawnTimer > 95) { spawnTimer = 0; spawnPipe(); }

      const speed = dims.width * 0.014;
      pipes.forEach((p) => { p.x -= speed; });
      pipes = pipes.filter((p) => p.x + PIPE_W > 0);

      pipes.forEach((p) => {
        if (!p.passed && p.x + PIPE_W < bird.x) {
          p.passed = true;
          score++;
          scoreEl.textContent = String(score);
        }
        const withinX = bird.x + bird.r > p.x && bird.x - bird.r < p.x + PIPE_W;
        const withinGap = bird.y - bird.r > p.gapY && bird.y + bird.r < p.gapY + p.gap;
        if (withinX && !withinGap) crash();
      });

      if (bird.y + bird.r > dims.height || bird.y - bird.r < 0) crash();
    }

    function crash() {
      if (!running) return;
      running = false;
      const best = Math.max(score, Number(localStorage.getItem("arcade_flappy_best") || 0));
      localStorage.setItem("arcade_flappy_best", String(best));
      bestEl.textContent = String(best);
      cancelAnimationFrame(rafId);
      overlayEl = ArcadeEngine.overlay(container, {
        emoji: "💥", title: "Crashed!", subtitle: `Score: ${score}${score >= best ? " — new best!" : ""}`,
        buttonLabel: "Play Again", onRestart: reset,
      });
    }

    function draw() {
      const g = ctx.createLinearGradient(0, 0, 0, dims.height);
      g.addColorStop(0, "#0ea5e9");
      g.addColorStop(1, "#0c4a6e");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, dims.width, dims.height);

      ctx.fillStyle = "#16a34a";
      pipes.forEach((p) => {
        roundRect(p.x, 0, PIPE_W, p.gapY, 6);
        roundRect(p.x, p.gapY + p.gap, PIPE_W, dims.height - (p.gapY + p.gap), 6);
      });

      ctx.fillStyle = "#fde047";
      ctx.shadowColor = "#fde047";
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(bird.x, bird.y, bird.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      if (!started) {
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.font = "bold 14px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("Tap to start", dims.width / 2, dims.height / 2 - 30);
      }
    }

    function loop() {
      if (!running) return;
      step();
      draw();
      rafId = requestAnimationFrame(loop);
    }

    const onKey = (e) => { if (e.code === "Space") { e.preventDefault(); flap(); } };
    canvas.style.touchAction = "none";
    canvas.addEventListener("touchstart", (e) => { e.preventDefault(); flap(); }, { passive: false });
    canvas.addEventListener("mousedown", flap);
    document.addEventListener("keydown", onKey);
    removeResize = ArcadeEngine.onResize(() => { layout(); draw(); });

    container._cleanup = () => {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
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
  window.ArcadeGames["flappy-block"] = { start, stop };
})();
