// Servo extension — needs the Ardublockly-style hoisting mechanism
// (core/codegen.js's definitions_/setups_), since a real Servo program
// needs #include <Servo.h>, a global Servo object, and a one-time
// .attach() call in setup(), not just a single statement. Confirmed via
// bindComponentsToSimulation (arduinoLab.js) that the simulated servo
// times real pulse widths against Servo.h's actual MIN_PULSE_WIDTH/
// MAX_PULSE_WIDTH constants, so a genuine Servo.h program drives it
// correctly — and confirmed via services/arduinoCompileService.js's
// BUILTIN_LIBRARIES that Servo is available to the real arduino-cli
// compile, so this actually compiles, not just runs in-browser.
//
// v1 limitation: exactly one servo object ("myservo") is supported, not
// independently-named multiples — if a circuit has two physical servos,
// both servo_write blocks drive the same object/pin. A future pass could
// add an object-name field to these blocks.

Blockly.Blocks["servo_attach"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("attach servo on pin")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "PIN");
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour("#6A1B9A");
    this.setTooltip("One-time setup — place this in setup().");
  },
};

Blockly.Blocks["servo_write"] = {
  init: function () {
    this.appendValueInput("ANGLE").setCheck("Number").appendField("set servo angle to");
    this.appendDummyInput().appendField("°");
    this.setInputsInline(true);
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour("#6A1B9A");
    this.setTooltip("Moves the servo to an angle, 0-180.");
  },
};

cppGenerator.forBlock["servo_attach"] = function (block) {
  const pin = normalizePin(block.getFieldValue("PIN"));
  cppGenerator.includes_["servo"] = "#include <Servo.h>";
  cppGenerator.definitions_["servo_obj"] = "Servo myservo;";
  cppGenerator.setups_["servo_attach"] = `myservo.attach(${pin});`;
  return "";
};

cppGenerator.forBlock["servo_write"] = function (block) {
  const angle = cppGenerator.valueToCode(block, "ANGLE", Order.NONE) || "0";
  cppGenerator.includes_["servo"] = "#include <Servo.h>";
  // Safe even if servo_attach wasn't placed — compiles, just never attached.
  cppGenerator.definitions_["servo_obj"] = "Servo myservo;";
  return `myservo.write(${angle});\n`;
};
