// Arcade: Car Parking — real 3D (Three.js), same car physics feel as
// car-racing.js (shares its tuned accel/brake/steer/grip constants and its
// car mesh via ./shared/car-mesh.js) across 3 levels of tighter parking
// spots. Camera stays level and simply follows the car's POSITION (not its
// heading) from a high angle — unlike car-racing's rotating chase cam,
// parking depends on judging left/right the same way regardless of which
// way the car is currently facing, so the view deliberately never turns
// with it. Loaded as a <script type="module"> (see views/student/arcade.ejs)
// so it can `import` Three.js and the shared car mesh with no build step.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { makeCar, disposeObject3D } from "./shared/car-mesh.js";

const ACCEL = 0.0052, BRAKE = 0.0088, DRAG = 0.986, STEER_RATE = 0.0032;
const MAX_FWD = 0.16, MAX_REV = -0.083;
// Same tuned values as car-racing.js — this is the same car model/scale, so
// the same grip feel applies; kids found lower values too hard to control.
const GRIP_BY_DIFFICULTY = { easy: 0.34, medium: 0.24, hard: 0.16 };
const TIME_LIMIT = 90;
const HOLD_FRAMES = 45;
const CAR_R = 0.85; // bump-detection radius — the car body is ~1.1x2.2
const LOT_W = 22, LOT_D = 16; // world-unit size of the parking lot ground

// Unchanged from the original 2D version — normalized (0-1) positions
// within the lot, same level designs/difficulty curve, just reinterpreted
// onto a 3D ground plane instead of a 2D canvas (see loadLevel below).
const LEVELS = [
  { zone: { x: 0.74, y: 0.4, w: 0.16, h: 0.22, heading: 0 }, obstacles: [{ x: 0.74, y: 0.1, w: 0.16, h: 0.14 }, { x: 0.74, y: 0.76, w: 0.16, h: 0.14 }] },
  { zone: { x: 0.08, y: 0.74, w: 0.22, h: 0.16, heading: Math.PI / 2 }, obstacles: [{ x: 0.35, y: 0.3, w: 0.14, h: 0.5 }, { x: 0.6, y: 0.1, w: 0.14, h: 0.3 }] },
  { zone: { x: 0.42, y: 0.1, w: 0.16, h: 0.18, heading: 0 }, obstacles: [{ x: 0.1, y: 0.4, w: 0.18, h: 0.14 }, { x: 0.65, y: 0.4, w: 0.18, h: 0.14 }, { x: 0.42, y: 0.64, w: 0.16, h: 0.14 }] },
];

// (nx, ny) normalized 0-1 -> world {x, z}, origin at the lot's center.
function worldPos(nx, ny) {
  return { x: (nx - 0.5) * LOT_W, z: (ny - 0.5) * LOT_D };
}

