// OLED Display SSD1306 extension. Confirmed via bindComponentsToSimulation
// (arduinoLab.js ~2320-2421) that this is a real I2C command/GDDRAM
// protocol at address 0x3C — exactly what the real Adafruit_SSD1306
// library's begin()/display()/drawPixel()/print() issue under the hood
// (confirmed against the actual installed library source). Fixed wiring:
// I2C, so no CS/DC/RST pin fields needed (unlike the SPI-based ILI9341).

Blockly.Blocks["ssd1306_setup"] = {
  init: function () {
    this.appendDummyInput().appendField("set up SSD1306 OLED display (I2C)");
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour("#AD1457");
    this.setTooltip("One-time setup — place this in setup(). Wired via I2C (A4/A5), address 0x3C.");
  },
};

Blockly.Blocks["ssd1306_print"] = {
  init: function () {
    this.appendValueInput("TEXT").appendField("OLED print");
    this.appendValueInput("COL").setCheck("Number").appendField("at x");
    this.appendValueInput("ROW").setCheck("Number").appendField("y");
    this.setInputsInline(true);
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour("#AD1457");
    this.setTooltip("Prints text at a pixel position. Call 'show OLED changes' after to actually display it.");
  },
};

Blockly.Blocks["ssd1306_clear"] = {
  init: function () {
    this.appendDummyInput().appendField("OLED clear");
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour("#AD1457");
  },
};

Blockly.Blocks["ssd1306_show"] = {
  init: function () {
    this.appendDummyInput().appendField("show OLED changes");
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour("#AD1457");
    this.setTooltip("Pushes pending print/clear changes out to the real display.");
  },
};

const SSD1306_INCLUDES = () => {
  cppGenerator.includes_["ssd1306_gfx"] = "#include <Adafruit_GFX.h>";
  cppGenerator.includes_["ssd1306"] = "#include <Adafruit_SSD1306.h>";
  cppGenerator.definitions_["ssd1306_obj"] = "Adafruit_SSD1306 oled(128, 64, &Wire, -1);";
  cppGenerator.setups_["ssd1306_begin"] = "oled.begin(SSD1306_SWITCHCAPVCC, 0x3C);";
};

cppGenerator.forBlock["ssd1306_setup"] = function () {
  SSD1306_INCLUDES();
  return "";
};

cppGenerator.forBlock["ssd1306_print"] = function (block) {
  const text = cppGenerator.valueToCode(block, "TEXT", Order.NONE) || '""';
  const col = cppGenerator.valueToCode(block, "COL", Order.NONE) || "0";
  const row = cppGenerator.valueToCode(block, "ROW", Order.NONE) || "0";
  SSD1306_INCLUDES();
  return `oled.setCursor(${col}, ${row});\n  oled.print(${text});\n`;
};

cppGenerator.forBlock["ssd1306_clear"] = function () {
  SSD1306_INCLUDES();
  return "oled.clearDisplay();\n";
};

cppGenerator.forBlock["ssd1306_show"] = function () {
  SSD1306_INCLUDES();
  return "oled.display();\n";
};
