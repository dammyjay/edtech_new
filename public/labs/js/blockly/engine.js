window.sprites = [];

window.currentSprite = null;

// Which sprite's code is executing right now — distinct from
// currentSprite (which sprite is open in the editor). Every generated
// script runs with this set to the sprite it belongs to (see runCode /
// compileEvents in blocklyLab.js), so a block like moveSprite() always
// moves the right sprite instead of one hardcoded global one.
window.currentRuntimeSprite = null;

function getRuntimeSprite() {
  const sprite = window.currentRuntimeSprite || window.currentSprite;
  if (!sprite) {
    console.warn("A block ran with no active sprite context.");
  }
  return sprite;
}

window.backgrounds = [];

window.penDownState = false;

window.penColor = "#000000";

window.penSize = 2;

window.penCanvas = null;

window.penCtx = null;


// =========================
// SPRITE RENDER
// =========================

// Pushes one sprite's x/y/rotation/visible state onto its own DOM
// element. Every mutation function below calls this with the sprite it
// just changed, instead of the old single hardcoded #sprite element.
window.renderSprite = function (sprite) {
  sprite = sprite || getRuntimeSprite();
  if (!sprite || !sprite.element) return;

  sprite.element.style.left = sprite.x + "px";
  sprite.element.style.top = sprite.y + "px";
  sprite.element.style.transform = `rotate(${sprite.rotation}deg)`;
  sprite.element.style.display = sprite.visible ? "block" : "none";
};

// Back-compat wrapper for any lingering direct callers.
window.updateSprite = function () {
  renderSprite(getRuntimeSprite());
};

// =========================
// EVENTS
// =========================

window.keyEvents = {};

// Registered at "compile" time (see compileEvents in blocklyLab.js),
// which sets currentRuntimeSprite to the owning sprite before running
// each sprite's event-setup code — so the {sprite, callback} pair
// captured here always remembers which sprite this handler belongs to.
window.registerKeyEvent = function (key, callback) {
  if (!window.keyEvents[key]) {
    window.keyEvents[key] = [];
  }

  window.keyEvents[key].push({ sprite: window.currentRuntimeSprite, callback });
};

document.addEventListener("keydown", async (e) => {
  const list = window.keyEvents[e.key];

  if (!list) return;

  for (const { sprite, callback } of list) {
    window.currentRuntimeSprite = sprite;
    await callback();
  }

  window.currentRuntimeSprite = null;
});

// compileEvents() re-registers every sprite's event blocks on every
// workspace change — remove each sprite's previous click handler first
// so they don't stack up into duplicates over repeated edits.
window.registerSpriteClick = function (callback) {
  const sprite = window.currentRuntimeSprite;
  if (!sprite || !sprite.element) return;

  if (sprite._clickHandler) {
    sprite.element.removeEventListener("click", sprite._clickHandler);
  }

  sprite._clickHandler = async () => {
    window.currentRuntimeSprite = sprite;
    await callback();
    window.currentRuntimeSprite = null;
  };

  sprite.element.addEventListener("click", sprite._clickHandler);
};

window.broadcastListeners = {};

window.broadcast = async function (message) {
  const listeners = window.broadcastListeners[message];

  if (!listeners) return;

  for (const { sprite, callback } of listeners) {
    window.currentRuntimeSprite = sprite;
    await callback();
  }

  window.currentRuntimeSprite = null;
};

window.registerBroadcast = function (message, callback) {
  if (!window.broadcastListeners[message]) {
    window.broadcastListeners[message] = [];
  }

  window.broadcastListeners[message].push({ sprite: window.currentRuntimeSprite, callback });
};

window.initPen = function () {
  const canvas = document.getElementById("penCanvas");

  const stage = document.getElementById("stage");

  if (!canvas || !stage) return;

  canvas.width = stage.clientWidth;

  canvas.height = stage.clientHeight;

  window.penCanvas = canvas;

  window.penCtx = canvas.getContext("2d");

  penCtx.lineCap = "round";
  penCtx.lineJoin = "round";
};

