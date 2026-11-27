// Arcade: Penalty Shootout — real 3D (Three.js pitch + goal + ball),
// same drag-to-aim/keeper-AI/save-detection mechanics as the original 2D
// version. Unlike basketball-shooter's flat-vertical-plane port, this one
// gets a genuine depth axis: the ball starts near the camera and travels
// AWAY into the goal, which is exactly how a real penalty-kick view
// works — so instead of literally reusing the original's 2D (x, y) as
// (x, y-up) like basketball did, the goal's OWN 2D rect (which the
// original drew near the top of a flat canvas) maps onto a real,
// upright goal plane at the far end of the pitch, and the ball's
// existing flight-progress ("t", from the UNCHANGED ballFlightPos()
// easing) drives a NEW depth interpolation layered on top. Every actual
// GAME RULE (keeper read chance, dive math, save/corner/goal detection,
// scoring) is an untouched, verbatim port — only how the ball/keeper/
// target get drawn in 3D space is new. Loaded as a <script type="module">
// (see views/student/arcade.ejs) so it can `import` Three.js with no
// build step.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { disposeObject3D, fitRenderer3D } from "./shared/three-helpers.js";

const KEEPER_READ_BY_DIFFICULTY = { easy: 0.35, medium: 0.55, hard: 0.72 };
const KEEPER_REACH_BY_DIFFICULTY = { easy: 0.24, medium: 0.3, hard: 0.36 };
const TOTAL_KICKS = 5;
const FLIGHT_MS = 550;

// Fixed "world-unit canvas" — the original's game-space math (goal rect,
// ball start, keeper dive clamping) is kept completely unchanged against
// these constants, same technique as basketball-shooter.js.
const dims = { width: 6, height: 6 / 0.82 };

