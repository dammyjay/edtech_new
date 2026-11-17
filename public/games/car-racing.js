// Arcade: Car Racing — real 3D (Three.js), chase camera behind a low-poly
// car, driving a ring circuit against an AI rival. No shadows/post-fx by
// design — keeps this fast on school Chromebooks/tablets, not just
// desktops. Loaded as a <script type="module"> (see views/student/arcade.ejs)
// so it can `import` Three.js straight from a CDN with no build step.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

const ACCEL = 0.0052, BRAKE = 0.0088, DRAG = 0.986, STEER_RATE = 0.0032;
const MAX_FWD = 0.16, MAX_REV = -0.083;
// Higher grip = velocity snaps toward the heading direction faster (less
// "slippery" drift) — tuned up from the original pass after feedback that
// the car was too hard to control.
const GRIP_BY_DIFFICULTY = { easy: 0.34, medium: 0.24, hard: 0.16 };
const AI_SPEED_BY_DIFFICULTY = { easy: 0.0055, medium: 0.0068, hard: 0.0078 };
const REQUIRED_LAPS = 2;
const TIME_LIMIT = 120;
const TRACK_OUTER = 26, TRACK_INNER = 14, TRACK_MID = (TRACK_OUTER + TRACK_INNER) / 2;

function angleDelta(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function makeCar(bodyColor) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.45, 2.2), new THREE.MeshLambertMaterial({ color: bodyColor }));
  body.position.y = 0.38;
  group.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.32, 1.0), new THREE.MeshLambertMaterial({ color: 0x1e293b }));
  cabin.position.set(0, 0.68, -0.15);
  group.add(cabin);
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.2, 0.2), new THREE.MeshLambertMaterial({ color: 0xf8fafc }));
  bumper.position.set(0, 0.3, 1.1);
  group.add(bumper);
  const wheelGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.24, 14);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
  [[-0.58, 0.26, 0.75], [0.58, 0.26, 0.75], [-0.58, 0.26, -0.75], [0.58, 0.26, -0.75]].forEach(([x, y, z]) => {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(x, y, z);
    group.add(wheel);
  });
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(1.5, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28 }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  group.add(shadow);
  return group;
}

function disposeObject3D(obj) {
  obj.traverse((node) => {
    if (node.geometry) node.geometry.dispose();
    if (node.material) {
      (Array.isArray(node.material) ? node.material : [node.material]).forEach((m) => m.dispose());
    }
  });
}

