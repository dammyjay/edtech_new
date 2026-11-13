// Arcade: Pool — real ball-to-ball elastic collisions, friction, pockets.
// Drag back from the cue ball (slingshot-style) and release to shoot.
(function () {
  const FRICTION_BY_DIFFICULTY = { easy: 0.985, medium: 0.978, hard: 0.971 };
  const POCKET_MULT_BY_DIFFICULTY = { easy: 2.3, medium: 1.9, hard: 1.6 };
  const BALL_COLORS = ["#eab308", "#2563eb", "#dc2626", "#7c3aed", "#059669"];
  const MAX_SHOTS = 30;
  const MAX_POWER = 16;

  function start(container) {
    container.classList.add("arcade-game");
    container.style.setProperty("--game-accent", "#15803d");
    const friction = FRICTION_BY_DIFFICULTY[container.dataset.difficulty] || FRICTION_BY_DIFFICULTY.medium;
    const pocketMult = POCKET_MULT_BY_DIFFICULTY[container.dataset.difficulty] || POCKET_MULT_BY_DIFFICULTY.medium;

    container.innerHTML = `
      <p class="arcade-game-hint">Drag back from the cue ball and release to shoot. Sink every colored ball.</p>
      <div class="arcade-scoreboard">
        <div class="arcade-score-pill"><span class="label">Score</span><span class="value" id="poolScore">0</span></div>
        <div class="arcade-score-pill"><span class="label">Balls Left</span><span class="value" id="poolLeft">5</span></div>
        <div class="arcade-score-pill"><span class="label">Shots</span><span class="value" id="poolShots">0</span></div>
      </div>
      <div class="arcade-canvas-wrap"><canvas id="poolCanvas"></canvas></div>
    `;

    const canvas = container.querySelector("#poolCanvas");
    const scoreEl = container.querySelector("#poolScore");
    const leftEl = container.querySelector("#poolLeft");
    const shotsEl = container.querySelector("#poolShots");

    let dims, ctx, balls, pockets, r, score, shots, running, rafId, overlayEl, removeResize;
    let aiming = false, aimStart = null, aimCurrent = null;

    function makeBalls() {
      r = dims.width * 0.019;
      const cue = { x: dims.width * 0.22, y: dims.height / 2, vx: 0, vy: 0, r, color: "#f8fafc", cue: true, alive: true };
      const rackX = dims.width * 0.68, rackY = dims.height / 2;
      const spacing = r * 2.05;
      const positions = [
        [0, 0], [spacing * 0.87, -spacing / 2], [spacing * 0.87, spacing / 2],
        [spacing * 1.74, -spacing], [spacing * 1.74, 0],
      ];
      const rest = positions.map((p, i) => ({
        x: rackX + p[0], y: rackY + p[1], vx: 0, vy: 0, r, color: BALL_COLORS[i], cue: false, alive: true,
      }));
      balls = [cue, ...rest];
    }

    function makePockets() {
      const m = r * 1.4;
      pockets = [
        { x: m, y: m }, { x: dims.width - m, y: m },
        { x: m, y: dims.height - m }, { x: dims.width - m, y: dims.height - m },
        { x: dims.width / 2, y: m * 0.5 }, { x: dims.width / 2, y: dims.height - m * 0.5 },
      ].map((p) => ({ ...p, r: r * pocketMult }));
    }

    function layout() {
      dims = ArcadeEngine.fitCanvas(canvas, 1.9, 480);
      ctx = dims.ctx;
      if (!balls) { makeBalls(); makePockets(); }
    }

    function reset() {
      if (overlayEl) { overlayEl.remove(); overlayEl = null; }
      score = 0; shots = 0; running = true;
      scoreEl.textContent = "0"; shotsEl.textContent = "0";
      makeBalls();
      leftEl.textContent = "5";
      loop(performance.now());
    }

    function allStopped() {
      return balls.every((b) => !b.alive || (Math.abs(b.vx) < 0.02 && Math.abs(b.vy) < 0.02));
    }

    function step(dt) {
      const k = Math.pow(friction, dt / 16.67);
      balls.forEach((b) => {
        if (!b.alive) return;
        b.x += b.vx * (dt / 16.67);
        b.y += b.vy * (dt / 16.67);
        b.vx *= k; b.vy *= k;
        if (Math.abs(b.vx) < 0.02) b.vx = 0;
        if (Math.abs(b.vy) < 0.02) b.vy = 0;

        if (b.x - b.r < 0) { b.x = b.r; b.vx *= -0.85; }
        if (b.x + b.r > dims.width) { b.x = dims.width - b.r; b.vx *= -0.85; }
        if (b.y - b.r < 0) { b.y = b.r; b.vy *= -0.85; }
        if (b.y + b.r > dims.height) { b.y = dims.height - b.r; b.vy *= -0.85; }
      });

      // ball-ball elastic collisions (equal mass)
      for (let i = 0; i < balls.length; i++) {
        for (let j = i + 1; j < balls.length; j++) {
          const a = balls[i], b = balls[j];
          if (!a.alive || !b.alive) continue;
          const dx = b.x - a.x, dy = b.y - a.y;
          const dist = Math.hypot(dx, dy) || 0.001;
          const minDist = a.r + b.r;
          if (dist < minDist) {
            const nx = dx / dist, ny = dy / dist;
            const overlap = minDist - dist;
            a.x -= nx * overlap / 2; a.y -= ny * overlap / 2;
            b.x += nx * overlap / 2; b.y += ny * overlap / 2;
            const relVx = b.vx - a.vx, relVy = b.vy - a.vy;
            const sep = relVx * nx + relVy * ny;
            if (sep < 0) {
              a.vx += nx * sep; a.vy += ny * sep;
              b.vx -= nx * sep; b.vy -= ny * sep;
              ArcadeEngine.vibrate(6);
            }
          }
        }
      }

      // pocket checks
      balls.forEach((b) => {
        if (!b.alive) return;
        pockets.forEach((p) => {
          if (Math.hypot(b.x - p.x, b.y - p.y) < p.r) {
            b.alive = false;
            if (b.cue) {
              score = Math.max(0, score - 10);
              setTimeout(() => {
                b.alive = true; b.x = dims.width * 0.22; b.y = dims.height / 2; b.vx = 0; b.vy = 0;
              }, 500);
            } else {
              score += 15;
              ArcadeEngine.vibrate(16);
            }
            scoreEl.textContent = String(score);
          }
        });
      });

      const remaining = balls.filter((b) => !b.cue && b.alive).length;
      leftEl.textContent = String(remaining);
      if (remaining === 0) finish(true);
      else if (shots >= MAX_SHOTS && allStopped()) finish(false);
    }

    function draw() {
      ctx.fillStyle = "#0b4d2c";
      ctx.fillRect(0, 0, dims.width, dims.height);
      ctx.strokeStyle = "#6b3f1d";
      ctx.lineWidth = Math.max(8, dims.width * 0.025);
      ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, dims.width - ctx.lineWidth, dims.height - ctx.lineWidth);

      pockets.forEach((p) => {
        ctx.fillStyle = "#000";
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      });

      balls.forEach((b) => {
        if (!b.alive) return;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fillStyle = b.color;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "rgba(0,0,0,0.3)";
        ctx.stroke();
      });

      const cue = balls[0];
      if (aiming && cue.alive && aimCurrent) {
        const dx = cue.x - aimCurrent.x, dy = cue.y - aimCurrent.y;
        const dist = Math.min(Math.hypot(dx, dy), dims.width * 0.3);
        const ang = Math.atan2(dy, dx);
        ctx.strokeStyle = "rgba(255,255,255,0.8)";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(cue.x, cue.y);
        ctx.lineTo(cue.x + Math.cos(ang) * dist * 1.6, cue.y + Math.sin(ang) * dist * 1.6);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    function finish(won) {
      running = false;
      cancelAnimationFrame(rafId);
      if (won) ArcadeEngine.confetti(container);
      overlayEl = ArcadeEngine.overlay(container, {
        emoji: won ? "🎱" : "⏱️", title: won ? "Table cleared!" : "Out of shots",
        subtitle: `Score: ${score} · Shots: ${shots}`, buttonLabel: "Play Again", onRestart: reset, score,
      });
    }

    let lastT = null;
    function loop(t) {
      if (!running) return;
      const dt = lastT ? Math.min(40, t - lastT) : 16.67;
      lastT = t;
      step(dt);
      draw();
      rafId = requestAnimationFrame(loop);
    }

    function toCanvasPoint(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const scaleX = dims.width / rect.width, scaleY = dims.height / rect.height;
      return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
    }

    function onDown(clientX, clientY) {
      if (!allStopped()) return;
      const cue = balls[0];
      if (!cue.alive) return;
      const p = toCanvasPoint(clientX, clientY);
      if (Math.hypot(p.x - cue.x, p.y - cue.y) > r * 6) return;
      aiming = true;
      aimStart = p;
      aimCurrent = p;
    }
    function onMove(clientX, clientY) {
      if (!aiming) return;
      aimCurrent = toCanvasPoint(clientX, clientY);
    }
    function onUp() {
      if (!aiming) return;
      aiming = false;
      const cue = balls[0];
      const dx = cue.x - aimCurrent.x, dy = cue.y - aimCurrent.y;
      const dist = Math.min(Math.hypot(dx, dy), dims.width * 0.3);
      if (dist < r) { aimCurrent = null; return; }
      const ang = Math.atan2(dy, dx);
      const power = Math.min(MAX_POWER, (dist / (dims.width * 0.3)) * MAX_POWER);
      cue.vx = Math.cos(ang) * power;
      cue.vy = Math.sin(ang) * power;
      shots++;
      shotsEl.textContent = String(shots);
      aimCurrent = null;
      ArcadeEngine.vibrate(10);
    }

    const onMouseDown = (e) => onDown(e.clientX, e.clientY);
    const onMouseMove = (e) => onMove(e.clientX, e.clientY);
    const onMouseUp = () => onUp();
    const onTouchStart = (e) => { if (e.touches[0]) onDown(e.touches[0].clientX, e.touches[0].clientY); };
    const onTouchMove = (e) => { if (e.touches[0]) onMove(e.touches[0].clientX, e.touches[0].clientY); };
    const onTouchEnd = () => onUp();

    canvas.style.touchAction = "none";
    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("touchstart", onTouchStart, { passive: true });
    canvas.addEventListener("touchmove", onTouchMove, { passive: true });
    canvas.addEventListener("touchend", onTouchEnd);
    removeResize = ArcadeEngine.onResize(layout);

    container._cleanup = () => {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
      if (removeResize) removeResize();
    };

    layout();
    reset();
  }

  function stop(container) {
    if (container && container._cleanup) container._cleanup();
  }

  window.ArcadeGames = window.ArcadeGames || {};
  window.ArcadeGames["pool"] = { start, stop };
})();
