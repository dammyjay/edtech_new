// Push Button extension — pure sugar over digital_read. Confirmed via
// bindComponentsToSimulation (arduinoLab.js) that the simulated
// pushbutton wiring assumes idle-HIGH/pressed-LOW, i.e. expects
// INPUT_PULLUP, not plain INPUT. The block's tooltip recommends this; it
// is NOT auto-injected (a value/reporter block silently also writing
// pinMode would be a surprising side effect) — the shipped example
// sketches wire it correctly.

Blockly.Blocks["button_is_pressed"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("button on pin")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "PIN")
      .appendField("is pressed");
    this.setOutput(true, "Boolean");
    this.setColour("#FFB300");
    this.setTooltip(
      "True while the button is held down. Set this pin's mode to INPUT_PULLUP in setup first."
    );
  },
};

cppGenerator.forBlock["button_is_pressed"] = function (block) {
  const pin = normalizePin(block.getFieldValue("PIN"));
  return [`(digitalRead(${pin}) == LOW)`, Order.RELATIONAL];
};
