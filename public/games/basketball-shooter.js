// Arcade: Basketball Shooter — drag-back slingshot launch, real gravity
// arc, rim/backboard collision, swish detection.
(function () {
  const GRAVITY_BY_DIFFICULTY = { easy: 0.0135, medium: 0.016, hard: 0.019 };
  const RIM_MULT_BY_DIFFICULTY = { easy: 1.25, medium: 1, hard: 0.82 };
  const TIME_LIMIT = 45;

  function start(container) {
    container.classList.add("arcade-game");
    container.style.setProperty("--game-accent", "#ea580c");
    const gravity = GRAVITY_BY_DIFFICULTY[container.dataset.difficulty] || GRAVITY_BY_DIFFICULTY.medium;
    const rimMult = RIM_MULT_BY_DIFFICULTY[container.dataset.difficulty] || RIM_MULT_BY_DIFFICULTY.medium;

    container.innerHTML = `
      <p class="arcade-game-hint">Drag back from the ball and release to shoot. Swish it for bonus points!</p>
      <div class="arcade-scoreboard">
        <div class="arcade-score-pill"><span class="label">Score</span><span class="value" id="bsScore">0</span></div>
        <div class="arcade-score-pill"><span class="label">Time</span><span class="value" id="bsTime">${TIME_LIMIT}</span></div>
        <div class="arcade-score-pill"><span class="label">Streak</span><span class="value" id="bsStreak">0</span></div>
      </div>
      <div class="arcade-canvas-wrap"><canvas id="bsCanvas"></canvas></div>
    `;

    const canvas = container.querySelector("#bsCanvas");
    const scoreEl = container.querySelector("#bsScore");
    const timeEl = container.querySelector("#bsTime");
    const streakEl = container.querySelector("#bsStreak");

    let dims, ctx, hoop, ball, score, streak, timeLeft, running, rafId, overlayEl, removeResize;
    let flying = false, touchedRim = false, aiming = false, aimStart = null, aimCurrent = null;
    let startX, startY, r;
    let popupText = null, popupT = 0;

    function layout() {
      dims = ArcadeEngine.fitCanvas(canvas, 0.72, 420);
      ctx = dims.ctx;
      r = dims.width * 0.05;
      startX = dims.width / 2;
      startY = dims.height - r * 1.6;
      hoop = {
        x: dims.width / 2,
        y: dims.height * 0.24,
        rimW: dims.width * 0.22 * rimMult,
        rimH: dims.height * 0.025,
      };
      if (!ball) resetBall();
    }

    function resetBall() {
      ball = { x: startX, y: startY, vx: 0, vy: 0 };
      flying = false;
      touchedRim = false;
    }

    function reset() {
      if (overlayEl) { overlayEl.remove(); overlayEl = null; }
      score = 0; streak = 0; timeLeft = TIME_LIMIT; running = true;
      scoreEl.textContent = "0"; streakEl.textContent = "0"; timeEl.textContent = String(TIME_LIMIT);
      resetBall();
      loop(performance.now());
    }

    function step(dt) {
      const steps = dt / 16.67;
      if (flying) {
        ball.x += ball.vx * steps;
        ball.y += ball.vy * steps;
        ball.vy += gravity * dims.height * 0.05 * steps;

        if (ball.x < r || ball.x > dims.width - r) ball.vx *= -0.6;

        // rim collision (simple: treat rim as two posts at the hoop ends)
        const rimY = hoop.y;
        const leftPost = hoop.x - hoop.rimW / 2, rightPost = hoop.x + hoop.rimW / 2;
        if (Math.abs(ball.y - rimY) < r && ball.vy > 0) {
          if (Math.abs(ball.x - leftPost) < r || Math.abs(ball.x - rightPost) < r) {
            ball.vy *= -0.5; ball.vx *= 0.7;
            touchedRim = true;
            ArcadeEngine.vibrate(8);
          } else if (ball.x > leftPost && ball.x < rightPost) {
            // passed cleanly through the hoop plane while descending
            score += touchedRim ? 2 : 3;
            streak++;
            scoreEl.textContent = String(score);
            streakEl.textContent = String(streak);
            popupText = touchedRim ? "+2" : "+3 Swish!";
            popupT = 60;
            if (!touchedRim) ArcadeEngine.confetti(container, 10);
            ArcadeEngine.vibrate(20);
            setTimeout(resetBall, 400);
            flying = false;
            return;
          }
        }

        // backboard
        const boardX = hoop.x + hoop.rimW / 2 + 4;
        if (ball.x > boardX - r && ball.x < boardX && ball.y < hoop.y && ball.y > hoop.y - dims.height * 0.12 && ball.vx > 0) {
          ball.vx *= -0.6;
          touchedRim = true;
        }

        if (ball.y - r > dims.height || ball.x < -r * 2 || ball.x > dims.width + r * 2) {
          streak = 0;
          streakEl.textContent = "0";
          popupText = "Miss";
          popupT = 45;
          resetBall();
        }
      }
      if (popupT > 0) popupT--;
    }

    function draw() {
      const g = ctx.createLinearGradient(0, 0, 0, dims.height);
      g.addColorStop(0, "#1e293b");
      g.addColorStop(1, "#0f172a");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, dims.width, dims.height);

      // backboard
      ctx.fillStyle = "#e2e8f0";
      ctx.fillRect(hoop.x + hoop.rimW / 2, hoop.y - dims.height * 0.14, dims.width * 0.025, dims.height * 0.16);

      // rim
      ctx.strokeStyle = "#f97316";
      ctx.lineWidth = Math.max(3, dims.width * 0.012);
      ctx.beginPath();
      ctx.moveTo(hoop.x - hoop.rimW / 2, hoop.y);
      ctx.lineTo(hoop.x + hoop.rimW / 2, hoop.y);
      ctx.stroke();
      // net hint
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 1;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(hoop.x + i * (hoop.rimW / 5), hoop.y);
        ctx.lineTo(hoop.x + i * (hoop.rimW / 9), hoop.y + dims.height * 0.07);
        ctx.stroke();
      }

      // aim line
      if (aiming && aimCurrent) {
        const dx = ball.x - aimCurrent.x, dy = ball.y - aimCurrent.y;
        ctx.strokeStyle = "rgba(255,255,255,0.8)";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(ball.x, ball.y);
        ctx.lineTo(ball.x + dx * 1.3, ball.y + dy * 1.3);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // ball
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, r, 0, Math.PI * 2);
      ctx.fillStyle = "#f97316";
      ctx.fill();
      ctx.strokeStyle = "#7c2d12";
      ctx.lineWidth = 2;
      ctx.stroke();

      if (popupText && popupT > 0) {
        ctx.fillStyle = "rgba(255,255,255," + Math.min(1, popupT / 30) + ")";
        ctx.font = `bold ${Math.round(dims.width * 0.07)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(popupText, dims.width / 2, dims.height * 0.5);
      }
    }

    function finish() {
      running = false;
      cancelAnimationFrame(rafId);
      if (score > 0) ArcadeEngine.confetti(container);
      overlayEl = ArcadeEngine.overlay(container, {
        emoji: "🏀", title: "Time's up!",
        subtitle: `Final score: ${score}`, buttonLabel: "Play Again", onRestart: reset, score,
      });
    }

    let lastT = null, lastSecond = null;
    function loop(t) {
      if (!running) return;
      const dt = lastT ? Math.min(40, t - lastT) : 16.67;
      lastT = t;
      if (lastSecond === null) lastSecond = t;
      if (t - lastSecond >= 1000) {
        lastSecond = t;
        timeLeft--;
        timeEl.textContent = String(Math.max(0, timeLeft));
        if (timeLeft <= 0) { finish(); return; }
      }
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
      if (flying) return;
      const p = toCanvasPoint(clientX, clientY);
      if (Math.hypot(p.x - ball.x, p.y - ball.y) > r * 5) return;
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
      const dx = ball.x - aimCurrent.x, dy = ball.y - aimCurrent.y;
      const dist = Math.hypot(dx, dy);
      if (dist < r) return;
      const power = Math.min(dims.width * 0.045, dist * 0.09);
      const ang = Math.atan2(dy, dx);
      ball.vx = Math.cos(ang) * power;
      ball.vy = Math.sin(ang) * power;
      flying = true;
      touchedRim = false;
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
  window.ArcadeGames["basketball-shooter"] = { start, stop };
})();