window.drawPenLine = function (startX, startY, endX, endY) {
  if (!penDownState) return;

  if (!penCtx) return;

  penCtx.beginPath();

  penCtx.moveTo(startX, startY);

  penCtx.lineTo(endX, endY);

  penCtx.strokeStyle = penColor;

  penCtx.lineWidth = penSize;

  penCtx.stroke();
};

window.penDownFn = function () {
  penDownState = true;
};

window.penUpFn = function () {
  penDownState = false;
};

window.clearPen = function () {
  if (!penCtx) return;

  penCtx.clearRect(0, 0, penCanvas.width, penCanvas.height);
};

window.setPenColor = function (color) {
  penColor = color;
};

window.setPenSize = function (size) {
  penSize = Number(size);
};

window.changePenSizeBy = function (value) {
  penSize += Number(value);

  if (penSize < 1) {
    penSize = 1;
  }
};
// =========================
// MOTION
// =========================

window.getSpriteCenter = function (sprite) {
  sprite = sprite || getRuntimeSprite();
  if (!sprite || !sprite.element) return { x: 0, y: 0 };

  const rect = sprite.element.getBoundingClientRect();
  const stageRect = document.getElementById("stage").getBoundingClientRect();

  return {
    x: rect.left - stageRect.left + rect.width / 2,
    y: rect.top - stageRect.top + rect.height / 2,
  };
};

window.moveSprite = function (steps) {
  const sprite = getRuntimeSprite();
  if (!sprite) return;

  const start = getSpriteCenter(sprite);

  const distance = Number(steps) * (sprite.speed || 1);

  sprite.x += Math.cos((sprite.rotation * Math.PI) / 180) * distance;
  sprite.y += Math.sin((sprite.rotation * Math.PI) / 180) * distance;

  renderSprite(sprite);

  const end = getSpriteCenter(sprite);

  drawPenLine(start.x, start.y, end.x, end.y);
};

window.goToPosition = function (x, y) {
  const sprite = getRuntimeSprite();
  if (!sprite) return;

  const start = getSpriteCenter(sprite);

  sprite.x = Number(x);
  sprite.y = Number(y);

  renderSprite(sprite);

  const end = getSpriteCenter(sprite);

  drawPenLine(start.x, start.y, end.x, end.y);
};

window.turnSprite = function (angle) {
  const sprite = getRuntimeSprite();
  if (!sprite) return;

  sprite.rotation += Number(angle);

  renderSprite(sprite);
};

window.pointDirection = function (direction) {
  const sprite = getRuntimeSprite();
  if (!sprite) return;

  sprite.rotation = Number(direction);

  renderSprite(sprite);
};


// =========================
// SPEED
// =========================

window.setSpeed = function (speed) {
  const sprite = getRuntimeSprite();
  if (!sprite) return;

  sprite.speed = Math.max(1, Number(speed));
};

// =========================
// LOOKS
// =========================

window.sayText = function (text) {
  const sprite = getRuntimeSprite();

  let bubble = document.getElementById("speechBubble");

  if (!bubble) {
    bubble = document.createElement("div");
    bubble.id = "speechBubble";
    bubble.className = "speech-bubble";
    document.getElementById("stage").appendChild(bubble);
  }

  bubble.innerText = text;
  bubble.style.display = "block";

  // Show scrollbar only for long messages
  if (text.length > 100) {
    bubble.style.maxHeight = "100px";
    bubble.style.overflowY = "auto";
  } else {
    bubble.style.maxHeight = "none";
    bubble.style.overflowY = "hidden";
  }

  requestAnimationFrame(() => {
    if (!sprite) return;

    const bubbleHeight = bubble.offsetHeight;

    bubble.style.left = sprite.x + 60 + "px";
    bubble.style.top = sprite.y - bubbleHeight - 10 + "px";
  });
};


window.sayForSeconds = async function (text, seconds) {
  sayText(text);

  await wait(seconds);

  const bubble = document.getElementById("speechBubble");

  if (bubble) {
    bubble.style.display = "none";
  }
};

