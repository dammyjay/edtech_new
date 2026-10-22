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

// Blockly.Blocks["ask_and_wait"] = {
//   init() {
//     this.appendValueInput("QUESTION").appendField("Ask");

//     this.appendDummyInput().appendField("and wait");

//     this.setPreviousStatement(true);
//     this.setNextStatement(true);

//     this.setColour("#5CB1D6");
//   },
// };

Blockly.Blocks["ask_and_wait"] = {
  init() {
    this.appendDummyInput()
      .appendField("Ask")
      .appendField(new Blockly.FieldTextInput("What is your name?"), "QUESTION")
      .appendField("and wait");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#5CB1D6");
  },
};

Blockly.Blocks["answer"] = {
  init() {
    this.appendDummyInput().appendField("Answer");

    this.setOutput(true, "String");

    this.setColour("#5CB1D6");
  },
};

Blockly.Blocks["mouse_down"] = {
  init() {
    this.appendDummyInput().appendField("Mouse Down?");

    this.setOutput(true, "Boolean");

    this.setColour("#5CB1D6");
  },
};

Blockly.Blocks["any_key_pressed"] = {
  init() {
    this.appendDummyInput().appendField("Any Key Pressed?");

    this.setOutput(true, "Boolean");

    this.setColour("#5CB1D6");
  },
};

Blockly.Blocks["last_key_pressed"] = {
  init() {
    this.appendDummyInput().appendField("Last Key Pressed");

    this.setOutput(true, "String");

    this.setColour("#5CB1D6");
  },
};

Blockly.Blocks["timer"] = {
  init() {
    this.appendDummyInput().appendField("Timer");

    this.setOutput(true, "Number");

    this.setColour("#5CB1D6");
  },
};

Blockly.Blocks["reset_timer"] = {
  init() {
    this.appendDummyInput().appendField("Reset Timer");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#5CB1D6");
  },
};

Blockly.Blocks["touching_sprite_named"] = {
  init() {
    this.appendDummyInput()
      .appendField("Touching")
      .appendField(new Blockly.FieldTextInput("Sprite2"), "SPRITE")
      .appendField("?");

    this.setOutput(true, "Boolean");

    this.setColour("#5CB1D6");
  },
};

Blockly.Blocks["distance_to_sprite"] = {
  init() {
    this.appendDummyInput()
      .appendField("Distance To")
      .appendField(new Blockly.FieldTextInput("Sprite2"), "SPRITE");

    this.setOutput(true, "Number");

    this.setColour("#5CB1D6");
  },
};

Blockly.Blocks["distance_to_mouse"] = {
  init() {
    this.appendDummyInput().appendField("Distance To Mouse");

    this.setOutput(true, "Number");

    this.setColour("#5CB1D6");
  },
};

Blockly.Blocks["attribute_of_sprite"] = {
  init() {
    this.appendDummyInput()
      .appendField(
        new Blockly.FieldDropdown([
          ["x position", "x"],
          ["y position", "y"],
          ["direction", "direction"],
          ["size", "size"],
          ["costume name", "costume"],
          ["visible?", "visible"],
        ]),
        "ATTRIBUTE",
      )
      .appendField("of")
      .appendField(new Blockly.FieldTextInput("Sprite2"), "SPRITE");

    this.setOutput(true, null);

    this.setColour("#5CB1D6");
  },
};

Blockly.Blocks["current_date_time"] = {
  init() {
    this.appendDummyInput()
      .appendField("Current")
      .appendField(
        new Blockly.FieldDropdown([
          ["year", "year"],
          ["month", "month"],
          ["date", "date"],
          ["day of week", "day_of_week"],
          ["hour", "hour"],
          ["minute", "minute"],
          ["second", "second"],
        ]),
        "PART",
      );

    this.setOutput(true, "Number");

    this.setColour("#5CB1D6");
  },
};

Blockly.Blocks["days_since_2000"] = {
  init() {
    this.appendDummyInput().appendField("Days Since 2000");

    this.setOutput(true, "Number");

    this.setColour("#5CB1D6");
  },
};

Blockly.Blocks["username_reporter"] = {
  init() {
    this.appendDummyInput().appendField("Username");

    this.setOutput(true, "String");

    this.setColour("#5CB1D6");
  },
};

Blockly.Blocks["show_variable_monitor"] = {
  init() {
    this.appendDummyInput()
      .appendField(new Blockly.FieldCheckbox("TRUE"), "VISIBLE")
      .appendField("Show X Position");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#5CB1D6");
  },
};

Blockly.Blocks["touching_color"] = {
  init() {
    this.appendDummyInput()
      .appendField("Touching Color")
      .appendField(new Blockly.FieldColour("#ff0000"), "COLOR");

    this.setOutput(true, "Boolean");

    this.setColour("#5CB1D6");
  },
};

Blockly.Blocks["set_drag_mode"] = {
  init() {
    this.appendDummyInput()
      .appendField("Set Drag Mode")
      .appendField(
        new Blockly.FieldDropdown([
          ["Draggable", "draggable"],
          ["Not Draggable", "not draggable"],
        ]),
        "MODE",
      );

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#5CB1D6");
  },
};