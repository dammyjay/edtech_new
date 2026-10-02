// Buzzer extension — pure sugar over digital_write. Confirmed via
// bindComponentsToSimulation (arduinoLab.js) that the simulated buzzer's
// `hasSignal` prop is just the raw digital level — there is no tone()/
// frequency modeling, so a tone()-based block is deliberately NOT offered
// here (it would visually do nothing in this simulator).

Blockly.Blocks["buzzer_on_off"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("turn buzzer on pin")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "PIN")
      .appendField(
        new Blockly.FieldDropdown([
          ["ON", "HIGH"],
          ["OFF", "LOW"],
        ]),
        "STATE"
      );
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour("#00838F");
    this.setTooltip("Turns the buzzer fully on or off.");
  },
};

cppGenerator.forBlock["buzzer_on_off"] = function (block) {
  const pin = normalizePin(block.getFieldValue("PIN"));
  const state = block.getFieldValue("STATE");
  return `digitalWrite(${pin}, ${state});\n`;
};
