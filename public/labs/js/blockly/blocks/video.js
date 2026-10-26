// Video Sensing — webcam motion detection. See engine.js's VIDEO SENSING
// section for the camera render/analysis loop and the registerVideoMotionWatch
// continuous-watch trigger (same pattern as the Sensing category's
// "when timer > value").

Blockly.Blocks["turn_video"] = {
  init() {
    this.appendDummyInput()
      .appendField("Turn Video")
      .appendField(
        new Blockly.FieldDropdown([
          ["On", "on"],
          ["Off", "off"],
        ]),
        "STATE",
      );

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#0FBD8C");
  },
};

Blockly.Blocks["set_video_transparency"] = {
  init() {
    this.appendValueInput("VALUE").appendField("Set Video Transparency To");

    this.appendDummyInput().appendField("%");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#0FBD8C");
  },
};

Blockly.Blocks["video_sensing_reporter"] = {
  init() {
    this.appendDummyInput()
      .appendField("video")
      .appendField(
        new Blockly.FieldDropdown([
          ["motion", "motion"],
          ["direction", "direction"],
        ]),
        "ATTRIBUTE",
      )
      .appendField("on")
      .appendField(
        new Blockly.FieldDropdown([
          ["sprite", "sprite"],
          ["stage", "stage"],
        ]),
        "TARGET",
      );

    this.setOutput(true, "Number");

    this.setColour("#0FBD8C");
  },
};

Blockly.Blocks["when_video_motion_greater_than"] = {
  init() {
    this.appendValueInput("VALUE").appendField("When Video Motion >");

    this.appendStatementInput("DO");

    this.setColour("#0FBD8C");
  },
};
