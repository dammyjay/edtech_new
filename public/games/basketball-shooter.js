// Arcade: Basketball Shooter — a drawn player character shoots real
// gravity-arc jump shots (drag back, release) or, on a quick tap instead
// of a drag, drives in and slams home a dunk.
(function () {
  const GRAVITY_BY_DIFFICULTY = { easy: 0.0135, medium: 0.016, hard: 0.019 };
  const RIM_MULT_BY_DIFFICULTY = { easy: 1.25, medium: 1, hard: 0.82 };
  const TIME_LIMIT = 45;
  const DUNK_PHASES = { approach: 260, jump: 200, slam: 60, fall: 160, settle: 140 };
  const DUNK_TOTAL = Object.values(DUNK_PHASES).reduce((a, b) => a + b, 0);

  function start(container) {
    container.classList.add("arcade-game");
    container.style.setProperty("--game-accent", "#ea580c");
    const gravity = GRAVITY_BY_DIFFICULTY[container.dataset.difficulty] || GRAVITY_BY_DIFFICULTY.medium;
    const rimMult = RIM_MULT_BY_DIFFICULTY[container.dataset.difficulty] || RIM_MULT_BY_DIFFICULTY.medium;

    container.innerHTML = `
      <p class="arcade-game-hint">Drag back and release for a jump shot. Just tap the ball to drive in for a dunk!</p>
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
    let flying = false, touchedRim = false, aiming = false, aimCurrent = null;
    let startX, startY, r, groundY;
    let popupText = null, popupT = 0;
    let dunking = false, dunkT0 = 0, dunkCancelled = false;
    let player = { x: 0, legPhase: 0 };
    let shake = 0;

    function layout() {
      dims = ArcadeEngine.fitCanvas(canvas, 0.72, 420);
      ctx = dims.ctx;
      r = dims.width * 0.05;
      startX = dims.width / 2;
      groundY = dims.height - dims.height * 0.06;
      startY = groundY - r * 1.5;
      hoop = {
        x: dims.width / 2,
        y: dims.height * 0.24,
        rimW: dims.width * 0.22 * rimMult,
        rimH: dims.height * 0.025,
      };
      player.x = startX;
      if (!ball) resetBall();
    }

    function resetBall() {
      ball = { x: startX, y: startY, vx: 0, vy: 0, heldByPlayer: true };
      flying = false;
      touchedRim = false;
      dunking = false;
      player.x = startX;
    }

    function reset() {
      if (overlayEl) { overlayEl.remove(); overlayEl = null; }
      score = 0; streak = 0; timeLeft = TIME_LIMIT; running = true;
      scoreEl.textContent = "0"; streakEl.textContent = "0"; timeEl.textContent = String(TIME_LIMIT);
      resetBall();
      loop(performance.now());
    }

    function awardShot(points, label, swish) {
      score += points;
      streak++;
      scoreEl.textContent = String(score);
      streakEl.textContent = String(streak);
      popupText = label;
      popupT = 60;
      ArcadeSound.play(swish ? "swish" : "score");
      if (swish) ArcadeEngine.confetti(container, 10);
      ArcadeEngine.vibrate(20);
    }

    function startDunk() {
      dunking = true;
      dunkCancelled = false;
      dunkT0 = performance.now();
      ball.heldByPlayer = true;
      ArcadeSound.play("swoosh");
    }

    function dunkPlayerX(t) {
      const a = DUNK_PHASES.approach;
      if (t >= a) return hoop.x - dims.width * 0.05;
      const p = t / a;
      return startX + (hoop.x - dims.width * 0.05 - startX) * (1 - Math.pow(1 - p, 2));
    }

    function stepDunk(now) {
      const t = now - dunkT0;
      const { approach, jump, slam, fall, settle } = DUNK_PHASES;
      player.x = dunkPlayerX(Math.min(t, approach));
      player.legPhase += 0.3;

      if (t < approach) {
        ball.x = player.x; ball.y = startY;
      } else if (t < approach + jump) {
        const p = (t - approach) / jump;
        const jumpHeight = dims.height * 0.17;
        ball.x = player.x + p * dims.width * 0.02;
        ball.y = startY - Math.sin(p * Math.PI / 2) * jumpHeight;
      } else if (t < approach + jump + slam) {
        if (!dunkCancelled) {
          awardShot(4, "SLAM DUNK! +4", true);
          ArcadeSound.play("dunk");
          shake = 10;
          dunkCancelled = true; // guard: only award once
        }
        ball.x = hoop.x; ball.y = hoop.y + dims.height * 0.01;
      } else if (t < approach + jump + slam + fall) {
        const p = (t - approach - jump - slam) / fall;
        ball.x = hoop.x - p * (hoop.x - startX) * 0.0 + player.x;
        ball.y = hoop.y + p * (startY - hoop.y) * 0.4;
        player.x = hoop.x - dims.width * 0.05 + p * (startX - (hoop.x - dims.width * 0.05));
      } else if (t < DUNK_TOTAL) {
        player.x = startX;
        ball.x = startX; ball.y = startY;
      } else {
        resetBall();
      }
    }

    function step(dt) {
      if (shake > 0) shake *= 0.85;
      if (dunking) {
        stepDunk(performance.now());
        if (popupT > 0) popupT--;
        return;
      }
      const steps = dt / 16.67;
      if (flying) {
        ball.x += ball.vx * steps;
        ball.y += ball.vy * steps;
        ball.vy += gravity * dims.height * 0.05 * steps;

        if (ball.x < r || ball.x > dims.width - r) ball.vx *= -0.6;

        const rimY = hoop.y;
        const leftPost = hoop.x - hoop.rimW / 2, rightPost = hoop.x + hoop.rimW / 2;
        if (Math.abs(ball.y - rimY) < r && ball.vy > 0) {
          if (Math.abs(ball.x - leftPost) < r || Math.abs(ball.x - rightPost) < r) {
            ball.vy *= -0.5; ball.vx *= 0.7;
            touchedRim = true;
            ArcadeSound.play("bounce");
            ArcadeEngine.vibrate(8);
          } else if (ball.x > leftPost && ball.x < rightPost) {
            awardShot(touchedRim ? 2 : 3, touchedRim ? "+2" : "+3 Swish!", !touchedRim);
            setTimeout(resetBall, 400);
            flying = false;
            return;
          }
        }

        const boardX = hoop.x + hoop.rimW / 2 + 4;
        if (ball.x > boardX - r && ball.x < boardX && ball.y < hoop.y && ball.y > hoop.y - dims.height * 0.12 && ball.vx > 0) {
          ball.vx *= -0.6;
          touchedRim = true;
          ArcadeSound.play("bounce");
        }

        if (ball.y - r > dims.height || ball.x < -r * 2 || ball.x > dims.width + r * 2) {
          streak = 0;
          streakEl.textContent = "0";
          popupText = "Miss";
          popupT = 45;
          ArcadeSound.play("miss");
          resetBall();
        }
      }
      if (popupT > 0) popupT--;
    }

    function drawPlayer() {
      const legSwing = dunking ? Math.sin(player.legPhase) * 8 : 0;
      const px = player.x, py = groundY;
      ctx.strokeStyle = "#1e293b";
      ctx.lineWidth = Math.max(3, dims.width * 0.012);
      ctx.lineCap = "round";
      // legs
      ctx.beginPath();
      ctx.moveTo(px - 6, py - 2); ctx.lineTo(px - 6 + legSwing * 0.3, py - r * 1.1);
      ctx.moveTo(px + 6, py - 2); ctx.lineTo(px + 6 - legSwing * 0.3, py - r * 1.1);
      ctx.stroke();
      // body
      ctx.beginPath();
      ctx.moveTo(px, py - r * 1.1); ctx.lineTo(px, py - r * 2.4);
      ctx.stroke();
      // arms — raised when dunking/aiming, relaxed otherwise
      const armUp = dunking || aiming;
      ctx.beginPath();
      if (armUp) {
        ctx.moveTo(px, py - r * 2.1); ctx.lineTo(px - r * 1.1, py - r * 3.1);
        ctx.moveTo(px, py - r * 2.1); ctx.lineTo(px + r * 1.1, py - r * 3.1);
      } else {
        ctx.moveTo(px, py - r * 2.1); ctx.lineTo(px - r * 0.9, py - r * 1.3);
        ctx.moveTo(px, py - r * 2.1); ctx.lineTo(px + r * 0.9, py - r * 1.3);
      }
      ctx.stroke();
      // head
      ctx.beginPath();
      ctx.arc(px, py - r * 2.8, r * 0.55, 0, Math.PI * 2);
      ctx.fillStyle = "#fb923c";
      ctx.fill();
    }

    function draw() {
      ctx.save();
      if (shake > 0.3) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

      const g = ctx.createLinearGradient(0, 0, 0, dims.height);
      g.addColorStop(0, "#1e293b");
      g.addColorStop(1, "#0f172a");
      ctx.fillStyle = g;
      ctx.fillRect(-20, -20, dims.width + 40, dims.height + 40);

      ctx.fillStyle = "#334155";
      ctx.fillRect(0, groundY, dims.width, dims.height - groundY);

      ctx.fillStyle = "#e2e8f0";
      ctx.fillRect(hoop.x + hoop.rimW / 2, hoop.y - dims.height * 0.14, dims.width * 0.025, dims.height * 0.16);

      ctx.strokeStyle = "#f97316";
      ctx.lineWidth = Math.max(3, dims.width * 0.012);
      ctx.beginPath();
      ctx.moveTo(hoop.x - hoop.rimW / 2, hoop.y);
      ctx.lineTo(hoop.x + hoop.rimW / 2, hoop.y);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 1;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(hoop.x + i * (hoop.rimW / 5), hoop.y);
        ctx.lineTo(hoop.x + i * (hoop.rimW / 9), hoop.y + dims.height * 0.07);
        ctx.stroke();
      }

      drawPlayer();

      if (aiming && aimCurrent && !dunking) {
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
      ctx.restore();
    }

    function finish() {
      running = false;
      cancelAnimationFrame(rafId);
      if (score > 0) { ArcadeEngine.confetti(container); ArcadeSound.play("win"); }
      else ArcadeSound.play("lose");
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
      if (flying || dunking) return;
      const p = toCanvasPoint(clientX, clientY);
      if (Math.hypot(p.x - ball.x, p.y - ball.y) > r * 5) return;
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
      const dist = Math.hypot(dx, dy);
      if (dist < r * 1.8) {
        // a tap rather than a drag — drive in for a dunk instead of a shot
        startDunk();
        return;
      }
      const power = Math.min(dims.width * 0.045, dist * 0.09);
      const ang = Math.atan2(dy, dx);
      ball.vx = Math.cos(ang) * power;
      ball.vy = Math.sin(ang) * power;
      ball.heldByPlayer = false;
      flying = true;
      touchedRim = false;
      ArcadeSound.play("swoosh");
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
