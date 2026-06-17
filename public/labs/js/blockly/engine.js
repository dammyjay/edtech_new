window.spriteX = 100;
window.spriteY = 100;
window.spriteRotation = 0;
window.spriteSpeed = 1;
window.spriteVisible = true;
window.sprites = [];

window.currentSprite = null;
window.backgrounds = [];
// =========================
// SPRITE RENDER
// =========================

window.updateSprite = function () {
  const sprite = document.getElementById("sprite");

  if (!sprite) return;

  sprite.style.left = spriteX + "px";
  sprite.style.top = spriteY + "px";

  sprite.style.transform = `rotate(${spriteRotation}deg)`;

  sprite.style.display = spriteVisible ? "block" : "none";

  // UPDATE RECORDING DATA

  const mainSprite = window.sprites.find((s) => s.id === "mainSprite");

  if (mainSprite) {
    mainSprite.x = spriteX;
    mainSprite.y = spriteY;
    mainSprite.rotation = spriteRotation;
    mainSprite.visible = spriteVisible;
  }
};


// =========================
// EVENTS
// =========================

window.keyEvents = {};

window.registerKeyEvent = function (key, callback) {
  if (!window.keyEvents[key]) {
    window.keyEvents[key] = [];
  }

  window.keyEvents[key].push(callback);
};

document.addEventListener("keydown", async (e) => {
  const list = window.keyEvents[e.key];

  if (!list) return;

  for (const fn of list) {
    await fn();
  }
});

window.registerSpriteClick = function (callback) {
  const sprite = document.getElementById("sprite");

  sprite.addEventListener("click", callback);
};

window.broadcastListeners = {};

window.broadcast = function (message) {
  const listeners = window.broadcastListeners[message];

  if (!listeners) return;

  listeners.forEach((fn) => fn());
};

window.registerBroadcast = function (message, callback) {
  if (!window.broadcastListeners[message]) {
    window.broadcastListeners[message] = [];
  }

  window.broadcastListeners[message].push(callback);
};

// =========================
// MOTION
// =========================

window.moveSprite = function (steps) {

  const distance =
    Number(steps) * spriteSpeed;

  spriteX +=
    Math.cos(spriteRotation * Math.PI / 180)
    * distance;

  spriteY +=
    Math.sin(spriteRotation * Math.PI / 180)
    * distance;

  updateSprite();
};

window.turnSprite = function (angle) {

  spriteRotation += Number(angle);

  updateSprite();
};

window.pointDirection = function (direction) {

  spriteRotation = Number(direction);

  updateSprite();
};


// =========================
// SPEED
// =========================

window.setSpeed = function (speed) {

  spriteSpeed = Number(speed);

  if (spriteSpeed < 1) {
    spriteSpeed = 1;
  }
};

// =========================
// LOOKS
// =========================

window.sayText = function (text) {
  const sprite = document.getElementById("sprite");

  let bubble = document.getElementById("speechBubble");

  if (!bubble) {
    bubble = document.createElement("div");

    bubble.id = "speechBubble";

    bubble.className = "speech-bubble";

    document.getElementById("stage").appendChild(bubble);
  }

  bubble.innerText = text;

  bubble.style.left = spriteX + 60 + "px";

  bubble.style.top = spriteY - 20 + "px";

  bubble.style.display = "block";
};

window.sayForSeconds = async function (text, seconds) {
  sayText(text);

  await wait(seconds);

  const bubble = document.getElementById("speechBubble");

  if (bubble) {
    bubble.style.display = "none";
  }
};

