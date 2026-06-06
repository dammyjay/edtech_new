
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

  sprite.style.transform =
    `rotate(${spriteRotation}deg)`;

  sprite.style.display =
    spriteVisible ? "block" : "none";
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

  window.sprites.push({
    id: window.sprites.length,
    element: sprite,
    name: spriteName,
    x: Number(x),
    y: Number(y),
    rotation: 0,
    });
};

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

window.hideSprite = function () {
  spriteVisible = false;

  updateSprite();
};

window.showSprite = function () {
  spriteVisible = true;

  updateSprite();
};
// window.setSprite = function(name){

//  document.getElementById("sprite").src =
//  `/labs/images/sprites/${name}.png`;
// };

window.wait = function(seconds){

 return new Promise(resolve=>{
   setTimeout(resolve, seconds * 1000);
 });
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

// window.touchingSprite = function () {
//   return false;
// };

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
  updateSprite();
});