// Backdrop is a stage-level concept, shared by every sprite — not
// retargeted per-sprite.
window.setBackgroundImage = function (image) {
  const stage = document.getElementById("stage");

  stage.style.backgroundImage = `url('/labs/images/backgrounds/${image}')`;

  stage.style.backgroundSize = "cover";

  stage.style.backgroundPosition = "center";
};

window.currentBackground = 0;

window.nextBackground = function () {
  if (!window.backgrounds || window.backgrounds.length === 0) {
    return;
  }

  currentBackground++;

  if (currentBackground >= backgrounds.length) {
    currentBackground = 0;
  }

  setBackgroundImage(backgrounds[currentBackground]);
};

window.previousBackground = function () {
  if (!window.backgrounds.length) return;

  currentBackground--;

  if (currentBackground < 0) {
    currentBackground = window.backgrounds.length - 1;
  }

  setBackgroundImage(window.backgrounds[currentBackground]);
};

window.randomBackground = function () {
  if (!backgrounds || backgrounds.length === 0) {
    return;
  }

  const random = Math.floor(Math.random() * backgrounds.length);

  setBackgroundImage(backgrounds[random]);
};

window.changeBackground = function (color) {

  const stage =
    document.getElementById("stage");

  if (stage) {
    stage.style.background = color;
  }
};

window.changeImage = function (color) {
  const stage = document.getElementById("stage");

  if (stage) {
    stage.style.background = color;
  }
};

window.addSprite = function (spriteName, x, y) {
  const stage = document.getElementById("stage");

  if (!stage) return;

  const sprite = document.createElement("img");

  sprite.src = `/labs/images/sprites/${spriteName}.png`;

  sprite.classList.add("extra-sprite");

  sprite.style.position = "absolute";
  sprite.style.left = x + "px";
  sprite.style.top = y + "px";

  sprite.style.width = "50px";
  sprite.style.height = "50px";

  stage.appendChild(sprite);

  const spriteData = {
    id: Date.now(),
    element: sprite,
    name: spriteName,
    x: Number(x),
    y: Number(y),
    width: 120,
    height: 120,
    rotation: 0,
    visible: true,
    speed: 1,
    workspaceXml: "",
  };

  window.sprites.push(spriteData);

  let dragging = false;

  sprite.addEventListener("mousedown", () => {
    selectSpriteById(spriteData.id);

    dragging = true;
  });

  document.addEventListener("mouseup", () => {
    dragging = false;
  });

  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;

    const rect = stage.getBoundingClientRect();

    spriteData.x = e.clientX - rect.left;

    spriteData.y = e.clientY - rect.top;

    sprite.style.left = spriteData.x + "px";

    sprite.style.top = spriteData.y + "px";

    loadSpriteProperties(spriteData);
  });


  sprite.addEventListener("click", () => {
    selectSpriteById(spriteData.id);
  });
};


// The one live sprite-selection path (wired to sprite-card clicks in
// blocklyLab.js's renderSpriteList). Each sprite owns its own Blockly
// blocks — only one sprite's blocks are ever shown in the shared
// workspace at a time, so switching sprites means: save whatever's
// currently in the visible workspace back onto the sprite we're leaving,
// then load the newly-selected sprite's own saved blocks into it.
function selectSpriteById(id) {
  document
    .querySelectorAll(".sprite-card")
    .forEach((card) => card.classList.remove("selected"));

  const sprite = window.sprites.find((s) => s.id === id);

  if (!sprite) return;

  if (window.currentSprite && typeof workspace !== "undefined" && workspace) {
    window.currentSprite.workspaceXml = Blockly.Xml.domToText(
      Blockly.Xml.workspaceToDom(workspace)
    );
  }

  window.currentSprite = sprite;

  const card = document.querySelector(`.sprite-card[data-sprite-id="${id}"]`);

  if (card) {
    card.classList.add("selected");
  }

  loadSpriteProperties(sprite);

  if (typeof workspace !== "undefined" && workspace) {
    workspace.clear();

    if (sprite.workspaceXml) {
      const xml = Blockly.utils.xml.textToDom(sprite.workspaceXml);
      Blockly.Xml.domToWorkspace(xml, workspace);
    }
  }
}

