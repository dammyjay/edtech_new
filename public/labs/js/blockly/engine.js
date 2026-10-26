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

// Pen color's real source of truth is the HSV-style quad below (matching
// Scratch's own pen model) — penColor is always DERIVED from it via
// recomputePenColor(), never set directly, so the legacy swatch-dropdown
// block and the newer generic set/change-property blocks can't fork into
// two different "current pen color"s.
window.penHue = 0; // 0-100, maps to 0-360 degrees
window.penSaturation = 100; // 0-100
window.penBrightness = 100; // 0-100
window.penTransparency = 0; // 0-100, 0 = fully opaque

window.penColor = "#000000";

window.penSize = 2;

window.penCanvas = null;

window.penCtx = null;

// Brightness/transparency are mapped onto HSL lightness/alpha as an
// approximation (HSB brightness isn't the same axis as HSL lightness) —
// same honesty-flagged approximation already used by the CSS-filter-based
// graphic effects below, not true colorimetric HSV.
function recomputePenColor() {
  const hueDeg = (((window.penHue % 100) + 100) % 100) * 3.6;
  const lightness = Math.max(0, Math.min(100, window.penBrightness)) / 2;
  const alpha = 1 - Math.max(0, Math.min(100, window.penTransparency)) / 100;
  window.penColor = `hsla(${hueDeg}, ${Math.max(0, Math.min(100, window.penSaturation))}%, ${lightness}%, ${alpha})`;
}

function hexToHsl(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex) || [];
  const int = parseInt(m[1] || "000000", 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  const l = (max + min) / 2;
  const d = max - min;

  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  return { h, l };
}


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

  // Mirrors Scratch's three rotation styles. "NONE" means the costume
  // never visually rotates regardless of direction (e.g. a UI cursor);
  // "LEFT_RIGHT" only ever mirrors horizontally (the common choice for
  // a walking/side-view character, where a full spin would look
  // upside-down); "ALL_AROUND" (the default, and the only style this
  // engine had before) rotates freely.
  const style = sprite.rotationStyle || "ALL_AROUND";
  if (style === "NONE") {
    sprite.element.style.transform = "";
  } else if (style === "LEFT_RIGHT") {
    const facingLeft = Math.cos((sprite.rotation * Math.PI) / 180) < 0;
    sprite.element.style.transform = facingLeft ? "scaleX(-1)" : "";
  } else {
    sprite.element.style.transform = `rotate(${sprite.rotation}deg)`;
  }

  sprite.element.style.display = sprite.visible ? "block" : "none";
  if (sprite.width) sprite.element.style.width = sprite.width + "px";
  if (sprite.height) sprite.element.style.height = sprite.height + "px";
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

// Capture phase (the `true` 3rd argument), not bubble — Blockly itself
// binds its own per-widget/per-block keydown handlers (e.g. for its
// keyboard-navigation and field-editor features) directly on focusable
// elements inside the workspace SVG, and a block left focused after the
// student just placed it is a completely normal state. A bubble-phase
// listener on document only ever sees what those handlers let through;
// capture phase runs top-down before any of them, so a "When Space
// Pressed" block fires regardless of what element currently has focus.
document.addEventListener("keydown", async (e) => {
  const list = window.keyEvents[e.key];

  if (!list) return;

  for (const { sprite, callback } of list) {
    window.currentRuntimeSprite = sprite;
    await callback();
  }

  window.currentRuntimeSprite = null;
}, true);

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
  // Legacy swatch-dropdown block — reset the full HSV quad from the
  // chosen hex so it stays the single source of truth alongside the
  // newer generic property blocks, instead of forking penColor directly.
  const { h } = hexToHsl(color);
  penHue = (h / 360) * 100;
  penSaturation = 100;
  penBrightness = 100;
  penTransparency = 0;
  recomputePenColor();
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

window.stampSprite = function () {
  const sprite = getRuntimeSprite();
  if (!sprite || !window.penCtx) return;
  drawSpriteToCanvas(window.penCtx, sprite);
};

window.changePenColorBy = function (value) {
  penHue = (((penHue + Number(value)) % 100) + 100) % 100;
  recomputePenColor();
};

const PEN_PROPERTY_FIELDS = {
  color: "penHue",
  saturation: "penSaturation",
  brightness: "penBrightness",
  transparency: "penTransparency",
};

window.setPenProperty = function (property, value) {
  const field = PEN_PROPERTY_FIELDS[property];
  if (!field) return;

  let v = Number(value);
  if (field === "penHue") v = ((v % 100) + 100) % 100;
  else v = Math.max(0, Math.min(100, v));

  window[field] = v;
  recomputePenColor();
};

window.changePenProperty = function (property, value) {
  const field = PEN_PROPERTY_FIELDS[property];
  if (!field) return;

  let v = window[field] + Number(value);
  if (field === "penHue") v = ((v % 100) + 100) % 100;
  else v = Math.max(0, Math.min(100, v));

  window[field] = v;
  recomputePenColor();
};
// =========================
// MOTION
// =========================

