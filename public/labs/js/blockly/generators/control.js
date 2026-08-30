
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


// jsGenerator is declared once in generators/motion.js (loaded first) —
// shared here since classic <script> tags share one global scope.

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

  // await wait(0.02) every iteration is required, not optional — without
  // a yield point, this compiles to a synchronous while(true) that freezes
  // the browser tab if the student's own blocks don't already include a
  // wait. Matches the same pattern already used by repeat_until/wait_until.
  return `
while(true){
${statements}
checkStop();
await wait(0.02);
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

  // Same yield-per-iteration requirement as forever/repeat_until — without
  // it the loop runs fully synchronously in one JS tick and the browser
  // never repaints between iterations, so only the final state is visible.
  return `
for(let i = 0; i < ${times}; i++){
${statements}
checkStop();
await wait(0.02);
}
`;
};