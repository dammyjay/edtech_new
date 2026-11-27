// Arcade: Pool — real 3D (Three.js table + spheres), same ball-to-ball
// elastic collisions/friction/pockets/slingshot-aim mechanics as the
// original 2D version, just rendered as a real table instead of a flat
// canvas. Fixed camera (the table itself never moves, unlike car-racing/
// car-parking's car-following cams) framing the whole table from a
// classic above-and-behind angle. Aiming/shooting works by raycasting the
// pointer onto the table's own ground plane (y=0), so drag direction and
// distance translate into world-space exactly like the old canvas
// version's screen-space math did. Loaded as a <script type="module">
// (see views/student/arcade.ejs) so it can `import` Three.js with no
// build step.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { disposeObject3D, fitRenderer3D } from "./shared/three-helpers.js";

const FRICTION_BY_DIFFICULTY = { easy: 0.985, medium: 0.978, hard: 0.971 };
const POCKET_MULT_BY_DIFFICULTY = { easy: 2.3, medium: 1.9, hard: 1.6 };
const BALL_COLORS = [0xeab308, 0x2563eb, 0xdc2626, 0x7c3aed, 0x059669];
const MAX_SHOTS = 30;

// World-unit scale: a real pool table is roughly 2:1 — these are the
// same proportions the old canvas version used (aspect 1.9), just in
// Three.js world units instead of CSS pixels. Every other constant below
// is derived from BALL_R the same way the old version derived them from
// its own pixel-sized ball radius, so the exact same *relative* feel
// (how far you can pull back, how fast friction kills a shot, how
// generous the pockets are) carries over unchanged.
const TABLE_W = 10, TABLE_D = 5.2;
const BALL_R = 0.22;
const MAX_POWER = BALL_R * 0.92; // ~ old MAX_POWER(16) / old radius(~17.3px) ratio
const MAX_PULL = TABLE_W * 0.3; // how far back you can drag for full power
const STOP_EPS = MAX_POWER * 0.00125; // "effectively stopped" velocity threshold

