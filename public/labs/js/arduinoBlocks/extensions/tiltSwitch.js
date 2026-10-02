// Tilt Switch extension — pure sugar over digital_read. Confirmed via
// bindComponentsToSimulation (arduinoLab.js, NO_UI_SENSOR_TAGS branch
// ~2193-2220) that OUT is active-HIGH, driven by this app's own
// selection-toolbar Idle/Triggered toggle (the element has no native
// interactivity of its own — use the toolbar to test both states).

Blockly.Blocks["tilt_switch_is_tilted"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("tilt switch on pin")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "PIN")
      .appendField("is tilted");
    this.setOutput(true, "Boolean");
    this.setColour("#2E7D32");
    this.setTooltip("True while tilted. Use the component's own toolbar toggle (click it on the canvas) to test both states.");
  },
};

cppGenerator.forBlock["tilt_switch_is_tilted"] = function (block) {
  const pin = normalizePin(block.getFieldValue("PIN"));
  return [`(digitalRead(${pin}) == HIGH)`, Order.RELATIONAL];
};
