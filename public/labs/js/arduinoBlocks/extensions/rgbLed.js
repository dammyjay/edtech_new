// RGB LED extension — pure sugar over three digital_write calls, NOT PWM
// color blending. Confirmed via bindComponentsToSimulation (arduinoLab.js)
// that the simulated RGB LED's three legs (R/G/B) are each just plain
// digital HIGH/LOW — the source comment there explicitly says PWM color
// mixing "isn't modeled yet" — so this block offers on/off per channel,
// not a color picker, to match what the simulator actually does.

Blockly.Blocks["rgb_led_set"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("RGB LED  R pin")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "R_PIN")
      .appendField(new Blockly.FieldDropdown([["ON", "HIGH"], ["OFF", "LOW"]]), "R_STATE");
    this.appendDummyInput()
      .appendField("G pin")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "G_PIN")
      .appendField(new Blockly.FieldDropdown([["ON", "HIGH"], ["OFF", "LOW"]]), "G_STATE");
    this.appendDummyInput()
      .appendField("B pin")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "B_PIN")
      .appendField(new Blockly.FieldDropdown([["ON", "HIGH"], ["OFF", "LOW"]]), "B_STATE");
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour("#00838F");
    this.setTooltip("Turns each of the RGB LED's channels fully on or off.");
  },
};

cppGenerator.forBlock["rgb_led_set"] = function (block) {
  const rPin = normalizePin(block.getFieldValue("R_PIN"));
  const gPin = normalizePin(block.getFieldValue("G_PIN"));
  const bPin = normalizePin(block.getFieldValue("B_PIN"));
  const rState = block.getFieldValue("R_STATE");
  const gState = block.getFieldValue("G_STATE");
  const bState = block.getFieldValue("B_STATE");
  return (
    `digitalWrite(${rPin}, ${rState});\n` +
    `digitalWrite(${gPin}, ${gState});\n` +
    `digitalWrite(${bPin}, ${bState});\n`
  );
};
