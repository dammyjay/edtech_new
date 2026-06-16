window.sprites = window.sprites || [];
window.backgrounds = window.backgrounds || [];
window.currentSprite = null;
window.currentRuntimeSprite = null;

// =========================
// SPRITE RENDER
// =========================

window.updateSprite = function (sprite) {
  if (!sprite || !sprite.element) return;

  sprite.element.style.left = sprite.x + "px";

  sprite.element.style.top = sprite.y + "px";

  sprite.element.style.transform = `rotate(${sprite.rotation || 0}deg)`;

  sprite.element.style.display = sprite.visible === false ? "none" : "block";
};

// =========================
// MOTION
// =========================

window.moveSprite = function (steps) {
  const s = window.currentRuntimeSprite;

  if (!s) return;

  const distance = Number(steps) * (s.speed || 1);

  s.x += Math.cos(((s.rotation || 0) * Math.PI) / 180) * distance;

  s.y += Math.sin(((s.rotation || 0) * Math.PI) / 180) * distance;

  updateSprite(s);
};

window.turnSprite = function (angle) {
  const s = window.currentRuntimeSprite;

  if (!s) return;

  s.rotation = (s.rotation || 0) + Number(angle);

  updateSprite(s);
};

window.pointDirection = function (direction) {
  const s = window.currentRuntimeSprite;

  if (!s) return;

  s.rotation = Number(direction);

  updateSprite(s);
};

window.goToPosition = function (x, y) {
  const s = window.currentRuntimeSprite;

  if (!s) return;

  s.x = Number(x);
  s.y = Number(y);

  updateSprite(s);
};

window.changeX = function (value) {
  const s = window.currentRuntimeSprite;

  if (!s) return;

  s.x += Number(value);

  updateSprite(s);
};

window.changeY = function (value) {
  const s = window.currentRuntimeSprite;

  if (!s) return;

  s.y += Number(value);

  updateSprite(s);
};

// =========================
// SPEED
// =========================

window.setSpeed = function (speed) {
  const s = window.currentRuntimeSprite;

  if (!s) return;

  s.speed = Number(speed);

  if (s.speed < 1) {
    s.speed = 1;
  }
};

// =========================
// LOOKS
// =========================

window.hideSprite = function () {
  const s = window.currentRuntimeSprite;

  if (!s) return;

  s.visible = false;

  updateSprite(s);
};

window.showSprite = function () {
  const s = window.currentRuntimeSprite;

  if (!s) return;

  s.visible = true;

  updateSprite(s);
};

window.setSprite = function (spriteName) {
  const s = window.currentRuntimeSprite;

  if (!s) return;

  s.name = spriteName;

  s.element.src = `/labs/images/sprites/${spriteName}.png`;
};

window.changeBackground = function (color) {
  const stage = document.getElementById("stage");

  if (!stage) return;

  stage.style.background = color;
};

window.changeImage = function (color) {
  const stage = document.getElementById("stage");

  if (!stage) return;

  stage.style.background = color;
};

// =========================
// ADDITIONAL SPRITES
// =========================

window.addSprite = function (spriteName, x, y) {
  const stage = document.getElementById("stage");

  if (!stage) return;

  const sprite = document.createElement("img");

  sprite.src = `/labs/images/sprites/${spriteName}.png`;

  sprite.classList.add("extra-sprite");

  sprite.style.position = "absolute";

  sprite.style.width = "50px";
  sprite.style.height = "50px";

  stage.appendChild(sprite);

  const spriteData = {
    id: Date.now(),
    name: spriteName,
    element: sprite,
    x: Number(x),
    y: Number(y),
    rotation: 0,
    speed: 1,
    visible: true,
    workspaceXml: "",
  };

  window.sprites.push(spriteData);

  updateSprite(spriteData);

  return spriteData.id;
};

window.moveSpriteTo = function (spriteId, x, y) {
  const sprite = window.sprites.find((s) => s.id == spriteId);

  if (!sprite) return;

  sprite.x = Number(x);
  sprite.y = Number(y);

  updateSprite(sprite);
};

window.moveAddedSprite = function (spriteId, steps) {
  const sprite = window.sprites.find((s) => s.id == spriteId);

  if (!sprite) return;

  sprite.x += Number(steps);

  updateSprite(sprite);
};

window.getSprite = function (name) {
  return window.sprites.find((s) => s.name === name);
};

window.moveSpriteNamed = function (name, x, y) {
  const sprite = getSprite(name);

  if (!sprite) return;

  sprite.x = Number(x);
  sprite.y = Number(y);

  updateSprite(sprite);
};

// =========================
// SENSORS
// =========================

window.touchingEdge = function () {
  const s = window.currentRuntimeSprite;

  if (!s) return false;

  const stage = document.getElementById("stage");

  return (
    s.x <= 0 ||
    s.y <= 0 ||
    s.x >= stage.clientWidth - 50 ||
    s.y >= stage.clientHeight - 50
  );
};

window.touchingSprite = function () {
  const s = window.currentRuntimeSprite;

  if (!s) return false;

  const a = s.element.getBoundingClientRect();

  for (const other of window.sprites) {
    if (other.id === s.id || !other.element) continue;

    const b = other.element.getBoundingClientRect();

    const touching = !(
      a.right < b.left ||
      a.left > b.right ||
      a.bottom < b.top ||
      a.top > b.bottom
    );

    if (touching) {
      return true;
    }
  }

  return false;
};

// =========================
// UTILITIES
// =========================

window.wait = function (seconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, seconds * 1000);
  });
};

// =========================
// CONSOLE
// =========================

window.logMessage = function (message) {
  const consoleBox = document.getElementById("console");

  if (!consoleBox) return;

  consoleBox.innerHTML += `${message}<br>`;

  consoleBox.scrollTop = consoleBox.scrollHeight;
};

window.clearConsole = function () {
  const consoleBox = document.getElementById("console");

  if (consoleBox) {
    consoleBox.innerHTML = "";
  }
};

// =========================
// RESET
// =========================

window.resetStage = function () {
  window.sprites.forEach((sprite) => {
    sprite.x = 100;
    sprite.y = 100;
    sprite.rotation = 0;
    sprite.speed = 1;
    sprite.visible = true;

    updateSprite(sprite);
  });

  const stage = document.getElementById("stage");

  if (stage) {
    stage.style.background = "#ffffff";
  }

  clearConsole();
};

// =========================
// INITIALIZE
// =========================

window.addEventListener("load", () => {
  window.sprites.forEach((sprite) => {
    updateSprite(sprite);
  });
});
