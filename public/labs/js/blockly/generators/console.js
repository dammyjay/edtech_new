// Blockly.JavaScript["print_message"] = function (block) {
//   const text =
//     Blockly.JavaScript.valueToCode(
//       block,
//       "TEXT",
//       Blockly.JavaScript.ORDER_ATOMIC,
//     ) || '""';

//   return `logMessage(${text});\n`;
// };

// console.log(
//   "print_message generator loaded",
//   Blockly.JavaScript["print_message"],
// );

const jsGenerator = javascript.javascriptGenerator;

jsGenerator.forBlock["print_message"] = function (block, generator) {
  const text =
    generator.valueToCode(block, "TEXT", javascript.Order.ATOMIC) || '""';

  return `logMessage(${text});\n`;
};

console.log("Generator registered:", jsGenerator.forBlock["print_message"]);