// Slide Switch extension — pure sugar over digital_read. Confirmed via
// bindComponentsToSimulation (arduinoLab.js ~1800-1809) that the switch
// drives a plain digital level, no pullup/idle-state convention assumed.

Blockly.Blocks["slide_switch_is_on"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("slide switch on pin")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "PIN")
      .appendField("is on");
    this.setOutput(true, "Boolean");
    this.setColour("#00838F");
    this.setTooltip("True while the switch is in the ON position.");
  },
};

cppGenerator.forBlock["slide_switch_is_on"] = function (block) {
  const pin = normalizePin(block.getFieldValue("PIN"));
  return [`(digitalRead(${pin}) == HIGH)`, Order.RELATIONAL];
};
