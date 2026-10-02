// Flame Sensor extension — pure sugar over digital_read/analog_read.
// Confirmed via bindComponentsToSimulation (arduinoLab.js,
// NO_UI_SENSOR_TAGS branch ~2193-2220) that DOUT is active-LOW (the
// opposite polarity from PIR/Tilt's OUT) and AOUT is a plain ADC channel
// — driven by this app's own selection-toolbar toggle.

Blockly.Blocks["flame_detected"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("flame detected on pin")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "PIN");
    this.setOutput(true, "Boolean");
    this.setColour("#2E7D32");
    this.setTooltip("True while flame is detected (digital output). Use the component's own toolbar toggle to test both states.");
  },
};

Blockly.Blocks["flame_analog_read"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("flame sensor reading on pin")
      .appendField(new Blockly.FieldDropdown(["A0", "A1", "A2", "A3", "A4", "A5"].map((p) => [p, p])), "PIN");
    this.setOutput(true, "Number");
    this.setColour("#2E7D32");
    this.setTooltip("Reads the flame sensor's analog output: 0-1023.");
  },
};

cppGenerator.forBlock["flame_detected"] = function (block) {
  const pin = normalizePin(block.getFieldValue("PIN"));
  return [`(digitalRead(${pin}) == LOW)`, Order.RELATIONAL];
};

cppGenerator.forBlock["flame_analog_read"] = function (block) {
  const pin = normalizePin(block.getFieldValue("PIN"));
  return [`analogRead(${pin})`, Order.ATOMIC];
};
