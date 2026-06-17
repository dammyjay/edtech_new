Blockly.Blocks["say_text"] = {
  init() {
    this.appendValueInput("TEXT").appendField("Say");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#9966FF");
  },
};

Blockly.Blocks["say_for_seconds"] = {
  init() {
    this.appendValueInput("TEXT").appendField("Say");

    this.appendValueInput("SECONDS").appendField("For");

    this.appendDummyInput().appendField("Seconds");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#9966FF");
  },
};

Blockly.Blocks["set_background_image"] = {
  init() {
    this.appendDummyInput()
      .appendField("Set Background Image to")
      .appendField(
        new Blockly.FieldDropdown([
          ["Beach", "beach"],
          ["Forest", "forest"],
          ["Space", "space"],
          ["City", "city"],
        ]),
        "IMAGE",
      );

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#9966FF");
  },
};

Blockly.Blocks["change_background"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("Change Background Color")
      .appendField(new Blockly.FieldTextInput("red"), "COLOR");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#9966FF");
  },
};

Blockly.Blocks["add_sprite"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("Add Sprite")
      .appendField(
        new Blockly.FieldDropdown([
          [
            {
              src: "/labs/images/sprites/cat.png",
              width: 30,
              height: 30,
              alt: "Cat",
            },
            "cat",
          ],
          [
            {
              src: "/labs/images/sprites/robot.png",
              width: 30,
              height: 30,
              alt: "Robot",
            },
            "robot",
          ],
          [
            {
              src: "/labs/images/sprites/dog.png",
              width: 30,
              height: 30,
              alt: "Dog",
            },
            "dog",
          ],
        ]),
        "SPRITE",
      );

    this.appendValueInput("X").setCheck("Number").appendField("x");

    this.appendValueInput("Y").setCheck("Number").appendField("y");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#9966FF");
  },
};

Blockly.Blocks["set_sprite"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("Set Sprite")
      .appendField(
        new Blockly.FieldDropdown([
          [
            {
              src: "/labs/images/sprites/cat.png",
              width: 30,
              height: 30,
              alt: "Cat",
            },
            "cat",
          ],
          [
            {
              src: "/labs/images/sprites/robot.png",
              width: 30,
              height: 30,
              alt: "Robot",
            },
            "robot",
          ],
          [
            {
              src: "/labs/images/sprites/dog.png",
              width: 30,
              height: 30,
              alt: "Dog",
            },
            "dog",
          ],
        ]),
        "SPRITE",
      );

    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour("#9966FF");
  },
};

Blockly.Blocks["hide_sprite"] = {
  init() {
    this.appendDummyInput().appendField("Hide Sprite");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#9966FF");
  },
};

Blockly.Blocks["show_sprite"] = {
  init() {
    this.appendDummyInput().appendField("Show Sprite");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#9966FF");
  },
};

Blockly.Blocks["set_sprite_size"] = {
  init() {
    this.appendValueInput("SIZE").appendField("Set Sprite Size To");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#9966FF");
  },
};

Blockly.Blocks["change_size_by"] = {
  init() {
    this.appendValueInput("SIZE").appendField("Change Size By");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#9966FF");
  },
};

Blockly.Blocks["next_background"] = {
  init() {
    this.appendDummyInput().appendField("Next Background");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#9966FF");
  },
};

Blockly.Blocks["previous_background"] = {
  init() {
    this.appendDummyInput().appendField("Previous Background");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#9966FF");
  },
};

Blockly.Blocks["random_background"] = {
  init() {
    this.appendDummyInput().appendField("Random Background");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#9966FF");
  },
};

Blockly.Blocks["set_background_image"] = {
  init() {
    this.appendDummyInput()
      .appendField("Set Background Image to")
      .appendField(
        new Blockly.FieldDropdown([
          ["Beach", "beach"],
          ["Forest", "forest"],
          ["City", "city"],
          ["Space", "space"],
        ]),
        "IMAGE",
      );

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#9966FF");
  },
};