Blockly.Blocks["print_message"] = {
  init: function () {
    this.appendValueInput("TEXT").appendField("Print");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour(65);
  },
};


