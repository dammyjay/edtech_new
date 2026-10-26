Blockly.Blocks["print_message"] = {
  init: function () {
    this.setTooltip("Prints a message to the console panel.");
    this.appendValueInput("TEXT").appendField("Print");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour(65);
  },
};


