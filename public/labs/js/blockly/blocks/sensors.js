
Blockly.Blocks["random_number"] = {
  init() {

    this.appendValueInput("MIN")
      .appendField("Random");

    this.appendValueInput("MAX")
      .appendField("to");

    this.setOutput(true,"Number");

    this.setColour("#5CB1D6");
  }
};

Blockly.Blocks["touching_edge"] = {
  init() {

    this.appendDummyInput()
      .appendField("Touching Edge?");

    this.setOutput(true,"Boolean");

    this.setColour("#5CB1D6");
  }
};

Blockly.Blocks["touching_sprite"] = {
  init() {

    this.appendDummyInput()
      .appendField("Touching Sprite?");

    this.setOutput(true, "Boolean");

    this.setColour("#5CB1D6");
  }
};

Blockly.Blocks["when_touching_edge"] = {
  init: function () {
    this.appendDummyInput().appendField("When Touching Edge");

    this.appendStatementInput("DO");

    this.setColour("#ff9800");
  },
};