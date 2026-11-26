// Arcade: Basketball Shooter — real 3D (Three.js hoop + ball + a simple
// 3D player), same gravity-arc jump shots / tap-to-dunk mechanics as the
// original 2D version. Unlike the top-down games (car-parking, pool,
// mini-golf), this one's actual gameplay is a single VERTICAL plane —
// the original was a side-view game where the player always shoots
// straight up at a hoop sharing the same X — so every physics formula
// below is a DIRECT, unchanged port: `dims.width`/`dims.height` are kept
// as the exact same symbols, just fixed world-unit constants now instead
// of a resizable canvas size. Only two things actually change: ball/hoop/
// player get mapped from 2D (x, y-down) game-space into 3D (x, y-up, z=0)
// world position for rendering, and aiming raycasts the pointer onto that
// same z=0 plane instead of reading canvas pixels. The camera sits at a
// slight angle off that plane (not flat-on) purely so the 3D hoop/
// backboard/player models actually read as 3D, since the simulated shot
// itself never leaves z=0 (matching the original, which never had a
// left-right-miss "depth" dimension either). Loaded as a
// <script type="module"> (see views/student/arcade.ejs) so it can
// `import` Three.js with no build step.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { disposeObject3D } from "./shared/three-helpers.js";

const GRAVITY_BY_DIFFICULTY = { easy: 0.0135, medium: 0.016, hard: 0.019 };
const RIM_MULT_BY_DIFFICULTY = { easy: 1.25, medium: 1, hard: 0.82 };
const TIME_LIMIT = 45;
const DUNK_PHASES = { approach: 260, jump: 200, slam: 60, fall: 160, settle: 140 };
const DUNK_TOTAL = Object.values(DUNK_PHASES).reduce((a, b) => a + b, 0);

