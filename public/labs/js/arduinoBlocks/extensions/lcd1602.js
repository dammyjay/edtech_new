// LCD1602 extension — needs the hoisting mechanism: #include
// <LiquidCrystal.h>, a global LiquidCrystal object (constructed from the
// 6 wired pins), and a one-time .begin(16, 2) call in setup(). Confirmed
// via bindComponentsToSimulation (arduinoLab.js) that the simulated
// LCD1602 implements the real HD44780 PARALLEL protocol in 4-bit mode
// (RS/E/D4-D7 — not I2C) via the standard LiquidCrystal library, and
// confirmed via services/arduinoCompileService.js's BUILTIN_LIBRARIES
// that LiquidCrystal is available to the real arduino-cli compile.
//
// v1 limitation: exactly one LCD object ("lcd") is supported, matching
// servo.js's same single-object precedent.

Blockly.Blocks["lcd_setup"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("set up LCD1602  RS")
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

Blockly.Blocks["lcd_print"] = {
  init: function () {
    this.appendValueInput("TEXT").appendField("LCD print");
    this.appendValueInput("COL").setCheck("Number").appendField("at column");
    this.appendValueInput("ROW").setCheck("Number").appendField("row");
    this.setInputsInline(true);
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour("#AD1457");
    this.setTooltip("Prints text to the LCD at a column (0-15) and row (0-1).");
  },
};

Blockly.Blocks["lcd_clear"] = {
  init: function () {
    this.appendDummyInput().appendField("LCD clear");
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour("#AD1457");
  },
};

const LCD_DEFAULT_OBJ = "LiquidCrystal lcd(7, 8, 9, 10, 11, 12); // default pins — add an LCD Set Up block to customize";

cppGenerator.forBlock["lcd_setup"] = function (block) {
  const [rs, e, d4, d5, d6, d7] = ["RS", "E", "D4", "D5", "D6", "D7"].map((f) => normalizePin(block.getFieldValue(f)));
  cppGenerator.includes_["lcd"] = "#include <LiquidCrystal.h>";
  cppGenerator.definitions_["lcd_obj"] = `LiquidCrystal lcd(${rs}, ${e}, ${d4}, ${d5}, ${d6}, ${d7});`;
  cppGenerator.setups_["lcd_begin"] = "lcd.begin(16, 2);";
  return "";
};

cppGenerator.forBlock["lcd_print"] = function (block) {
  const text = cppGenerator.valueToCode(block, "TEXT", Order.NONE) || '""';
  const col = cppGenerator.valueToCode(block, "COL", Order.NONE) || "0";
  const row = cppGenerator.valueToCode(block, "ROW", Order.NONE) || "0";
  cppGenerator.includes_["lcd"] = "#include <LiquidCrystal.h>";
  cppGenerator.definitions_["lcd_obj"] ||= LCD_DEFAULT_OBJ;
  cppGenerator.setups_["lcd_begin"] ||= "lcd.begin(16, 2);";
  return `lcd.setCursor(${col}, ${row});\n  lcd.print(${text});\n`;
};

cppGenerator.forBlock["lcd_clear"] = function () {
  cppGenerator.includes_["lcd"] = "#include <LiquidCrystal.h>";
  cppGenerator.definitions_["lcd_obj"] ||= LCD_DEFAULT_OBJ;
  cppGenerator.setups_["lcd_begin"] ||= "lcd.begin(16, 2);";
  return "lcd.clear();\n";
};
