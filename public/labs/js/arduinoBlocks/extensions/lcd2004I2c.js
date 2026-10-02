// LCD2004 (I2C) extension — same relationship to lcd2004.js that
// lcd1602I2c.js has to lcd1602.js (see that file's own header comment for
// the full I2C/PCF8574 protocol explanation). A separate extension from
// lcd1602I2c.js, not a size dropdown, for the same "one object per
// extension" reason lcd1602.js/lcd2004.js are already separate: both LCD
// sizes can in principle be wired into the same circuit without
// colliding on one global object name.

Blockly.Blocks["lcd2004_i2c_setup"] = {
  init: function () {
    this.appendDummyInput().appendField("set up LCD2004 (I2C)");
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour("#AD1457");
    this.setTooltip("One-time setup — place this in setup(). Wired via I2C (A4/A5) at address 0x27.");
  },
};

Blockly.Blocks["lcd2004_i2c_print"] = {
  init: function () {
    this.appendValueInput("TEXT").appendField("LCD2004 (I2C) print");
    this.appendValueInput("COL").setCheck("Number").appendField("at column");
    this.appendValueInput("ROW").setCheck("Number").appendField("row");
    this.setInputsInline(true);
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour("#AD1457");
    this.setTooltip("Prints text to the LCD at a column (0-19) and row (0-3).");
  },
};

Blockly.Blocks["lcd2004_i2c_clear"] = {
  init: function () {
    this.appendDummyInput().appendField("LCD2004 (I2C) clear");
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour("#AD1457");
  },
};

const LCD2004_I2C_DEFAULT_OBJ = "LiquidCrystal_I2C lcd20x4I2c(0x27, 20, 4);";

const LCD2004_I2C_SETUP = () => {
  cppGenerator.includes_["lcd2004_i2c"] = "#include <Wire.h>";
  cppGenerator.includes_["lcd2004_i2c_lib"] = "#include <LiquidCrystal_I2C.h>";
  cppGenerator.definitions_["lcd2004_i2c_obj"] ||= LCD2004_I2C_DEFAULT_OBJ;
};

cppGenerator.forBlock["lcd2004_i2c_setup"] = function () {
  LCD2004_I2C_SETUP();
  cppGenerator.setups_["lcd2004_i2c_begin"] = "lcd20x4I2c.init();\n  lcd20x4I2c.backlight();";
  return "";
};

cppGenerator.forBlock["lcd2004_i2c_print"] = function (block) {
  const text = cppGenerator.valueToCode(block, "TEXT", Order.NONE) || '""';
  const col = cppGenerator.valueToCode(block, "COL", Order.NONE) || "0";
  const row = cppGenerator.valueToCode(block, "ROW", Order.NONE) || "0";
  LCD2004_I2C_SETUP();
  cppGenerator.setups_["lcd2004_i2c_begin"] ||= "lcd20x4I2c.init();\n  lcd20x4I2c.backlight();";
  return `lcd20x4I2c.setCursor(${col}, ${row});\n  lcd20x4I2c.print(${text});\n`;
};

cppGenerator.forBlock["lcd2004_i2c_clear"] = function () {
  LCD2004_I2C_SETUP();
  cppGenerator.setups_["lcd2004_i2c_begin"] ||= "lcd20x4I2c.init();\n  lcd20x4I2c.backlight();";
  return "lcd20x4I2c.clear();\n";
};
