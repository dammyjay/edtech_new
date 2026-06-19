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
    this.appendDummyInput().appendField("Move Sprite");

    this.appendValueInput("STEPS").setCheck("Number").appendField("by");

    this.appendDummyInput().appendField("steps");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#4C97FF");
  },
};

Blockly.Blocks["move_added_sprite"] = {
  init: function () {
    this.appendDummyInput().appendField("Move Sprite");

    this.appendValueInput("ID").setCheck("Number").appendField("ID");

    this.appendValueInput("X").setCheck("Number").appendField("X");

    this.appendValueInput("Y").setCheck("Number").appendField("Y");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#4C97FF");
  },
};

Blockly.Blocks["turn_sprite"] = {
  init: function () {
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
    this.appendDummyInput().appendField("Point in direction");

    this.appendValueInput("DIRECTION").setCheck("Number");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#4C97FF");
  },
};

Blockly.Blocks["go_to_position"] = {
  init: function () {
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
    this.appendDummyInput().appendField("Set Speed");

    this.appendValueInput("SPEED").setCheck("Number").appendField("to");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#4C97FF");
  },
};

Blockly.Blocks["change_x"] = {
  init() {
    this.appendValueInput("VALUE").appendField("Change X By");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#4C97FF");
  },
};

Blockly.Blocks["change_y"] = {
  init() {
    this.appendValueInput("VALUE").appendField("Change Y By");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#4C97FF");
  },
};

Blockly.Blocks["glide_to"] = {
  init() {
    this.appendValueInput("SECONDS").appendField("Glide");

    this.appendValueInput("X").appendField("to X");

    this.appendValueInput("Y").appendField("Y");

    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour("#4C97FF");
  },
};