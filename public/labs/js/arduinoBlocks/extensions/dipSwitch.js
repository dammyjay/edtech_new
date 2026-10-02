// DIP Switch (8-way) extension — pure sugar over digital_read. Confirmed
// via bindComponentsToSimulation (arduinoLab.js ~1887-1912) that each of
// the 8 switches is an independent plain digital pin (the "b" leg of each
// pair carries no signal — wire continuity isn't modeled).

Blockly.Blocks["dip_switch_is_on"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("DIP switch")
      .appendField(
        new Blockly.FieldDropdown(["1", "2", "3", "4", "5", "6", "7", "8"].map((n) => [n, n])),
        "INDEX"
      )
      .appendField("on pin")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "PIN")
      .appendField("is on");
    this.setOutput(true, "Boolean");
    this.setColour("#00838F");
    this.setTooltip("True while that switch is in the ON position — the switch number is just a label, wire it to the pin you're reading.");
  },
};

cppGenerator.forBlock["dip_switch_is_on"] = function (block) {
  const pin = normalizePin(block.getFieldValue("PIN"));
  return [`(digitalRead(${pin}) == HIGH)`, Order.RELATIONAL];
};
