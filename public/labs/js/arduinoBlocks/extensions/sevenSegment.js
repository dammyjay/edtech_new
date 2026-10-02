// 7-Segment Display extension — pure sugar over digital_write. Confirmed
// via bindComponentsToSimulation (arduinoLab.js ~1942-1967) that each
// segment pin (A-G, DP) is an independent plain digital HIGH/LOW pin
// (single-digit pinout only — multi-digit multiplexed variants aren't
// modeled by this component).

Blockly.Blocks["seven_segment_set"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("set 7-segment")
      .appendField(
        new Blockly.FieldDropdown(
          ["A", "B", "C", "D", "E", "F", "G", "DP"].map((s) => [s, s])
        ),
        "SEGMENT"
      )
      .appendField("pin")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "PIN")
      .appendField(new Blockly.FieldDropdown([["ON", "HIGH"], ["OFF", "LOW"]]), "STATE");
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour("#FFB300");
    this.setTooltip("Turns one 7-segment display segment on or off — wire each segment to its own pin.");
  },
};

cppGenerator.forBlock["seven_segment_set"] = function (block) {
  const pin = normalizePin(block.getFieldValue("PIN"));
  const state = block.getFieldValue("STATE");
  return `digitalWrite(${pin}, ${state});\n`;
};