function start(container) {
  container.classList.add("arcade-game");
  container.style.setProperty("--game-accent", "#dc2626");
  const grip = GRIP_BY_DIFFICULTY[container.dataset.difficulty] || GRIP_BY_DIFFICULTY.medium;
  const aiSpeed = AI_SPEED_BY_DIFFICULTY[container.dataset.difficulty] || AI_SPEED_BY_DIFFICULTY.medium;

  container.innerHTML = `
    <p class="arcade-game-hint">Race 2 laps against the rival car. Stay on the asphalt — the grass slows you down.</p>
    <div class="arcade-scoreboard">
      <div class="arcade-score-pill"><span class="label">Lap</span><span class="value" id="crLap">1/${REQUIRED_LAPS}</span></div>
      <div class="arcade-score-pill"><span class="label">Time</span><span class="value" id="crTime">0</span></div>
      <div class="arcade-score-pill"><span class="label">Rival</span><span class="value" id="crRival">1/${REQUIRED_LAPS}</span></div>
    </div>
    <div class="arcade-canvas-wrap" style="width:100%; max-width:440px; margin:0 auto;">
      <div id="crWrap" style="width:100%; aspect-ratio:4/3; position:relative; background:#0b1020;"></div>
    </div>
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

  const wrap = container.querySelector("#crWrap");
  const lapEl = container.querySelector("#crLap");
  const timeEl = container.querySelector("#crTime");
  const rivalEl = container.querySelector("#crRival");

  let renderer3d = null, scene = null, camera = null, playerMesh = null, aiMesh = null;
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
    wrap.innerHTML = '<p style="padding:40px 16px; text-align:center; color:#9aa3c0;">3D racing needs WebGL, which this device/browser doesn\'t support. Try a different browser or device.</p>';
    container._cleanup = () => {};
    return;
  }

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8fd0ef);
  scene.fog = new THREE.Fog(0x8fd0ef, 35, 95);

  camera = new THREE.PerspectiveCamera(62, 4 / 3, 0.1, 400);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x3f6212, 1.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 0.75);
  sun.position.set(25, 40, 15);
  scene.add(sun);

  const ground = new THREE.Mesh(new THREE.CircleGeometry(70, 48), new THREE.MeshLambertMaterial({ color: 0x3f6212 }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const road = new THREE.Mesh(new THREE.RingGeometry(TRACK_INNER, TRACK_OUTER, 64), new THREE.MeshLambertMaterial({ color: 0x475569 }));
  road.rotation.x = -Math.PI / 2;
  road.position.y = 0.01;
  scene.add(road);

  const curbGroup = new THREE.Group();
  const CURB_SEGMENTS = 48;
  const curbRedMat = new THREE.MeshLambertMaterial({ color: 0xdc2626 });
  const curbWhiteMat = new THREE.MeshLambertMaterial({ color: 0xf8fafc });
  for (let i = 0; i < CURB_SEGMENTS; i++) {
    const angle = (i / CURB_SEGMENTS) * Math.PI * 2;
    const mat = i % 2 === 0 ? curbRedMat : curbWhiteMat;
    [TRACK_OUTER + 0.5, TRACK_INNER - 0.5].forEach((radius) => {
      const curb = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.3, 1.1), mat);
      curb.position.set(Math.cos(angle) * radius, 0.14, Math.sin(angle) * radius);
      curb.rotation.y = -angle;
      curbGroup.add(curb);
    });
  }
  scene.add(curbGroup);

  // start/finish line — a white stripe across the track at angle = PI
  const finishLine = new THREE.Mesh(
    new THREE.PlaneGeometry(TRACK_OUTER - TRACK_INNER, 1.4),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  finishLine.rotation.x = -Math.PI / 2;
  finishLine.position.set(Math.cos(Math.PI) * TRACK_MID, 0.02, Math.sin(Math.PI) * TRACK_MID);
  scene.add(finishLine);

  // a handful of trees scattered outside the track for scenery/depth cues
  const treeGroup = new THREE.Group();
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x78350f });
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x15803d });
  for (let i = 0; i < 18; i++) {
    const angle = (i / 18) * Math.PI * 2 + 0.3;
    const radius = TRACK_OUTER + 6 + (i % 3) * 4;
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 1.6, 6), trunkMat);
    trunk.position.y = 0.8;
    tree.add(trunk);
    const leaves = new THREE.Mesh(new THREE.ConeGeometry(1.1, 2.2, 7), leafMat);
    leaves.position.y = 2.2;
    tree.add(leaves);
    tree.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    treeGroup.add(tree);
  }
  scene.add(treeGroup);

  playerMesh = makeCar(0xfacc15);
  aiMesh = makeCar(0x1d4ed8);
  scene.add(playerMesh);
  scene.add(aiMesh);

  let car, ai, running = false, overlayEl = null, elapsed = 0;
  let prevAngle = 0, totalAngle = 0, aiTotalAngle = 0, rafId = null;
  const keys = { left: false, right: false, gas: false, brake: false };
  const camPos = new THREE.Vector3();
  const lookTarget = new THREE.Vector3();

  function initEntities() {
    const startAngle = Math.PI;
    const heading = startAngle + Math.PI / 2;
    car = {
      x: Math.cos(startAngle) * TRACK_MID, z: Math.sin(startAngle) * TRACK_MID,
      heading, speed: 0, vx: 0, vz: 0,
    };
    ai = { angle: startAngle + 0.4 };
    prevAngle = startAngle;
    totalAngle = 0; aiTotalAngle = 0;
    camPos.set(car.x, 3, car.z - 6);
  }

  function reset() {
    if (overlayEl) { overlayEl.remove(); overlayEl = null; }
    running = true; elapsed = 0;
    lapEl.textContent = `1/${REQUIRED_LAPS}`;
    rivalEl.textContent = `1/${REQUIRED_LAPS}`;
    timeEl.textContent = "0";
    initEntities();
    lastT = null; lastSecond = null;
    rafId = requestAnimationFrame(loop);
  }

  function step(dt) {
    const steps = dt / 16.67;
    const accel = keys.gas ? ACCEL : keys.brake ? -BRAKE : 0;
    car.speed += accel * steps;
    car.speed *= Math.pow(DRAG, steps);

    const distFromCenter = Math.hypot(car.x, car.z);
    const offTrack = distFromCenter < TRACK_INNER - 0.6 || distFromCenter > TRACK_OUTER + 0.6;
    const maxFwd = offTrack ? MAX_FWD * 0.45 : MAX_FWD;
    if (offTrack) car.speed *= Math.pow(0.9, steps);
    car.speed = Math.max(MAX_REV, Math.min(maxFwd, car.speed));

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

    const currentAngle = Math.atan2(car.z, car.x);
    totalAngle += angleDelta(currentAngle, prevAngle);
    prevAngle = currentAngle;

    ai.angle += aiSpeed * steps;
    aiTotalAngle += aiSpeed * steps;

    const playerLaps = Math.floor(Math.max(0, totalAngle) / (Math.PI * 2));
    const aiLaps = Math.floor(aiTotalAngle / (Math.PI * 2));
    const prevLapText = lapEl.textContent;
    const newLapText = `${Math.min(playerLaps + 1, REQUIRED_LAPS)}/${REQUIRED_LAPS}`;
    if (newLapText !== prevLapText && playerLaps > 0) ArcadeSound.play("lap");
    lapEl.textContent = newLapText;
    rivalEl.textContent = `${Math.min(aiLaps + 1, REQUIRED_LAPS)}/${REQUIRED_LAPS}`;

    if (playerLaps >= REQUIRED_LAPS) finish(true, aiLaps < REQUIRED_LAPS);
  }

  function updateScene() {
    playerMesh.position.set(car.x, 0, car.z);
    playerMesh.rotation.y = Math.PI / 2 - car.heading;

    const aiHeading = ai.angle + Math.PI / 2;
    aiMesh.position.set(Math.cos(ai.angle) * TRACK_MID, 0, Math.sin(ai.angle) * TRACK_MID);
    aiMesh.rotation.y = Math.PI / 2 - aiHeading;

    const forward = new THREE.Vector3(Math.cos(car.heading), 0, Math.sin(car.heading));
    const desiredCam = new THREE.Vector3(car.x, 0, car.z).sub(forward.clone().multiplyScalar(6.5)).add(new THREE.Vector3(0, 3, 0));
    camPos.lerp(desiredCam, 0.12);
    camera.position.copy(camPos);
    lookTarget.set(car.x, 0.6, car.z).add(forward.clone().multiplyScalar(5));
    camera.lookAt(lookTarget);
  }

  function finish(won, beatRival) {
    running = false;
    cancelAnimationFrame(rafId);
    const score = Math.max(50, 600 - Math.round(elapsed) * 4) + (won && beatRival ? 200 : 0);
    if (won) { ArcadeEngine.confetti(container); ArcadeSound.play(beatRival ? "win" : "score"); }
    else ArcadeSound.play("lose");
    overlayEl = ArcadeEngine.overlay(container, {
      emoji: "🏁", title: won ? (beatRival ? "You won the race!" : "Finished — rival beat you") : "Time's up",
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
window.ArcadeGames["car-racing"] = { start, stop };
