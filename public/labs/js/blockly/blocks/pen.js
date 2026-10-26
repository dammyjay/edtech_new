Blockly.Blocks["pen_down"] = {
  init() {
    this.setTooltip("Starts drawing a trail as the sprite moves.");
    this.appendDummyInput().appendField("Pen Down");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#0fBD8C");
  },
};

Blockly.Blocks["pen_up"] = {
  init() {
    this.setTooltip("Stops drawing a trail.");
    this.appendDummyInput().appendField("Pen Up");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#0fBD8C");
  },
};

Blockly.Blocks["clear_pen"] = {
  init() {
    this.setTooltip("Erases every pen mark and stamp from the stage.");
    this.appendDummyInput().appendField("Clear");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#0fBD8C");
  },
};

// Blockly.Blocks["set_pen_color"] = {
//   init() {
//     this.appendDummyInput()
//       .appendField("Set Pen Color")
//       .appendField(new Blockly.FieldColour("#ff0000"), "COLOR");

//     this.setPreviousStatement(true);
//     this.setNextStatement(true);

//     this.setColour("#0fBD8C");
//   },
// };

Blockly.Blocks["set_pen_color"] = {
  init() {
    this.setTooltip("Sets the pen color to one of a few preset colors.");
    this.appendDummyInput()
      .appendField("Set Pen Color")
      .appendField(
        new Blockly.FieldDropdown([
          ["Red", "#ff0000"],
          ["Blue", "#0000ff"],
          ["Green", "#00ff00"],
          ["Black", "#000000"],
        ]),
        "COLOR",
      );

    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour("#0fBD8C");
  },
};

Blockly.Blocks["set_pen_size"] = {
  init() {
    this.setTooltip("Sets how thick the pen's drawn line is.");
    this.appendValueInput("SIZE").appendField("Set Pen Size To");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#0fBD8C");
  },
};

Blockly.Blocks["change_pen_size"] = {
  init() {
    this.setTooltip("Changes the pen's line thickness by the given amount.");
    this.appendValueInput("VALUE").appendField("Change Pen Size By");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#0fBD8C");
  },
};

Blockly.Blocks["stamp"] = {
  init() {
    this.setTooltip("Stamps a copy of the sprite's current costume onto the stage.");
    this.appendDummyInput().appendField("Stamp");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#0fBD8C");
  },
};

Blockly.Blocks["change_pen_color"] = {
  init() {
    this.setTooltip("Changes the pen's hue by the given amount.");
    this.appendValueInput("VALUE").appendField("Change Pen Color By");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#0fBD8C");
  },
};

Blockly.Blocks["set_pen_property"] = {
  init() {
    this.setTooltip("Sets the pen's color, saturation, brightness, or transparency to a value (0-100).");
    this.appendValueInput("VALUE")
      .appendField("Set Pen")
      .appendField(
        new Blockly.FieldDropdown([
          ["Color", "color"],
          ["Saturation", "saturation"],
          ["Brightness", "brightness"],
          ["Transparency", "transparency"],
        ]),
        "PROPERTY",
      )
      .appendField("To");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#0fBD8C");
  },
};

Blockly.Blocks["change_pen_property"] = {
  init() {
    this.setTooltip("Changes the pen's color, saturation, brightness, or transparency by the given amount.");
    this.appendValueInput("VALUE")
      .appendField("Change Pen")
      .appendField(
        new Blockly.FieldDropdown([
          ["Color", "color"],
          ["Saturation", "saturation"],
          ["Brightness", "brightness"],
          ["Transparency", "transparency"],
        ]),
        "PROPERTY",
      )
      .appendField("By");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#0fBD8C");
  },
};