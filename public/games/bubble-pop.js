// Arcade: Bubble Pop — canvas, tap/click bubbles before they float away.
(function () {
  function start(container) {
    container.classList.add("arcade-game");
    container.style.setProperty("--game-accent", "#06b6d4");
    container.innerHTML = `
      <p class="arcade-game-hint">Tap bubbles before they float off the top. 60 seconds — go!</p>
      <div class="arcade-scoreboard">
        <div class="arcade-score-pill"><span class="label">Score</span><span class="value" id="bpScore">0</span></div>
        <div class="arcade-score-pill"><span class="label">Time</span><span class="value" id="bpTime">60</span></div>
      </div>
      <div class="arcade-canvas-wrap"><canvas id="bpCanvas"></canvas></div>
    `;

    const canvas = container.querySelector("#bpCanvas");
    const scoreEl = container.querySelector("#bpScore");
    const timeEl = container.querySelector("#bpTime");

    let dims, ctx, bubbles, score, timeLeft, running, rafId, overlayEl, removeResize, spawnTimer, timerId;
    const COLORS = ["#22d3ee", "#38bdf8", "#a78bfa", "#f472b6", "#fbbf24"];

    function layout() {
      dims = ArcadeEngine.fitCanvas(canvas, 0.85, 420);
      ctx = dims.ctx;
    }

    function reset() {
      if (overlayEl) { overlayEl.remove(); overlayEl = null; }
      bubbles = [];
      score = 0;
      timeLeft = 60;
      running = true;
      spawnTimer = 0;
      scoreEl.textContent = "0";
      timeEl.textContent = "60";
      if (timerId) clearInterval(timerId);
      timerId = setInterval(() => {
        timeLeft--;
        timeEl.textContent = String(Math.max(0, timeLeft));
        if (timeLeft <= 0) finish();
      }, 1000);
      loop();
    }

    function spawnBubble() {
      const r = dims.width * (0.04 + Math.random() * 0.045);
      bubbles.push({
        x: r + Math.random() * (dims.width - r * 2),
        y: dims.height + r,
        r,
        vy: -(dims.height * 0.0025 + Math.random() * dims.height * 0.002),
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        popped: false,
        popFrame: 0,
      });
    }

    function step() {
      spawnTimer++;
      const spawnEvery = Math.max(14, 32 - Math.floor(score / 5)); // spawns faster as score grows
      if (spawnTimer > spawnEvery) { spawnTimer = 0; spawnBubble(); }

      bubbles.forEach((b) => {
        if (b.popped) { b.popFrame++; return; }
        b.y += b.vy;
      });
      bubbles = bubbles.filter((b) => (b.popped ? b.popFrame < 10 : b.y + b.r > -20));
    }

    function draw() {
      const g = ctx.createLinearGradient(0, 0, 0, dims.height);
      g.addColorStop(0, "#0c4a6e");
      g.addColorStop(1, "#082f49");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, dims.width, dims.height);

      bubbles.forEach((b) => {
        ctx.save();
        if (b.popped) {
          ctx.globalAlpha = Math.max(0, 1 - b.popFrame / 10);
          ctx.beginPath();
          ctx.arc(b.x, b.y, b.r * (1 + b.popFrame / 10), 0, Math.PI * 2);
          ctx.strokeStyle = b.color;
          ctx.lineWidth = 3;
          ctx.stroke();
        } else {
          ctx.globalAlpha = 0.85;
          ctx.beginPath();
          ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
          ctx.fillStyle = b.color;
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.beginPath();
          ctx.arc(b.x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.28, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(255,255,255,0.5)";
          ctx.fill();
        }
        ctx.restore();
      });
    }

    function finish() {
      if (!running) return;
      running = false;
      clearInterval(timerId);
      cancelAnimationFrame(rafId);
      overlayEl = ArcadeEngine.overlay(container, {
        emoji: "🫧", title: "Time's up!", subtitle: `You popped for ${score} points.`,
        buttonLabel: "Play Again", onRestart: reset,
      });
    }

    function loop() {
      if (!running) return;
      step();
      draw();
      rafId = requestAnimationFrame(loop);
    }

    function pointerPop(clientX, clientY) {
      if (!running) return;
      const rect = canvas.getBoundingClientRect();
      const scale = dims.width / rect.width;
      const x = (clientX - rect.left) * scale;
      const y = (clientY - rect.top) * scale;
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i];
        if (b.popped) continue;
        const d = Math.hypot(x - b.x, y - b.y);
        if (d <= b.r * 1.15) {
          b.popped = true;
          b.popFrame = 0;
          score++;
          scoreEl.textContent = String(score);
          ArcadeEngine.vibrate(12);
          break;
        }
      }
    }

    const onTouch = (e) => { Array.from(e.changedTouches).forEach((t) => pointerPop(t.clientX, t.clientY)); e.preventDefault(); };
    const onClick = (e) => pointerPop(e.clientX, e.clientY);
    canvas.style.touchAction = "none";
    canvas.addEventListener("touchstart", onTouch, { passive: false });
    canvas.addEventListener("mousedown", onClick);
    removeResize = ArcadeEngine.onResize(layout);

    container._cleanup = () => {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      if (timerId) clearInterval(timerId);
      canvas.removeEventListener("touchstart", onTouch);
      canvas.removeEventListener("mousedown", onClick);
      if (removeResize) removeResize();
    };

    layout();
    reset();
  }

  function stop(container) {
    if (container && container._cleanup) container._cleanup();
  }

  window.ArcadeGames = window.ArcadeGames || {};
  window.ArcadeGames["bubble-pop"] = { start, stop };
})();
