
Blockly.Blocks["when_run_clicked"] = {
  init: function () {
    this.setTooltip("Runs the blocks inside when the green Run button is clicked.");
    this.appendDummyInput().appendField("When Run Clicked");

    this.appendStatementInput("DO");

    this.setColour("#ffd900");
  },
};

Blockly.Blocks["when_key_pressed"] = {
  init() {
    this.setTooltip("Runs the blocks inside when the chosen key is pressed.");
    this.appendDummyInput()
      .appendField("When Key")
      .appendField(
        new Blockly.FieldDropdown([
          ["Space", " "],
          ["Up Arrow", "ArrowUp"],
          ["Down Arrow", "ArrowDown"],
          ["Left Arrow", "ArrowLeft"],
          ["Right Arrow", "ArrowRight"],
          ["A", "a"],
          ["B", "b"],
          ["C", "c"],
          ["D", "d"],
          ["E", "e"],
          ["F", "f"],
          ["G", "g"],
          ["H", "h"],
          ["I", "i"],
          ["J", "j"],
          ["K", "k"],
          ["L", "l"],
          ["M", "m"],
          ["N", "n"],
          ["O", "o"],
          ["P", "p"],
          ["Q", "q"],
          ["R", "r"],
          ["S", "s"],
          ["T", "t"],
          ["U", "u"],
          ["V", "v"],
          ["W", "w"],
          ["X", "x"],
          ["Y", "y"],
          ["Z", "z"],
        ]),
        "KEY",
      )
      .appendField("Pressed");

    this.appendStatementInput("DO");

    this.setColour("#FFD500");
  },
};

Blockly.Blocks["when_sprite_clicked"] = {
  init() {
    this.setTooltip("Runs the blocks inside when this sprite is clicked or tapped.");
    this.appendDummyInput().appendField("When Sprite Clicked");

    this.appendStatementInput("DO");

    this.setColour("#FFD500");
  },
};

Blockly.Blocks["broadcast_message"] = {
  init() {
    this.setTooltip("Sends a message to every sprite listening for it.");
    this.appendDummyInput()
      .appendField("Broadcast")
      .appendField(new Blockly.FieldTextInput("message1"), "MESSAGE");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#FFD500");
  },
};

Blockly.Blocks["when_message_received"] = {
  init() {
    this.setTooltip("Runs the blocks inside when the chosen broadcast message is received.");
    this.appendDummyInput()
      .appendField("When I Receive")
      .appendField(new Blockly.FieldTextInput("message1"), "MESSAGE");

    this.appendStatementInput("DO");

    this.setColour("#FFD500");
  },
};

Blockly.Blocks["broadcast_and_wait"] = {
  init() {
    this.setTooltip("Sends a message and waits until every sprite that received it finishes responding.");
    this.appendDummyInput()
      .appendField("Broadcast")
      .appendField(new Blockly.FieldTextInput("message1"), "MESSAGE")
      .appendField("and Wait");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#FFD500");
  },
};

Blockly.Blocks["when_backdrop_switches"] = {
  init() {
    this.setTooltip("Runs the blocks inside when the backdrop changes to the chosen one.");
    this.appendDummyInput()
      .appendField("When Backdrop Switches To")
      .appendField(new Blockly.FieldTextInput("Backdrop1"), "BACKDROP");

    this.appendStatementInput("DO");

    this.setColour("#FFD500");
  },
};

Blockly.Blocks["when_timer_greater_than"] = {
  init() {
    this.setTooltip("Runs the blocks inside once the timer passes the given number of seconds.");
    this.appendValueInput("VALUE").appendField("When Timer >");

    this.appendStatementInput("DO");

    this.setColour("#FFD500");
  },
};