// Blockly.Blocks["move_sprite"] = {
//   init: function () {
//     this.appendDummyInput().appendField("Move Sprite");

//     this.appendValueInput("STEPS").setCheck("Number").appendField("by");

//     this.appendDummyInput().appendField("steps");

//     this.setPreviousStatement(true);
//     this.setNextStatement(true);

//     this.setColour("#4C97FF");
//   },
// };

Blockly.Blocks["move_sprite"] = {
  init: function () {
    this.setTooltip("Moves the sprite forward by the given number of steps, in the direction it's facing.");
    this.appendDummyInput().appendField("Move Sprite");

    this.appendValueInput("STEPS").setCheck("Number").appendField("by");

    this.appendDummyInput().appendField("steps");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#4C97FF");
  },
};

Blockly.Blocks["turn_sprite"] = {
  init: function () {
    this.setTooltip("Turns the sprite clockwise by the given number of degrees.");
    this.appendDummyInput().appendField("Turn Sprite");

    this.appendValueInput("ANGLE").setCheck("Number").appendField("by");

    this.appendDummyInput().appendField("degrees");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#4C97FF");
  },
};

Blockly.Blocks["point_direction"] = {
  init: function () {
    this.setTooltip("Points the sprite in the given direction (0 = up, 90 = right).");
    this.appendDummyInput().appendField("Point in direction");

    this.appendValueInput("DIRECTION").setCheck("Number");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#4C97FF");
  },
};

Blockly.Blocks["go_to_position"] = {
  init: function () {
    this.setTooltip("Moves the sprite instantly to a chosen position (a random spot, or the mouse pointer).");
    this.appendDummyInput().appendField("Go to");

    this.appendValueInput("X").setCheck("Number").appendField("x:");

    this.appendValueInput("Y").setCheck("Number").appendField("y:");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#4C97FF");
  },
};

Blockly.Blocks["set_speed"] = {
  init: function () {
    this.setTooltip("Sets how fast the sprite moves and glides.");
    this.appendDummyInput().appendField("Set Speed");

    this.appendValueInput("SPEED").setCheck("Number").appendField("to");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#4C97FF");
  },
};

Blockly.Blocks["change_x"] = {
  init() {
    this.setTooltip("Changes the sprite's x position by the given amount.");
    this.appendValueInput("VALUE").appendField("Change X By");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#4C97FF");
  },
};

Blockly.Blocks["change_y"] = {
  init() {
    this.setTooltip("Changes the sprite's y position by the given amount.");
    this.appendValueInput("VALUE").appendField("Change Y By");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#4C97FF");
  },
};

Blockly.Blocks["glide_to"] = {
  init() {
    this.setTooltip("Smoothly moves the sprite to a position over the given number of seconds.");
    this.appendValueInput("SECONDS").appendField("Glide");

    this.appendValueInput("X").appendField("to X");

    this.appendValueInput("Y").appendField("Y");

    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour("#4C97FF");
  },
};

// Scratch has two separate turn blocks (clockwise ↻ / counter-clockwise
// ↺) rather than a signed angle on one block — turn_sprite above is the
// clockwise one; this is its mirror.
Blockly.Blocks["turn_sprite_ccw"] = {
  init: function () {
    this.setTooltip("Turns the sprite counter-clockwise by the given number of degrees.");
    this.appendDummyInput().appendField("Turn ↺ Sprite");

    this.appendValueInput("ANGLE").setCheck("Number").appendField("by");

    this.appendDummyInput().appendField("degrees");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#4C97FF");
  },
};

Blockly.Blocks["set_x"] = {
  init: function () {
    this.setTooltip("Sets the sprite's x position.");
    this.appendValueInput("VALUE").setCheck("Number").appendField("Set X to");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#4C97FF");
  },
};

Blockly.Blocks["set_y"] = {
  init: function () {
    this.setTooltip("Sets the sprite's y position.");
    this.appendValueInput("VALUE").setCheck("Number").appendField("Set Y to");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#4C97FF");
  },
};

Blockly.Blocks["if_on_edge_bounce"] = {
  init: function () {
    this.setTooltip("Makes the sprite bounce back when it touches the edge of the stage.");
    this.appendDummyInput().appendField("If on edge, bounce");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#4C97FF");
  },
};

Blockly.Blocks["set_rotation_style"] = {
  init: function () {
    this.setTooltip("Sets how the sprite rotates when it changes direction.");
    this.appendDummyInput()
      .appendField("Set rotation style")
      .appendField(
        new Blockly.FieldDropdown([
          ["left-right", "LEFT_RIGHT"],
          ["don't rotate", "NONE"],
          ["all around", "ALL_AROUND"],
        ]),
        "STYLE"
      );

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#4C97FF");
  },
};

Blockly.Blocks["sprite_direction"] = {
  init: function () {
    this.setTooltip("Reports the direction the sprite is currently facing.");
    this.appendDummyInput().appendField("direction");

    this.setOutput(true, "Number");

    this.setColour("#4C97FF");
  },
};