function start(container) {
  container.classList.add("arcade-game");
  container.style.setProperty("--game-accent", "#15803d");
  const friction = FRICTION_BY_DIFFICULTY[container.dataset.difficulty] || FRICTION_BY_DIFFICULTY.medium;
  const pocketMult = POCKET_MULT_BY_DIFFICULTY[container.dataset.difficulty] || POCKET_MULT_BY_DIFFICULTY.medium;
  const pocketR = BALL_R * pocketMult;

  container.innerHTML = `
    <p class="arcade-game-hint">Drag back from the cue ball and release to shoot. Sink every colored ball.</p>
    <div class="arcade-scoreboard">
      <div class="arcade-score-pill"><span class="label">Score</span><span class="value" id="poolScore">0</span></div>
      <div class="arcade-score-pill"><span class="label">Balls Left</span><span class="value" id="poolLeft">5</span></div>
      <div class="arcade-score-pill"><span class="label">Shots</span><span class="value" id="poolShots">0</span></div>
    </div>
    <div class="arcade-canvas-wrap">
      <div id="poolWrap" style="width:100%; height:100%; position:relative; background:#06250f;"></div>
    </div>
  `;

  const wrap = container.querySelector("#poolWrap");
  const scoreEl = container.querySelector("#poolScore");
  const leftEl = container.querySelector("#poolLeft");
  const shotsEl = container.querySelector("#poolShots");

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
    wrap.innerHTML = '<p style="padding:40px 16px; text-align:center; color:#9aa3c0;">3D pool needs WebGL, which this device/browser doesn\'t support. Try a different browser or device.</p>';
    container._cleanup = () => {};
    return;
  }

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x06250f);

  camera = new THREE.PerspectiveCamera(48, 1.9, 0.1, 100);
  camera.position.set(0, 8.6, 4.4);
  camera.lookAt(0, 0, 0);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x0b4d2c, 1.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 0.8);
  sun.position.set(3, 10, 4);
  scene.add(sun);

  const felt = new THREE.Mesh(new THREE.PlaneGeometry(TABLE_W, TABLE_D), new THREE.MeshLambertMaterial({ color: 0x0b4d2c }));
  felt.rotation.x = -Math.PI / 2;
  scene.add(felt);

  // Wooden rail border — a frame of boxes around the felt, same role as
  // the old canvas version's brown stroke border.
  const railMat = new THREE.MeshLambertMaterial({ color: 0x6b3f1d });
  const RAIL_T = 0.3, RAIL_H = 0.3;
  [
    { w: TABLE_W + RAIL_T * 2, d: RAIL_T, x: 0, z: TABLE_D / 2 + RAIL_T / 2 },
    { w: TABLE_W + RAIL_T * 2, d: RAIL_T, x: 0, z: -(TABLE_D / 2 + RAIL_T / 2) },
    { w: RAIL_T, d: TABLE_D, x: TABLE_W / 2 + RAIL_T / 2, z: 0 },
    { w: RAIL_T, d: TABLE_D, x: -(TABLE_W / 2 + RAIL_T / 2), z: 0 },
  ].forEach((r) => {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(r.w, RAIL_H, r.d), railMat);
    rail.position.set(r.x, RAIL_H / 2 - 0.05, r.z);
    scene.add(rail);
  });

  // Pockets — same 6-pocket layout as the old version (4 corners + 2 on
  // the long rails' midpoints), rendered as flat dark circles (a real
  // recessed hole isn't worth the extra geometry for how little it'd add).
  const halfW = TABLE_W / 2, halfD = TABLE_D / 2;
  const m = BALL_R * 1.4;
  const pockets = [
    { x: -(halfW - m), z: -(halfD - m) }, { x: (halfW - m), z: -(halfD - m) },
    { x: -(halfW - m), z: (halfD - m) }, { x: (halfW - m), z: (halfD - m) },
    { x: 0, z: -(halfD - m * 0.5) }, { x: 0, z: (halfD - m * 0.5) },
  ].map((p) => ({ ...p, r: pocketR }));
  const pocketMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  pockets.forEach((p) => {
    const hole = new THREE.Mesh(new THREE.CircleGeometry(p.r, 20), pocketMat);
    hole.rotation.x = -Math.PI / 2;
    hole.position.set(p.x, 0.01, p.z);
    scene.add(hole);
  });

  const ballGeo = new THREE.SphereGeometry(BALL_R, 20, 16);
  const ballMeshes = [];
  let balls = [];

  function makeBalls() {
    ballMeshes.forEach((m2) => { scene.remove(m2); disposeObject3D(m2); });
    ballMeshes.length = 0;

    const cue = { x: -(TABLE_W * 0.28), z: 0, vx: 0, vz: 0, r: BALL_R, cue: true, alive: true };
    const rackX = TABLE_W * 0.18, rackZ = 0;
    const spacing = BALL_R * 2.05;
    const positions = [
      [0, 0], [spacing * 0.87, -spacing / 2], [spacing * 0.87, spacing / 2],
      [spacing * 1.74, -spacing], [spacing * 1.74, 0],
    ];
    const rest = positions.map((p, i) => ({
      x: rackX + p[0], z: rackZ + p[1], vx: 0, vz: 0, r: BALL_R, cue: false, alive: true, colorIndex: i,
    }));
    balls = [cue, ...rest];

    balls.forEach((b) => {
      const mat = new THREE.MeshPhongMaterial({ color: b.cue ? 0xf8fafc : BALL_COLORS[b.colorIndex], shininess: 60 });
      const mesh = new THREE.Mesh(ballGeo, mat);
      mesh.position.set(b.x, BALL_R, b.z);
      scene.add(mesh);
      b.mesh = mesh;
      ballMeshes.push(mesh);
    });
  }

  let score = 0, shots = 0, running = false, overlayEl = null, rafId = null;
  let aiming = false, aimWorld = null;

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  // Intersects the pointer ray with the table's own ground plane (y=0) —
  // the 3D equivalent of the old version's toCanvasPoint(), used for both
  // "is this click near the cue ball" and continuous aim tracking.
  function pointerToTablePoint(clientX, clientY) {
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

  // Dashed aim line — drawn fresh each frame while aiming (cheap: one
  // short line, nothing like the breadboard's hundreds of pins).
  let aimLine = null;
  function clearAimLine() {
    if (aimLine) { scene.remove(aimLine); disposeObject3D(aimLine); aimLine = null; }
  }
  function drawAimLine(cue, ang, dist) {
    clearAimLine();
    const len = dist * 1.6;
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(cue.x, 0.02, cue.z),
      new THREE.Vector3(cue.x + Math.cos(ang) * len, 0.02, cue.z + Math.sin(ang) * len),
    ]);
    const mat = new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.15, gapSize: 0.1, transparent: true, opacity: 0.8 });
    aimLine = new THREE.Line(geo, mat);
    aimLine.computeLineDistances();
    scene.add(aimLine);
  }

  function reset() {
    if (overlayEl) { overlayEl.remove(); overlayEl = null; }
    score = 0; shots = 0; running = true;
    scoreEl.textContent = "0"; shotsEl.textContent = "0"; leftEl.textContent = "5";
    makeBalls();
    lastT = null;
    rafId = requestAnimationFrame(loop);
  }

  function allStopped() {
    return balls.every((b) => !b.alive || (Math.abs(b.vx) < STOP_EPS && Math.abs(b.vz) < STOP_EPS));
  }

  function step(dt) {
    const k = Math.pow(friction, dt / 16.67);
    const steps = dt / 16.67;
    balls.forEach((b) => {
      if (!b.alive) return;
      b.x += b.vx * steps;
      b.z += b.vz * steps;
      b.vx *= k; b.vz *= k;
      if (Math.abs(b.vx) < STOP_EPS) b.vx = 0;
      if (Math.abs(b.vz) < STOP_EPS) b.vz = 0;

      if (b.x - b.r < -halfW) { b.x = -halfW + b.r; b.vx *= -0.85; }
      if (b.x + b.r > halfW) { b.x = halfW - b.r; b.vx *= -0.85; }
      if (b.z - b.r < -halfD) { b.z = -halfD + b.r; b.vz *= -0.85; }
      if (b.z + b.r > halfD) { b.z = halfD - b.r; b.vz *= -0.85; }
    });

    // ball-ball elastic collisions (equal mass) — identical formula to
    // the old 2D version, just x/z instead of x/y.
    for (let i = 0; i < balls.length; i++) {
      for (let j = i + 1; j < balls.length; j++) {
        const a = balls[i], b = balls[j];
        if (!a.alive || !b.alive) continue;
        const dx = b.x - a.x, dz = b.z - a.z;
        const dist = Math.hypot(dx, dz) || 0.001;
        const minDist = a.r + b.r;
        if (dist < minDist) {
          const nx = dx / dist, nz = dz / dist;
          const overlap = minDist - dist;
          a.x -= nx * overlap / 2; a.z -= nz * overlap / 2;
          b.x += nx * overlap / 2; b.z += nz * overlap / 2;
          const relVx = b.vx - a.vx, relVz = b.vz - a.vz;
          const sep = relVx * nx + relVz * nz;
          if (sep < 0) {
            a.vx += nx * sep; a.vz += nz * sep;
            b.vx -= nx * sep; b.vz -= nz * sep;
            ArcadeEngine.vibrate(6);
          }
        }
      }
    }

    // pocket checks
    balls.forEach((b) => {
      if (!b.alive) return;
      pockets.forEach((p) => {
        if (Math.hypot(b.x - p.x, b.z - p.z) < p.r) {
          b.alive = false;
          b.mesh.visible = false;
          if (b.cue) {
            score = Math.max(0, score - 10);
            ArcadeSound.play("miss");
            setTimeout(() => {
              b.alive = true; b.x = -(TABLE_W * 0.28); b.z = 0; b.vx = 0; b.vz = 0;
              b.mesh.visible = true;
            }, 500);
          } else {
            score += 15;
            ArcadeSound.play("sink");
            ArcadeEngine.vibrate(16);
          }
          scoreEl.textContent = String(score);
        }
      });
    });

    const remaining = balls.filter((b) => !b.cue && b.alive).length;
    leftEl.textContent = String(remaining);
    if (remaining === 0) { finish(true); return; }
    if (shots >= MAX_SHOTS && allStopped()) finish(false);
  }

  function updateScene() {
    balls.forEach((b) => {
      if (!b.mesh) return;
      b.mesh.position.set(b.x, BALL_R, b.z);
      // Rolling-without-slipping visual spin — purely cosmetic, makes a
      // stationary top-down ball actually look like it's rolling.
      const speed = Math.hypot(b.vx, b.vz);
      if (speed > 0.0005) {
        const axis = new THREE.Vector3(b.vz, 0, -b.vx).normalize();
        b.mesh.rotateOnWorldAxis(axis, speed / b.r);
      }
    });
  }

  function finish(won) {
    running = false;
    cancelAnimationFrame(rafId);
    clearAimLine();
    if (won) { ArcadeEngine.confetti(container); ArcadeSound.play("win"); } else ArcadeSound.play("lose");
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
    updateScene();
    renderer3d.render(scene, camera);
    rafId = requestAnimationFrame(loop);
  }

  function onDown(clientX, clientY) {
    if (!allStopped()) return;
    const cue = balls[0];
    if (!cue.alive) return;
    const p = pointerToTablePoint(clientX, clientY);
    if (!p || Math.hypot(p.x - cue.x, p.z - cue.z) > BALL_R * 6) return;
    aiming = true;
    aimWorld = p;
  }
  function onMove(clientX, clientY) {
    if (!aiming) return;
    const p = pointerToTablePoint(clientX, clientY);
    if (!p) return;
    aimWorld = p;
    const cue = balls[0];
    const dx = cue.x - aimWorld.x, dz = cue.z - aimWorld.z;
    const dist = Math.min(Math.hypot(dx, dz), MAX_PULL);
    if (dist < BALL_R * 0.3) { clearAimLine(); return; }
    drawAimLine(cue, Math.atan2(dz, dx), dist);
  }
  function onUp() {
    if (!aiming) return;
    aiming = false;
    clearAimLine();
    const cue = balls[0];
    const dx = cue.x - aimWorld.x, dz = cue.z - aimWorld.z;
    const dist = Math.min(Math.hypot(dx, dz), MAX_PULL);
    if (dist < BALL_R) { aimWorld = null; return; }
    const ang = Math.atan2(dz, dx);
    const power = Math.min(MAX_POWER, (dist / MAX_PULL) * MAX_POWER);
    cue.vx = Math.cos(ang) * power;
    cue.vz = Math.sin(ang) * power;
    shots++;
    shotsEl.textContent = String(shots);
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
    fitRenderer3D(renderer3d, camera, wrap, 1.9);
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
window.ArcadeGames["pool"] = { start, stop };
