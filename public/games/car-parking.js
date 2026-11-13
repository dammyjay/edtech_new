// Arcade: Car Parking — top-down car physics (accel/brake/steer + drift
// blend toward heading) across 3 levels of tighter parking spots.
(function () {
  const ACCEL = 0.09, BRAKE = 0.16, DRAG = 0.985, STEER_RATE = 0.0032;
  const MAX_FWD = 2.6, MAX_REV = -1.6;
  const GRIP_BY_DIFFICULTY = { easy: 0.14, medium: 0.1, hard: 0.075 };
  const TIME_LIMIT = 90;
  const HOLD_FRAMES = 45;

  const LEVELS = [
    { zone: { x: 0.74, y: 0.4, w: 0.16, h: 0.22, heading: 0 }, obstacles: [{ x: 0.74, y: 0.1, w: 0.16, h: 0.14 }, { x: 0.74, y: 0.76, w: 0.16, h: 0.14 }] },
    { zone: { x: 0.08, y: 0.74, w: 0.22, h: 0.16, heading: Math.PI / 2 }, obstacles: [{ x: 0.35, y: 0.3, w: 0.14, h: 0.5 }, { x: 0.6, y: 0.1, w: 0.14, h: 0.3 }] },
    { zone: { x: 0.42, y: 0.1, w: 0.16, h: 0.18, heading: 0 }, obstacles: [{ x: 0.1, y: 0.4, w: 0.18, h: 0.14 }, { x: 0.65, y: 0.4, w: 0.18, h: 0.14 }, { x: 0.42, y: 0.64, w: 0.16, h: 0.14 }] },
  ];

  function start(container) {
    container.classList.add("arcade-game");
    container.style.setProperty("--game-accent", "#2563eb");
    const grip = GRIP_BY_DIFFICULTY[container.dataset.difficulty] || GRIP_BY_DIFFICULTY.medium;

    container.innerHTML = `
      <p class="arcade-game-hint">Drive into the highlighted spot, lined up straight, and hold still. Watch the obstacles!</p>
      <div class="arcade-scoreboard">
        <div class="arcade-score-pill"><span class="label">Level</span><span class="value" id="cpLevel">1/3</span></div>
        <div class="arcade-score-pill"><span class="label">Time</span><span class="value" id="cpTime">${TIME_LIMIT}</span></div>
        <div class="arcade-score-pill"><span class="label">Bumps</span><span class="value" id="cpBumps">0</span></div>
      </div>
      <div class="arcade-canvas-wrap"><canvas id="cpCanvas"></canvas></div>
      <div class="cp-controls">
        <div class="cp-pad">
          <button type="button" class="arcade-dpad-btn" data-k="left">◀</button>
          <button type="button" class="arcade-dpad-btn" data-k="right">▶</button>
        </div>
        <div class="cp-pad">
          <button type="button" class="arcade-dpad-btn" data-k="brake">▼</button>
          <button type="button" class="arcade-dpad-btn" data-k="gas">▲</button>
        </div>
      </div>
      <style>
        .cp-controls { display:flex; justify-content:space-between; max-width:480px; margin:16px auto 0; padding:0 10px; }
        .cp-pad { display:flex; gap:10px; }
        .cp-controls .arcade-dpad-btn { width:56px; height:56px; font-size:20px; }
      </style>
    `;

    const canvas = container.querySelector("#cpCanvas");
    const levelEl = container.querySelector("#cpLevel");
    const timeEl = container.querySelector("#cpTime");
    const bumpsEl = container.querySelector("#cpBumps");

    let dims, ctx, car, zone, obstacles, levelIndex, bumps, timeLeft, holdFrames, running, rafId, overlayEl, removeResize;
    const keys = { left: false, right: false, gas: false, brake: false };

    function loadLevel() {
      const L = LEVELS[levelIndex];
      car = { x: dims.width * 0.12, y: dims.height * 0.12, heading: 0.3, speed: 0 };
      zone = { x: L.zone.x * dims.width, y: L.zone.y * dims.height, w: L.zone.w * dims.width, h: L.zone.h * dims.height, heading: L.zone.heading };
      obstacles = L.obstacles.map((o) => ({ x: o.x * dims.width, y: o.y * dims.height, w: o.w * dims.width, h: o.h * dims.height }));
      holdFrames = 0;
      levelEl.textContent = `${levelIndex + 1}/${LEVELS.length}`;
    }

    function layout() {
      dims = ArcadeEngine.fitCanvas(canvas, 1.3, 460);
      ctx = dims.ctx;
      if (!car) loadLevel();
    }

    function reset() {
      if (overlayEl) { overlayEl.remove(); overlayEl = null; }
      levelIndex = 0; bumps = 0; timeLeft = TIME_LIMIT; running = true;
      bumpsEl.textContent = "0"; timeEl.textContent = String(TIME_LIMIT);
      loadLevel();
      loop(performance.now());
    }

    const CAR_LEN = () => dims.width * 0.07;
    const CAR_W = () => dims.width * 0.035;

    function step(dt) {
      const steps = dt / 16.67;
      const accel = keys.gas ? ACCEL : keys.brake ? -BRAKE : 0;
      car.speed += accel * steps;
      car.speed *= Math.pow(DRAG, steps);
      car.speed = Math.max(MAX_REV, Math.min(MAX_FWD, car.speed));

      const steerDir = (keys.left ? -1 : 0) + (keys.right ? 1 : 0);
      const speedFactor = Math.max(0.25, Math.min(1, Math.abs(car.speed) / MAX_FWD));
      const revSign = car.speed < 0 ? -1 : 1;
      car.heading += STEER_RATE * steps * 16.67 * steerDir * speedFactor * revSign;

      const targetVx = Math.cos(car.heading) * car.speed;
      const targetVy = Math.sin(car.heading) * car.speed;
      if (car._vx === undefined) { car._vx = targetVx; car._vy = targetVy; }
      car._vx += (targetVx - car._vx) * grip * steps;
      car._vy += (targetVy - car._vy) * grip * steps;

      car.x += car._vx * steps;
      car.y += car._vy * steps;

      const half = CAR_LEN() / 2;
      if (car.x < half) { car.x = half; car.speed = 0; }
      if (car.x > dims.width - half) { car.x = dims.width - half; car.speed = 0; }
      if (car.y < half) { car.y = half; car.speed = 0; }
      if (car.y > dims.height - half) { car.y = dims.height - half; car.speed = 0; }

      obstacles.forEach((o) => {
        const closestX = Math.max(o.x, Math.min(car.x, o.x + o.w));
        const closestY = Math.max(o.y, Math.min(car.y, o.y + o.h));
        const dx = car.x - closestX, dy = car.y - closestY;
        const dist = Math.hypot(dx, dy);
        const carR = CAR_LEN() * 0.4;
        if (dist < carR) {
          const overlap = carR - (dist || 0.001);
          const nx = dist ? dx / dist : 1, ny = dist ? dy / dist : 0;
          car.x += nx * overlap; car.y += ny * overlap;
          if (Math.abs(car.speed) > 0.3) {
            bumps++;
            bumpsEl.textContent = String(bumps);
            ArcadeEngine.vibrate(18);
          }
          car.speed *= -0.3;
          car._vx *= 0.2; car._vy *= 0.2;
        }
      });

      // parking check
      const inZoneX = car.x > zone.x && car.x < zone.x + zone.w;
      const inZoneY = car.y > zone.y && car.y < zone.y + zone.h;
      let headingDiff = Math.abs(((car.heading - zone.heading + Math.PI) % (Math.PI * 2)) - Math.PI);
      headingDiff = Math.min(headingDiff, Math.PI - headingDiff);
      const aligned = headingDiff < 0.45;
      const slow = Math.abs(car.speed) < 0.3;
      if (inZoneX && inZoneY && aligned && slow) {
        holdFrames++;
        if (holdFrames >= HOLD_FRAMES) levelComplete();
      } else {
        holdFrames = 0;
      }
    }

    function levelComplete() {
      ArcadeEngine.confetti(container, 14);
      ArcadeEngine.vibrate(20);
      levelIndex++;
      if (levelIndex >= LEVELS.length) {
        finish(true);
      } else {
        car = null;
        loadLevel();
      }
    }

    function draw() {
      ctx.fillStyle = "#334155";
      ctx.fillRect(0, 0, dims.width, dims.height);
      for (let x = 0; x < dims.width; x += dims.width * 0.08) {
        ctx.fillStyle = "rgba(255,255,255,0.06)";
        ctx.fillRect(x, 0, 2, dims.height);
      }

      // Hit-testing (inZoneX/inZoneY below) is axis-aligned, so the outline
      // stays axis-aligned too — only the arrow rotates, to show the
      // heading the car needs to line up with without misleading the eye
      // about where the actual (unrotated) box boundary is.
      ctx.strokeStyle = "#facc15";
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 6]);
      ctx.strokeRect(zone.x, zone.y, zone.w, zone.h);
      ctx.setLineDash([]);

      ctx.save();
      ctx.translate(zone.x + zone.w / 2, zone.y + zone.h / 2);
      ctx.rotate(zone.heading);
      ctx.strokeStyle = "rgba(250,204,21,0.8)";
      ctx.lineWidth = 3;
      const arrowLen = Math.min(zone.w, zone.h) * 0.35;
      ctx.beginPath();
      ctx.moveTo(-arrowLen, 0); ctx.lineTo(arrowLen, 0);
      ctx.lineTo(arrowLen * 0.6, -arrowLen * 0.4);
      ctx.moveTo(arrowLen, 0);
      ctx.lineTo(arrowLen * 0.6, arrowLen * 0.4);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = "#7c2d12";
      obstacles.forEach((o) => ctx.fillRect(o.x, o.y, o.w, o.h));

      ctx.save();
      ctx.translate(car.x, car.y);
      ctx.rotate(car.heading);
      ctx.fillStyle = "#ef4444";
      ctx.fillRect(-CAR_LEN() / 2, -CAR_W() / 2, CAR_LEN(), CAR_W());
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(-CAR_LEN() * 0.1, -CAR_W() / 2, CAR_LEN() * 0.35, CAR_W());
      ctx.restore();

      if (holdFrames > 0) {
        ctx.fillStyle = "rgba(34,197,94,0.9)";
        ctx.font = `bold ${Math.round(dims.width * 0.04)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText("Hold still…", dims.width / 2, dims.height * 0.1);
      }
    }

    function finish(won) {
      running = false;
      cancelAnimationFrame(rafId);
      const score = Math.max(0, levelIndex * 150 + Math.round(timeLeft) * 2 - bumps * 15);
      if (won) ArcadeEngine.confetti(container);
      overlayEl = ArcadeEngine.overlay(container, {
        emoji: won ? "🚗" : "⏱️", title: won ? "All parked!" : "Time's up",
        subtitle: `Levels: ${levelIndex}/${LEVELS.length} · Bumps: ${bumps}`, buttonLabel: "Play Again", onRestart: reset, score,
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
        if (timeLeft <= 0) { finish(false); return; }
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
    container.querySelectorAll(".cp-pad .arcade-dpad-btn").forEach((btn) => {
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
  window.ArcadeGames["car-parking"] = { start, stop };
})();
