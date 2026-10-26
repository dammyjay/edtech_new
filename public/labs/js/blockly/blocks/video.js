// Video Sensing — webcam motion detection. See engine.js's VIDEO SENSING
// section for the camera render/analysis loop and the registerVideoMotionWatch
// continuous-watch trigger (same pattern as the Sensing category's
// "when timer > value").

Blockly.Blocks["turn_video"] = {
  init() {
    this.setTooltip("Turns the webcam feed on or off.");
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
    this.setTooltip("Sets how see-through the camera feed is (0 = fully visible, 100 = invisible).");
    this.appendValueInput("VALUE").appendField("Set Video Transparency To");

    this.appendDummyInput().appendField("%");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#0FBD8C");
  },
};

Blockly.Blocks["video_sensing_reporter"] = {
  init() {
    this.setTooltip("Reports how much motion, or which direction of motion, the camera sees for this sprite or the whole stage.");
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
    this.setTooltip("Runs the blocks inside whenever the camera detects motion above the given amount.");
    this.appendValueInput("VALUE").appendField("When Video Motion >");

    this.appendStatementInput("DO");

    this.setColour("#0FBD8C");
  },
};
