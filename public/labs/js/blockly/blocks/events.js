// Blockly.Blocks["when_run_clicked"] = {
//   init: function () {
//     this.appendDummyInput()
//       .appendField("🚩 When Run Clicked");

//     this.setNextStatement(true);

//     this.setColour("#ffbf00");
//   }
// };

Blockly.Blocks["when_run_clicked"] = {
  init: function () {
    this.appendDummyInput().appendField("When Run Clicked");

    this.appendStatementInput("DO");

    this.setColour("#ff9800");
  },
};