console.log("looks generator loaded");

const jsGenerator = javascript.javascriptGenerator;

// =========================
// Generators for Event Blocks
// =========================

jsGenerator.forBlock["when_key_pressed"] = function (block) {
  const key = block.getFieldValue("KEY");

  const statements = jsGenerator.statementToCode(block, "DO");

  return `
registerKeyEvent("${key}", async ()=>{
${statements}
});
`;
};

jsGenerator.forBlock["when_sprite_clicked"] = function (block) {
  const statements = jsGenerator.statementToCode(block, "DO");

  return `
registerSpriteClick(async ()=>{
${statements}
});
`;
};

jsGenerator.forBlock["broadcast_message"] = function (block) {
  const msg = block.getFieldValue("MESSAGE");

  return `
broadcast("${msg}");
`;
};

jsGenerator.forBlock["when_message_received"] = function (block) {
  const msg = block.getFieldValue("MESSAGE");

  const statements = jsGenerator.statementToCode(block, "DO");

  return `
registerBroadcast(
 "${msg}",
 async ()=>{
${statements}
});
`;
};

// =========================
// Generators for Console Blocks
// =========================
jsGenerator.forBlock["print_message"] = function (block, generator) {
  const text =
    generator.valueToCode(block, "TEXT", javascript.Order.ATOMIC) || '""';

  return `logMessage(${text});\n`;
};

console.log("Generator registered:", jsGenerator.forBlock["print_message"]);

// =========================
// Generators for Motion Blocks
// =========================
jsGenerator.forBlock["move_sprite"] = function (block) {
  const steps =
    jsGenerator.valueToCode(block, "STEPS", javascript.Order.ATOMIC) || "0";

  return `moveSprite(${steps});\n`;
};

jsGenerator.forBlock["turn_sprite"] = function (block) {
  const angle =
    jsGenerator.valueToCode(block, "ANGLE", javascript.Order.ATOMIC) || "0";

  return `turnSprite(${angle});\n`;
};

jsGenerator.forBlock["point_direction"] = function (block) {
  const direction =
    jsGenerator.valueToCode(block, "DIRECTION", javascript.Order.ATOMIC) || "0";

  return `pointDirection(${direction});\n`;
};

jsGenerator.forBlock["go_to_position"] = function (block) {
  const x = jsGenerator.valueToCode(block, "X", javascript.Order.ATOMIC) || "0";

  const y = jsGenerator.valueToCode(block, "Y", javascript.Order.ATOMIC) || "0";

  return `goToPosition(${x}, ${y});\n`;
};

jsGenerator.forBlock["change_x"] = function (block) {
  const value =
    jsGenerator.valueToCode(block, "VALUE", javascript.Order.ATOMIC) || "0";

  return `changeX(${value});\n`;
};

jsGenerator.forBlock["change_y"] = function (block) {
  const value =
    jsGenerator.valueToCode(block, "VALUE", javascript.Order.ATOMIC) || "0";

  return `changeY(${value});\n`;
};

jsGenerator.forBlock["set_speed"] = function (block) {
  const speed =
    jsGenerator.valueToCode(block, "SPEED", javascript.Order.ATOMIC) || "1";

  return `setSpeed(${speed});\n`;
};

jsGenerator.forBlock["glide_to"] = function (block) {
  const sec = jsGenerator.valueToCode(block, "SECONDS", 0);

  const x = jsGenerator.valueToCode(block, "X", 0);

  const y = jsGenerator.valueToCode(block, "Y", 0);

  return `await glideTo(${sec},${x},${y});\n`;
};

// =========================
// Generators for Looks Blocks
// =========================

jsGenerator.forBlock["say_text"] = function (block) {
  const text =
    jsGenerator.valueToCode(block, "TEXT", javascript.Order.ATOMIC) || '""';

  return `sayText(${text});\n`;
};

jsGenerator.forBlock["say_for_seconds"] = function (block) {
  const text = jsGenerator.valueToCode(block, "TEXT", 0) || '""';

  const sec = jsGenerator.valueToCode(block, "SECONDS", 0) || "2";

  return `
await sayForSeconds(${text},${sec});
`;
};

jsGenerator.forBlock["set_background_image"] = function (block) {
  const image = block.getFieldValue("IMAGE");

  return `
setBackgroundImage("${image}");
`;
};

jsGenerator.forBlock["next_background"] = function () {
  return `nextBackground();\n`;
};

