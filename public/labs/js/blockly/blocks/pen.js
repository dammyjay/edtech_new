Blockly.Blocks["pen_down"] = {
  init() {
    this.appendDummyInput().appendField("Pen Down");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#0fBD8C");
  },
};

Blockly.Blocks["pen_up"] = {
  init() {
    this.appendDummyInput().appendField("Pen Up");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#0fBD8C");
  },
};

Blockly.Blocks["clear_pen"] = {
  init() {
    this.appendDummyInput().appendField("Clear");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#0fBD8C");
  },
};

Blockly.Blocks["set_pen_color"] = {
  init() {
    this.appendDummyInput()
      .appendField("Set Pen Color")
      .appendField(new Blockly.FieldColour("#ff0000"), "COLOR");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#0fBD8C");
  },
};

Blockly.Blocks["set_pen_size"] = {
  init() {
    this.appendValueInput("SIZE").appendField("Set Pen Size To");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#0fBD8C");
  },
};

Blockly.Blocks["change_pen_size"] = {
  init() {
    this.appendValueInput("VALUE").appendField("Change Pen Size By");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#0fBD8C");
  },
};