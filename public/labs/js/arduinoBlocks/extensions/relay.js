// Relay Module extension — pure sugar over digital_write. Confirmed via
// bindComponentsToSimulation (arduinoLab.js ~2161-2192) that driving the
// coil pin HIGH energizes that relay (standard digitalWrite teaching
// pattern) — the element has no reactive property of its own; this app
// adds the energized-state CSS class itself.

Blockly.Blocks["relay_set"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("set relay on pin")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "PIN")
      .appendField(new Blockly.FieldDropdown([["ON", "HIGH"], ["OFF", "LOW"]]), "STATE");
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour("#5D4037");
    this.setTooltip("Energizes or de-energizes the relay coil. For a 2-channel module, use one block per coil pin.");
  },
};

cppGenerator.forBlock["relay_set"] = function (block) {
  const pin = normalizePin(block.getFieldValue("PIN"));
  const state = block.getFieldValue("STATE");
  return `digitalWrite(${pin}, ${state});\n`;
};
