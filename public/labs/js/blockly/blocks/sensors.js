Blockly.Blocks["random_number"] = {
  init() {
    this.setTooltip("Reports a random whole number between the two given numbers.");

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
    this.setTooltip("Reports true if the sprite is touching the edge of the stage.");

    this.appendDummyInput()
      .appendField("Touching Edge?");

    this.setOutput(true,"Boolean");

    this.setColour("#5CB1D6");
  }
};

Blockly.Blocks["touching_sprite"] = {
  init() {
    this.setTooltip("Reports true if the sprite is touching another sprite.");

    this.appendDummyInput()
      .appendField("Touching Sprite?");

    this.setOutput(true, "Boolean");

    this.setColour("#5CB1D6");
  }
};

Blockly.Blocks["when_touching_edge"] = {
  init: function () {
    this.setTooltip("Runs the blocks inside whenever the sprite touches the edge of the stage.");
    this.appendDummyInput().appendField("When Touching Edge");

    this.appendStatementInput("DO");

    this.setColour("#5CB1D6");
  },
};

Blockly.Blocks["touching_mouse"] = {
  init() {
    this.setTooltip("Reports true if the sprite is touching the mouse pointer.");
    this.appendDummyInput().appendField("Touching Mouse?");

    this.setOutput(true, "Boolean");

    this.setColour("#5CB1D6");
  },
};

Blockly.Blocks["mouse_x"] = {
  init() {
    this.setTooltip("Reports the mouse pointer's current x position.");
    this.appendDummyInput().appendField("Mouse X");

    this.setOutput(true, "Number");

    this.setColour("#5CB1D6");
  },
};

Blockly.Blocks["mouse_y"] = {
  init() {
    this.setTooltip("Reports the mouse pointer's current y position.");
    this.appendDummyInput().appendField("Mouse Y");

    this.setOutput(true, "Number");

    this.setColour("#5CB1D6");
  },
};

Blockly.Blocks["key_pressed"] = {
  init() {
    this.setTooltip("Reports true while the chosen key is held down.");
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
    this.setTooltip("Reports the sprite's current x position.");
    this.appendDummyInput().appendField("Sprite X");

    this.setOutput(true, "Number");

    this.setColour("#5CB1D6");
  },
};

Blockly.Blocks["sprite_y_position"] = {
  init() {
    this.setTooltip("Reports the sprite's current y position.");
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
    this.setTooltip("Shows a question and a text box, and waits for the student to answer.");
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
    this.setTooltip("Reports the most recent answer typed into Ask And Wait.");
    this.appendDummyInput().appendField("Answer");

    this.setOutput(true, "String");

    this.setColour("#5CB1D6");
  },
};

Blockly.Blocks["mouse_down"] = {
  init() {
    this.setTooltip("Reports true while the mouse button is held down.");
    this.appendDummyInput().appendField("Mouse Down?");

    this.setOutput(true, "Boolean");

    this.setColour("#5CB1D6");
  },
};

Blockly.Blocks["any_key_pressed"] = {
  init() {
    this.setTooltip("Reports true while any key is held down.");
    this.appendDummyInput().appendField("Any Key Pressed?");

    this.setOutput(true, "Boolean");

    this.setColour("#5CB1D6");
  },
};

Blockly.Blocks["last_key_pressed"] = {
  init() {
    this.setTooltip("Reports the name of the most recently pressed key.");
    this.appendDummyInput().appendField("Last Key Pressed");

    this.setOutput(true, "String");

    this.setColour("#5CB1D6");
  },
};

Blockly.Blocks["timer"] = {
  init() {
    this.setTooltip("Reports how many seconds have passed since the timer last reset.");
    this.appendDummyInput().appendField("Timer");

    this.setOutput(true, "Number");

    this.setColour("#5CB1D6");
  },
};

Blockly.Blocks["reset_timer"] = {
  init() {
    this.setTooltip("Resets the timer back to zero.");
    this.appendDummyInput().appendField("Reset Timer");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#5CB1D6");
  },
};

Blockly.Blocks["touching_sprite_named"] = {
  init() {
    this.setTooltip("Reports true if the sprite is touching the named sprite.");
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
    this.setTooltip("Reports the distance from this sprite to the named sprite.");
    this.appendDummyInput()
      .appendField("Distance To")
      .appendField(new Blockly.FieldTextInput("Sprite2"), "SPRITE");

    this.setOutput(true, "Number");

    this.setColour("#5CB1D6");
  },
};

Blockly.Blocks["distance_to_mouse"] = {
  init() {
    this.setTooltip("Reports the distance from this sprite to the mouse pointer.");
    this.appendDummyInput().appendField("Distance To Mouse");

    this.setOutput(true, "Number");

    this.setColour("#5CB1D6");
  },
};

Blockly.Blocks["attribute_of_sprite"] = {
  init() {
    this.setTooltip("Reports a chosen attribute (x, y, direction, size, costume, visible) of the named sprite.");
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
    this.setTooltip("Reports the current year, month, date, day, hour, minute, or second.");
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
    this.setTooltip("Reports how many days have passed since January 1, 2000.");
    this.appendDummyInput().appendField("Days Since 2000");

    this.setOutput(true, "Number");

    this.setColour("#5CB1D6");
  },
};

Blockly.Blocks["username_reporter"] = {
  init() {
    this.setTooltip("Reports the logged-in student's username.");
    this.appendDummyInput().appendField("Username");

    this.setOutput(true, "String");

    this.setColour("#5CB1D6");
  },
};

Blockly.Blocks["show_variable_monitor"] = {
  init() {
    this.setTooltip("Shows or hides the on-stage X position monitor.");
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
    this.setTooltip("Reports true if the sprite is touching the chosen color.");
    this.appendDummyInput()
      .appendField("Touching Color")
      .appendField(
        // A plain color-swatch dropdown, not Blockly.FieldColour — that
        // constructor isn't bundled in core Blockly in the version loaded
        // here (moved to a separate, unloaded plugin in modern Blockly),
        // so using it threw at block-construction time and made this
        // block silently unusable. Matches the same swatch-dropdown
        // pattern already used by the Pen category's "Set Pen Color".
        new Blockly.FieldDropdown([
          ["Red", "#ff0000"],
          ["Blue", "#0000ff"],
          ["Green", "#00ff00"],
          ["Yellow", "#ffff00"],
          ["Black", "#000000"],
          ["White", "#ffffff"],
        ]),
        "COLOR",
      );

    this.setOutput(true, "Boolean");

    this.setColour("#5CB1D6");
  },
};

Blockly.Blocks["set_drag_mode"] = {
  init() {
    this.setTooltip("Sets whether this sprite can be dragged with the mouse while the project runs.");
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