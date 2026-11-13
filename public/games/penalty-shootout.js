// Arcade: Penalty Shootout — drag from the ball to a spot in the goal and
// release to shoot. A keeper AI reads your aim (odds scale with difficulty)
// and dives to save it.
(function () {
  const KEEPER_READ_BY_DIFFICULTY = { easy: 0.35, medium: 0.55, hard: 0.72 };
  const KEEPER_REACH_BY_DIFFICULTY = { easy: 0.24, medium: 0.3, hard: 0.36 };
  const TOTAL_KICKS = 5;
  const FLIGHT_MS = 550;

  function start(container) {
    container.classList.add("arcade-game");
    container.style.setProperty("--game-accent", "#15803d");
    const readChance = KEEPER_READ_BY_DIFFICULTY[container.dataset.difficulty] || KEEPER_READ_BY_DIFFICULTY.medium;
    const reachFrac = KEEPER_REACH_BY_DIFFICULTY[container.dataset.difficulty] || KEEPER_REACH_BY_DIFFICULTY.medium;

    container.innerHTML = `
      <p class="arcade-game-hint">Drag from the ball to a spot in the goal, then release to shoot. 5 kicks — beat the keeper.</p>
      <div class="arcade-scoreboard">
        <div class="arcade-score-pill"><span class="label">Goals</span><span class="value" id="psGoals">0</span></div>
        <div class="arcade-score-pill"><span class="label">Kick</span><span class="value" id="psKick">1/${TOTAL_KICKS}</span></div>
        <div class="arcade-score-pill"><span class="label">Score</span><span class="value" id="psScore">0</span></div>
      </div>
      <div class="arcade-canvas-wrap"><canvas id="psCanvas"></canvas></div>
    `;

    const canvas = container.querySelector("#psCanvas");
    const goalsEl = container.querySelector("#psGoals");
    const kickEl = container.querySelector("#psKick");
    const scoreEl = container.querySelector("#psScore");

    let dims, ctx, goal, ballStart, ball, keeper, score, goals, kickIndex, running, rafId, overlayEl, removeResize;
    let aiming = false, aimCurrent = null, flying = false, flightStart = 0, flightFrom = null, flightTo = null, resultText = null, resultT = 0, keeperDiveX = null;

    function layout() {
      dims = ArcadeEngine.fitCanvas(canvas, 0.82, 420);
      ctx = dims.ctx;
      goal = { x: dims.width * 0.18, y: dims.height * 0.1, w: dims.width * 0.64, h: dims.height * 0.32 };
      ballStart = { x: dims.width / 2, y: dims.height * 0.82 };
      if (!ball) resetBall();
    }

    function resetBall() {
      ball = { x: ballStart.x, y: ballStart.y };
      keeper = { x: goal.x + goal.w / 2 };
      flying = false;
      keeperDiveX = null;
    }

    function reset() {
      if (overlayEl) { overlayEl.remove(); overlayEl = null; }
      score = 0; goals = 0; kickIndex = 0; running = true;
      goalsEl.textContent = "0"; scoreEl.textContent = "0"; kickEl.textContent = `1/${TOTAL_KICKS}`;
      resetBall();
      loop(performance.now());
    }

    function takeShot(target) {
      flying = true;
      flightStart = performance.now();
      flightFrom = { x: ball.x, y: ball.y };
      flightTo = target;

      const willRead = Math.random() < readChance;
      const reach = goal.w * reachFrac;
      if (willRead) {
        keeperDiveX = Math.max(goal.x + reach * 0.3, Math.min(goal.x + goal.w - reach * 0.3, target.x));
      } else {
        const dir = Math.random() < 0.5 ? -1 : 1;
        keeperDiveX = Math.max(goal.x + reach * 0.3, Math.min(goal.x + goal.w - reach * 0.3, keeper.x + dir * reach * 1.4));
      }

      setTimeout(() => {
        if (!running) return;
        const saved = Math.abs(target.x - keeperDiveX) < reach && target.y < goal.y + goal.h * 0.85;
        const corner = target.x < goal.x + goal.w * 0.18 || target.x > goal.x + goal.w * 0.82 || target.y < goal.y + goal.h * 0.22;
        kickIndex++;
        if (saved) {
          resultText = "Saved!";
        } else {
          goals++;
          score += corner ? 25 : 20;
          resultText = corner ? "Top corner! ⚽" : "GOAL! ⚽";
          ArcadeEngine.confetti(container, 14);
        }
        goalsEl.textContent = String(goals);
        scoreEl.textContent = String(score);
        resultT = 70;
        ArcadeEngine.vibrate(saved ? 10 : 20);

        if (kickIndex >= TOTAL_KICKS) {
          setTimeout(() => finish(), 900);
        } else {
          kickEl.textContent = `${kickIndex + 1}/${TOTAL_KICKS}`;
          setTimeout(resetBall, 900);
        }
      }, FLIGHT_MS);
    }

    function step() {
      if (resultT > 0) resultT--;
    }

    function ballFlightPos() {
      const t = Math.min(1, (performance.now() - flightStart) / FLIGHT_MS);
      const ease = 1 - Math.pow(1 - t, 2);
      return { x: flightFrom.x + (flightTo.x - flightFrom.x) * ease, y: flightFrom.y + (flightTo.y - flightFrom.y) * ease, t };
    }

    function draw() {
      const g = ctx.createLinearGradient(0, 0, 0, dims.height);
      g.addColorStop(0, "#15803d");
      g.addColorStop(1, "#166534");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, dims.width, dims.height);

      ctx.strokeStyle = "#fff";
      ctx.lineWidth = Math.max(3, dims.width * 0.012);
      ctx.strokeRect(goal.x, goal.y, goal.w, goal.h);
      ctx.strokeStyle = "rgba(255,255,255,0.3)";
      ctx.lineWidth = 1;
      for (let i = 1; i < 6; i++) {
        ctx.beginPath(); ctx.moveTo(goal.x + (goal.w / 6) * i, goal.y); ctx.lineTo(goal.x + (goal.w / 6) * i, goal.y + goal.h); ctx.stroke();
      }

      const keeperX = flying ? (keeperDiveX ?? keeper.x) : keeper.x;
      const kw = dims.width * 0.07, kh = dims.height * 0.1;
      ctx.fillStyle = "#facc15";
      ctx.fillRect(keeperX - kw / 2, goal.y + goal.h - kh * 0.8, kw, kh);

      if (aiming && aimCurrent) {
        ctx.strokeStyle = "rgba(255,255,255,0.8)";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(ball.x, ball.y);
        ctx.lineTo(aimCurrent.x, aimCurrent.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(aimCurrent.x, aimCurrent.y, dims.width * 0.012, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.8)";
        ctx.fill();
      }

      let bx = ball.x, by = ball.y, scale = 1;
      if (flying) {
        const p = ballFlightPos();
        bx = p.x; by = p.y; scale = 1 - p.t * 0.4;
      }
      ctx.beginPath();
      ctx.arc(bx, by, dims.width * 0.025 * scale, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.strokeStyle = "#111";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      if (resultText && resultT > 0) {
        ctx.fillStyle = "rgba(255,255,255," + Math.min(1, resultT / 30) + ")";
        ctx.font = `bold ${Math.round(dims.width * 0.06)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(resultText, dims.width / 2, dims.height * 0.55);
      }
    }

    function finish() {
      running = false;
      cancelAnimationFrame(rafId);
      if (goals === TOTAL_KICKS) { score += 50; ArcadeEngine.confetti(container); }
      overlayEl = ArcadeEngine.overlay(container, {
        emoji: "⚽", title: goals === TOTAL_KICKS ? "Perfect shootout!" : "Shootout over",
        subtitle: `${goals}/${TOTAL_KICKS} goals`, buttonLabel: "Play Again", onRestart: reset, score,
      });
    }

    function loop() {
      if (!running) return;
      step();
      draw();
      rafId = requestAnimationFrame(loop);
    }

    function toCanvasPoint(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const scaleX = dims.width / rect.width, scaleY = dims.height / rect.height;
      return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
    }

    function clampToGoal(p) {
      return {
        x: Math.max(goal.x + 4, Math.min(goal.x + goal.w - 4, p.x)),
        y: Math.max(goal.y + 4, Math.min(goal.y + goal.h - 4, p.y)),
      };
    }

    function onDown(clientX, clientY) {
      if (flying) return;
      const p = toCanvasPoint(clientX, clientY);
      if (Math.hypot(p.x - ball.x, p.y - ball.y) > dims.width * 0.12) return;
      aiming = true;
      aimCurrent = clampToGoal(p);
    }
    function onMove(clientX, clientY) {
      if (!aiming) return;
      aimCurrent = clampToGoal(toCanvasPoint(clientX, clientY));
    }
    function onUp() {
      if (!aiming) return;
      aiming = false;
      const target = aimCurrent;
      aimCurrent = null;
      ArcadeEngine.vibrate(10);
      takeShot(target);
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
    loop();
  }

  function stop(container) {
    if (container && container._cleanup) container._cleanup();
  }

  window.ArcadeGames = window.ArcadeGames || {};
  window.ArcadeGames["penalty-shootout"] = { start, stop };
})();
