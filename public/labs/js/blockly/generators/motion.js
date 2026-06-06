console.log("looks generator loaded");

const jsGenerator = javascript.javascriptGenerator;

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

// =========================
// Generators for Looks Blocks
// =========================
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

    this.appendDummyInput()
      .appendField("Move Sprite");

    this.appendValueInput("ID")
      .setCheck("Number")
      .appendField("ID");

    this.appendValueInput("X")
      .setCheck("Number")
      .appendField("X");

    this.appendValueInput("Y")
      .setCheck("Number")
      .appendField("Y");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour(290);
  }
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