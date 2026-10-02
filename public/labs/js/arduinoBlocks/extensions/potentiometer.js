// Potentiometer extension — pure sugar over analog_read. Confirmed via
// bindComponentsToSimulation (arduinoLab.js) that the simulated
// potentiometer is a plain ADC channel read, nothing special.

Blockly.Blocks["potentiometer_read"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("potentiometer on pin")
      .appendField(new Blockly.FieldDropdown(["A0", "A1", "A2", "A3", "A4", "A5"].map((p) => [p, p])), "PIN");
    this.setOutput(true, "Number");
    this.setColour("#00838F");
    this.setTooltip("Reads the potentiometer's position: 0-1023.");
  },
};

cppGenerator.forBlock["potentiometer_read"] = function (block) {
  const pin = normalizePin(block.getFieldValue("PIN"));
  return [`analogRead(${pin})`, Order.ATOMIC];
};
