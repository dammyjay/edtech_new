// Membrane Keypad extension — standard 4x4 layout (1-9, *, 0, #, A-D).
// Confirmed via bindComponentsToSimulation (arduinoLab.js ~2062-2109)
// that this binding was built specifically against the real Keypad
// library's matrix-scan algorithm (drive one ROW low, read pulled-up
// COLUMN pins) — comment explicitly names the Keypad library, not a
// hand-rolled scan. Real Keypad constructor confirmed from the actual
// installed library source: Keypad(makeKeymap(keys), rowPins, colPins,
// ROWS, COLS).
//
// v1 limitation: a fixed standard 4x4 keymap (1-9,*,0,#,A-D) — matching
// the single-object precedent elsewhere, not a configurable layout.

Blockly.Blocks["keypad_setup"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("set up keypad  R1")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "R1")
      .appendField("R2")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "R2");
    this.appendDummyInput()
      .appendField("R3")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "R3")
      .appendField("R4")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "R4");
    this.appendDummyInput()
      .appendField("C1")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "C1")
      .appendField("C2")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "C2");
    this.appendDummyInput()
      .appendField("C3")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "C3")
      .appendField("C4")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "C4");
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour("#AD1457");
    this.setTooltip("One-time setup — place this in setup(). Standard 4x4 keypad layout: 1-9, *, 0, #, A-D.");
  },
};

Blockly.Blocks["keypad_key_pressed"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("key")
      .appendField(
        new Blockly.FieldDropdown(
          ["1", "2", "3", "A", "4", "5", "6", "B", "7", "8", "9", "C", "*", "0", "#", "D"].map((k) => [k, k])
        ),
        "KEY"
      )
      .appendField("was just pressed");
    this.setOutput(true, "Boolean");
    this.setColour("#AD1457");
    this.setTooltip("True the instant that key is pressed (checks the keypad once per call — call it again each loop).");
  },
};

cppGenerator.forBlock["keypad_setup"] = function (block) {
  const [r1, r2, r3, r4, c1, c2, c3, c4] = ["R1", "R2", "R3", "R4", "C1", "C2", "C3", "C4"].map((f) =>
    normalizePin(block.getFieldValue(f))
  );
  cppGenerator.includes_["keypad"] = "#include <Keypad.h>";
  cppGenerator.definitions_["keypad_obj"] = [
    "const byte KEYPAD_ROWS = 4;",
    "const byte KEYPAD_COLS = 4;",
    "char keypadKeys[KEYPAD_ROWS][KEYPAD_COLS] = {",
    "  {'1','2','3','A'},",
    "  {'4','5','6','B'},",
    "  {'7','8','9','C'},",
    "  {'*','0','#','D'}",
    "};",
    `byte keypadRowPins[KEYPAD_ROWS] = {${r1}, ${r2}, ${r3}, ${r4}};`,
    `byte keypadColPins[KEYPAD_COLS] = {${c1}, ${c2}, ${c3}, ${c4}};`,
    "Keypad keypad = Keypad(makeKeymap(keypadKeys), keypadRowPins, keypadColPins, KEYPAD_ROWS, KEYPAD_COLS);",
  ].join("\n");
  return "";
};

cppGenerator.forBlock["keypad_key_pressed"] = function (block) {
  const key = block.getFieldValue("KEY");
  cppGenerator.includes_["keypad"] = "#include <Keypad.h>";
  // Safe even if keypad_setup wasn't placed — compiles with default pins,
  // matching this lab's "honest best-effort" fallback pattern elsewhere.
  cppGenerator.definitions_["keypad_obj"] ||= [
    "const byte KEYPAD_ROWS = 4;",
    "const byte KEYPAD_COLS = 4;",
    "char keypadKeys[KEYPAD_ROWS][KEYPAD_COLS] = {",
    "  {'1','2','3','A'},",
    "  {'4','5','6','B'},",
    "  {'7','8','9','C'},",
    "  {'*','0','#','D'}",
    "};",
    "byte keypadRowPins[KEYPAD_ROWS] = {9, 8, 7, 6};",
    "byte keypadColPins[KEYPAD_COLS] = {5, 4, 3, 2};",
    "Keypad keypad = Keypad(makeKeymap(keypadKeys), keypadRowPins, keypadColPins, KEYPAD_ROWS, KEYPAD_COLS);",
  ].join("\n");
  return [`(keypad.getKey() == '${key}')`, Order.RELATIONAL];
};
