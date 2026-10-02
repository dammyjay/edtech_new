// NTC Temperature Sensor extension — pure sugar over analog_read.
// Confirmed via bindComponentsToSimulation (arduinoLab.js,
// SLIDER_SENSOR_TAGS branch ~1828-1854) that OUT is a plain ADC channel
// over a simplified linear map (NOT a real thermistor beta-coefficient
// curve — the code's own comment states this is intentional, there's no
// single generic NTC formula accurate enough to model), driven by this
// app's own selection-toolbar slider.

Blockly.Blocks["ntc_temperature_read"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("temperature sensor reading on pin")
      .appendField(new Blockly.FieldDropdown(["A0", "A1", "A2", "A3", "A4", "A5"].map((p) => [p, p])), "PIN");
    this.setOutput(true, "Number");
    this.setColour("#2E7D32");
    this.setTooltip("Reads the raw analog value: 0-1023. Use the component's own toolbar slider to test different temperatures.");
  },
};

cppGenerator.forBlock["ntc_temperature_read"] = function (block) {
  const pin = normalizePin(block.getFieldValue("PIN"));
  return [`analogRead(${pin})`, Order.ATOMIC];
};