function loadSpriteProperties(sprite) {
  document.getElementById("spriteName").value = sprite.name;

  document.getElementById("spriteX").value = sprite.x;

  document.getElementById("spriteY").value = sprite.y;

  document.getElementById("spriteWidth").value = sprite.width || 120;

  document.getElementById("spriteHeight").value = sprite.height || 120;

  document.getElementById("spriteRotation").value = sprite.rotation || 0;

  document.getElementById("spriteVisible").checked = sprite.visible !== false;
}

function updateSelectedSprite() {
  if (!currentSprite) return;

  currentSprite.x = Number(document.getElementById("spriteX").value);

  currentSprite.y = Number(document.getElementById("spriteY").value);

  currentSprite.width = Number(document.getElementById("spriteWidth").value);

  currentSprite.height = Number(document.getElementById("spriteHeight").value);

  currentSprite.rotation = Number(
    document.getElementById("spriteRotation").value,
  );

  currentSprite.visible = document.getElementById("spriteVisible").checked;

  currentSprite.element.style.left = currentSprite.x + "px";

  currentSprite.element.style.top = currentSprite.y + "px";

  currentSprite.element.style.width = currentSprite.width + "px";

  currentSprite.element.style.height = currentSprite.height + "px";

  currentSprite.element.style.transform = `rotate(${currentSprite.rotation}deg)`;

  currentSprite.element.style.display = currentSprite.visible
    ? "block"
    : "none";
}

window.moveSpriteTo = function (spriteId, x, y) {
  const sprite = window.sprites.find((s) => s.id == spriteId);

  if (!sprite) return;

  sprite.x = Number(x);
  sprite.y = Number(y);

  sprite.element.style.left = sprite.x + "px";

  sprite.element.style.top = sprite.y + "px";
};

window.moveAddedSprite = function (spriteId, steps) {
  const sprite = window.sprites[spriteId];

  if (!sprite) return;

  sprite.x += Number(steps);

  sprite.element.style.left = sprite.x + "px";
};

window.getSprite = function (name) {
  return window.sprites.find((s) => s.name === name);
};

window.moveSpriteNamed = function (name, x, y) {
  const sprite = getSprite(name);

  if (!sprite) return;

  sprite.x = Number(x);
  sprite.y = Number(y);

  sprite.element.style.left = sprite.x + "px";

  sprite.element.style.top = sprite.y + "px";
};

window.setSprite = function (spriteName) {
  const sprite = getRuntimeSprite();
  if (!sprite || !sprite.element) return;

  sprite.name = spriteName;
  sprite.element.src = `/labs/images/sprites/${spriteName}.png`;
};

window.changeX = function (value) {
  const sprite = getRuntimeSprite();
  if (!sprite) return;

  const start = getSpriteCenter(sprite);

  sprite.x += Number(value);

  renderSprite(sprite);

  const end = getSpriteCenter(sprite);

  drawPenLine(start.x, start.y, end.x, end.y);
};

window.changeY = function (value) {
  const sprite = getRuntimeSprite();
  if (!sprite) return;

  const start = getSpriteCenter(sprite);

  sprite.y += Number(value);

  renderSprite(sprite);

  const end = getSpriteCenter(sprite);

  drawPenLine(start.x, start.y, end.x, end.y);
};


window.glideTo = async function (sec, x, y) {
  const sprite = getRuntimeSprite();
  if (!sprite) return;

  const startX = sprite.x;
  const startY = sprite.y;

  const steps = 60 * sec;

  let prev = getSpriteCenter(sprite);

  for (let i = 0; i < steps; i++) {
    sprite.x = startX + ((x - startX) * i) / steps;

    sprite.y = startY + ((y - startY) * i) / steps;

    renderSprite(sprite);

    const current = getSpriteCenter(sprite);

    drawPenLine(prev.x, prev.y, current.x, current.y);

    prev = current;

    await wait(1 / 60);
  }

  sprite.x = Number(x);
  sprite.y = Number(y);
  renderSprite(sprite);
};

