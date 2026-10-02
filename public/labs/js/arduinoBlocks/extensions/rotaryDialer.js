// Rotary Dialer extension. Confirmed via bindComponentsToSimulation
// (arduinoLab.js ~2776-2829) that no real Arduino library exists for this
// part — DIAL idles HIGH (INPUT_PULLUP), goes LOW for the whole dialing
// window; PULSE idles HIGH, pulses LOW once per unit as the dial spins
// back (digit 0 = 10 pulses). Offered as plain pin reporters, same
// reasoning as the rotary encoder above: counting pulses into a digit
// needs a student-built loop with their own counter variable, since
// there's no library (real or block) to hoist that logic into.

Blockly.Blocks["dialer_is_dialing"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("dialer DIAL pin")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "PIN")
      .appendField("is dialing");
    this.setOutput(true, "Boolean");
    this.setColour("#00838F");
    this.setTooltip("True for the whole time a digit is being dialed (the dial is pulled out and spring-returning).");
  },
};

Blockly.Blocks["dialer_pulse_active"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("dialer PULSE pin")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "PIN")
      .appendField("pulse active");
    this.setOutput(true, "Boolean");
    this.setColour("#00838F");
    this.setTooltip(
      "True during each individual pulse. Count the LOW pulses while DIAL is dialing to get the digit (10 pulses = 0)."
    );
  },
};

cppGenerator.forBlock["dialer_is_dialing"] = function (block) {
  const pin = normalizePin(block.getFieldValue("PIN"));
  return [`(digitalRead(${pin}) == LOW)`, Order.RELATIONAL];
};

cppGenerator.forBlock["dialer_pulse_active"] = function (block) {
  const pin = normalizePin(block.getFieldValue("PIN"));
  return [`(digitalRead(${pin}) == LOW)`, Order.RELATIONAL];
};
