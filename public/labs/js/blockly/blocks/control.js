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


Blockly.Blocks["if_block"] = {
  init() {
    this.appendValueInput("CONDITION").setCheck("Boolean").appendField("if");

    this.appendStatementInput("DO").appendField("then");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#FFAB19");
  },
};

Blockly.Blocks["if_else_block"] = {
  init() {
    this.appendValueInput("CONDITION").setCheck("Boolean").appendField("if");

    this.appendStatementInput("TRUE").appendField("then");

    this.appendStatementInput("FALSE").appendField("else");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#FFAB19");
  },
};

Blockly.Blocks["repeat_until"] = {
  init() {
    this.appendValueInput("CONDITION")
      .setCheck("Boolean")
      .appendField("repeat until");

    this.appendStatementInput("DO");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#FFAB19");
  },
};

Blockly.Blocks["wait_until"] = {
  init() {
    this.appendValueInput("CONDITION")
      .setCheck("Boolean")
      .appendField("wait until");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#FFAB19");
  },
};

Blockly.Blocks["stop_all"] = {
  init() {
    this.appendDummyInput().appendField("stop all");

    this.setPreviousStatement(true);

    this.setColour("#FFAB19");
  },
};