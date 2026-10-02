// PIR Motion Sensor extension — pure sugar over digital_read. Confirmed
// via bindComponentsToSimulation (arduinoLab.js, NO_UI_SENSOR_TAGS branch
// ~2193-2220) that OUT is active-HIGH, driven by this app's own
// selection-toolbar Idle/Triggered toggle.

Blockly.Blocks["pir_motion_detected"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("motion detected on pin")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "PIN");
    this.setOutput(true, "Boolean");
    this.setColour("#2E7D32");
    this.setTooltip("True while motion is detected. Use the component's own toolbar toggle (click it on the canvas) to test both states.");
  },
};

cppGenerator.forBlock["pir_motion_detected"] = function (block) {
  const pin = normalizePin(block.getFieldValue("PIN"));
  return [`(digitalRead(${pin}) == HIGH)`, Order.RELATIONAL];
};
