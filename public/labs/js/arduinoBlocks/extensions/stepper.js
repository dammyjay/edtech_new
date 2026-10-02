// Stepper Motor extension — covers BOTH wokwi-stepper-motor and
// wokwi-biaxial-stepper (identical binding code; the biaxial part only
// exposes one set of coil pins in @wokwi/elements, so it's driven the
// same way). Confirmed via bindComponentsToSimulation (arduinoLab.js
// ~2110-2160) that the simulation matches the live A-/A+/B+/B- pin
// combination against Arduino's real built-in Stepper.h library's exact
// internal drive table (Stepper::stepMotor's case 0-3) — moving between
// adjacent table entries is one real step. Working the table backwards
// confirms the real Stepper 4-pin constructor must be called with pins in
// the order (A+, A-, B+, B-) for its sequence to match this binding's
// table exactly.
//
// Stepper.h is Arduino's own official Library Manager package (listed in
// BUILTIN_LIBRARIES as "Stepper") — NOT bundled with the arduino:avr core
// itself, despite an earlier assumption that it was; a real compile
// caught the resulting "Stepper.h: No such file or directory" before it
// shipped, confirmed by listing the core's actual libraries/ folder
// (only EEPROM/HID/SPI/SoftwareSerial/Wire live there).

Blockly.Blocks["stepper_attach"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("attach stepper  A+")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "A_PLUS")
      .appendField("A-")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "A_MINUS");
    this.appendDummyInput()
      .appendField("B+")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "B_PLUS")
      .appendField("B-")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "B_MINUS");
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour("#6A1B9A");
    this.setTooltip("One-time setup — place this in setup(). 200 steps/revolution (standard 1.8°/step motor).");
  },
};

Blockly.Blocks["stepper_set_speed"] = {
  init: function () {
    this.appendValueInput("RPM").setCheck("Number").appendField("set stepper speed");
    this.appendDummyInput().appendField("RPM");
    this.setInputsInline(true);
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour("#6A1B9A");
    this.setTooltip("Sets the stepper's rotation speed in revolutions per minute.");
  },
};

Blockly.Blocks["stepper_step"] = {
  init: function () {
    this.appendValueInput("STEPS").setCheck("Number").appendField("stepper move");
    this.appendDummyInput().appendField("steps (negative = reverse)");
    this.setInputsInline(true);
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour("#6A1B9A");
    this.setTooltip("Moves the stepper the given number of steps. This blocks until the move finishes.");
  },
};

cppGenerator.forBlock["stepper_attach"] = function (block) {
  const aPlus = normalizePin(block.getFieldValue("A_PLUS"));
  const aMinus = normalizePin(block.getFieldValue("A_MINUS"));
  const bPlus = normalizePin(block.getFieldValue("B_PLUS"));
  const bMinus = normalizePin(block.getFieldValue("B_MINUS"));
  cppGenerator.includes_["stepper"] = "#include <Stepper.h>";
  cppGenerator.definitions_["stepper_obj"] = `const int STEPPER_STEPS_PER_REV = 200;\nStepper myStepper(STEPPER_STEPS_PER_REV, ${aPlus}, ${aMinus}, ${bPlus}, ${bMinus});`;
  return "";
};

cppGenerator.forBlock["stepper_set_speed"] = function (block) {
  const rpm = cppGenerator.valueToCode(block, "RPM", Order.NONE) || "10";
  cppGenerator.includes_["stepper"] = "#include <Stepper.h>";
  cppGenerator.definitions_["stepper_obj"] ||=
    "const int STEPPER_STEPS_PER_REV = 200;\nStepper myStepper(STEPPER_STEPS_PER_REV, 8, 9, 10, 11);";
  return `myStepper.setSpeed(${rpm});\n`;
};

cppGenerator.forBlock["stepper_step"] = function (block) {
  const steps = cppGenerator.valueToCode(block, "STEPS", Order.NONE) || "0";
  cppGenerator.includes_["stepper"] = "#include <Stepper.h>";
  cppGenerator.definitions_["stepper_obj"] ||=
    "const int STEPPER_STEPS_PER_REV = 200;\nStepper myStepper(STEPPER_STEPS_PER_REV, 8, 9, 10, 11);";
  return `myStepper.step(${steps});\n`;
};
