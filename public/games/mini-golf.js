// Arcade: Mini Golf — real 3D (Three.js course + ball), same 4-hole
// slingshot-putt physics as the original 2D version (friction, wall
// bounce, par-based scoring), just rendered as a real course instead of a
// flat canvas. Fixed camera (the course itself never moves) framing the
// whole hole from an angled overhead view, same convention as pool.js.
// Aiming raycasts the pointer onto the course's own ground plane (y=0),
// same technique pool.js already uses. Loaded as a <script type="module">
// (see views/student/arcade.ejs) so it can `import` Three.js with no
// build step.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { disposeObject3D, fitRenderer3D } from "./shared/three-helpers.js";

const FRICTION_BY_DIFFICULTY = { easy: 0.965, medium: 0.975, hard: 0.982 };
const MAX_STROKES_PER_HOLE = 8;

// World-unit course size — same ~1.35 aspect as the old canvas version,
// just in Three.js world units. Hole layouts below are UNCHANGED from
// the original: fractions (0-1) of the course width/depth, converted to
// world X/Z by worldPos() the same way car-parking.js converts its own
// normalized level layouts.
const COURSE_W = 12, COURSE_D = 9;
const BALL_R = 0.18;
const CUP_R = BALL_R * 1.6;
// Tied to COURSE_W, not BALL_R — matching the ORIGINAL's own convention
// (its power/pull formulas were relative to canvas width, not ball
// radius), so these ratios carry over directly onto the new world size.
const MAX_PULL = COURSE_W * 0.35;
const MAX_POWER = COURSE_W * 0.028;
const MOVING_EPS = MAX_POWER * 0.0016; // ~ old 0.02 / old max-power(~12.3) ratio
const SINK_SPEED = MAX_POWER * 0.179; // ~ old 2.2 / old max-power(~12.3) ratio

const HOLES = [
  { par: 2, ball: { x: 0.12, y: 0.5 }, cup: { x: 0.88, y: 0.5 }, walls: [] },
  { par: 3, ball: { x: 0.1, y: 0.15 }, cup: { x: 0.88, y: 0.85 }, walls: [{ x: 0.42, y: 0.0, w: 0.08, h: 0.65 }] },
  { par: 3, ball: { x: 0.1, y: 0.5 }, cup: { x: 0.88, y: 0.5 }, walls: [{ x: 0.35, y: 0.0, w: 0.08, h: 0.6 }, { x: 0.6, y: 0.4, w: 0.08, h: 0.6 }] },
  { par: 4, ball: { x: 0.1, y: 0.85 }, cup: { x: 0.5, y: 0.1 }, walls: [{ x: 0.3, y: 0.3, w: 0.4, h: 0.08 }, { x: 0.3, y: 0.55, w: 0.08, h: 0.45 }] },
];

// (nx, ny) normalized 0-1 -> world {x, z}, origin at the course's center.
function worldPos(nx, ny) {
  return { x: (nx - 0.5) * COURSE_W, z: (ny - 0.5) * COURSE_D };
}