window.setBackgroundImage = function (image) {
  const stage = document.getElementById("stage");

  stage.style.backgroundImage = `url('/labs/images/backgrounds/${image}.jpg')`;

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

  // stage.appendChild(sprite);
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


function selectSpriteById(id) {
  document
    .querySelectorAll(".sprite-card")
    .forEach((card) => card.classList.remove("selected"));

  const sprite = window.sprites.find((s) => s.id === id);

  if (!sprite) return;

  window.currentSprite = sprite;

  const card = document.querySelector(`.sprite-card[data-sprite-id="${id}"]`);

  if (card) {
    card.classList.add("selected");
  }

  loadSpriteProperties(sprite);
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
if (currentSprite?.id === "mainSprite") {
  spriteX = currentSprite.x;
  spriteY = currentSprite.y;
}
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
  const sprite = window.sprites[spriteId];

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

  const sprite =
    document.getElementById("sprite");

  if (!sprite) return;

  sprite.src =
    `/labs/images/sprites/${spriteName}.png`;
};

window.goToPosition = function(x,y){

 spriteX = Number(x);
 spriteY = Number(y);

 updateSprite();
};

window.changeX = function(value){

 spriteX += Number(value);

 updateSprite();
};

window.changeY = function(value){

 spriteY += Number(value);

 updateSprite();
};

window.glideTo = async function (sec, x, y) {
  const startX = spriteX;
  const startY = spriteY;

  const steps = 60 * sec;

  for (let i = 0; i < steps; i++) {
    spriteX = startX + ((x - startX) * i) / steps;

    spriteY = startY + ((y - startY) * i) / steps;

    updateSprite();

    await wait(1 / 60);
  }
};

window.hideSprite = function () {
  spriteVisible = false;

  updateSprite();
};

window.showSprite = function () {
  spriteVisible = true;

  updateSprite();
};

window.setSpriteSize = function (size) {
  const sprite = document.getElementById("sprite");

  sprite.style.width = size + "px";

  sprite.style.height = size + "px";
};

window.changeSpriteSizeBy = function (value) {
  const sprite = document.getElementById("sprite");

  let width = parseInt(sprite.style.width) || sprite.offsetWidth;

  let height = parseInt(sprite.style.height) || sprite.offsetHeight;

  sprite.style.width = width + Number(value) + "px";

  sprite.style.height = height + Number(value) + "px";
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

window.touchingEdge = function(){

 const stage =
 document.getElementById("stage");

 return (
   spriteX <= 0 ||
   spriteY <= 0 ||
   spriteX >= stage.clientWidth - 50 ||
   spriteY >= stage.clientHeight - 50
 );
};


window.touchingSprite = function () {
  const a = document.getElementById("sprite1").getBoundingClientRect();

  const b = document.getElementById("sprite2").getBoundingClientRect();

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

window.touchingMouse =
function(){

 return (
  mouseX >= spriteX &&
  mouseX <= spriteX + 100 &&
  mouseY >= spriteY &&
  mouseY <= spriteY + 100
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

// =========================
// CONSOLE
// =========================

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

window.resetStage = function () {

  spriteX = 100;
  spriteY = 100;

  spriteRotation = 0;

  spriteSpeed = 1;

  spriteVisible = true;

  const stage =
    document.getElementById("stage");

  if (stage) {
    stage.style.background = "#ffffff";
  }

  clearConsole();

  updateSprite();
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

  updateSprite();
});

window.compileEvents = function () {

   clearEvents();

   const generator =
      javascript.javascriptGenerator;

   const topBlocks =
      workspace.getTopBlocks(true);

   let eventCode = "";

   for (const block of topBlocks) {

      if (
         block.type === "when_key_pressed" ||
         block.type === "when_sprite_clicked" ||
         block.type === "when_message_received" ||
         block.type === "when_touching_edge"
      ) {

         let code =
            generator.blockToCode(block);

         if (Array.isArray(code)) {
            code = code[0];
         }

         eventCode += code + "\n";
      }
   }

   console.log(eventCode);

   new Function(eventCode)();
};

window.clearEvents = function(){

   window.keyEvents = {};

   window.broadcastListeners = {};

   window.spriteClickEvents = [];

   window.edgeEvents = [];

};