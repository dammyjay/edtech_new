// Gas Sensor extension — pure sugar over digital_read/analog_read. Same
// DOUT(active-LOW)/AOUT contract as flameSensor.js, confirmed via
// bindComponentsToSimulation's shared NO_UI_SENSOR_TAGS branch
// (arduinoLab.js ~2193-2220).

Blockly.Blocks["gas_detected"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("gas detected on pin")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "PIN");
    this.setOutput(true, "Boolean");
    this.setColour("#2E7D32");
    this.setTooltip("True while gas is detected (digital output). Use the component's own toolbar toggle to test both states.");
  },
};

Blockly.Blocks["gas_analog_read"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("gas sensor reading on pin")
      .appendField(new Blockly.FieldDropdown(["A0", "A1", "A2", "A3", "A4", "A5"].map((p) => [p, p])), "PIN");
    this.setOutput(true, "Number");
    this.setColour("#2E7D32");
    this.setTooltip("Reads the gas sensor's analog output: 0-1023.");
  },
};

cppGenerator.forBlock["gas_detected"] = function (block) {
  const pin = normalizePin(block.getFieldValue("PIN"));
  return [`(digitalRead(${pin}) == LOW)`, Order.RELATIONAL];
};

cppGenerator.forBlock["gas_analog_read"] = function (block) {
  const pin = normalizePin(block.getFieldValue("PIN"));
  return [`analogRead(${pin})`, Order.ATOMIC];
};
