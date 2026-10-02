// LED Bar Graph extension — pure sugar over digital_write. Confirmed via
// bindComponentsToSimulation (arduinoLab.js ~1913-1941) that each of the
// 10 segments (A1-A10) is an independent plain digital HIGH/LOW pin, no
// shared bus/library.

Blockly.Blocks["led_bar_segment"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("turn LED bar segment on pin")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "PIN")
      .appendField(new Blockly.FieldDropdown([["ON", "HIGH"], ["OFF", "LOW"]]), "STATE");
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour("#FFB300");
    this.setTooltip("Turns one LED bar graph segment on or off — wire each segment to its own pin.");
  },
};

cppGenerator.forBlock["led_bar_segment"] = function (block) {
  const pin = normalizePin(block.getFieldValue("PIN"));
  const state = block.getFieldValue("STATE");
  return `digitalWrite(${pin}, ${state});\n`;
};
