// Sound Sensor extension — covers BOTH the small and large sound sensor
// catalog entries (wokwi-small-sound-sensor / wokwi-big-sound-sensor),
// which share identical bindComponentsToSimulation code (arduinoLab.js,
// NO_UI_SENSOR_TAGS branch ~2193-2220): DOUT active-LOW, AOUT a plain ADC
// channel. One block set, registered twice in extensionRegistry.js (once
// per catalog entry) since they're electrically and programmatically
// identical — only the physical module size differs.

Blockly.Blocks["sound_detected"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("sound detected on pin")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "PIN");
    this.setOutput(true, "Boolean");
    this.setColour("#2E7D32");
    this.setTooltip("True while sound above the threshold is detected (digital output). Use the component's own toolbar toggle to test both states.");
  },
};

Blockly.Blocks["sound_analog_read"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("sound sensor reading on pin")
      .appendField(new Blockly.FieldDropdown(["A0", "A1", "A2", "A3", "A4", "A5"].map((p) => [p, p])), "PIN");
    this.setOutput(true, "Number");
    this.setColour("#2E7D32");
    this.setTooltip("Reads the sound sensor's analog output: 0-1023.");
  },
};

cppGenerator.forBlock["sound_detected"] = function (block) {
  const pin = normalizePin(block.getFieldValue("PIN"));
  return [`(digitalRead(${pin}) == LOW)`, Order.RELATIONAL];
};

cppGenerator.forBlock["sound_analog_read"] = function (block) {
  const pin = normalizePin(block.getFieldValue("PIN"));
  return [`analogRead(${pin})`, Order.ATOMIC];
};
