// Slide Potentiometer extension — pure sugar over analog_read. Confirmed
// via bindComponentsToSimulation (arduinoLab.js ~1810-1827) that it shares
// the exact same SIG/min/max/value contract as the standard rotary
// potentiometer — a plain ADC channel read.

Blockly.Blocks["slide_potentiometer_read"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("slide potentiometer on pin")
      .appendField(new Blockly.FieldDropdown(["A0", "A1", "A2", "A3", "A4", "A5"].map((p) => [p, p])), "PIN");
    this.setOutput(true, "Number");
    this.setColour("#00838F");
    this.setTooltip("Reads the slider's position: 0-1023.");
  },
};

cppGenerator.forBlock["slide_potentiometer_read"] = function (block) {
  const pin = normalizePin(block.getFieldValue("PIN"));
  return [`analogRead(${pin})`, Order.ATOMIC];
};
