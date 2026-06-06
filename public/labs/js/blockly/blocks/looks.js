

Blockly.Blocks["change_background"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("Change Background")
      .appendField(new Blockly.FieldTextInput("red"), "COLOR");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour(20);
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

    this.setColour(290);
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

    this.setColour(290);
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
    this.setColour(200);
  },
};

Blockly.Blocks["hide_sprite"] = {
  init() {

    this.appendDummyInput()
      .appendField("Hide Sprite");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#9966FF");
  }
};

Blockly.Blocks["show_sprite"] = {
  init() {

    this.appendDummyInput()
      .appendField("Show Sprite");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#9966FF");
  }
};