window.hideSprite = function () {
  const sprite = getRuntimeSprite();
  if (!sprite) return;

  sprite.visible = false;

  renderSprite(sprite);
};

window.showSprite = function () {
  const sprite = getRuntimeSprite();
  if (!sprite) return;

  sprite.visible = true;

  renderSprite(sprite);
};

window.setSpriteSize = function (size) {
  const sprite = getRuntimeSprite();
  if (!sprite || !sprite.element) return;

  sprite.width = Number(size);
  sprite.height = Number(size);

  sprite.element.style.width = sprite.width + "px";
  sprite.element.style.height = sprite.height + "px";
};

window.changeSpriteSizeBy = function (value) {
  const sprite = getRuntimeSprite();
  if (!sprite || !sprite.element) return;

  sprite.width = (sprite.width || sprite.element.offsetWidth) + Number(value);
  sprite.height = (sprite.height || sprite.element.offsetHeight) + Number(value);

  sprite.element.style.width = sprite.width + "px";
  sprite.element.style.height = sprite.height + "px";
};

window.stopRequested = false;

window.stopAllScripts = function () {
  stopRequested = true;
};

window.wait = function (seconds) {
  return new Promise((resolve, reject) => {
    const start = Date.now();

    const timer = setInterval(() => {
      if (stopRequested) {
        clearInterval(timer);

        reject(new Error("Program stopped"));

        return;
      }

      if (Date.now() - start >= seconds * 1000) {
        clearInterval(timer);

        resolve();
      }
    }, 20);
  });
};

window.checkStop = function () {
  if (stopRequested) {
    throw new Error("Program stopped");
  }
};

window.touchingEdge = function () {
  const sprite = getRuntimeSprite();
  if (!sprite) return false;

  const stage = document.getElementById("stage");
  const size = sprite.width || 50;

  return (
    sprite.x <= 0 ||
    sprite.y <= 0 ||
    sprite.x >= stage.clientWidth - size ||
    sprite.y >= stage.clientHeight - size
  );
};


window.touchingSprite = function () {
  const sprite = getRuntimeSprite();
  if (!sprite || !sprite.element) return false;

  const a = sprite.element.getBoundingClientRect();

  return window.sprites.some((other) => {
    if (other === sprite || !other.element) return false;

    const b = other.element.getBoundingClientRect();

    return !(
      a.right < b.left ||
      a.left > b.right ||
      a.bottom < b.top ||
      a.top > b.bottom
    );
  });
};

window.touchingSpriteNamed = function (name) {
  const sprite = getRuntimeSprite();
  const other = getSprite(name);

  if (!sprite || !other || !sprite.element || !other.element) return false;

  const a = sprite.element.getBoundingClientRect();
  const b = other.element.getBoundingClientRect();

  return !(
    a.right < b.left ||
    a.left > b.right ||
    a.bottom < b.top ||
    a.top > b.bottom
  );
};

window.mouseX = 0;
window.mouseY = 0;

document.addEventListener("mousemove", (e) => {
  const stage = document.getElementById("stage");

  const rect = stage.getBoundingClientRect();

  mouseX = e.clientX - rect.left;

  mouseY = e.clientY - rect.top;
});

window.touchingMouse = function () {
  const sprite = getRuntimeSprite();
  if (!sprite) return false;

  const size = sprite.width || 100;

  return (
    mouseX >= sprite.x &&
    mouseX <= sprite.x + size &&
    mouseY >= sprite.y &&
    mouseY <= sprite.y + size
  );
};

window.pressedKeys = {};

document.addEventListener("keydown", (e) => {
  pressedKeys[e.key] = true;
});

