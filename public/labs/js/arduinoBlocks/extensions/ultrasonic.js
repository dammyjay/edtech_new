// Ultrasonic (HC-SR04) extension — needs hoisting for the TRIG/ECHO pin
// globals and a named helper function, but no #include: confirmed via
// bindComponentsToSimulation (arduinoLab.js) that the simulated sensor
// implements the real TRIG/ECHO protocol (pulse TRIG high >=10us, then
// read the ECHO pulse width), which is pure Arduino-core (digitalWrite/
// delayMicroseconds/pulseIn) — no library needed.
//
// The distance reading is hoisted as a real named function
// (readUltrasonicDistance()) rather than generated inline at every call
// site, specifically so the generated .ino reads like code a student
// could reasonably have written themselves — the whole point of
// blocks->text is producing real, idiomatic, readable Arduino code.

Blockly.Blocks["ultrasonic_setup"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("set up ultrasonic sensor  TRIG pin")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "TRIG")
      .appendField("ECHO pin")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "ECHO");
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour("#2E7D32");
    this.setTooltip("One-time setup — place this in setup().");
  },
};

Blockly.Blocks["ultrasonic_distance"] = {
  init: function () {
    this.appendDummyInput().appendField("distance (cm)");
    this.setOutput(true, "Number");
    this.setColour("#2E7D32");
    this.setTooltip("Reads the distance to the nearest object, in centimeters.");
  },
};

// The pin declarations and the helper function that references them are
// built as ONE definitions_ entry, not two — they were originally two
// separate keys ("ultrasonic_pins" / "ultrasonic_helper"), which broke
// real compilation: generateFullSketch emits definitions_ in alphabetical
// key order, and "ultrasonic_helper" sorts before "ultrasonic_pins",
// putting the function body (which reads US_TRIG_PIN/US_ECHO_PIN) above
// the globals it depends on — "'US_TRIG_PIN' was not declared in this
// scope" from the real compiler caught this. One key removes the
// ordering dependency entirely, since this file controls the internal
// line order itself.
function buildUltrasonicDefinition(trig, echo) {
  return [
    `const int US_TRIG_PIN = ${trig};`,
    `const int US_ECHO_PIN = ${echo};`,
    "float readUltrasonicDistance() {",
    "  digitalWrite(US_TRIG_PIN, LOW);",
    "  delayMicroseconds(2);",
    "  digitalWrite(US_TRIG_PIN, HIGH);",
    "  delayMicroseconds(10);",
    "  digitalWrite(US_TRIG_PIN, LOW);",
    "  long duration = pulseIn(US_ECHO_PIN, HIGH);",
    "  return duration / 58.0;",
    "}",
  ].join("\n");
}

cppGenerator.forBlock["ultrasonic_setup"] = function (block) {
  const trig = normalizePin(block.getFieldValue("TRIG"));
  const echo = normalizePin(block.getFieldValue("ECHO"));
  cppGenerator.definitions_["ultrasonic"] = buildUltrasonicDefinition(trig, echo);
  cppGenerator.setups_["ultrasonic_setup"] = "pinMode(US_TRIG_PIN, OUTPUT);\n  pinMode(US_ECHO_PIN, INPUT);";
  return "";
};

cppGenerator.forBlock["ultrasonic_distance"] = function () {
  // Safe even if ultrasonic_setup wasn't placed — pins default to 0/1,
  // which at least compiles (TRIG/ECHO would just be wrong), matching
  // this lab's "honest best-effort, don't hard-crash" approach elsewhere
  // (e.g. servo_write above).
  cppGenerator.definitions_["ultrasonic"] ||= buildUltrasonicDefinition(0, 1);
  return ["readUltrasonicDistance()", Order.ATOMIC];
};
