// LCD2004 extension — confirmed via bindComponentsToSimulation
// (arduinoLab.js ~2446-2545) to be driven by the exact same real parallel
// HD44780 LiquidCrystal protocol as LCD1602 (same code branch, just a
// different numCols/numRows passed to .begin()). A separate extension
// (not a size dropdown on lcd1602.js) so both LCD sizes could in
// principle be wired into the same circuit without colliding on one
// global object name — matching the "one object per extension" v1
// limitation already established for LCD1602/Servo.

Blockly.Blocks["lcd2004_setup"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("set up LCD2004  RS")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "RS")
      .appendField("E")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "E");
    this.appendDummyInput()
      .appendField("D4")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "D4")
      .appendField("D5")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "D5");
    this.appendDummyInput()
      .appendField("D6")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "D6")
      .appendField("D7")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "D7");
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour("#AD1457");
    this.setTooltip("One-time setup — place this in setup().");
  },
};

Blockly.Blocks["lcd2004_print"] = {
  init: function () {
    this.appendValueInput("TEXT").appendField("LCD2004 print");
    this.appendValueInput("COL").setCheck("Number").appendField("at column");
    this.appendValueInput("ROW").setCheck("Number").appendField("row");
    this.setInputsInline(true);
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour("#AD1457");
    this.setTooltip("Prints text to the LCD at a column (0-19) and row (0-3).");
  },
};

Blockly.Blocks["lcd2004_clear"] = {
  init: function () {
    this.appendDummyInput().appendField("LCD2004 clear");
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour("#AD1457");
  },
};

const LCD2004_DEFAULT_OBJ = "LiquidCrystal lcd20x4(7, 8, 9, 10, 11, 12); // default pins — add an LCD2004 Set Up block to customize";

cppGenerator.forBlock["lcd2004_setup"] = function (block) {
  const [rs, e, d4, d5, d6, d7] = ["RS", "E", "D4", "D5", "D6", "D7"].map((f) => normalizePin(block.getFieldValue(f)));
  cppGenerator.includes_["lcd2004"] = "#include <LiquidCrystal.h>";
  cppGenerator.definitions_["lcd2004_obj"] = `LiquidCrystal lcd20x4(${rs}, ${e}, ${d4}, ${d5}, ${d6}, ${d7});`;
  cppGenerator.setups_["lcd2004_begin"] = "lcd20x4.begin(20, 4);";
  return "";
};

cppGenerator.forBlock["lcd2004_print"] = function (block) {
  const text = cppGenerator.valueToCode(block, "TEXT", Order.NONE) || '""';
  const col = cppGenerator.valueToCode(block, "COL", Order.NONE) || "0";
  const row = cppGenerator.valueToCode(block, "ROW", Order.NONE) || "0";
  cppGenerator.includes_["lcd2004"] = "#include <LiquidCrystal.h>";
  cppGenerator.definitions_["lcd2004_obj"] ||= LCD2004_DEFAULT_OBJ;
  cppGenerator.setups_["lcd2004_begin"] ||= "lcd20x4.begin(20, 4);";
  return `lcd20x4.setCursor(${col}, ${row});\n  lcd20x4.print(${text});\n`;
};

cppGenerator.forBlock["lcd2004_clear"] = function () {
  cppGenerator.includes_["lcd2004"] = "#include <LiquidCrystal.h>";
  cppGenerator.definitions_["lcd2004_obj"] ||= LCD2004_DEFAULT_OBJ;
  cppGenerator.setups_["lcd2004_begin"] ||= "lcd20x4.begin(20, 4);";
  return "lcd20x4.clear();\n";
};
