// Analog Joystick extension. Confirmed via bindComponentsToSimulation
// (arduinoLab.js ~1855-1886): VERT/HORZ are plain ADC channels; SEL is a
// plain digital pushbutton, idle HIGH — identical contract to the
// standalone pushbutton (INPUT_PULLUP expected, pressed reads LOW).

Blockly.Blocks["joystick_axis_read"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("joystick")
      .appendField(new Blockly.FieldDropdown([["X (HORZ)", "X"], ["Y (VERT)", "Y"]]), "AXIS")
      .appendField("on pin")
      .appendField(new Blockly.FieldDropdown(["A0", "A1", "A2", "A3", "A4", "A5"].map((p) => [p, p])), "PIN");
    this.setOutput(true, "Number");
    this.setColour("#00838F");
    this.setTooltip("Reads one joystick axis: 0-1023 (512 is centered). Use one block for HORZ, one for VERT.");
  },
};

Blockly.Blocks["joystick_button_is_pressed"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("joystick button on pin")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "PIN")
      .appendField("is pressed");
    this.setOutput(true, "Boolean");
    this.setColour("#00838F");
    this.setTooltip(
      "True while the joystick's SEL button is held down. Set this pin's mode to INPUT_PULLUP in setup first."
    );
  },
};

cppGenerator.forBlock["joystick_axis_read"] = function (block) {
  const pin = normalizePin(block.getFieldValue("PIN"));
  return [`analogRead(${pin})`, Order.ATOMIC];
};

cppGenerator.forBlock["joystick_button_is_pressed"] = function (block) {
  const pin = normalizePin(block.getFieldValue("PIN"));
  return [`(digitalRead(${pin}) == LOW)`, Order.RELATIONAL];
};
