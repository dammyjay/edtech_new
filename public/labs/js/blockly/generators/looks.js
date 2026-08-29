
console.log("looks generator loaded");
// jsGenerator is declared once in generators/motion.js (loaded first) —
// shared here since classic <script> tags share one global scope.
console.log("looks generator loaded after");

jsGenerator.forBlock["change_background"] = function (block) {
  const color = block.getFieldValue("COLOR");

  return `changeBackground("${color}");\n`;
};
console.log(
  javascript.javascriptGenerator.forBlock["change_background"]
);

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

jsGenerator.forBlock["change_x"] = function (block) {
  const value =
    jsGenerator.valueToCode(block, "VALUE", javascript.Order.ATOMIC) || "0";

  return `changeX(${value});\n`;
};