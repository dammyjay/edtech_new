// LED extension — pure sugar over digital_write. Confirmed via
// bindComponentsToSimulation (arduinoLab.js) that the simulated LED is
// driven purely by plain digital HIGH/LOW, so no PWM brightness block is
// offered here.

Blockly.Blocks["led_on_off"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("turn LED on pin")
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
    this.setColour("#FFB300");
    this.setTooltip("Turns an LED fully on or off.");
  },
};

cppGenerator.forBlock["led_on_off"] = function (block) {
  const pin = normalizePin(block.getFieldValue("PIN"));
  const state = block.getFieldValue("STATE");
  return `digitalWrite(${pin}, ${state});\n`;
};
