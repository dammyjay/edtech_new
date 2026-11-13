// Arcade: Mini Golf — 4 holes, real putt physics (friction + wall bounce).
// Drag back from the ball and release to putt, like a slingshot.
(function () {
  const FRICTION_BY_DIFFICULTY = { easy: 0.965, medium: 0.975, hard: 0.982 };
  const MAX_STROKES_PER_HOLE = 8;

  // Coordinates are fractions of the course width/height (0..1), scaled to
  // pixels in layout(). Walls are axis-aligned obstacle rectangles; the
  // canvas edges themselves act as the outer boundary.
  const HOLES = [
    { par: 2, ball: { x: 0.12, y: 0.5 }, cup: { x: 0.88, y: 0.5 }, walls: [] },
    { par: 3, ball: { x: 0.1, y: 0.15 }, cup: { x: 0.88, y: 0.85 }, walls: [{ x: 0.42, y: 0.0, w: 0.08, h: 0.65 }] },
    { par: 3, ball: { x: 0.1, y: 0.5 }, cup: { x: 0.88, y: 0.5 }, walls: [{ x: 0.35, y: 0.0, w: 0.08, h: 0.6 }, { x: 0.6, y: 0.4, w: 0.08, h: 0.6 }] },
    { par: 4, ball: { x: 0.1, y: 0.85 }, cup: { x: 0.5, y: 0.1 }, walls: [{ x: 0.3, y: 0.3, w: 0.4, h: 0.08 }, { x: 0.3, y: 0.55, w: 0.08, h: 0.45 }] },
  ];

  function start(container) {
    container.classList.add("arcade-game");
    container.style.setProperty("--game-accent", "#16a34a");
    const friction = FRICTION_BY_DIFFICULTY[container.dataset.difficulty] || FRICTION_BY_DIFFICULTY.medium;

    container.innerHTML = `
      <p class="arcade-game-hint">Drag back from the ball and release to putt. Fewer strokes = more points.</p>
      <div class="arcade-scoreboard">
        <div class="arcade-score-pill"><span class="label">Hole</span><span class="value" id="mgHole">1/4</span></div>
        <div class="arcade-score-pill"><span class="label">Strokes</span><span class="value" id="mgStrokes">0</span></div>
        <div class="arcade-score-pill"><span class="label">Score</span><span class="value" id="mgScore">0</span></div>
      </div>
      <div class="arcade-canvas-wrap"><canvas id="mgCanvas"></canvas></div>
    `;

    const canvas = container.querySelector("#mgCanvas");
    const holeEl = container.querySelector("#mgHole");
    const strokesEl = container.querySelector("#mgStrokes");
    const scoreEl = container.querySelector("#mgScore");

    let dims, ctx, ball, walls, cup, r, cupR, strokes, holeIndex, totalScore, running, rafId, overlayEl, removeResize;
    let aiming = false, aimCurrent = null, completingHole = false;

    function loadHole() {
      const h = HOLES[holeIndex];
      r = dims.width * 0.016;
      cupR = r * 1.6;
      ball = { x: h.ball.x * dims.width, y: h.ball.y * dims.height, vx: 0, vy: 0 };
      cup = { x: h.cup.x * dims.width, y: h.cup.y * dims.height };
      walls = h.walls.map((w) => ({
        x: w.x * dims.width, y: w.y * dims.height, w: w.w * dims.width, h: w.h * dims.height,
      }));
      strokes = 0;
      completingHole = false;
      strokesEl.textContent = "0";
      holeEl.textContent = `${holeIndex + 1}/${HOLES.length}`;
    }

    function layout() {
      dims = ArcadeEngine.fitCanvas(canvas, 1.35, 440);
      ctx = dims.ctx;
      if (!ball) loadHole();
    }

    function reset() {
      if (overlayEl) { overlayEl.remove(); overlayEl = null; }
      holeIndex = 0; totalScore = 0; running = true;
      scoreEl.textContent = "0";
      loadHole();
      loop(performance.now());
    }

    function isMoving() {
      return Math.abs(ball.vx) > 0.02 || Math.abs(ball.vy) > 0.02;
    }

    function resolveWallCollision(w) {
      const closestX = Math.max(w.x, Math.min(ball.x, w.x + w.w));
      const closestY = Math.max(w.y, Math.min(ball.y, w.y + w.h));
      const dx = ball.x - closestX, dy = ball.y - closestY;
      const dist = Math.hypot(dx, dy);
      if (dist < r && dist > 0) {
        const overlap = r - dist;
        const nx = dx / dist, ny = dy / dist;
        ball.x += nx * overlap;
        ball.y += ny * overlap;
        if (Math.abs(nx) > Math.abs(ny)) ball.vx *= -0.7; else ball.vy *= -0.7;
      } else if (dist === 0) {
        ball.vx *= -0.7; ball.vy *= -0.7;
      }
    }

    function step(dt) {
      if (!isMoving()) {
        if (strokes >= MAX_STROKES_PER_HOLE && !aiming && !completingHole) holeComplete();
        return;
      }
      const steps = dt / 16.67;
      ball.x += ball.vx * steps;
      ball.y += ball.vy * steps;
      const k = Math.pow(friction, steps);
      ball.vx *= k; ball.vy *= k;
      if (Math.abs(ball.vx) < 0.02) ball.vx = 0;
      if (Math.abs(ball.vy) < 0.02) ball.vy = 0;

      if (ball.x - r < 0) { ball.x = r; ball.vx *= -0.8; }
      if (ball.x + r > dims.width) { ball.x = dims.width - r; ball.vx *= -0.8; }
      if (ball.y - r < 0) { ball.y = r; ball.vy *= -0.8; }
      if (ball.y + r > dims.height) { ball.y = dims.height - r; ball.vy *= -0.8; }

      walls.forEach(resolveWallCollision);

      const distToCup = Math.hypot(ball.x - cup.x, ball.y - cup.y);
      const speed = Math.hypot(ball.vx, ball.vy);
      if (distToCup < cupR && speed < 2.2 && !completingHole) {
        holeComplete();
      }
    }

    function pointsForHole(par, strokesTaken) {
      if (strokesTaken <= par) return 100;
      return Math.max(20, 100 - (strokesTaken - par) * 25);
    }

    function holeComplete() {
      completingHole = true;
      const h = HOLES[holeIndex];
      const pts = pointsForHole(h.par, strokes || 1);
      totalScore += pts;
      scoreEl.textContent = String(totalScore);
      ArcadeEngine.confetti(container, 14);
      ArcadeEngine.vibrate(16);
      holeIndex++;
      if (holeIndex >= HOLES.length) {
        finish();
      } else {
        setTimeout(() => { loadHole(); }, 500);
      }
    }

    function draw() {
      ctx.fillStyle = "#1a4d2e";
      ctx.fillRect(0, 0, dims.width, dims.height);
      ctx.strokeStyle = "#0d2818";
      ctx.lineWidth = Math.max(6, dims.width * 0.02);
      ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, dims.width - ctx.lineWidth, dims.height - ctx.lineWidth);

      walls.forEach((w) => {
        ctx.fillStyle = "#166534";
        ctx.fillRect(w.x, w.y, w.w, w.h);
        ctx.strokeStyle = "#0d2818";
        ctx.lineWidth = 2;
        ctx.strokeRect(w.x, w.y, w.w, w.h);
      });

      ctx.fillStyle = "#000";
      ctx.beginPath(); ctx.arc(cup.x, cup.y, cupR, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = Math.max(2, dims.width * 0.004);
      ctx.beginPath(); ctx.moveTo(cup.x, cup.y); ctx.lineTo(cup.x, cup.y - cupR * 3); ctx.stroke();
      ctx.fillStyle = "#dc2626";
      ctx.beginPath(); ctx.moveTo(cup.x, cup.y - cupR * 3); ctx.lineTo(cup.x + cupR * 1.6, cup.y - cupR * 2.5); ctx.lineTo(cup.x, cup.y - cupR * 2); ctx.fill();

      if (aiming && aimCurrent) {
        const dx = ball.x - aimCurrent.x, dy = ball.y - aimCurrent.y;
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(ball.x, ball.y);
        ctx.lineTo(ball.x + dx * 1.6, ball.y + dy * 1.6);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.beginPath();
      ctx.arc(ball.x, ball.y, r, 0, Math.PI * 2);
      ctx.fillStyle = "#f8fafc";
      ctx.fill();
      ctx.strokeStyle = "#94a3b8";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    function finish() {
      running = false;
      cancelAnimationFrame(rafId);
      ArcadeEngine.confetti(container);
      overlayEl = ArcadeEngine.overlay(container, {
        emoji: "⛳", title: "Course complete!",
        subtitle: `Final score: ${totalScore}`, buttonLabel: "Play Again", onRestart: reset, score: totalScore,
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
      if (isMoving() || completingHole) return;
      const p = toCanvasPoint(clientX, clientY);
      if (Math.hypot(p.x - ball.x, p.y - ball.y) > r * 6) return;
      aiming = true;
      aimCurrent = p;
    }
    function onMove(clientX, clientY) {
      if (!aiming) return;
      aimCurrent = toCanvasPoint(clientX, clientY);
    }
    function onUp() {
      if (!aiming) return;
      aiming = false;
      const dx = ball.x - aimCurrent.x, dy = ball.y - aimCurrent.y;
      const dist = Math.min(Math.hypot(dx, dy), dims.width * 0.35);
      if (dist < r) { aimCurrent = null; return; }
      const ang = Math.atan2(dy, dx);
      const power = (dist / (dims.width * 0.35)) * (dims.width * 0.028);
      ball.vx = Math.cos(ang) * power;
      ball.vy = Math.sin(ang) * power;
      strokes++;
      strokesEl.textContent = String(strokes);
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
  window.ArcadeGames["mini-golf"] = { start, stop };
})();
