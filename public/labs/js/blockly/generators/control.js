
// Blockly.JavaScript.forBlock["wait_seconds"] =
// function(block){

//  const sec =
//  Blockly.JavaScript.valueToCode(
//  block,
//  "SECONDS",
//  Blockly.JavaScript.ORDER_ATOMIC
//  ) || 1;

//  return `await wait(${sec});\n`;
// };

// Blockly.Blocks["forever"] = {
//   init() {

//     this.appendStatementInput("DO")
//       .appendField("Forever");

//     this.setPreviousStatement(true);

//     this.setColour("#FFAB19");
//   }
// };

// Blockly.JavaScript.forBlock["repeat_times"] = function (block) {
//   const times =
//     Blockly.JavaScript.valueToCode(
//       block,
//       "TIMES",
//       Blockly.JavaScript.ORDER_ATOMIC,
//     ) || 1;

//   const statements = Blockly.JavaScript.statementToCode(block, "DO");

//   return `
//  for(let i=0;i<${times};i++){
//  ${statements}
//  }
//  `;
// };


const jsGenerator = javascript.javascriptGenerator;

jsGenerator.forBlock["wait_seconds"] = function (block) {
  const seconds =
    jsGenerator.valueToCode(
      block,
      "SECONDS",
      javascript.Order.ATOMIC
    ) || "1";

  return `await wait(${seconds});\n`;
};

jsGenerator.forBlock["forever"] = function (block) {
  const statements =
    jsGenerator.statementToCode(
      block,
      "DO"
    );

  return `
while(true){
${statements}
}
`;
};

jsGenerator.forBlock["repeat_times"] = function (block) {
  const times =
    jsGenerator.valueToCode(
      block,
      "TIMES",
      javascript.Order.ATOMIC
    ) || "1";

  const statements =
    jsGenerator.statementToCode(
      block,
      "DO"
    );

  return `
for(let i = 0; i < ${times}; i++){
${statements}
}
`;
};