function start(container) {
  container.classList.add("arcade-game");
  container.style.setProperty("--game-accent", "#16a34a");
  const friction = FRICTION_BY_DIFFICULTY[container.dataset.difficulty] || FRICTION_BY_DIFFICULTY.medium;

  container.innerHTML = `
    <p class="arcade-game-hint">Drag back from the ball and release to putt. Fewer strokes = more points.</p>
    <div class="arcade-scoreboard">
      <div class="arcade-score-pill"><span class="label">Hole</span><span class="value" id="mgHole">1/${HOLES.length}</span></div>
      <div class="arcade-score-pill"><span class="label">Strokes</span><span class="value" id="mgStrokes">0</span></div>
      <div class="arcade-score-pill"><span class="label">Score</span><span class="value" id="mgScore">0</span></div>
    </div>
    <div class="arcade-canvas-wrap">
      <div id="mgWrap" style="width:100%; height:100%; position:relative; background:#0d2818;"></div>
    </div>
  `;

  const wrap = container.querySelector("#mgWrap");
  const holeEl = container.querySelector("#mgHole");
  const strokesEl = container.querySelector("#mgStrokes");
  const scoreEl = container.querySelector("#mgScore");

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
    wrap.innerHTML = '<p style="padding:40px 16px; text-align:center; color:#9aa3c0;">3D mini golf needs WebGL, which this device/browser doesn\'t support. Try a different browser or device.</p>';
    container._cleanup = () => {};
    return;
  }

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d2818);

  camera = new THREE.PerspectiveCamera(50, 1.35, 0.1, 100);
  camera.position.set(0, 11, 7);
  camera.lookAt(0, 0, 0);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x0d2818, 1.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 0.8);
  sun.position.set(4, 11, 5);
  scene.add(sun);

  const green = new THREE.Mesh(new THREE.PlaneGeometry(COURSE_W, COURSE_D), new THREE.MeshLambertMaterial({ color: 0x1a4d2e }));
  green.rotation.x = -Math.PI / 2;
  scene.add(green);

  // Border — same dark trim as the old canvas version's stroke border.
  const borderMat = new THREE.MeshLambertMaterial({ color: 0x0d2818 });
  const BORDER_T = 0.35, BORDER_H = 0.25;
  const halfW = COURSE_W / 2, halfD = COURSE_D / 2;
  [
    { w: COURSE_W + BORDER_T * 2, d: BORDER_T, x: 0, z: halfD + BORDER_T / 2 },
    { w: COURSE_W + BORDER_T * 2, d: BORDER_T, x: 0, z: -(halfD + BORDER_T / 2) },
    { w: BORDER_T, d: COURSE_D, x: halfW + BORDER_T / 2, z: 0 },
    { w: BORDER_T, d: COURSE_D, x: -(halfW + BORDER_T / 2), z: 0 },
  ].forEach((b) => {
    const border = new THREE.Mesh(new THREE.BoxGeometry(b.w, BORDER_H, b.d), borderMat);
    border.position.set(b.x, BORDER_H / 2 - 0.05, b.z);
    scene.add(border);
  });

  const wallMat = new THREE.MeshLambertMaterial({ color: 0x166534 });
  const WALL_H = 0.4;
  let wallMeshes = [];
  let cupHole = null, flagPole = null, flag = null;

  const ballMat = new THREE.MeshPhongMaterial({ color: 0xf8fafc, shininess: 70 });
  const ball3d = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 18, 14), ballMat);
  scene.add(ball3d);

  let ball, walls, cup, strokes = 0, holeIndex = 0, totalScore = 0;
  let running = false, overlayEl = null, rafId = null;
  let aiming = false, aimWorld = null, completingHole = false;

  function clearHoleMeshes() {
    wallMeshes.forEach((m) => { scene.remove(m); disposeObject3D(m); });
    wallMeshes = [];
    if (cupHole) { scene.remove(cupHole); disposeObject3D(cupHole); cupHole = null; }
    if (flagPole) { scene.remove(flagPole); disposeObject3D(flagPole); flagPole = null; }
    if (flag) { scene.remove(flag); disposeObject3D(flag); flag = null; }
  }

  function loadHole() {
    clearHoleMeshes();
    const h = HOLES[holeIndex];
    const ballP = worldPos(h.ball.x, h.ball.y);
    ball = { x: ballP.x, z: ballP.z, vx: 0, vz: 0 };
    const cupP = worldPos(h.cup.x, h.cup.y);
    cup = { x: cupP.x, z: cupP.z };

    walls = h.walls.map((w) => {
      const p = worldPos(w.x, w.y);
      const ww = w.w * COURSE_W, wd = w.h * COURSE_D;
      return { minX: p.x, maxX: p.x + ww, minZ: p.z, maxZ: p.z + wd, cx: p.x + ww / 2, cz: p.z + wd / 2, w: ww, d: wd };
    });
    walls.forEach((w) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w.w, WALL_H, w.d), wallMat);
      mesh.position.set(w.cx, WALL_H / 2, w.cz);
      scene.add(mesh);
      wallMeshes.push(mesh);
    });

    cupHole = new THREE.Mesh(new THREE.CircleGeometry(CUP_R, 20), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    cupHole.rotation.x = -Math.PI / 2;
    cupHole.position.set(cup.x, 0.01, cup.z);
    scene.add(cupHole);

    flagPole = new THREE.Mesh(new THREE.CylinderGeometry(CUP_R * 0.12, CUP_R * 0.12, CUP_R * 3, 8), new THREE.MeshLambertMaterial({ color: 0xf8fafc }));
    flagPole.position.set(cup.x, CUP_R * 1.5, cup.z);
    scene.add(flagPole);

    const flagShape = new THREE.Shape();
    flagShape.moveTo(0, 0);
    flagShape.lineTo(CUP_R * 1.6, -CUP_R * 0.5);
    flagShape.lineTo(0, -CUP_R);
    flagShape.closePath();
    flag = new THREE.Mesh(new THREE.ShapeGeometry(flagShape), new THREE.MeshBasicMaterial({ color: 0xdc2626, side: THREE.DoubleSide }));
    flag.position.set(cup.x, CUP_R * 2.9, cup.z);
    scene.add(flag);

    strokes = 0;
    completingHole = false;
    strokesEl.textContent = "0";
    holeEl.textContent = `${holeIndex + 1}/${HOLES.length}`;
  }

  function reset() {
    if (overlayEl) { overlayEl.remove(); overlayEl = null; }
    holeIndex = 0; totalScore = 0; running = true;
    scoreEl.textContent = "0";
    loadHole();
    lastT = null;
    rafId = requestAnimationFrame(loop);
  }

  function isMoving() {
    return Math.abs(ball.vx) > MOVING_EPS || Math.abs(ball.vz) > MOVING_EPS;
  }

  function resolveWallCollision(w) {
    const closestX = Math.max(w.minX, Math.min(ball.x, w.maxX));
    const closestZ = Math.max(w.minZ, Math.min(ball.z, w.maxZ));
    const dx = ball.x - closestX, dz = ball.z - closestZ;
    const dist = Math.hypot(dx, dz);
    if (dist < BALL_R && dist > 0) {
      const overlap = BALL_R - dist;
      const nx = dx / dist, nz = dz / dist;
      ball.x += nx * overlap;
      ball.z += nz * overlap;
      if (Math.abs(nx) > Math.abs(nz)) ball.vx *= -0.7; else ball.vz *= -0.7;
    } else if (dist === 0) {
      ball.vx *= -0.7; ball.vz *= -0.7;
    }
  }

  function step(dt) {
    if (!isMoving()) {
      if (strokes >= MAX_STROKES_PER_HOLE && !aiming && !completingHole) holeComplete();
      return;
    }
    const steps = dt / 16.67;
    ball.x += ball.vx * steps;
    ball.z += ball.vz * steps;
    const k = Math.pow(friction, steps);
    ball.vx *= k; ball.vz *= k;
    if (Math.abs(ball.vx) < MOVING_EPS) ball.vx = 0;
    if (Math.abs(ball.vz) < MOVING_EPS) ball.vz = 0;

    if (ball.x - BALL_R < -halfW) { ball.x = -halfW + BALL_R; ball.vx *= -0.8; }
    if (ball.x + BALL_R > halfW) { ball.x = halfW - BALL_R; ball.vx *= -0.8; }
    if (ball.z - BALL_R < -halfD) { ball.z = -halfD + BALL_R; ball.vz *= -0.8; }
    if (ball.z + BALL_R > halfD) { ball.z = halfD - BALL_R; ball.vz *= -0.8; }

    walls.forEach(resolveWallCollision);

    const distToCup = Math.hypot(ball.x - cup.x, ball.z - cup.z);
    const speed = Math.hypot(ball.vx, ball.vz);
    if (distToCup < CUP_R && speed < SINK_SPEED && !completingHole) {
      holeComplete();
    }
  }

  function updateScene() {
    ball3d.position.set(ball.x, BALL_R, ball.z);
    const speed = Math.hypot(ball.vx, ball.vz);
    if (speed > 0.0005) {
      const axis = new THREE.Vector3(ball.vz, 0, -ball.vx).normalize();
      ball3d.rotateOnWorldAxis(axis, speed / BALL_R);
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
    ArcadeSound.play("sink");
    ArcadeEngine.vibrate(16);
    holeIndex++;
    if (holeIndex >= HOLES.length) {
      finish();
    } else {
      setTimeout(() => { loadHole(); }, 500);
    }
  }

  function finish() {
    running = false;
    cancelAnimationFrame(rafId);
    clearAimLine();
    ArcadeEngine.confetti(container);
    ArcadeSound.play("win");
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
    updateScene();
    renderer3d.render(scene, camera);
    rafId = requestAnimationFrame(loop);
  }

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pointerToGroundPoint(clientX, clientY) {
    const rect = renderer3d.domElement.getBoundingClientRect();
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const origin = raycaster.ray.origin, dir = raycaster.ray.direction;
    if (Math.abs(dir.y) < 1e-6) return null;
    const t = -origin.y / dir.y;
    if (t < 0) return null;
    return { x: origin.x + dir.x * t, z: origin.z + dir.z * t };
  }

  let aimLine = null;
  function clearAimLine() {
    if (aimLine) { scene.remove(aimLine); disposeObject3D(aimLine); aimLine = null; }
  }
  function drawAimLine(dx, dz) {
    clearAimLine();
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(ball.x, 0.02, ball.z),
      new THREE.Vector3(ball.x + dx * 1.6, 0.02, ball.z + dz * 1.6),
    ]);
    const mat = new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.12, gapSize: 0.08, transparent: true, opacity: 0.85 });
    aimLine = new THREE.Line(geo, mat);
    aimLine.computeLineDistances();
    scene.add(aimLine);
  }

  function onDown(clientX, clientY) {
    if (isMoving() || completingHole) return;
    const p = pointerToGroundPoint(clientX, clientY);
    if (!p || Math.hypot(p.x - ball.x, p.z - ball.z) > BALL_R * 6) return;
    aiming = true;
    aimWorld = p;
  }
  function onMove(clientX, clientY) {
    if (!aiming) return;
    const p = pointerToGroundPoint(clientX, clientY);
    if (!p) return;
    aimWorld = p;
    drawAimLine(ball.x - aimWorld.x, ball.z - aimWorld.z);
  }
  function onUp() {
    if (!aiming) return;
    aiming = false;
    clearAimLine();
    const dx = ball.x - aimWorld.x, dz = ball.z - aimWorld.z;
    const dist = Math.min(Math.hypot(dx, dz), MAX_PULL);
    if (dist < BALL_R) { aimWorld = null; return; }
    const ang = Math.atan2(dz, dx);
    const power = (dist / MAX_PULL) * MAX_POWER;
    ball.vx = Math.cos(ang) * power;
    ball.vz = Math.sin(ang) * power;
    strokes++;
    strokesEl.textContent = String(strokes);
    aimWorld = null;
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
    fitRenderer3D(renderer3d, camera, wrap, 1.35);
  }
  const removeResize = ArcadeEngine.onResize(fitRenderer);

  container._cleanup = () => {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
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
window.ArcadeGames["mini-golf"] = { start, stop };