// Deliberately computed from the sprite's own LOGICAL x/y/width/height —
// never from getBoundingClientRect(). The pen canvas draws using its own
// native (unscaled) pixel resolution, fixed at page load; a screen-space
// measurement reflects whatever CSS transform is currently applied to
// #stage (e.g. the uniform scale-up used for fullscreen — see
// applyFullscreenStageScale in blocklyLab.js). Mixing scaled screen
// coordinates into pen-drawing calls, drawn onto an unscaled canvas that
// then ALSO gets visually magnified by that same transform, doubled the
// effective scale — pen shapes came out far too big and could extend
// past the stage in fullscreen. Logical coordinates are immune to any
// CSS transform, so this always matches the canvas's own resolution.
window.getSpriteCenter = function (sprite) {
  sprite = sprite || getRuntimeSprite();
  if (!sprite) return { x: 0, y: 0 };

  return {
    x: sprite.x + (sprite.width || 0) / 2,
    y: sprite.y + (sprite.height || 0) / 2,
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

window.setX = function (x) {
  const sprite = getRuntimeSprite();
  if (!sprite) return;

  const start = getSpriteCenter(sprite);
  sprite.x = Number(x);
  renderSprite(sprite);
  const end = getSpriteCenter(sprite);
  drawPenLine(start.x, start.y, end.x, end.y);
};

window.setY = function (y) {
  const sprite = getRuntimeSprite();
  if (!sprite) return;

  const start = getSpriteCenter(sprite);
  sprite.y = Number(y);
  renderSprite(sprite);
  const end = getSpriteCenter(sprite);
  drawPenLine(start.x, start.y, end.x, end.y);
};

// Reverses direction when the sprite reaches the stage edge and nudges
// it back inside the bounds, so it doesn't stay stuck re-triggering the
// bounce every frame. A simple left/right + up/down reflection (not a
// true angle-of-incidence bounce) — matches what Scratch's own
// "if on edge, bounce" does for the common case of a sprite moving in a
// straight line.
window.ifOnEdgeBounce = function () {
  const sprite = getRuntimeSprite();
  if (!sprite) return;

  const stage = document.getElementById("stage");
  if (!stage || !touchingEdge()) return;

  const size = sprite.width || 50;
  const maxX = stage.clientWidth - size;
  const maxY = stage.clientHeight - size;

  let dx = Math.cos((sprite.rotation * Math.PI) / 180);
  let dy = Math.sin((sprite.rotation * Math.PI) / 180);

  if (sprite.x <= 0 || sprite.x >= maxX) dx = -dx;
  if (sprite.y <= 0 || sprite.y >= maxY) dy = -dy;

  sprite.rotation = (Math.atan2(dy, dx) * 180) / Math.PI;
  sprite.x = Math.min(Math.max(sprite.x, 0), Math.max(maxX, 0));
  sprite.y = Math.min(Math.max(sprite.y, 0), Math.max(maxY, 0));

  renderSprite(sprite);
};

window.setRotationStyle = function (style) {
  const sprite = getRuntimeSprite();
  if (!sprite) return;

  sprite.rotationStyle = style;
  renderSprite(sprite);
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

window.thinkText = function (text) {
  const sprite = getRuntimeSprite();

  let bubble = document.getElementById("thoughtBubble");

  if (!bubble) {
    bubble = document.createElement("div");
    bubble.id = "thoughtBubble";
    bubble.className = "speech-bubble thought-bubble";
    document.getElementById("stage").appendChild(bubble);
  }

  bubble.innerText = text;
  bubble.style.display = "block";

  requestAnimationFrame(() => {
    if (!sprite) return;
    const bubbleHeight = bubble.offsetHeight;
    bubble.style.left = sprite.x + 60 + "px";
    bubble.style.top = sprite.y - bubbleHeight - 10 + "px";
  });
};

window.thinkForSeconds = async function (text, seconds) {
  thinkText(text);
  await wait(seconds);
  const bubble = document.getElementById("thoughtBubble");
  if (bubble) bubble.style.display = "none";
};

// Scratch's graphic effects, approximated with CSS filter() — the
// closest native browser equivalent for each. "color" cycles hue (the
// Scratch range is conventionally 0-200 for one full rotation); "ghost"
// is transparency; "brightness"/"blur" map directly to their CSS
// filter counterparts. Effects stack as one combined filter string per
// sprite, same as Scratch applies them together rather than
// overwriting each other.
window.applyGraphicEffects = function (sprite) {
  if (!sprite || !sprite.element) return;
  const fx = sprite.effects || {};
  const parts = [];

  if (fx.color) parts.push(`hue-rotate(${((fx.color % 200) / 200) * 360}deg)`);
  if (fx.ghost) parts.push(`opacity(${Math.max(0, 1 - fx.ghost / 100)})`);
  if (fx.brightness) parts.push(`brightness(${Math.max(0, 1 + fx.brightness / 100)})`);
  if (fx.blur) parts.push(`blur(${Math.max(0, fx.blur) / 10}px)`);

  sprite.element.style.filter = parts.join(" ");
};

window.changeGraphicEffect = function (effect, value) {
  const sprite = getRuntimeSprite();
  if (!sprite) return;

  sprite.effects = sprite.effects || {};
  sprite.effects[effect] = (sprite.effects[effect] || 0) + Number(value);
  applyGraphicEffects(sprite);
};

window.setGraphicEffect = function (effect, value) {
  const sprite = getRuntimeSprite();
  if (!sprite) return;

  sprite.effects = sprite.effects || {};
  sprite.effects[effect] = Number(value);
  applyGraphicEffects(sprite);
};

window.clearGraphicEffects = function () {
  const sprite = getRuntimeSprite();
  if (!sprite) return;

  sprite.effects = {};
  if (sprite.element) sprite.element.style.filter = "";
};

// Layer order via z-index. window.nextZIndex only ever climbs, so
// "go to front" is always higher than anything placed before it,
// without needing to renumber every other sprite.
window.nextZIndex = 1;

window.goToLayer = function (layer) {
  const sprite = getRuntimeSprite();
  if (!sprite || !sprite.element) return;

  if (layer === "front") {
    window.nextZIndex += 1;
    sprite.zIndex = window.nextZIndex;
  } else {
    sprite.zIndex = 0;
    window.sprites.forEach((s) => {
      if (s !== sprite && s.element) s.zIndex = (s.zIndex || 0) + 1;
    });
    window.sprites.forEach((s) => { if (s.element) s.element.style.zIndex = s.zIndex || 0; });
  }
  sprite.element.style.zIndex = sprite.zIndex || 0;
};

window.goLayers = function (direction, amount) {
  const sprite = getRuntimeSprite();
  if (!sprite || !sprite.element) return;

  const delta = direction === "forward" ? Number(amount) : -Number(amount);
  sprite.zIndex = (sprite.zIndex || 0) + delta;
  sprite.element.style.zIndex = sprite.zIndex;
};

window.getCostumeName = function () {
  const sprite = getRuntimeSprite();
  if (!sprite) return "";
  const costume = sprite.costumes && sprite.costumes[sprite.costumeIndex || 0];
  return costume ? costume.name : sprite.name;
};

window.switchCostumeTo = function (name) {
  const sprite = getRuntimeSprite();
  if (!sprite || !sprite.costumes || !sprite.costumes.length) return;

  const idx = sprite.costumes.findIndex(
    (c) => c.name.toLowerCase() === String(name).toLowerCase(),
  );
  if (idx === -1) return;

  sprite.costumeIndex = idx;
  sprite.image = sprite.costumes[idx].src;
  sprite.element.src = sprite.image;
};

window.nextCostume = function () {
  const sprite = getRuntimeSprite();
  if (!sprite || !sprite.costumes || sprite.costumes.length < 2) return;

  sprite.costumeIndex = ((sprite.costumeIndex || 0) + 1) % sprite.costumes.length;
  sprite.image = sprite.costumes[sprite.costumeIndex].src;
  sprite.element.src = sprite.image;
};

window.currentBackdropName = "";

window.getBackdropName = function () {
  return window.currentBackdropName || "";
};

window.getSpriteSize = function () {
  const sprite = getRuntimeSprite();
  return sprite ? sprite.width || 0 : 0;
};

// Backdrop is a stage-level concept, shared by every sprite — not
// retargeted per-sprite. `image` is normally a full URL (Cloudinary or
// local, from the DB-driven Lab Assets picker) — the bare-filename branch
// only exists for projects saved before Lab Assets existed, whose
// `backdrop` field is just a filename like "beach.webp".
// Shared by setBackgroundImage below (CSS) and setBackground in
// blocklyLab.js (the separate `backgroundImage` Image object used for
// Screenshot/Record canvas compositing) — both need the SAME resolved
// URL. Using it in only one place was the actual bug behind "Screenshot
// failed": a legacy bare filename like "beach.webp" resolved correctly
// for the CSS display, but the raw, unresolved value was used for the
// Image object, which then 404'd and left it "broken" — crashing
// composeStageSnapshot() when it tried to drawImage() it.
window.resolveBackdropUrl = function (image) {
  return /^(https?:)?\//.test(image) ? image : `/labs/images/backgrounds/${image}`;
};

window.setBackgroundImage = function (image) {
  const stage = document.getElementById("stage");

  const resolved = resolveBackdropUrl(image);

  stage.style.backgroundImage = `url('${resolved}')`;

  stage.style.backgroundSize = "cover";

  stage.style.backgroundPosition = "center";

  stage.style.backgroundRepeat = "no-repeat";
};

// Numeric cycling index into window.backgrounds (an array of {url,name}
// objects) — deliberately a SEPARATE variable from
// window.currentBackdropUrl (blocklyLab.js), which tracks the actual
// backdrop URL currently on the stage. Reusing one variable for both used
// to break "next background" the moment a student manually picked one.
window.currentBackground = 0;

window.nextBackground = function () {
  if (!window.backgrounds || window.backgrounds.length === 0) {
    return;
  }

  currentBackground++;

  if (currentBackground >= backgrounds.length) {
    currentBackground = 0;
  }

  setBackground(backgrounds[currentBackground].url);
};

window.previousBackground = function () {
  if (!window.backgrounds.length) return;

  currentBackground--;

  if (currentBackground < 0) {
    currentBackground = window.backgrounds.length - 1;
  }

  setBackground(window.backgrounds[currentBackground].url);
};

window.randomBackground = function () {
  if (!backgrounds || backgrounds.length === 0) {
    return;
  }

  const random = Math.floor(Math.random() * backgrounds.length);

  setBackground(backgrounds[random].url);
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
    width: 50,
    height: 50,
    rotation: 0,
    visible: true,
    speed: 1,
    workspaceXml: "",
    spawnX: Number(x),
    spawnY: Number(y),
    spawnWidth: 50,
    spawnHeight: 50,
    spawnRotation: 0,
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

  if (typeof renderCostumeList === "function") renderCostumeList(sprite);
  if (typeof renderSoundList === "function") renderSoundList(sprite);
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

// Injected before every statement block's generated code (see
// STATEMENT_PREFIX in blocklyLab.js). Only the sprite currently open in
// the editor has its blocks visibly on screen, so only its own run
// highlights anything — other sprites' concurrently-running scripts skip
// straight through instead of pausing for a highlight nobody can see.
window.highlightBlock = async function (id) {
  if (
    typeof workspace !== "undefined" &&
    workspace &&
    window.currentSprite &&
    window.currentRuntimeSprite &&
    window.currentRuntimeSprite.id === window.currentSprite.id
  ) {
    workspace.highlightBlock(id);
    await wait(0.15);
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

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex) || [];
  const int = parseInt(m[1] || "000000", 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

function colorDistance(a, b) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

let colorCheckCanvas = null;
let colorCheckCtx = null;

// Reuses the exact compositing recipe composeStageSnapshot() (blocklyLab.js)
// already uses for Screenshot/Record — backdrop, then the pen layer, then
// every OTHER sprite (never the one asking) — drawn into one cached
// offscreen canvas instead of allocating a new one on every call, since a
// `touching color?` reporter can run every frame inside a forever loop.
window.touchingColor = function (hexColor) {
  const sprite = getRuntimeSprite();
  const stage = document.getElementById("stage");
  if (!sprite || !stage) return false;

  const w = stage.clientWidth;
  const h = stage.clientHeight;
  if (!w || !h) return false;

  if (!colorCheckCanvas) {
    colorCheckCanvas = document.createElement("canvas");
    colorCheckCtx = colorCheckCanvas.getContext("2d", { willReadFrequently: true });
  }
  if (colorCheckCanvas.width !== w) colorCheckCanvas.width = w;
  if (colorCheckCanvas.height !== h) colorCheckCanvas.height = h;

  colorCheckCtx.clearRect(0, 0, w, h);

  if (typeof drawBackdropToCanvas === "function" && typeof backgroundImage !== "undefined") {
    drawBackdropToCanvas(colorCheckCtx, backgroundImage, w, h);
  }

  const penCanvasEl = document.getElementById("penCanvas");
  if (penCanvasEl) colorCheckCtx.drawImage(penCanvasEl, 0, 0, w, h);

  if (typeof drawSpriteToCanvas === "function") {
    window.sprites.forEach((other) => {
      if (other !== sprite) drawSpriteToCanvas(colorCheckCtx, other);
    });
  }

  const sampleX = Math.max(0, Math.floor(sprite.x));
  const sampleY = Math.max(0, Math.floor(sprite.y));
  const sampleW = Math.min(sprite.width || 50, w - sampleX);
  const sampleH = Math.min(sprite.height || 50, h - sampleY);
  if (sampleW <= 0 || sampleH <= 0) return false;

  const target = hexToRgb(hexColor);
  const data = colorCheckCtx.getImageData(sampleX, sampleY, sampleW, sampleH).data;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 10) continue; // transparent pixel, nothing drawn there
    if (colorDistance([data[i], data[i + 1], data[i + 2]], target) < 40) {
      return true;
    }
  }
  return false;
};

window.setDragMode = function (mode) {
  const sprite = getRuntimeSprite();
  if (!sprite) return;
  sprite.draggable = mode === "draggable";
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

// "When Timer > N" hats register here instead of being re-evaluated by
// compileEvents (which only runs its scanned top-level blocks ONCE, at
// compile time — fine for registerKeyEvent/registerBroadcast-style
// calls, useless for a condition that needs re-checking over time).
// A persistent ticker below polls every registered watch and fires each
// one once per threshold-crossing, re-arming only once the timer drops
// back to/under its threshold (e.g. after reset_timer), so it behaves
// like Scratch's edge-triggered hat rather than firing every tick.
window.timerWatches = [];

window.registerTimerWatch = function (threshold, callback) {
  window.timerWatches.push({
    sprite: window.currentRuntimeSprite,
    threshold: Number(threshold),
    callback,
    armed: true,
  });
};

setInterval(() => {
  const value = getTimer();

  for (const watch of window.timerWatches) {
    if (value > watch.threshold) {
      if (watch.armed) {
        watch.armed = false;
        window.currentRuntimeSprite = watch.sprite;
        watch.callback();
        window.currentRuntimeSprite = null;
      }
    } else {
      watch.armed = true;
    }
  }
}, 100);

// Mirrors registerBroadcast/broadcast exactly, keyed by backdrop name
// instead of message text — fired for real by setBackground (see
// blocklyLab.js) whenever the backdrop actually changes, not just once
// at compile time.
window.backdropSwitchListeners = {};

window.registerBackdropSwitch = function (name, callback) {
  if (!window.backdropSwitchListeners[name]) {
    window.backdropSwitchListeners[name] = [];
  }

  window.backdropSwitchListeners[name].push({ sprite: window.currentRuntimeSprite, callback });
};

window.fireBackdropSwitch = async function (name) {
  const listeners = window.backdropSwitchListeners[name];

  if (!listeners) return;

  for (const { sprite, callback } of listeners) {
    window.currentRuntimeSprite = sprite;
    await callback();
  }

  window.currentRuntimeSprite = null;
};

// =========================
// SENSING: distance / generic attribute / date-time / username
// =========================

window.distanceToSprite = function (name) {
  const sprite = getRuntimeSprite();
  const other = getSprite(name);
  if (!sprite || !other) return 0;

  const dx = (other.x + (other.width || 0) / 2) - (sprite.x + (sprite.width || 0) / 2);
  const dy = (other.y + (other.height || 0) / 2) - (sprite.y + (sprite.height || 0) / 2);

  return Math.sqrt(dx * dx + dy * dy);
};

window.distanceToMouse = function () {
  const sprite = getRuntimeSprite();
  if (!sprite) return 0;

  const cx = sprite.x + (sprite.width || 0) / 2;
  const cy = sprite.y + (sprite.height || 0) / 2;

  const dx = window.mouseX - cx;
  const dy = window.mouseY - cy;

  return Math.sqrt(dx * dx + dy * dy);
};

window.getAttributeOf = function (name, attribute) {
  const sprite = getSprite(name);
  if (!sprite) return "";

  switch (attribute) {
    case "x": return sprite.x;
    case "y": return sprite.y;
    case "direction": return sprite.rotation || 0;
    case "size": return sprite.width || 0;
    case "costume": {
      const costume = sprite.costumes && sprite.costumes[sprite.costumeIndex || 0];
      return costume ? costume.name : sprite.name;
    }
    case "visible": return !!sprite.visible;
    default: return "";
  }
};

window.currentDateTime = function (part) {
  const d = new Date();

  switch (part) {
    case "year": return d.getFullYear();
    case "month": return d.getMonth() + 1;
    case "date": return d.getDate();
    case "day_of_week": return d.getDay() + 1; // Scratch convention: 1 = Sunday
    case "hour": return d.getHours();
    case "minute": return d.getMinutes();
    case "second": return d.getSeconds();
    default: return 0;
  }
};

window.daysSince2000 = function () {
  const start = new Date(2000, 0, 1);
  const now = new Date();

  return (now - start) / 86400000;
};

window.getUsername = function () {
  return window.currentUsername || "";
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
// Reset only puts each sprite back to normal — its own starting
// position/size/rotation/visibility — nothing more. It never removes an
// added sprite and never touches the backdrop (setting stage.background
// here used to silently wipe an image backdrop too, since `background`
// is a shorthand that resets background-image along with it).
window.resetStage = function () {
  window.sprites.forEach((sprite) => {
    sprite.x = sprite.spawnX ?? sprite.x;
    sprite.y = sprite.spawnY ?? sprite.y;
    sprite.width = sprite.spawnWidth ?? sprite.width;
    sprite.height = sprite.spawnHeight ?? sprite.height;
    sprite.rotation = sprite.spawnRotation ?? 0;
    sprite.visible = true;
    renderSprite(sprite);
  });

  // Refresh the on-screen X/Y/Width/Height/Rotation/Show inputs to match
  // immediately, instead of only updating on next sprite selection.
  if (window.currentSprite) {
    loadSpriteProperties(window.currentSprite);
  }

  clearConsole();
  if (typeof showToast === "function") showToast("🔄 Sprites reset!");
};

// =========================
// TEXT TO SPEECH
// =========================
// Uses the browser's own SpeechSynthesis API — no API key, no external
// service, works offline. window.speechSynthesis is missing on some very
// old/embedded browsers, so every function here no-ops safely if it is.

window.ttsLang = "en-US";
window.ttsVoiceName = ""; // "" = browser default for the current language

window.setTtsVoice = function (name) {
  window.ttsVoiceName = name || "";
};

window.setTtsLanguage = function (lang) {
  window.ttsLang = lang || "en-US";
};

// Real Scratch/PictoBlox "speak" blocks the script until the speech
// finishes (not fire-and-forget) — resolving the promise on the
// utterance's end/error event matches that, the same way wait()/
// askAndWait() already pause generated scripts elsewhere in this file.
window.ttsSpeak = function (text) {
  return new Promise((resolve) => {
    if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === "undefined") {
      resolve();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(String(text));
    utterance.lang = window.ttsLang || "en-US";

    if (window.ttsVoiceName) {
      const match = speechSynthesis.getVoices().find((v) => v.name === window.ttsVoiceName);
      if (match) utterance.voice = match;
    }

    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    speechSynthesis.speak(utterance);
  });
};

// =========================
// SOUND
// =========================
// Real audio clips attached to a sprite (sprite.sounds[]) — admin-curated
// (lab_asset_sounds) and/or student-uploaded. One shared, lazily-created
// AudioContext; every play gets its own <audio> element routed through
// GainNode (volume) -> StereoPannerNode (pan) -> destination. Pitch is
// approximated via playbackRate (changes speed too — an approximation,
// same honesty-flagged approach as the pen HSL/graphic-effects
// approximations above), since real-time pitch-shifting without changing
// speed needs a much heavier DSP approach this scope doesn't call for.

window.soundVolume = 100; // 0-100
window.soundPitch = 0; // unbounded; mapped onto playbackRate via a cents-like curve
window.soundPan = 0; // -100 (left) to 100 (right)

let sharedAudioCtx = null;
function getAudioCtx() {
  if (!sharedAudioCtx) {
    sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return sharedAudioCtx;
}

const activeSoundNodes = [];

function findSpriteSound(sprite, name) {
  if (!sprite || !sprite.sounds) return null;
  return sprite.sounds.find((s) => s.name.toLowerCase() === String(name).toLowerCase());
}

function playSoundInternal(name, waitForEnd) {
  const sprite = getRuntimeSprite();
  const soundDef = findSpriteSound(sprite, name);
  if (!soundDef) return waitForEnd ? Promise.resolve() : undefined;

  const ctx = getAudioCtx();
  const audioEl = new Audio(soundDef.src);
  audioEl.crossOrigin = "anonymous";
  audioEl.playbackRate = Math.pow(2, window.soundPitch / 1200);

  let node;
  try {
    const source = ctx.createMediaElementSource(audioEl);
    const gain = ctx.createGain();
    const panner = ctx.createStereoPanner();
    gain.gain.value = Math.max(0, Math.min(100, window.soundVolume)) / 100;
    panner.pan.value = Math.max(-100, Math.min(100, window.soundPan)) / 100;
    source.connect(gain).connect(panner).connect(ctx.destination);
    node = { audioEl, source, gain, panner };
  } catch (e) {
    // Cross-origin/CORS source that Web Audio refuses to tap — fall back
    // to plain <audio> playback (no volume/pan routing, but it still
    // plays) rather than silently doing nothing.
    audioEl.volume = Math.max(0, Math.min(100, window.soundVolume)) / 100;
    node = { audioEl };
  }

  activeSoundNodes.push(node);
  const cleanup = () => {
    const idx = activeSoundNodes.indexOf(node);
    if (idx !== -1) activeSoundNodes.splice(idx, 1);
  };

  if (waitForEnd) {
    return new Promise((resolve) => {
      audioEl.onended = () => { cleanup(); resolve(); };
      audioEl.onerror = () => { cleanup(); resolve(); };
      audioEl.play().catch(() => { cleanup(); resolve(); });
    });
  }

  audioEl.onended = cleanup;
  audioEl.play().catch(cleanup);
  return undefined;
}

window.startSound = function (name) {
  playSoundInternal(name, false);
};

window.playSoundUntilDone = function (name) {
  return playSoundInternal(name, true);
};

window.stopAllSounds = function () {
  activeSoundNodes.slice().forEach(({ audioEl }) => {
    audioEl.pause();
    audioEl.currentTime = 0;
  });
  activeSoundNodes.length = 0;
};

window.setVolume = function (value) {
  window.soundVolume = Math.max(0, Math.min(100, Number(value)));
};

window.changeVolumeBy = function (value) {
  window.soundVolume = Math.max(0, Math.min(100, window.soundVolume + Number(value)));
};

window.getVolume = function () {
  return window.soundVolume;
};

window.setSoundEffect = function (effect, value) {
  if (effect === "pitch") window.soundPitch = Number(value);
  else if (effect === "pan") window.soundPan = Math.max(-100, Math.min(100, Number(value)));
};

window.changeSoundEffect = function (effect, value) {
  if (effect === "pitch") window.soundPitch += Number(value);
  else if (effect === "pan") window.soundPan = Math.max(-100, Math.min(100, window.soundPan + Number(value)));
};

window.clearSoundEffects = function () {
  window.soundPitch = 0;
  window.soundPan = 0;
};

// =========================
// MUSIC
// =========================
// Scratch's own Music extension plays sampled instruments — avoiding the
// need to source/host/license real instrument/drum samples (the same
// reasoning public/js/gamify.js's quiz chime effects already used),
// notes/drums here are synthesized with the Web Audio API instead: a
// simple timbre-approximation waveform per instrument, and filtered
// white-noise bursts for drums. Flagged here plainly — these are
// synthesized tones, not real sampled instruments.

window.musicTempo = 60; // BPM
window.musicInstrument = "piano";

const INSTRUMENT_WAVEFORMS = {
  piano: "triangle",
  "electric piano": "sine",
  guitar: "sawtooth",
  organ: "square",
  marimba: "sine",
  synth: "sawtooth",
};

function beatsToSeconds(beats) {
  return (60 / (window.musicTempo || 60)) * Number(beats);
}

function midiToFrequency(note) {
  return 440 * Math.pow(2, (Number(note) - 69) / 12);
}

window.playNote = function (note, beats) {
  const ctx = getAudioCtx();
  const duration = Math.max(0.05, beatsToSeconds(beats));

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = INSTRUMENT_WAVEFORMS[window.musicInstrument] || "triangle";
  osc.frequency.value = midiToFrequency(note);
  gain.gain.setValueAtTime(0.3, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + duration);

  return new Promise((resolve) => setTimeout(resolve, duration * 1000));
};

const DRUM_NOISE_PARAMS = {
  snare: { duration: 0.15, filterFreq: 1800 },
  "bass drum": { duration: 0.25, filterFreq: 150 },
  "hi-hat": { duration: 0.05, filterFreq: 8000 },
  tambourine: { duration: 0.1, filterFreq: 6000 },
  cowbell: { duration: 0.2, filterFreq: 800 },
  clap: { duration: 0.12, filterFreq: 1200 },
};

window.playDrum = function (drum, beats) {
  const ctx = getAudioCtx();
  const params = DRUM_NOISE_PARAMS[drum] || DRUM_NOISE_PARAMS.snare;
  const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * params.duration));
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = params.filterFreq;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.5, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + params.duration);

  noise.connect(filter).connect(gain).connect(ctx.destination);
  noise.start();

  const totalDuration = Math.max(params.duration, beatsToSeconds(beats));
  return new Promise((resolve) => setTimeout(resolve, totalDuration * 1000));
};

window.musicRest = function (beats) {
  return new Promise((resolve) => setTimeout(resolve, beatsToSeconds(beats) * 1000));
};

window.setInstrument = function (instrument) {
  window.musicInstrument = instrument;
};

window.setTempo = function (bpm) {
  window.musicTempo = Math.max(20, Math.min(500, Number(bpm)));
};

window.changeTempoBy = function (delta) {
  window.musicTempo = Math.max(20, Math.min(500, window.musicTempo + Number(delta)));
};

window.getTempo = function () {
  return window.musicTempo;
};

// =========================
// VIDEO SENSING
// =========================
// Camera feed renders onto #videoCanvas (CSS z-index 0, behind pen marks
// and sprites — see blockly.css) via a requestAnimationFrame loop that
// also draws each frame onto a small offscreen analysis canvas and diffs
// it against the previous frame to compute a 0-100 motion amount. A
// continuous-watch "when video motion > N" trigger reuses the exact
// registerTimerWatch/timerWatches pattern above (registerVideoMotionWatch/
// videoMotionWatches), since this is the same "re-check every tick, not
// just once at compile time" problem Phase 2's timer watch already solved.

window.videoEnabled = false;
window.videoTransparency = 50; // Scratch's own scale: 0 = fully opaque, 100 = fully invisible

let videoStream = null;
let videoRafId = null;
const VIDEO_ANALYSIS_W = 64;
const VIDEO_ANALYSIS_H = 48;
let videoAnalysisCanvas = null;
let videoAnalysisCtx = null;
let videoPrevFrame = null; // Uint8ClampedArray snapshot of the previous analysis frame
let videoMotionGrid = null; // per-cell motion amounts (VIDEO_ANALYSIS_W x VIDEO_ANALYSIS_H), for per-sprite sampling
let videoGlobalMotion = 0;
let videoGlobalDirection = 0;

function ensureVideoAnalysisCanvas() {
  if (!videoAnalysisCanvas) {
    videoAnalysisCanvas = document.createElement("canvas");
    videoAnalysisCanvas.width = VIDEO_ANALYSIS_W;
    videoAnalysisCanvas.height = VIDEO_ANALYSIS_H;
    videoAnalysisCtx = videoAnalysisCanvas.getContext("2d", { willReadFrequently: true });
  }
}

function videoRenderLoop() {
  if (!window.videoEnabled) return;

  const videoEl = document.getElementById("videoFeed");
  const canvas = document.getElementById("videoCanvas");
  const stage = document.getElementById("stage");
  if (!videoEl || !canvas || !stage || videoEl.readyState < 2) {
    videoRafId = requestAnimationFrame(videoRenderLoop);
    return;
  }

  const w = stage.clientWidth;
  const h = stage.clientHeight;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;

  const ctx = canvas.getContext("2d");
  ctx.save();
  ctx.globalAlpha = 1 - Math.max(0, Math.min(100, window.videoTransparency)) / 100;
  // Mirrored, matching how a student sees themselves in a normal webcam
  // view (Scratch does the same) — "video direction" below is computed
  // in this same mirrored space, so left/right stay intuitive to them.
  ctx.translate(w, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(videoEl, 0, 0, w, h);
  ctx.restore();

  ensureVideoAnalysisCanvas();
  videoAnalysisCtx.save();
  videoAnalysisCtx.translate(VIDEO_ANALYSIS_W, 0);
  videoAnalysisCtx.scale(-1, 1);
  videoAnalysisCtx.drawImage(videoEl, 0, 0, VIDEO_ANALYSIS_W, VIDEO_ANALYSIS_H);
  videoAnalysisCtx.restore();

  const frame = videoAnalysisCtx.getImageData(0, 0, VIDEO_ANALYSIS_W, VIDEO_ANALYSIS_H).data;

  if (videoPrevFrame) {
    const grid = new Float32Array(VIDEO_ANALYSIS_W * VIDEO_ANALYSIS_H);
    let total = 0;
    let leftSum = 0, rightSum = 0, topSum = 0, bottomSum = 0;

    for (let y = 0; y < VIDEO_ANALYSIS_H; y++) {
      for (let x = 0; x < VIDEO_ANALYSIS_W; x++) {
        const i = (y * VIDEO_ANALYSIS_W + x) * 4;
        const diff =
          Math.abs(frame[i] - videoPrevFrame[i]) +
          Math.abs(frame[i + 1] - videoPrevFrame[i + 1]) +
          Math.abs(frame[i + 2] - videoPrevFrame[i + 2]);
        const cell = diff / (3 * 255); // 0-1 per cell
        grid[y * VIDEO_ANALYSIS_W + x] = cell;
        total += cell;

        if (x < VIDEO_ANALYSIS_W / 2) leftSum += cell; else rightSum += cell;
        if (y < VIDEO_ANALYSIS_H / 2) topSum += cell; else bottomSum += cell;
      }
    }

    videoMotionGrid = grid;
    // Scaled so "a good amount of on-screen movement" lands near 100,
    // matching the feel of Scratch's own 0-100 motion scale rather than
    // a raw average that rarely rises above single digits.
    videoGlobalMotion = Math.min(100, (total / (VIDEO_ANALYSIS_W * VIDEO_ANALYSIS_H)) * 400);

    // Deliberately simple direction approximation (not true optical
    // flow): which half of the frame has more motion sets the angle,
    // weighted toward whichever axis is more lopsided. 0deg = right,
    // 90deg = up, matching Scratch's compass-style direction reporter.
    const dx = rightSum - leftSum;
    const dy = topSum - bottomSum;
    videoGlobalDirection = (dx === 0 && dy === 0) ? 0 : (Math.atan2(dy, dx) * 180) / Math.PI;
  }

  videoPrevFrame = frame;
  videoRafId = requestAnimationFrame(videoRenderLoop);
}

window.turnVideo = function (state) {
  if (state === "on") {
    if (window.videoEnabled) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      if (typeof showToast === "function") showToast("This device/browser doesn't support camera access.", "error");
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: false })
      .then((stream) => {
        videoStream = stream;
        const videoEl = document.getElementById("videoFeed");
        videoEl.srcObject = stream;
        // Explicit play() rather than relying solely on the `autoplay`
        // attribute — "Turn Video On" always runs from a real click (Run),
        // so this is never blocked by autoplay policy, and calling it
        // directly is more reliable across browsers than waiting on the
        // attribute alone.
        videoEl.play().catch(() => {});
        window.videoEnabled = true;
        videoPrevFrame = null;
        videoRafId = requestAnimationFrame(videoRenderLoop);
      })
      .catch(() => {
        if (typeof showToast === "function") showToast("Camera access was denied or unavailable.", "error");
      });
  } else {
    window.videoEnabled = false;
    if (videoRafId) cancelAnimationFrame(videoRafId);
    videoRafId = null;
    if (videoStream) {
      videoStream.getTracks().forEach((track) => track.stop());
      videoStream = null;
    }
    const videoEl = document.getElementById("videoFeed");
    if (videoEl) videoEl.srcObject = null;
    const canvas = document.getElementById("videoCanvas");
    if (canvas) {
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    videoPrevFrame = null;
    videoMotionGrid = null;
    videoGlobalMotion = 0;
  }
};

window.setVideoTransparency = function (value) {
  window.videoTransparency = Math.max(0, Math.min(100, Number(value)));
};

function spriteMotionFromGrid() {
  const sprite = getRuntimeSprite();
  const stage = document.getElementById("stage");
  if (!sprite || !stage || !videoMotionGrid) return 0;

  const w = stage.clientWidth || 1;
  const h = stage.clientHeight || 1;
  const cellW = w / VIDEO_ANALYSIS_W;
  const cellH = h / VIDEO_ANALYSIS_H;

  const x0 = Math.max(0, Math.floor(sprite.x / cellW));
  const y0 = Math.max(0, Math.floor(sprite.y / cellH));
  const x1 = Math.min(VIDEO_ANALYSIS_W, Math.ceil((sprite.x + (sprite.width || 50)) / cellW));
  const y1 = Math.min(VIDEO_ANALYSIS_H, Math.ceil((sprite.y + (sprite.height || 50)) / cellH));

  let sum = 0;
  let count = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      sum += videoMotionGrid[y * VIDEO_ANALYSIS_W + x];
      count++;
    }
  }
  if (!count) return 0;
  return Math.min(100, (sum / count) * 400);
}

window.getVideoMotion = function (target) {
  if (!window.videoEnabled) return 0;
  if (target === "sprite") return spriteMotionFromGrid();
  return videoGlobalMotion;
};

window.getVideoDirection = function (target) {
  if (!window.videoEnabled) return 0;
  // Per-sprite direction isn't computed separately (the grid-region sum
  // above only tracks magnitude, not a per-region vector) — the global
  // direction approximation is returned for either target, which is a
  // reasonable simplification at this scope.
  return Math.round(videoGlobalDirection);
};

// "When video motion > N" hats — same edge-triggered continuous-watch
// pattern as registerTimerWatch above.
window.videoMotionWatches = [];

window.registerVideoMotionWatch = function (threshold, callback) {
  window.videoMotionWatches.push({
    sprite: window.currentRuntimeSprite,
    threshold: Number(threshold),
    callback,
    armed: true,
  });
};

setInterval(() => {
  if (!window.videoEnabled) return;
  const value = window.getVideoMotion("stage");

  for (const watch of window.videoMotionWatches) {
    if (value > watch.threshold) {
      if (watch.armed) {
        watch.armed = false;
        window.currentRuntimeSprite = watch.sprite;
        watch.callback();
        window.currentRuntimeSprite = null;
      }
    } else {
      watch.armed = true;
    }
  }
}, 100);

// Safety net so leaving the lab (navigating away, closing the tab) never
// leaves the webcam indicator light on — "Stop" doesn't turn video off
// (matches how it doesn't stop sound either; an explicit "Turn Video
// Off" block is the in-project way), but leaving the page entirely should
// always release the camera regardless of project state.
window.addEventListener("pagehide", () => {
  if (window.videoEnabled) window.turnVideo("off");
});

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
