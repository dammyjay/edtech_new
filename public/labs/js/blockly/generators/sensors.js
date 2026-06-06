// Blockly.JavaScript.forBlock["random_number"] = function (block) {
//   const min =
//     Blockly.JavaScript.valueToCode(
//       block,
//       "MIN",
//       Blockly.JavaScript.ORDER_ATOMIC,
//     ) || 1;

//   const max =
//     Blockly.JavaScript.valueToCode(
//       block,
//       "MAX",
//       Blockly.JavaScript.ORDER_ATOMIC,
//     ) || 10;

//   const code = `Math.floor(Math.random()*(${max}-${min}+1))+${min}`;

//   return [code, Blockly.JavaScript.ORDER_FUNCTION_CALL];
// };

// Blockly.JavaScript.forBlock["random_number"] = function (block) {
//   const min =
//     Blockly.JavaScript.valueToCode(
//       block,
//       "MIN",
//       Blockly.JavaScript.ORDER_ATOMIC,
//     ) || 1;

//   const max =
//     Blockly.JavaScript.valueToCode(
//       block,
//       "MAX",
//       Blockly.JavaScript.ORDER_ATOMIC,
//     ) || 10;

//   const code = `Math.floor(Math.random()*(${max}-${min}+1))+${min}`;

//   return [code, Blockly.JavaScript.ORDER_FUNCTION_CALL];
// };

const jsGenerator = javascript.javascriptGenerator;

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

jsGenerator.forBlock["touching_sprite"] = function () {
  return ["touchingSprite()", javascript.Order.FUNCTION_CALL];
};