// Arcade: Car Racing — top-down ring track, drift physics, race an AI car
// across 2 laps. Off-track driving (onto the "grass") slows you down hard.
(function () {
  const ACCEL = 0.1, BRAKE = 0.17, DRAG = 0.986, STEER_RATE = 0.0032;
  const MAX_FWD = 3.1, MAX_REV = -1.6;
  const GRIP_BY_DIFFICULTY = { easy: 0.15, medium: 0.11, hard: 0.085 };
  const AI_SPEED_BY_DIFFICULTY = { easy: 0.027, medium: 0.034, hard: 0.041 };
  const REQUIRED_LAPS = 2;
  const TIME_LIMIT = 120;

  function angleDelta(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  function start(container) {
    container.classList.add("arcade-game");
    container.style.setProperty("--game-accent", "#dc2626");
    const grip = GRIP_BY_DIFFICULTY[container.dataset.difficulty] || GRIP_BY_DIFFICULTY.medium;
    const aiSpeed = AI_SPEED_BY_DIFFICULTY[container.dataset.difficulty] || AI_SPEED_BY_DIFFICULTY.medium;

    container.innerHTML = `
      <p class="arcade-game-hint">Race 2 laps against the rival car. Stay on the track — the grass slows you down.</p>
      <div class="arcade-scoreboard">
        <div class="arcade-score-pill"><span class="label">Lap</span><span class="value" id="crLap">1/${REQUIRED_LAPS}</span></div>
        <div class="arcade-score-pill"><span class="label">Time</span><span class="value" id="crTime">0</span></div>
        <div class="arcade-score-pill"><span class="label">Rival</span><span class="value" id="crRival">1/${REQUIRED_LAPS}</span></div>
      </div>
      <div class="arcade-canvas-wrap"><canvas id="crCanvas"></canvas></div>
      <div class="cr-controls">
        <div class="cr-pad">
          <button type="button" class="arcade-dpad-btn" data-k="left">◀</button>
          <button type="button" class="arcade-dpad-btn" data-k="right">▶</button>
        </div>
        <div class="cr-pad">
          <button type="button" class="arcade-dpad-btn" data-k="brake">▼</button>
          <button type="button" class="arcade-dpad-btn" data-k="gas">▲</button>
        </div>
      </div>
      <style>
        .cr-controls { display:flex; justify-content:space-between; max-width:440px; margin:16px auto 0; padding:0 10px; }
        .cr-pad { display:flex; gap:10px; }
        .cr-controls .arcade-dpad-btn { width:56px; height:56px; font-size:20px; }
      </style>
    `;

    const canvas = container.querySelector("#crCanvas");
    const lapEl = container.querySelector("#crLap");
    const timeEl = container.querySelector("#crTime");
    const rivalEl = container.querySelector("#crRival");

    let dims, ctx, cx, cy, outerR, innerR, midR;
    let car, ai, running, rafId, overlayEl, removeResize;
    let elapsed, prevAngle, totalAngle, aiTotalAngle;
    const keys = { left: false, right: false, gas: false, brake: false };

    function layout() {
      dims = ArcadeEngine.fitCanvas(canvas, 1, 440);
      ctx = dims.ctx;
      cx = dims.width / 2; cy = dims.height / 2;
      outerR = dims.width * 0.46; innerR = dims.width * 0.24; midR = (outerR + innerR) / 2;
      if (!car) initEntities();
    }

    function initEntities() {
      const startAngle = Math.PI;
      const tangent = startAngle - Math.PI / 2;
      car = { x: cx + Math.cos(startAngle) * midR, y: cy + Math.sin(startAngle) * midR, heading: tangent, speed: 0, _vx: 0, _vy: 0 };
      ai = { angle: startAngle + 0.35 };
      prevAngle = startAngle;
      totalAngle = 0; aiTotalAngle = 0;
    }

    function reset() {
      if (overlayEl) { overlayEl.remove(); overlayEl = null; }
      running = true; elapsed = 0;
      lapEl.textContent = `1/${REQUIRED_LAPS}`;
      rivalEl.textContent = `1/${REQUIRED_LAPS}`;
      timeEl.textContent = "0";
      initEntities();
      loop(performance.now());
    }

    const CAR_LEN = () => dims.width * 0.06;
    const CAR_W = () => dims.width * 0.03;

    function step(dt) {
      const steps = dt / 16.67;
      const accel = keys.gas ? ACCEL : keys.brake ? -BRAKE : 0;
      car.speed += accel * steps;
      car.speed *= Math.pow(DRAG, steps);

      const distFromCenter = Math.hypot(car.x - cx, car.y - cy);
      const offTrack = distFromCenter < innerR - CAR_LEN() * 0.3 || distFromCenter > outerR + CAR_LEN() * 0.3;
      const maxFwd = offTrack ? MAX_FWD * 0.45 : MAX_FWD;
      if (offTrack) car.speed *= Math.pow(0.9, steps);
      car.speed = Math.max(MAX_REV, Math.min(maxFwd, car.speed));

      const steerDir = (keys.left ? -1 : 0) + (keys.right ? 1 : 0);
      const speedFactor = Math.max(0.25, Math.min(1, Math.abs(car.speed) / MAX_FWD));
      const revSign = car.speed < 0 ? -1 : 1;
      car.heading += STEER_RATE * steps * 16.67 * steerDir * speedFactor * revSign;

      const targetVx = Math.cos(car.heading) * car.speed;
      const targetVy = Math.sin(car.heading) * car.speed;
      car._vx += (targetVx - car._vx) * grip * steps;
      car._vy += (targetVy - car._vy) * grip * steps;
      car.x += car._vx * steps;
      car.y += car._vy * steps;

      const currentAngle = Math.atan2(car.y - cy, car.x - cx);
      totalAngle += angleDelta(currentAngle, prevAngle);
      prevAngle = currentAngle;

      ai.angle += aiSpeed * steps;
      aiTotalAngle += aiSpeed * steps;

      const playerLaps = Math.floor(Math.max(0, totalAngle) / (Math.PI * 2));
      const aiLaps = Math.floor(aiTotalAngle / (Math.PI * 2));
      lapEl.textContent = `${Math.min(playerLaps + 1, REQUIRED_LAPS)}/${REQUIRED_LAPS}`;
      rivalEl.textContent = `${Math.min(aiLaps + 1, REQUIRED_LAPS)}/${REQUIRED_LAPS}`;

      if (playerLaps >= REQUIRED_LAPS) {
        finish(true, aiLaps < REQUIRED_LAPS);
      }
    }

    function draw() {
      ctx.fillStyle = "#3f6212";
      ctx.fillRect(0, 0, dims.width, dims.height);

      ctx.fillStyle = "#475569";
      ctx.beginPath(); ctx.arc(cx, cy, outerR, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#3f6212";
      ctx.beginPath(); ctx.arc(cx, cy, innerR, 0, Math.PI * 2); ctx.fill();

      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.setLineDash([10, 10]);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, midR, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);

      // start/finish line
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.PI);
      ctx.fillStyle = "#fff";
      ctx.fillRect(-dims.width * 0.012, -outerR, dims.width * 0.024, outerR - innerR);
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = i % 2 === 0 ? "#111" : "#fff";
        ctx.fillRect(-dims.width * 0.012, -outerR + i * ((outerR - innerR) / 6), dims.width * 0.024, (outerR - innerR) / 6);
      }
      ctx.restore();

      // AI car
      const aix = cx + Math.cos(ai.angle) * midR, aiy = cy + Math.sin(ai.angle) * midR;
      ctx.save();
      ctx.translate(aix, aiy);
      ctx.rotate(ai.angle - Math.PI / 2);
      ctx.fillStyle = "#1d4ed8";
      ctx.fillRect(-CAR_LEN() / 2, -CAR_W() / 2, CAR_LEN(), CAR_W());
      ctx.restore();

      // player car
      ctx.save();
      ctx.translate(car.x, car.y);
      ctx.rotate(car.heading);
      ctx.fillStyle = "#facc15";
      ctx.fillRect(-CAR_LEN() / 2, -CAR_W() / 2, CAR_LEN(), CAR_W());
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(-CAR_LEN() * 0.1, -CAR_W() / 2, CAR_LEN() * 0.35, CAR_W());
      ctx.restore();
    }

    function finish(won, beatRival) {
      running = false;
      cancelAnimationFrame(rafId);
      const score = Math.max(50, 600 - Math.round(elapsed) * 4) + (won && beatRival ? 200 : 0);
      if (won) ArcadeEngine.confetti(container);
      overlayEl = ArcadeEngine.overlay(container, {
        emoji: won ? "🏁" : "⏱️", title: won ? (beatRival ? "You won the race!" : "Finished — rival beat you") : "Time's up",
        subtitle: `Time: ${Math.round(elapsed)}s`, buttonLabel: "Play Again", onRestart: reset, score,
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
        elapsed++;
        timeEl.textContent = String(elapsed);
        if (elapsed >= TIME_LIMIT) { finish(false, false); return; }
      }
      step(dt);
      draw();
      rafId = requestAnimationFrame(loop);
    }

    const onKeyDown = (e) => {
      if (["ArrowLeft", "a", "A"].includes(e.key)) keys.left = true;
      if (["ArrowRight", "d", "D"].includes(e.key)) keys.right = true;
      if (["ArrowUp", "w", "W"].includes(e.key)) keys.gas = true;
      if (["ArrowDown", "s", "S"].includes(e.key)) keys.brake = true;
    };
    const onKeyUp = (e) => {
      if (["ArrowLeft", "a", "A"].includes(e.key)) keys.left = false;
      if (["ArrowRight", "d", "D"].includes(e.key)) keys.right = false;
      if (["ArrowUp", "w", "W"].includes(e.key)) keys.gas = false;
      if (["ArrowDown", "s", "S"].includes(e.key)) keys.brake = false;
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);

    const btnCleanups = [];
    container.querySelectorAll(".cr-pad .arcade-dpad-btn").forEach((btn) => {
      const k = btn.dataset.k;
      const press = (e) => { e.preventDefault(); keys[k] = true; };
      const release = () => { keys[k] = false; };
      btn.addEventListener("touchstart", press, { passive: false });
      btn.addEventListener("touchend", release);
      btn.addEventListener("mousedown", press);
      btn.addEventListener("mouseup", release);
      btn.addEventListener("mouseleave", release);
      btnCleanups.push(() => {
        btn.removeEventListener("touchstart", press);
        btn.removeEventListener("touchend", release);
        btn.removeEventListener("mousedown", press);
        btn.removeEventListener("mouseup", release);
        btn.removeEventListener("mouseleave", release);
      });
    });

    removeResize = ArcadeEngine.onResize(layout);

    container._cleanup = () => {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      btnCleanups.forEach((fn) => fn());
      if (removeResize) removeResize();
    };

    layout();
    reset();
  }

  function stop(container) {
    if (container && container._cleanup) container._cleanup();
  }

  window.ArcadeGames = window.ArcadeGames || {};
  window.ArcadeGames["car-racing"] = { start, stop };
})();
