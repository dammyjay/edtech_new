// Light Sensor extension — pure sugar over analog_read. Confirmed via
// bindComponentsToSimulation (arduinoLab.js, SLIDER_SENSOR_TAGS branch
// ~1828-1854) that AO is a plain ADC channel, driven by this app's own
// selection-toolbar Light Level slider (the element has no native
// interactivity of its own).

Blockly.Blocks["light_sensor_read"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("light level on pin")
      .appendField(new Blockly.FieldDropdown(["A0", "A1", "A2", "A3", "A4", "A5"].map((p) => [p, p])), "PIN");
    this.setOutput(true, "Number");
    this.setColour("#2E7D32");
    this.setTooltip("Reads the light level: 0-1023. Use the component's own toolbar slider to test different values.");
  },
};

cppGenerator.forBlock["light_sensor_read"] = function (block) {
  const pin = normalizePin(block.getFieldValue("PIN"));
  return [`analogRead(${pin})`, Order.ATOMIC];
};