document.addEventListener("keyup", (e) => {
  pressedKeys[e.key] = false;
});

window.isKeyPressed = function (key) {
  return !!pressedKeys[key];
};

window.userAnswer = "";

window.askAndWait = function (question) {
  return new Promise((resolve) => {
    const askBox = document.getElementById("askBox");

    const askQuestion = document.getElementById("askQuestion");

    const askInput = document.getElementById("askInput");

    const askSubmit = document.getElementById("askSubmit");

    askQuestion.innerText = question;

    askInput.value = "";

    askBox.style.display = "block";

    askInput.focus();

    const finish = () => {
      userAnswer = askInput.value;

      askBox.style.display = "none";

      askSubmit.removeEventListener("click", finish);

      askInput.removeEventListener("keydown", enterHandler);

      resolve();
    };

    const enterHandler = (e) => {
      if (e.key === "Enter") {
        finish();
      }
    };

    askSubmit.addEventListener("click", finish);

    askInput.addEventListener("keydown", enterHandler);
  });
};

window.mouseDown = false;

document.addEventListener("mousedown", () => (mouseDown = true));

document.addEventListener("mouseup", () => (mouseDown = false));

window.lastKeyPressed = "";

document.addEventListener("keydown", (e) => {
  lastKeyPressed = e.key;
});

window.anyKeyPressed = function () {
  return Object.values(pressedKeys).some(Boolean);
};

window.timerStart = Date.now();

window.getTimer = function () {
  return (Date.now() - timerStart) / 1000;
};

window.resetTimer = function () {
  timerStart = Date.now();
};

// =========================
// CONSOLE
// =========================

window.monitorInterval = null;

window.setMonitorVisible = function (show) {
  const monitor = document.getElementById("xMonitor");

  if (!monitor) return;

  monitor.style.display = show ? "block" : "none";

  if (show && !window.monitorInterval) {
    window.monitorInterval = setInterval(() => {
      const sprite = window.currentSprite;
      monitor.innerHTML = `X: ${sprite ? Math.round(sprite.x) : 0}`;
    }, 50);
  }
};

window.logMessage = function (message) {

  const consoleBox =
    document.getElementById("console");

  if (!consoleBox) return;

  consoleBox.innerHTML +=
    `${message}<br>`;

  consoleBox.scrollTop =
    consoleBox.scrollHeight;
};

window.clearConsole = function () {

  const consoleBox =
    document.getElementById("console");

  if (consoleBox) {
    consoleBox.innerHTML = "";
  }
};

// =========================
// STAGE RESET
// =========================

// Resets every sprite's rotation/visibility (cheap, safe) and clears the
// console/backdrop. Position isn't reset — there's no separate "spawn
// position" tracked apart from current position yet, so resetting it
// would mean snapping sprites to an arbitrary spot rather than restoring
// anything real.
window.resetStage = function () {
  window.sprites.forEach((sprite) => {
    sprite.rotation = 0;
    sprite.visible = true;
    renderSprite(sprite);
  });

  const stage =
    document.getElementById("stage");

  if (stage) {
    stage.style.background = "#ffffff";
  }

  clearConsole();
};

// =========================
// INITIALIZE
// =========================

window.addEventListener("load", () => {

document
  .getElementById("spriteX")
  .addEventListener("input", updateSelectedSprite);

document
  .getElementById("spriteY")
  .addEventListener("input", updateSelectedSprite);

document
  .getElementById("spriteWidth")
  .addEventListener("input", updateSelectedSprite);

document
  .getElementById("spriteHeight")
  .addEventListener("input", updateSelectedSprite);

document
  .getElementById("spriteRotation")
  .addEventListener("input", updateSelectedSprite);

document
  .getElementById("spriteVisible")
  .addEventListener("change", updateSelectedSprite);

   initPen();
});

// compileEvents/clearEvents moved to blocklyLab.js, where they now
// iterate every sprite's own stored blocks (not just the one visible
// workspace) — see the "EVENTS (per-sprite)" section there.
