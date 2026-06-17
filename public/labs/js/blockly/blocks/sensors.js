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

    this.setColour("#5CB1D6");
  },
};

Blockly.Blocks["touching_mouse"] = {
  init() {
    this.appendDummyInput().appendField("Touching Mouse?");

    this.setOutput(true, "Boolean");

    this.setColour("#5CB1D6");
  },
};

Blockly.Blocks["mouse_x"] = {
  init() {
    this.appendDummyInput().appendField("Mouse X");

    this.setOutput(true, "Number");

    this.setColour("#5CB1D6");
  },
};

Blockly.Blocks["mouse_y"] = {
  init() {
    this.appendDummyInput().appendField("Mouse Y");

    this.setOutput(true, "Number");

    this.setColour("#5CB1D6");
  },
};

Blockly.Blocks["key_pressed"] = {
  init() {
    this.appendDummyInput()
      .appendField("Key")
      .appendField(
        new Blockly.FieldDropdown([
          ["Space", " "],
          ["Up", "ArrowUp"],
          ["Down", "ArrowDown"],
          ["Left", "ArrowLeft"],
          ["Right", "ArrowRight"],
        ]),
        "KEY",
      )
      .appendField("Pressed?");

    this.setOutput(true, "Boolean");

    this.setColour("#5CB1D6");
  },
};

Blockly.Blocks["sprite_x_position"] = {
  init() {
    this.appendDummyInput().appendField("Sprite X");

    this.setOutput(true, "Number");

    this.setColour("#5CB1D6");
  },
};

Blockly.Blocks["sprite_y_position"] = {
  init() {
    this.appendDummyInput().appendField("Sprite Y");

    this.setOutput(true, "Number");

    this.setColour("#5CB1D6");
  },
};