jsGenerator.forBlock["random_background"] = function () {
  return `randomBackground();\n`;
};

jsGenerator.forBlock["change_background"] = function (block) {
  const color = block.getFieldValue("COLOR");

  return `changeBackground("${color}");\n`;
};
console.log(javascript.javascriptGenerator.forBlock["change_background"]);

jsGenerator.forBlock["add_sprite"] = function (block) {
  const sprite = block.getFieldValue("SPRITE");

  const x = jsGenerator.valueToCode(block, "X", javascript.Order.ATOMIC) || "0";

  const y = jsGenerator.valueToCode(block, "Y", javascript.Order.ATOMIC) || "0";

  return `
addSprite("${sprite}", ${x}, ${y});
`;
};

Blockly.Blocks["move_added_sprite"] = {
  init: function () {
    this.appendDummyInput().appendField("Move Sprite");

    this.appendValueInput("ID").setCheck("Number").appendField("ID");

    this.appendValueInput("X").setCheck("Number").appendField("X");

    this.appendValueInput("Y").setCheck("Number").appendField("Y");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#4C97FF");
  },
};

jsGenerator.forBlock["move_added_sprite"] = function (block) {
  const id =
    jsGenerator.valueToCode(block, "ID", javascript.Order.ATOMIC) || "0";

  const x = jsGenerator.valueToCode(block, "X", javascript.Order.ATOMIC) || "0";

  const y = jsGenerator.valueToCode(block, "Y", javascript.Order.ATOMIC) || "0";

  return `
moveSpriteTo(${id}, ${x}, ${y});
`;
};

jsGenerator.forBlock["set_sprite"] = function (block) {
  const sprite = block.getFieldValue("SPRITE");

  return `setSprite("${sprite}");\n`;
};

jsGenerator.forBlock["hide_sprite"] = function () {
  return `hideSprite();\n`;
};

jsGenerator.forBlock["show_sprite"] = function () {
  return `showSprite();\n`;
};

jsGenerator.forBlock["set_sprite_size"] = function (block) {
  const size =
    jsGenerator.valueToCode(block, "SIZE", javascript.Order.ATOMIC) || "100";

  return `setSpriteSize(${size});\n`;
};

jsGenerator.forBlock["change_size_by"] = function (block) {
  const value = jsGenerator.valueToCode(block, "SIZE", 0) || "10";

  return `
changeSpriteSizeBy(${value});
`;
};

// =========================
// Generators for Sensors Blocks
// =========================
jsGenerator.forBlock["random_number"] = function (block) {
  const min =
    jsGenerator.valueToCode(block, "MIN", javascript.Order.ATOMIC) || "1";

  const max =
    jsGenerator.valueToCode(block, "MAX", javascript.Order.ATOMIC) || "10";

  const code = `Math.floor(Math.random() * (${max} - ${min} + 1)) + ${min}`;

  return [code, javascript.Order.FUNCTION_CALL];
};

jsGenerator.forBlock["touching_edge"] = function () {
  return ["touchingEdge()", javascript.Order.FUNCTION_CALL];
};

jsGenerator.forBlock["when_touching_edge"] = function (block, generator) {
  const statements = generator.statementToCode(block, "DO");

  return `
if(touchingEdge()){
${statements}
}
`;
};

jsGenerator.forBlock["touching_sprite"] = function () {
  return ["touchingSprite()", javascript.Order.FUNCTION_CALL];
};

jsGenerator.forBlock["touching_mouse"] = function () {
  return ["touchingMouse()", javascript.Order.FUNCTION_CALL];
};

jsGenerator.forBlock["mouse_x"] = function () {
  return ["mouseX", javascript.Order.ATOMIC];
};

jsGenerator.forBlock["mouse_y"] = function () {
  return ["mouseY", javascript.Order.ATOMIC];
};

jsGenerator.forBlock["key_pressed"] = function (block) {
  const key = block.getFieldValue("KEY");

  return [`isKeyPressed("${key}")`, javascript.Order.FUNCTION_CALL];
};

jsGenerator.forBlock["sprite_x_position"] = function () {
  return ["spriteX", javascript.Order.ATOMIC];
};

jsGenerator.forBlock["sprite_y_position"] = function () {
  return ["spriteY", javascript.Order.ATOMIC];
};

jsGenerator.forBlock["ask_and_wait"] = function (block) {
  const question = block.getFieldValue("QUESTION");

  return `
    await askAndWait(${JSON.stringify(question)});
  `;
};

