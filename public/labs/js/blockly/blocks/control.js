Blockly.Blocks["forever"] = {
  init() {

    this.appendStatementInput("DO")
      .appendField("Forever");

    this.setPreviousStatement(true);

    this.setColour("#FFAB19");
  }
};

Blockly.Blocks["wait_seconds"] = {
  init() {

    this.appendValueInput("SECONDS")
      .appendField("Wait");

    this.appendDummyInput()
      .appendField("seconds");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#FFAB19");
  }
};


Blockly.Blocks["repeat_times"] = {
  init() {

    this.appendValueInput("TIMES")
      .appendField("Repeat");

    this.appendStatementInput("DO");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#FFAB19");
  }
};
