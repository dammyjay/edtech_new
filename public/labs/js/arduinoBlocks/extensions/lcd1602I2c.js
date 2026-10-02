// LCD1602 (I2C) extension — the same wokwi-lcd1602 element as lcd1602.js,
// just placed as the synthetic "wokwi-lcd1602-i2c" catalog tag, which
// placeComponent() (arduinoLab.js) maps to the real element with its
// `pins="i2c"` attribute set, switching it to the 4-pin GND/VCC/SDA/SCL
// backpack header instead of the 16-pin parallel one. Confirmed via
// bindComponentsToSimulation that this is driven by a real PCF8574
// nibble-mode I2C protocol (not bit-banged GPIO like lcd1602.js) at the
// standard fixed address 0x27, matching the real, already-installed
// "LiquidCrystal_I2C" library's actual wire format exactly (confirmed
// against its own LiquidCrystal_I2C.cpp source, not guessed) — same
// HD44780 character grid underneath, just reached over 2 wires (SDA/SCL)
// instead of 6.
//
// v1 limitation: exactly one I2C LCD object ("lcdI2c") is supported,
// same single-object precedent as every other hoisted part in this lab.
// Also: the address is fixed at 0x27 in both the generated constructor
// call and the simulation's listener — a sketch hand-edited to use 0x3F
// (the other common backpack address) won't be picked up.

Blockly.Blocks["lcd1602_i2c_setup"] = {
  init: function () {
    this.appendDummyInput().appendField("set up LCD1602 (I2C)");
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour("#AD1457");
    this.setTooltip("One-time setup — place this in setup(). Wired via I2C (A4/A5) at address 0x27.");
  },
};

Blockly.Blocks["lcd1602_i2c_print"] = {
  init: function () {
    this.appendValueInput("TEXT").appendField("LCD1602 (I2C) print");
    this.appendValueInput("COL").setCheck("Number").appendField("at column");
    this.appendValueInput("ROW").setCheck("Number").appendField("row");
    this.setInputsInline(true);
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour("#AD1457");
    this.setTooltip("Prints text to the LCD at a column (0-15) and row (0-1).");
  },
};

Blockly.Blocks["lcd1602_i2c_clear"] = {
  init: function () {
    this.appendDummyInput().appendField("LCD1602 (I2C) clear");
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour("#AD1457");
  },
};

const LCD1602_I2C_DEFAULT_OBJ = "LiquidCrystal_I2C lcdI2c(0x27, 16, 2);";

const LCD1602_I2C_SETUP = () => {
  cppGenerator.includes_["lcd1602_i2c"] = "#include <Wire.h>";
  cppGenerator.includes_["lcd1602_i2c_lib"] = "#include <LiquidCrystal_I2C.h>";
  cppGenerator.definitions_["lcd1602_i2c_obj"] ||= LCD1602_I2C_DEFAULT_OBJ;
};

cppGenerator.forBlock["lcd1602_i2c_setup"] = function () {
  LCD1602_I2C_SETUP();
  cppGenerator.setups_["lcd1602_i2c_begin"] = "lcdI2c.init();\n  lcdI2c.backlight();";
  return "";
};

cppGenerator.forBlock["lcd1602_i2c_print"] = function (block) {
  const text = cppGenerator.valueToCode(block, "TEXT", Order.NONE) || '""';
  const col = cppGenerator.valueToCode(block, "COL", Order.NONE) || "0";
  const row = cppGenerator.valueToCode(block, "ROW", Order.NONE) || "0";
  LCD1602_I2C_SETUP();
  cppGenerator.setups_["lcd1602_i2c_begin"] ||= "lcdI2c.init();\n  lcdI2c.backlight();";
  return `lcdI2c.setCursor(${col}, ${row});\n  lcdI2c.print(${text});\n`;
};

cppGenerator.forBlock["lcd1602_i2c_clear"] = function () {
  LCD1602_I2C_SETUP();
  cppGenerator.setups_["lcd1602_i2c_begin"] ||= "lcdI2c.init();\n  lcdI2c.backlight();";
  return "lcdI2c.clear();\n";
};
