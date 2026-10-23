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
          ["Beach", "beach.webp"],
          ["Beach 2", "beach2.webp"],
          ["Underwater", "underwater.webp"],
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
          ["Beach", "beach.webp"],
          ["Beach 2", "beach2.webp"],
          ["Underwater", "underwater.webp"],
        ]),
        "IMAGE",
      );

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#9966FF");
  },
};

Blockly.Blocks["think_text"] = {
  init() {
    this.appendValueInput("TEXT").appendField("Think");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#9966FF");
  },
};

Blockly.Blocks["think_for_seconds"] = {
  init() {
    this.appendValueInput("TEXT").appendField("Think");

    this.appendValueInput("SECONDS").appendField("For");

    this.appendDummyInput().appendField("Seconds");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#9966FF");
  },
};

Blockly.Blocks["change_graphic_effect"] = {
  init() {
    this.appendValueInput("VALUE")
      .appendField("Change")
      .appendField(
        new Blockly.FieldDropdown([
          ["color", "color"],
          ["ghost", "ghost"],
          ["brightness", "brightness"],
          ["blur", "blur"],
        ]),
        "EFFECT",
      )
      .appendField("effect by");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#9966FF");
  },
};

Blockly.Blocks["set_graphic_effect"] = {
  init() {
    this.appendValueInput("VALUE")
      .appendField("Set")
      .appendField(
        new Blockly.FieldDropdown([
          ["color", "color"],
          ["ghost", "ghost"],
          ["brightness", "brightness"],
          ["blur", "blur"],
        ]),
        "EFFECT",
      )
      .appendField("effect to");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#9966FF");
  },
};

Blockly.Blocks["clear_graphic_effects"] = {
  init() {
    this.appendDummyInput().appendField("Clear graphic effects");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#9966FF");
  },
};

Blockly.Blocks["go_to_layer"] = {
  init() {
    this.appendDummyInput()
      .appendField("Go to")
      .appendField(
        new Blockly.FieldDropdown([
          ["front", "front"],
          ["back", "back"],
        ]),
        "LAYER",
      )
      .appendField("layer");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#9966FF");
  },
};

Blockly.Blocks["go_layers"] = {
  init() {
    this.appendValueInput("VALUE")
      .appendField("Go")
      .appendField(
        new Blockly.FieldDropdown([
          ["forward", "forward"],
          ["backward", "backward"],
        ]),
        "DIRECTION",
      );

    this.appendDummyInput().appendField("layers");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#9966FF");
  },
};

Blockly.Blocks["costume_reporter"] = {
  init() {
    this.appendDummyInput().appendField("costume name");

    this.setOutput(true, "String");

    this.setColour("#9966FF");
  },
};

Blockly.Blocks["switch_costume_to"] = {
  init() {
    this.appendDummyInput()
      .appendField("Switch Costume To")
      .appendField(
        new Blockly.FieldDropdown(() => {
          // Dynamic dropdown — Blockly calls this fresh every time the
          // menu opens, so it always lists whichever sprite's workspace
          // is currently open (window.currentSprite), not a fixed list
          // baked in when the block was first placed.
          const sprite = window.currentSprite;
          const costumes = sprite && sprite.costumes && sprite.costumes.length
            ? sprite.costumes
            : [{ name: "costume1" }];
          return costumes.map((c) => [c.name, c.name]);
        }),
        "NAME",
      );

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#9966FF");
  },
};

Blockly.Blocks["next_costume"] = {
  init() {
    this.appendDummyInput().appendField("Next Costume");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#9966FF");
  },
};

Blockly.Blocks["backdrop_reporter"] = {
  init() {
    this.appendDummyInput().appendField("backdrop name");

    this.setOutput(true, "String");

    this.setColour("#9966FF");
  },
};

Blockly.Blocks["size_reporter"] = {
  init() {
    this.appendDummyInput().appendField("size");

    this.setOutput(true, "Number");

    this.setColour("#9966FF");
  },
};
