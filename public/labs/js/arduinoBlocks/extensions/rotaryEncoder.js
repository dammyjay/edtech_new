// Rotary Encoder (KY-040) extension. Confirmed via
// bindComponentsToSimulation (arduinoLab.js ~2012-2061) that CLK/DT idle
// HIGH and step through a real 4-phase Gray-code sequence per detent, and
// SW is a plain pushbutton (idle HIGH, pressed LOW) — identical contract
// to the standalone pushbutton. These are offered as plain pin reporters
// (matching every other thin-sugar extension) rather than an auto-decoded
// "direction" block — turning CLK/DT readings into a direction needs
// comparing against the previous reading across loop iterations, which
// needs a variable a student builds themselves with the core Variables
// blocks, same as they'd do with a real encoder library's example sketch.

Blockly.Blocks["encoder_clk_read"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("encoder CLK on pin")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "PIN")
      .appendField("is HIGH");
    this.setOutput(true, "Boolean");
    this.setColour("#00838F");
    this.setTooltip("Reads the encoder's CLK pin. Compare CLK and DT across loop iterations to detect rotation direction.");
  },
};

Blockly.Blocks["encoder_dt_read"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("encoder DT on pin")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "PIN")
      .appendField("is HIGH");
    this.setOutput(true, "Boolean");
    this.setColour("#00838F");
    this.setTooltip("Reads the encoder's DT pin.");
  },
};

Blockly.Blocks["encoder_button_is_pressed"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("encoder button on pin")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "PIN")
      .appendField("is pressed");
    this.setOutput(true, "Boolean");
    this.setColour("#00838F");
    this.setTooltip("True while the encoder's built-in SW button is held down.");
  },
};

cppGenerator.forBlock["encoder_clk_read"] = function (block) {
  const pin = normalizePin(block.getFieldValue("PIN"));
  return [`(digitalRead(${pin}) == HIGH)`, Order.RELATIONAL];
};

cppGenerator.forBlock["encoder_dt_read"] = function (block) {
  const pin = normalizePin(block.getFieldValue("PIN"));
  return [`(digitalRead(${pin}) == HIGH)`, Order.RELATIONAL];
};

cppGenerator.forBlock["encoder_button_is_pressed"] = function (block) {
  const pin = normalizePin(block.getFieldValue("PIN"));
  return [`(digitalRead(${pin}) == LOW)`, Order.RELATIONAL];
};