// A fixed "world-unit canvas" — every formula below is an unchanged port
// of the original's dims.width/dims.height-relative math, just against
// these constants instead of a live canvas size. Same aspect (0.72) as
// the original's fitCanvas call.
const dims = { width: 6, height: 6 / 0.72 };

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
    <div class="arcade-canvas-wrap" style="width:100%; max-width:420px; margin:0 auto; position:relative;">
      <div id="bsWrap" style="width:100%; aspect-ratio:0.72; position:relative; background:#0f172a;"></div>
      <p id="bsPopup" style="position:absolute; top:40%; left:0; right:0; text-align:center; color:#fff; font-weight:800; font-size:22px; margin:0; text-shadow:0 2px 6px rgba(0,0,0,0.7); opacity:0; transition:opacity .1s; pointer-events:none;"></p>
    </div>
  `;

  const wrap = container.querySelector("#bsWrap");
  const scoreEl = container.querySelector("#bsScore");
  const timeEl = container.querySelector("#bsTime");
  const streakEl = container.querySelector("#bsStreak");
  const popupEl = container.querySelector("#bsPopup");

  let renderer3d = null, scene = null, camera = null;
  let webglFailed = false;

  try {
    renderer3d = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer3d.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer3d.domElement.style.width = "100%";
    renderer3d.domElement.style.height = "100%";
    renderer3d.domElement.style.display = "block";
    renderer3d.domElement.style.borderRadius = "14px";
    wrap.appendChild(renderer3d.domElement);
  } catch (e) {
    webglFailed = true;
  }

  if (webglFailed || !renderer3d) {
    wrap.innerHTML = '<p style="padding:40px 16px; text-align:center; color:#9aa3c0;">3D basketball needs WebGL, which this device/browser doesn\'t support. Try a different browser or device.</p>';
    container._cleanup = () => {};
    return;
  }

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f172a);
  scene.fog = new THREE.Fog(0x0f172a, 9, 16);

  camera = new THREE.PerspectiveCamera(45, 0.72, 0.1, 50);
  camera.position.set(1.1, dims.height * 0.5, 7.4);
  camera.lookAt(0, dims.height * 0.42, 0);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x1e293b, 1.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 0.75);
  sun.position.set(3, 8, 5);
  scene.add(sun);

  // game-space (x, y-down-from-hoop) -> world (x centered, y-up, z=0).
  function toWorld(gx, gy) {
    return { x: gx - dims.width / 2, y: dims.height - gy, z: 0 };
  }

  const court = new THREE.Mesh(new THREE.PlaneGeometry(dims.width * 2.2, 10), new THREE.MeshLambertMaterial({ color: 0x1e293b }));
  court.rotation.x = -Math.PI / 2;
  court.position.set(0, 0, -2);
  scene.add(court);
  const groundStrip = new THREE.Mesh(new THREE.PlaneGeometry(dims.width * 2.2, 1.4), new THREE.MeshLambertMaterial({ color: 0x334155 }));
  groundStrip.rotation.x = -Math.PI / 2;
  groundStrip.position.set(0, 0.01, 0.6);
  scene.add(groundStrip);

  let hoop, ball, score, streak, timeLeft, running = false, rafId = null, overlayEl = null;
  let flying = false, touchedRim = false, aiming = false, aimWorld = null;
  let startX, startY, r, groundY;
  let popupTimeout = null;
  let dunking = false, dunkT0 = 0, dunkCancelled = false;
  let player = { x: 0, legPhase: 0 };
  let shake = 0;

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

  // --- 3D models -----------------------------------------------------
  const ballMat = new THREE.MeshPhongMaterial({ color: 0xf97316, shininess: 40 });
  const ball3d = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), ballMat);
  scene.add(ball3d);
  const seamMat = new THREE.MeshBasicMaterial({ color: 0x7c2d12 });
  [0, Math.PI / 2].forEach((rot) => {
    const seam = new THREE.Mesh(new THREE.TorusGeometry(r * 1.01, r * 0.035, 6, 20), seamMat);
    seam.rotation.y = rot;
    ball3d.add(seam);
  });

  const hoopWorld = toWorld(hoop.x, hoop.y);
  const backboard = new THREE.Mesh(
    new THREE.BoxGeometry(dims.width * 0.025, dims.height * 0.16, dims.width * 0.6),
    new THREE.MeshLambertMaterial({ color: 0xe2e8f0 })
  );
  backboard.position.set(hoopWorld.x + hoop.rimW / 2, hoopWorld.y + dims.height * 0.08, hoopWorld.z);
  scene.add(backboard);

  const rimMat = new THREE.MeshLambertMaterial({ color: 0xf97316 });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(hoop.rimW / 2, hoop.rimW * 0.035, 8, 24), rimMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.set(hoopWorld.x, hoopWorld.y, hoopWorld.z);
  scene.add(rim);

  // A simple net — a handful of hanging line segments from the rim, same
  // decorative role as the original's dashed "net" strokes.
  const netMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 });
  const netGroup = new THREE.Group();
  for (let i = -2; i <= 2; i++) {
    const rx = (i / 5) * hoop.rimW;
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(rx, 0, 0),
      new THREE.Vector3(rx * 0.55, -dims.height * 0.07, 0),
    ]);
    netGroup.add(new THREE.Line(geo, netMat));
  }
  netGroup.position.copy(new THREE.Vector3(hoopWorld.x, hoopWorld.y, hoopWorld.z));
  scene.add(netGroup);

  // Player — simple 3D primitives standing in for the original's
  // stick-figure line drawing, with the same functional poses (arms up
  // when aiming/dunking, leg swing mid-dunk).
  const playerMat = new THREE.MeshLambertMaterial({ color: 0x1e293b });
  const headMat = new THREE.MeshLambertMaterial({ color: 0xfb923c });
  const playerGroup = new THREE.Group();
  const legL = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.12, r * 0.12, r * 1.1, 6), playerMat);
  const legR = legL.clone();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.14, r * 0.14, r * 1.3, 6), playerMat);
  const armL = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.1, r * 0.1, r * 1.0, 6), playerMat);
  const armR = armL.clone();
  const head = new THREE.Mesh(new THREE.SphereGeometry(r * 0.55, 12, 10), headMat);
  [legL, legR, body, armL, armR, head].forEach((m) => playerGroup.add(m));
  scene.add(playerGroup);

  function poseLegs(legSwing) {
    legL.position.set(-r * 0.3, r * 0.55, 0);
    legR.position.set(r * 0.3, r * 0.55, 0);
    legL.rotation.z = legSwing * 0.01;
    legR.rotation.z = -legSwing * 0.01;
  }
  function poseArms(armUp) {
    const bodyTopY = r * 1.1 + r * 1.3;
    if (armUp) {
      armL.position.set(-r * 0.5, bodyTopY + r * 0.35, 0);
      armL.rotation.z = Math.PI / 5;
      armR.position.set(r * 0.5, bodyTopY + r * 0.35, 0);
      armR.rotation.z = -Math.PI / 5;
    } else {
      armL.position.set(-r * 0.45, bodyTopY - r * 0.1, 0);
      armL.rotation.z = Math.PI / 12;
      armR.position.set(r * 0.45, bodyTopY - r * 0.1, 0);
      armR.rotation.z = -Math.PI / 12;
    }
  }
  body.position.set(0, r * 1.1 + r * 0.65, 0);
  head.position.set(0, r * 1.1 + r * 1.3 + r * 0.55, 0);

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
    lastT = null; lastSecond = null;
    rafId = requestAnimationFrame(loop);
  }

  function showPopup(text, ms) {
    popupEl.textContent = text;
    popupEl.style.opacity = "1";
    if (popupTimeout) clearTimeout(popupTimeout);
    popupTimeout = setTimeout(() => { popupEl.style.opacity = "0"; }, ms || 700);
  }

  function awardShot(points, label, swish) {
    score += points;
    streak++;
    scoreEl.textContent = String(score);
    streakEl.textContent = String(streak);
    showPopup(label, 700);
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
    const { approach, jump, slam, fall } = DUNK_PHASES;
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
        dunkCancelled = true;
      }
      ball.x = hoop.x; ball.y = hoop.y + dims.height * 0.01;
    } else if (t < approach + jump + slam + fall) {
      const p = (t - approach - jump - slam) / fall;
      ball.x = hoop.x + player.x;
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

      const boardX = hoop.x + hoop.rimW / 2 + 4 / dims.width; // "4" was a 4px nudge — negligible at world scale, kept proportionally tiny
      if (ball.x > boardX - r && ball.x < boardX && ball.y < hoop.y && ball.y > hoop.y - dims.height * 0.12 && ball.vx > 0) {
        ball.vx *= -0.6;
        touchedRim = true;
        ArcadeSound.play("bounce");
      }

      if (ball.y - r > dims.height || ball.x < -r * 2 || ball.x > dims.width + r * 2) {
        streak = 0;
        streakEl.textContent = "0";
        showPopup("Miss", 500);
        ArcadeSound.play("miss");
        resetBall();
      }
    }
  }

  function updateScene() {
    const bw = toWorld(ball.x, ball.y);
    ball3d.position.set(bw.x, bw.y, bw.z);
    const speed = Math.hypot(ball.vx, ball.vy);
    if (speed > 0.0005) {
      const axis = new THREE.Vector3(0, 0, 1).cross(new THREE.Vector3(ball.vx, -ball.vy, 0)).normalize();
      if (axis.lengthSq() > 0) ball3d.rotateOnWorldAxis(axis, speed / r);
    }

    const legSwing = dunking ? Math.sin(player.legPhase) * 8 : 0;
    poseLegs(legSwing);
    poseArms(dunking || aiming);
    const pw = toWorld(player.x, groundY);
    playerGroup.position.set(pw.x, pw.y, pw.z);

    if (shake > 0.3) {
      camera.position.x = 1.1 + (Math.random() - 0.5) * shake * 0.03;
      camera.position.y = dims.height * 0.5 + (Math.random() - 0.5) * shake * 0.03;
    } else {
      camera.position.x = 1.1;
      camera.position.y = dims.height * 0.5;
    }
  }

  function finish() {
    running = false;
    cancelAnimationFrame(rafId);
    clearAimLine();
    if (score > 0) { ArcadeEngine.confetti(container); ArcadeSound.play("win"); } else ArcadeSound.play("lose");
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
    updateScene();
    renderer3d.render(scene, camera);
    rafId = requestAnimationFrame(loop);
  }

  // --- Aiming: raycast the pointer onto the z=0 plane the action lives
  // on, then convert back into game-space (x, y-down) for the unchanged
  // physics formulas above.
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pointerToGamePoint(clientX, clientY) {
    const rect = renderer3d.domElement.getBoundingClientRect();
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const origin = raycaster.ray.origin, dir = raycaster.ray.direction;
    if (Math.abs(dir.z) < 1e-6) return null;
    const t = -origin.z / dir.z;
    if (t < 0) return null;
    const worldX = origin.x + dir.x * t, worldY = origin.y + dir.y * t;
    return { x: worldX + dims.width / 2, y: dims.height - worldY };
  }

  let aimLine = null;
  function clearAimLine() {
    if (aimLine) { scene.remove(aimLine); disposeObject3D(aimLine); aimLine = null; }
  }
  function drawAimLine(dx, dy) {
    clearAimLine();
    const from = toWorld(ball.x, ball.y);
    const to = toWorld(ball.x + dx * 1.3, ball.y + dy * 1.3);
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(from.x, from.y, from.z),
      new THREE.Vector3(to.x, to.y, to.z),
    ]);
    const mat = new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.1, gapSize: 0.07, transparent: true, opacity: 0.85 });
    aimLine = new THREE.Line(geo, mat);
    aimLine.computeLineDistances();
    scene.add(aimLine);
  }

  function onDown(clientX, clientY) {
    if (flying || dunking) return;
    const p = pointerToGamePoint(clientX, clientY);
    if (!p || Math.hypot(p.x - ball.x, p.y - ball.y) > r * 5) return;
    aiming = true;
    aimWorld = p;
  }
  function onMove(clientX, clientY) {
    if (!aiming) return;
    const p = pointerToGamePoint(clientX, clientY);
    if (!p) return;
    aimWorld = p;
    drawAimLine(ball.x - aimWorld.x, ball.y - aimWorld.y);
  }
  function onUp() {
    if (!aiming) return;
    aiming = false;
    clearAimLine();
    const dx = ball.x - aimWorld.x, dy = ball.y - aimWorld.y;
    const dist = Math.hypot(dx, dy);
    if (dist < r * 1.8) {
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

  renderer3d.domElement.style.touchAction = "none";
  renderer3d.domElement.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
  renderer3d.domElement.addEventListener("touchstart", onTouchStart, { passive: true });
  renderer3d.domElement.addEventListener("touchmove", onTouchMove, { passive: true });
  renderer3d.domElement.addEventListener("touchend", onTouchEnd);

  function fitRenderer() {
    const w = wrap.clientWidth || 1;
    const h = wrap.clientHeight || Math.round(w / 0.72);
    renderer3d.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const removeResize = ArcadeEngine.onResize(fitRenderer);

  container._cleanup = () => {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    if (popupTimeout) clearTimeout(popupTimeout);
    renderer3d.domElement.removeEventListener("mousedown", onMouseDown);
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
    renderer3d.domElement.removeEventListener("touchstart", onTouchStart);
    renderer3d.domElement.removeEventListener("touchmove", onTouchMove);
    renderer3d.domElement.removeEventListener("touchend", onTouchEnd);
    if (removeResize) removeResize();
    disposeObject3D(scene);
    renderer3d.dispose();
    if (renderer3d.forceContextLoss) renderer3d.forceContextLoss();
    if (renderer3d.domElement && renderer3d.domElement.parentNode) {
      renderer3d.domElement.parentNode.removeChild(renderer3d.domElement);
    }
  };

  fitRenderer();
  reset();
}

function stop(container) {
  if (container && container._cleanup) container._cleanup();
}

window.ArcadeGames = window.ArcadeGames || {};
window.ArcadeGames["basketball-shooter"] = { start, stop };