jsGenerator.forBlock["answer"] = function () {
  return ["userAnswer", javascript.Order.ATOMIC];
};

jsGenerator.forBlock["mouse_down"] = function () {
  return ["mouseDown", javascript.Order.ATOMIC];
};

jsGenerator.forBlock["any_key_pressed"] = function () {
  return ["anyKeyPressed()", javascript.Order.FUNCTION_CALL];
};

jsGenerator.forBlock["last_key_pressed"] = function () {
  return ["lastKeyPressed", javascript.Order.ATOMIC];
};

jsGenerator.forBlock["timer"] = function () {
  return ["getTimer()", javascript.Order.FUNCTION_CALL];
};

jsGenerator.forBlock["reset_timer"] = function () {
  return `
 resetTimer();
 `;
};

jsGenerator.forBlock["show_variable_monitor"] = function (block) {
  const visible = block.getFieldValue("VISIBLE");

  return `
 setMonitorVisible(${visible === "TRUE"});
 `;
};

// =========================
// Control Blocks Functions
// =========================
jsGenerator.forBlock["forever"] = function (block) {
  const statements = jsGenerator.statementToCode(block, "DO");

  return `
while(true){
${statements}
await wait(0.02);
}
`;
};

jsGenerator.forBlock["wait_seconds"] = function (block) {
  const seconds =
    jsGenerator.valueToCode(block, "SECONDS", javascript.Order.ATOMIC) || "1";

  return `await wait(${seconds});\n`;
};

jsGenerator.forBlock["repeat_times"] = function (block) {
  const times =
    jsGenerator.valueToCode(block, "TIMES", javascript.Order.ATOMIC) || "1";

  const statements = jsGenerator.statementToCode(block, "DO");

  return `
for(let i = 0; i < ${times}; i++){
${statements}
}
`;
};

jsGenerator.forBlock["if_block"] = function (block) {
  const condition =
    jsGenerator.valueToCode(block, "CONDITION", javascript.Order.NONE) ||
    "false";

  const statements = jsGenerator.statementToCode(block, "DO");

  return `
if(${condition}){
${statements}
}
`;
};

jsGenerator.forBlock["if_else_block"] = function (block) {
  const condition =
    jsGenerator.valueToCode(block, "CONDITION", javascript.Order.NONE) ||
    "false";

  const trueCode = jsGenerator.statementToCode(block, "TRUE");

  const falseCode = jsGenerator.statementToCode(block, "FALSE");

  return `
if(${condition}){
${trueCode}
}else{
${falseCode}
}
`;
};

jsGenerator.forBlock["repeat_until"] = function (block) {
  const condition =
    jsGenerator.valueToCode(block, "CONDITION", javascript.Order.NONE) ||
    "false";

  const statements = jsGenerator.statementToCode(block, "DO");

  return `
while(!(${condition})){
${statements}
await wait(0.02);
}
`;
};

jsGenerator.forBlock["wait_until"] = function (block) {
  const condition =
    jsGenerator.valueToCode(block, "CONDITION", javascript.Order.NONE) ||
    "false";

  return `
while(!(${condition})){
await wait(0.02);
}
`;
};

jsGenerator.forBlock["stop_all"] = function () {
  return `
stopAllScripts();
return;
`;
};

jsGenerator.forBlock["when_run_clicked"] = function (block) {
  const statements = jsGenerator.statementToCode(block, "DO");

  return `
(async ()=>{
${statements}
})();
`;
};

// PEN

jsGenerator.forBlock["pen_down"] = function () {
  return `penDownFn();\n`;
};

jsGenerator.forBlock["pen_up"] = function () {
  return `penUpFn();\n`;
};

jsGenerator.forBlock["clear_pen"] = function () {
  return `clearPen();\n`;
};

jsGenerator.forBlock["set_pen_color"] = function (block) {
  const color = block.getFieldValue("COLOR");

  return `
setPenColor("${color}");
`;
};

jsGenerator.forBlock["set_pen_size"] = function (block) {
  const size = jsGenerator.valueToCode(block, "SIZE", 0) || "2";

  return `
setPenSize(${size});
`;
};

jsGenerator.forBlock["change_pen_size"] = function (block) {
  const size = jsGenerator.valueToCode(block, "VALUE", 0) || "1";

  return `changePenSizeBy(${size});\n`;
};