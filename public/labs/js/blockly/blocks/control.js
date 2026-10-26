Blockly.Blocks["forever"] = {
  init() {
    this.setTooltip("Repeats the blocks inside forever, until the program is stopped.");

    this.appendStatementInput("DO")
      .appendField("Forever");

    this.setPreviousStatement(true);

    this.setColour("#FFAB19");
  }
};

Blockly.Blocks["wait_seconds"] = {
  init() {
    this.setTooltip("Pauses the script for the given number of seconds.");

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
    this.setTooltip("Repeats the blocks inside a set number of times.");

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
    this.setTooltip("Runs the blocks inside only if the condition is true.");
    this.appendValueInput("CONDITION").setCheck("Boolean").appendField("if");

    this.appendStatementInput("DO").appendField("then");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#FFAB19");
  },
};

Blockly.Blocks["if_else_block"] = {
  init() {
    this.setTooltip("Runs one set of blocks if the condition is true, another set if it's false.");
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
    this.setTooltip("Repeats the blocks inside until the condition becomes true.");
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
    this.setTooltip("Pauses the script until the condition becomes true.");
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
    this.setTooltip("Stops every running script.");
    this.appendDummyInput().appendField("stop all");

    this.setPreviousStatement(true);

    this.setColour("#FFAB19");
  },
};