// Real 3D world geometry the game-space math above gets mapped ONTO —
// goal plane at z=0, ball/kicker near the camera at z=KICK_Z.
const GOAL_W = 5.4, GOAL_H = 2.2, KICK_Z = 7.5, BALL_R = 0.16;

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
    <div class="arcade-canvas-wrap" style="position:relative;">
      <div id="psWrap" style="width:100%; height:100%; position:relative; background:#15803d;"></div>
      <p id="psResult" style="position:absolute; top:46%; left:0; right:0; text-align:center; color:#fff; font-weight:800; font-size:22px; margin:0; text-shadow:0 2px 6px rgba(0,0,0,0.7); opacity:0; transition:opacity .15s; pointer-events:none;"></p>
    </div>
  `;

  const wrap = container.querySelector("#psWrap");
  const goalsEl = container.querySelector("#psGoals");
  const kickEl = container.querySelector("#psKick");
  const scoreEl = container.querySelector("#psScore");
  const resultEl = container.querySelector("#psResult");

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
    wrap.innerHTML = '<p style="padding:40px 16px; text-align:center; color:#9aa3c0;">3D penalty shootout needs WebGL, which this device/browser doesn\'t support. Try a different browser or device.</p>';
    container._cleanup = () => {};
    return;
  }

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b3d20);
  scene.fog = new THREE.Fog(0x0b3d20, 10, 22);

  // Verified numerically (not just eyeballed) against the actual ball
  // and goal-corner world positions below — the ball sits at ground
  // level 7.5 world units in front of the goal, which a naively "centered
  // on the goal" camera clips below the bottom of the frame entirely;
  // this framing keeps the ball, both goal posts, and the crossbar all
  // within the view frustum at once.
  camera = new THREE.PerspectiveCamera(62, 0.82, 0.1, 60);
  camera.position.set(0, 3.2, KICK_Z + 3.5);
  camera.lookAt(0, GOAL_H * 0.5, 2);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x0b3d20, 1.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 0.8);
  sun.position.set(4, 10, 6);
  scene.add(sun);

  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(14, KICK_Z + 6), new THREE.MeshLambertMaterial({ color: 0x15803d }));
  pitch.rotation.x = -Math.PI / 2;
  pitch.position.set(0, 0, -2);
  scene.add(pitch);
  // Alternating mowing stripes, purely decorative.
  const stripeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.04 });
  for (let i = -3; i <= 3; i += 2) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(1.6, KICK_Z + 6), stripeMat);
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.set(i * 1.6, 0.005, -2);
    scene.add(stripe);
  }

  // Goal frame — posts + crossbar.
  const postMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const postR = 0.08;
  const postL = new THREE.Mesh(new THREE.CylinderGeometry(postR, postR, GOAL_H, 10), postMat);
  postL.position.set(-GOAL_W / 2, GOAL_H / 2, 0);
  scene.add(postL);
  const postRgt = postL.clone();
  postRgt.position.set(GOAL_W / 2, GOAL_H / 2, 0);
  scene.add(postRgt);
  const crossbar = new THREE.Mesh(new THREE.CylinderGeometry(postR, postR, GOAL_W, 10), postMat);
  crossbar.rotation.z = Math.PI / 2;
  crossbar.position.set(0, GOAL_H, 0);
  scene.add(crossbar);

  // A simple net — back + side panels as sparse line grids.
  const netMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 });
  const NET_DEPTH = 1.1;
  function addNetGrid(points) {
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    scene.add(new THREE.LineSegments(geo, netMat));
  }
  {
    const pts = [];
    for (let i = 0; i <= 6; i++) {
      const x = -GOAL_W / 2 + (i / 6) * GOAL_W;
      pts.push(new THREE.Vector3(x, 0, -NET_DEPTH), new THREE.Vector3(x, GOAL_H, -NET_DEPTH));
    }
    for (let j = 0; j <= 4; j++) {
      const y = (j / 4) * GOAL_H;
      pts.push(new THREE.Vector3(-GOAL_W / 2, y, -NET_DEPTH), new THREE.Vector3(GOAL_W / 2, y, -NET_DEPTH));
    }
    addNetGrid(pts);
  }

  // --- game-space <-> world mappings ----------------------------------
  // The goal rect (goal.x/y/w/h, in the original's own game-space units)
  // maps onto the real upright goal plane at z=0; keeper/target positions
  // are expressed in that same game-space and converted through these.
  let goal, ballStart;
  function gameGoalToWorld(gx, gy) {
    const nx = (gx - (goal.x + goal.w / 2)) / (goal.w / 2); // -1..1, left..right
    const ny = (gy - goal.y) / goal.h; // 0 (crossbar) .. 1 (ground)
    return { x: nx * (GOAL_W / 2), y: (1 - ny) * GOAL_H, z: 0 };
  }
  function worldGoalToGameSpace(wx, wy) {
    const nx = wx / (GOAL_W / 2);
    const ny = 1 - wy / GOAL_H;
    return { x: goal.x + goal.w / 2 + nx * (goal.w / 2), y: goal.y + ny * goal.h };
  }

  const ballMat = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 50 });
  const ball3d = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 16, 12), ballMat);
  scene.add(ball3d);

  const keeperMat = new THREE.MeshLambertMaterial({ color: 0xfacc15 });
  const keeperGroup = new THREE.Group();
  const keeperBody = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 1.1, 8), keeperMat);
  keeperBody.position.y = 0.75;
  keeperGroup.add(keeperBody);
  const keeperHead = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), new THREE.MeshLambertMaterial({ color: 0xfde68a }));
  keeperHead.position.y = 1.45;
  keeperGroup.add(keeperHead);
  scene.add(keeperGroup);

  let ball, keeper, score, goals, kickIndex, running = false, rafId = null, overlayEl = null;
  let aiming = false, aimCurrent = null, flying = false, flightStart = 0, flightFrom = null, flightTo = null, resultTimeout = null, keeperDiveX = null;

  function layoutGame() {
    goal = { x: dims.width * 0.18, y: dims.height * 0.1, w: dims.width * 0.64, h: dims.height * 0.32 };
    ballStart = { x: dims.width / 2, y: dims.height * 0.82 };
  }

  function resetBall() {
    ball = { x: ballStart.x, y: ballStart.y };
    keeper = { x: goal.x + goal.w / 2 };
    flying = false;
    keeperDiveX = null;
    resultEl.style.opacity = "0";
  }

  function reset() {
    if (overlayEl) { overlayEl.remove(); overlayEl = null; }
    score = 0; goals = 0; kickIndex = 0; running = true;
    goalsEl.textContent = "0"; scoreEl.textContent = "0"; kickEl.textContent = `1/${TOTAL_KICKS}`;
    layoutGame();
    resetBall();
    rafId = requestAnimationFrame(loop);
  }

  function showResult(text) {
    resultEl.textContent = text;
    resultEl.style.opacity = "1";
    if (resultTimeout) clearTimeout(resultTimeout);
    resultTimeout = setTimeout(() => { resultEl.style.opacity = "0"; }, 900);
  }

  // --- UNCHANGED from the original: takeShot's keeper-read/dive math and
  // the save/corner/goal scoring rules, operating on game-space target.x/y
  // exactly as before.
  function takeShot(target) {
    flying = true;
    flightStart = performance.now();
    flightFrom = { x: ball.x, y: ball.y };
    flightTo = target;
    ArcadeSound.play("swoosh");

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
        showResult("Saved!");
        ArcadeSound.play("save");
      } else {
        goals++;
        score += corner ? 25 : 20;
        showResult(corner ? "Top corner! ⚽" : "GOAL! ⚽");
        ArcadeEngine.confetti(container, 14);
        ArcadeSound.play("goal");
      }
      goalsEl.textContent = String(goals);
      scoreEl.textContent = String(score);
      ArcadeEngine.vibrate(saved ? 10 : 20);

      if (kickIndex >= TOTAL_KICKS) {
        setTimeout(() => finish(), 900);
      } else {
        kickEl.textContent = `${kickIndex + 1}/${TOTAL_KICKS}`;
        setTimeout(resetBall, 900);
      }
    }, FLIGHT_MS);
  }

  function ballFlightT() {
    const t = Math.min(1, (performance.now() - flightStart) / FLIGHT_MS);
    return 1 - Math.pow(1 - t, 2); // same ease-out as the original
  }

  function updateScene() {
    // Keeper stands in the goal mouth, diving along the goal's own X
    // when a shot is in flight (same keeperDiveX the unchanged AI above
    // already computed).
    const keeperGameX = flying ? (keeperDiveX ?? keeper.x) : keeper.x;
    const keeperWorld = gameGoalToWorld(keeperGameX, goal.y + goal.h * 0.82);
    keeperGroup.position.set(keeperWorld.x, 0, keeperWorld.z + 0.25);

    if (flying) {
      const t = ballFlightT();
      const targetWorld = gameGoalToWorld(flightTo.x, flightTo.y);
      const fromWorld = { x: 0, y: BALL_R, z: KICK_Z };
      ball3d.position.set(
        fromWorld.x + (targetWorld.x - fromWorld.x) * t,
        fromWorld.y + (targetWorld.y - fromWorld.y) * t,
        fromWorld.z + (targetWorld.z - fromWorld.z) * t
      );
      ball3d.rotation.x -= 0.25;
    } else {
      ball3d.position.set(0, BALL_R, KICK_Z);
    }
  }

  function finish() {
    running = false;
    cancelAnimationFrame(rafId);
    clearAimLine();
    if (goals === TOTAL_KICKS) { score += 50; ArcadeEngine.confetti(container); ArcadeSound.play("win"); }
    else if (goals === 0) ArcadeSound.play("lose");
    overlayEl = ArcadeEngine.overlay(container, {
      emoji: "⚽", title: goals === TOTAL_KICKS ? "Perfect shootout!" : "Shootout over",
      subtitle: `${goals}/${TOTAL_KICKS} goals`, buttonLabel: "Play Again", onRestart: reset, score,
    });
  }

  function loop() {
    if (!running) return;
    updateScene();
    renderer3d.render(scene, camera);
    rafId = requestAnimationFrame(loop);
  }

  // --- Aiming: raycast the pointer onto the goal's own plane (z=0),
  // convert to game-space via worldGoalToGameSpace, then clamp/shoot
  // exactly as the original did with canvas coordinates.
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pointerToGoalWorldPoint(clientX, clientY) {
    const rect = renderer3d.domElement.getBoundingClientRect();
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const origin = raycaster.ray.origin, dir = raycaster.ray.direction;
    if (Math.abs(dir.z) < 1e-6) return null;
    const t = -origin.z / dir.z;
    if (t < 0) return null;
    return { x: origin.x + dir.x * t, y: origin.y + dir.y * t };
  }

  function clampToGoal(p) {
    return {
      x: Math.max(goal.x + 4, Math.min(goal.x + goal.w - 4, p.x)),
      y: Math.max(goal.y + 4, Math.min(goal.y + goal.h - 4, p.y)),
    };
  }

  let aimLine = null, aimDot = null;
  function clearAimLine() {
    if (aimLine) { scene.remove(aimLine); disposeObject3D(aimLine); aimLine = null; }
    if (aimDot) { scene.remove(aimDot); disposeObject3D(aimDot); aimDot = null; }
  }
  function drawAimLine(gameAimPoint) {
    clearAimLine();
    const to = gameGoalToWorld(gameAimPoint.x, gameAimPoint.y);
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, BALL_R, KICK_Z),
      new THREE.Vector3(to.x, to.y, to.z),
    ]);
    const mat = new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.15, gapSize: 0.1, transparent: true, opacity: 0.85 });
    aimLine = new THREE.Line(geo, mat);
    aimLine.computeLineDistances();
    scene.add(aimLine);
    aimDot = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    aimDot.position.set(to.x, to.y, to.z);
    scene.add(aimDot);
  }

  const screenProjectVec = new THREE.Vector3();
  function ballScreenPos() {
    screenProjectVec.copy(ball3d.position);
    screenProjectVec.project(camera);
    const rect = renderer3d.domElement.getBoundingClientRect();
    return {
      x: rect.left + (screenProjectVec.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-screenProjectVec.y * 0.5 + 0.5) * rect.height,
      radius: rect.width * 0.12, // same 12%-of-canvas-width gate as the original
    };
  }

  function onDown(clientX, clientY) {
    if (flying) return;
    // Same gate as the original: the touch must land near the ball's
    // own on-screen position to start aiming (not literally anywhere
    // that happens to raycast onto the goal plane).
    const bp = ballScreenPos();
    if (Math.hypot(clientX - bp.x, clientY - bp.y) > bp.radius) return;
    const p = pointerToGoalWorldPoint(clientX, clientY);
    if (!p) return;
    aiming = true;
    aimCurrent = clampToGoal(worldGoalToGameSpace(p.x, p.y));
    drawAimLine(aimCurrent);
  }
  function onMove(clientX, clientY) {
    if (!aiming) return;
    const p = pointerToGoalWorldPoint(clientX, clientY);
    if (!p) return;
    aimCurrent = clampToGoal(worldGoalToGameSpace(p.x, p.y));
    drawAimLine(aimCurrent);
  }
  function onUp() {
    if (!aiming) return;
    aiming = false;
    clearAimLine();
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

  renderer3d.domElement.style.touchAction = "none";
  renderer3d.domElement.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
  renderer3d.domElement.addEventListener("touchstart", onTouchStart, { passive: true });
  renderer3d.domElement.addEventListener("touchmove", onTouchMove, { passive: true });
  renderer3d.domElement.addEventListener("touchend", onTouchEnd);

  function fitRenderer() {
    fitRenderer3D(renderer3d, camera, wrap, 0.82);
  }
  const removeResize = ArcadeEngine.onResize(fitRenderer);

  container._cleanup = () => {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    if (resultTimeout) clearTimeout(resultTimeout);
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
window.ArcadeGames["penalty-shootout"] = { start, stop };