function start(container) {
  container.classList.add("arcade-game");
  container.style.setProperty("--game-accent", "#2563eb");
  const grip = GRIP_BY_DIFFICULTY[container.dataset.difficulty] || GRIP_BY_DIFFICULTY.medium;

  container.innerHTML = `
    <p class="arcade-game-hint">Drive into the highlighted spot, lined up straight, and hold still. Watch the obstacles!</p>
    <div class="arcade-scoreboard">
      <div class="arcade-score-pill"><span class="label">Level</span><span class="value" id="cpLevel">1/${LEVELS.length}</span></div>
      <div class="arcade-score-pill"><span class="label">Time</span><span class="value" id="cpTime">${TIME_LIMIT}</span></div>
      <div class="arcade-score-pill"><span class="label">Bumps</span><span class="value" id="cpBumps">0</span></div>
    </div>
    <div class="arcade-canvas-wrap" style="width:100%; max-width:440px; margin:0 auto; position:relative;">
      <div id="cpWrap" style="width:100%; aspect-ratio:4/3; position:relative; background:#0b1020;"></div>
      <p id="cpHoldMsg" style="position:absolute; top:10px; left:0; right:0; text-align:center; color:#22c55e; font-weight:700; font-size:15px; text-shadow:0 1px 3px rgba(0,0,0,0.6); margin:0; opacity:0; transition:opacity .15s;">Hold still…</p>
    </div>
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
      .cp-controls { display:flex; justify-content:space-between; max-width:440px; margin:16px auto 0; padding:0 10px; }
      .cp-pad { display:flex; gap:10px; }
      .cp-controls .arcade-dpad-btn { width:56px; height:56px; font-size:20px; }
    </style>
  `;

  const wrap = container.querySelector("#cpWrap");
  const levelEl = container.querySelector("#cpLevel");
  const timeEl = container.querySelector("#cpTime");
  const bumpsEl = container.querySelector("#cpBumps");
  const holdMsgEl = container.querySelector("#cpHoldMsg");

  let renderer3d = null, scene = null, camera = null, carMesh = null;
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
    wrap.innerHTML = '<p style="padding:40px 16px; text-align:center; color:#9aa3c0;">3D parking needs WebGL, which this device/browser doesn\'t support. Try a different browser or device.</p>';
    container._cleanup = () => {};
    return;
  }

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1020);
  scene.fog = new THREE.Fog(0x0b1020, 20, 55);

  camera = new THREE.PerspectiveCamera(50, 4 / 3, 0.1, 200);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x1e293b, 1.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 0.7);
  sun.position.set(10, 20, 8);
  scene.add(sun);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(LOT_W, LOT_D), new THREE.MeshLambertMaterial({ color: 0x334155 }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // Faint lane-marking stripes across the lot — purely decorative, same
  // spirit as the original canvas version's vertical light stripes.
  const stripeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.06 });
  for (let i = 1; i < 8; i++) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.08, LOT_D), stripeMat);
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.set(-LOT_W / 2 + (i / 8) * LOT_W, 0.005, 0);
    scene.add(stripe);
  }

  // Perimeter curb — marks the lot boundary the car is clamped to, same
  // red/white curb look as car-racing's track edge.
  const curbGroup = new THREE.Group();
  const curbRedMat = new THREE.MeshLambertMaterial({ color: 0xdc2626 });
  const curbWhiteMat = new THREE.MeshLambertMaterial({ color: 0xf8fafc });
  let curbToggle = 0;
  const CURB_STEP = 1.2;
  for (let x = -LOT_W / 2; x <= LOT_W / 2; x += CURB_STEP) {
    [-LOT_D / 2, LOT_D / 2].forEach((z) => {
      const curb = new THREE.Mesh(new THREE.BoxGeometry(CURB_STEP, 0.3, 0.3), curbToggle % 2 === 0 ? curbRedMat : curbWhiteMat);
      curb.position.set(x, 0.14, z);
      curbGroup.add(curb);
    });
    curbToggle++;
  }
  for (let z = -LOT_D / 2; z <= LOT_D / 2; z += CURB_STEP) {
    [-LOT_W / 2, LOT_W / 2].forEach((x) => {
      const curb = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, CURB_STEP), curbToggle % 2 === 0 ? curbRedMat : curbWhiteMat);
      curb.position.set(x, 0.14, z);
      curbGroup.add(curb);
    });
    curbToggle++;
  }
  scene.add(curbGroup);

  const obstacleMat = new THREE.MeshLambertMaterial({ color: 0x7c2d12 });
  let obstacleMeshes = [];
  let zoneMesh = null, zoneArrow = null;

  carMesh = makeCar(0xef4444);
  scene.add(carMesh);

  let car, zone, obstacles, levelIndex = 0, bumps = 0, timeLeft = TIME_LIMIT;
  let holdFrames = 0, running = false, overlayEl = null, rafId = null, bumpCooldown = 0;
  const keys = { left: false, right: false, gas: false, brake: false };
  const camPos = new THREE.Vector3();

  function clearLevelMeshes() {
    obstacleMeshes.forEach((m) => { scene.remove(m); disposeObject3D(m); });
    obstacleMeshes = [];
    if (zoneMesh) { scene.remove(zoneMesh); disposeObject3D(zoneMesh); zoneMesh = null; }
    if (zoneArrow) { scene.remove(zoneArrow); disposeObject3D(zoneArrow); zoneArrow = null; }
  }

  function loadLevel() {
    clearLevelMeshes();
    const L = LEVELS[levelIndex];
    const startP = worldPos(0.12, 0.12);
    car = { x: startP.x, z: startP.z, heading: 0.3, speed: 0, vx: 0, vz: 0 };

    const zMin = worldPos(L.zone.x, L.zone.y);
    const zW = L.zone.w * LOT_W, zD = L.zone.h * LOT_D;
    zone = { minX: zMin.x, maxX: zMin.x + zW, minZ: zMin.z, maxZ: zMin.z + zD, heading: L.zone.heading };

    obstacles = L.obstacles.map((o) => {
      const p = worldPos(o.x, o.y);
      const ow = o.w * LOT_W, od = o.h * LOT_D;
      return { minX: p.x, maxX: p.x + ow, minZ: p.z, maxZ: p.z + od, cx: p.x + ow / 2, cz: p.z + od / 2, w: ow, d: od };
    });

    obstacles.forEach((o) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(o.w, 0.55, o.d), obstacleMat);
      mesh.position.set(o.cx, 0.275, o.cz);
      scene.add(mesh);
      obstacleMeshes.push(mesh);
    });

    const zoneW = zone.maxX - zone.minX, zoneD = zone.maxZ - zone.minZ;
    const zoneCx = (zone.minX + zone.maxX) / 2, zoneCz = (zone.minZ + zone.maxZ) / 2;
    zoneMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(zoneW, zoneD),
      new THREE.MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.35, side: THREE.DoubleSide })
    );
    zoneMesh.rotation.x = -Math.PI / 2;
    zoneMesh.position.set(zoneCx, 0.02, zoneCz);
    scene.add(zoneMesh);

    // A simple flat arrow showing the heading the car needs to line up
    // with — same purpose as the original's dashed-arrow overlay.
    const arrowLen = Math.min(zoneW, zoneD) * 0.4;
    const arrowShape = new THREE.Shape();
    arrowShape.moveTo(-arrowLen, -0.12);
    arrowShape.lineTo(arrowLen * 0.5, -0.12);
    arrowShape.lineTo(arrowLen * 0.5, -0.35);
    arrowShape.lineTo(arrowLen, 0);
    arrowShape.lineTo(arrowLen * 0.5, 0.35);
    arrowShape.lineTo(arrowLen * 0.5, 0.12);
    arrowShape.lineTo(-arrowLen, 0.12);
    arrowShape.closePath();
    zoneArrow = new THREE.Mesh(new THREE.ShapeGeometry(arrowShape), new THREE.MeshBasicMaterial({ color: 0x4c3802, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
    zoneArrow.rotation.x = -Math.PI / 2;
    zoneArrow.rotation.z = zone.heading;
    zoneArrow.position.set(zoneCx, 0.03, zoneCz);
    scene.add(zoneArrow);

    holdFrames = 0;
    holdMsgEl.style.opacity = "0";
    levelEl.textContent = `${levelIndex + 1}/${LEVELS.length}`;
    camPos.set(car.x, 11, car.z + 4.5);
  }

  function reset() {
    if (overlayEl) { overlayEl.remove(); overlayEl = null; }
    levelIndex = 0; bumps = 0; timeLeft = TIME_LIMIT; running = true;
    bumpsEl.textContent = "0"; timeEl.textContent = String(TIME_LIMIT);
    loadLevel();
    lastT = null; lastSecond = null;
    rafId = requestAnimationFrame(loop);
  }

  function step(dt) {
    const steps = dt / 16.67;
    if (bumpCooldown > 0) bumpCooldown -= steps;
    const accel = keys.gas ? ACCEL : keys.brake ? -BRAKE : 0;
    car.speed += accel * steps;
    car.speed *= Math.pow(DRAG, steps);
    car.speed = Math.max(MAX_REV, Math.min(MAX_FWD, car.speed));

    const steerDir = (keys.left ? -1 : 0) + (keys.right ? 1 : 0);
    const speedFactor = Math.max(0.45, Math.min(1, Math.abs(car.speed) / MAX_FWD));
    const revSign = car.speed < 0 ? -1 : 1;
    car.heading += STEER_RATE * steps * 16.67 * steerDir * speedFactor * revSign;

    const targetVx = Math.cos(car.heading) * car.speed;
    const targetVz = Math.sin(car.heading) * car.speed;
    car.vx += (targetVx - car.vx) * grip * steps;
    car.vz += (targetVz - car.vz) * grip * steps;
    car.x += car.vx * steps;
    car.z += car.vz * steps;

    const halfW = LOT_W / 2 - CAR_R, halfD = LOT_D / 2 - CAR_R;
    if (car.x < -halfW) { car.x = -halfW; car.speed = 0; }
    if (car.x > halfW) { car.x = halfW; car.speed = 0; }
    if (car.z < -halfD) { car.z = -halfD; car.speed = 0; }
    if (car.z > halfD) { car.z = halfD; car.speed = 0; }

    obstacles.forEach((o) => {
      const closestX = Math.max(o.minX, Math.min(car.x, o.maxX));
      const closestZ = Math.max(o.minZ, Math.min(car.z, o.maxZ));
      const dx = car.x - closestX, dz = car.z - closestZ;
      const dist = Math.hypot(dx, dz);
      if (dist < CAR_R) {
        const overlap = CAR_R - (dist || 0.001);
        const nx = dist ? dx / dist : 1, nz = dist ? dz / dist : 0;
        car.x += nx * overlap; car.z += nz * overlap;
        if (Math.abs(car.speed) > 0.015 && bumpCooldown <= 0) {
          bumps++;
          bumpsEl.textContent = String(bumps);
          ArcadeSound.play("bump");
          ArcadeEngine.vibrate(18);
          bumpCooldown = 20;
        }
        car.speed *= -0.3;
        car.vx *= 0.2; car.vz *= 0.2;
      }
    });

    const inZoneX = car.x > zone.minX && car.x < zone.maxX;
    const inZoneZ = car.z > zone.minZ && car.z < zone.maxZ;
    let headingDiff = Math.abs(((car.heading - zone.heading + Math.PI) % (Math.PI * 2)) - Math.PI);
    headingDiff = Math.min(headingDiff, Math.PI - headingDiff);
    const aligned = headingDiff < 0.45;
    const slow = Math.abs(car.speed) < 0.015;
    if (inZoneX && inZoneZ && aligned && slow) {
      holdFrames++;
      holdMsgEl.style.opacity = "1";
      if (holdFrames >= HOLD_FRAMES) levelComplete();
    } else {
      holdFrames = 0;
      holdMsgEl.style.opacity = "0";
    }
  }

  function updateScene() {
    carMesh.position.set(car.x, 0, car.z);
    carMesh.rotation.y = Math.PI / 2 - car.heading;

    // Camera position follows the car but, unlike car-racing's chase cam,
    // never rotates with its heading — parking depends on left/right
    // staying the same regardless of which way the car is facing.
    const desiredCam = new THREE.Vector3(car.x, 11, car.z + 4.5);
    camPos.lerp(desiredCam, 0.1);
    camera.position.copy(camPos);
    camera.lookAt(car.x, 0, car.z);
  }

  function levelComplete() {
    ArcadeEngine.confetti(container, 14);
    ArcadeSound.play("score");
    ArcadeEngine.vibrate(20);
    levelIndex++;
    if (levelIndex >= LEVELS.length) {
      finish(true);
    } else {
      loadLevel();
    }
  }

  function finish(won) {
    running = false;
    cancelAnimationFrame(rafId);
    const score = Math.max(0, levelIndex * 150 + Math.round(timeLeft) * 2 - bumps * 15);
    if (won) { ArcadeEngine.confetti(container); ArcadeSound.play("win"); } else ArcadeSound.play("lose");
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
    updateScene();
    renderer3d.render(scene, camera);
    rafId = requestAnimationFrame(loop);
  }

  function fitRenderer() {
    const w = wrap.clientWidth || 1;
    const h = wrap.clientHeight || Math.round(w * 0.75);
    renderer3d.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
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

  const removeResize = ArcadeEngine.onResize(fitRenderer);

  container._cleanup = () => {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("keyup", onKeyUp);
    btnCleanups.forEach((fn) => fn());
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
window.ArcadeGames["car-parking"] = { start, stop };
