// TFT Display ILI9341 extension. Confirmed via bindComponentsToSimulation
// (arduinoLab.js ~2830-2957) that this is a real SPI command/GRAM
// protocol (CASET/PASET/RAMWR), matching the real Adafruit_ILI9341
// library's begin()/fillScreen()/drawPixel()/print() exactly (confirmed
// against the actual installed library + its Adafruit_GFX base class
// source). Hardware SPI pins (MOSI/MISO/SCK = 11/12/13) are fixed; only
// CS and DC are configurable per the real constructor.

const ILI9341_COLOR_OPTIONS = [
  ["black", "ILI9341_BLACK"],
  ["white", "ILI9341_WHITE"],
  ["red", "ILI9341_RED"],
  ["green", "ILI9341_GREEN"],
  ["blue", "ILI9341_BLUE"],
  ["yellow", "ILI9341_YELLOW"],
  ["cyan", "ILI9341_CYAN"],
  ["magenta", "ILI9341_MAGENTA"],
];

Blockly.Blocks["ili9341_setup"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("set up ILI9341 TFT  CS pin")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "CS")
      .appendField("DC pin")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "DC");
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour("#AD1457");
    this.setTooltip("One-time setup — place this in setup(). Uses hardware SPI (pins 11-13) plus the CS/DC pins you choose here.");
  },
};

Blockly.Blocks["ili9341_fill_screen"] = {
  init: function () {
    this.appendDummyInput().appendField("TFT fill screen").appendField(new Blockly.FieldDropdown(ILI9341_COLOR_OPTIONS), "COLOR");
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour("#AD1457");
  },
};

Blockly.Blocks["ili9341_draw_pixel"] = {
  init: function () {
    this.appendValueInput("X").setCheck("Number").appendField("TFT draw pixel at x");
    this.appendValueInput("Y").setCheck("Number").appendField("y");
    this.appendDummyInput().appendField("color").appendField(new Blockly.FieldDropdown(ILI9341_COLOR_OPTIONS), "COLOR");
    this.setInputsInline(true);
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour("#AD1457");
  },
};

Blockly.Blocks["ili9341_print"] = {
  init: function () {
    this.appendValueInput("TEXT").appendField("TFT print");
    this.appendValueInput("X").setCheck("Number").appendField("at x");
    this.appendValueInput("Y").setCheck("Number").appendField("y");
    this.appendDummyInput().appendField("color").appendField(new Blockly.FieldDropdown(ILI9341_COLOR_OPTIONS), "COLOR");
    this.setInputsInline(true);
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour("#AD1457");
  },
};

const ILI9341_INCLUDES = () => {
  cppGenerator.includes_["ili9341_gfx"] = "#include <Adafruit_GFX.h>";
  cppGenerator.includes_["ili9341"] = "#include <Adafruit_ILI9341.h>";
};

cppGenerator.forBlock["ili9341_setup"] = function (block) {
  const cs = normalizePin(block.getFieldValue("CS"));
  const dc = normalizePin(block.getFieldValue("DC"));
  ILI9341_INCLUDES();
  cppGenerator.definitions_["ili9341_obj"] = `Adafruit_ILI9341 tft(${cs}, ${dc});`;
  cppGenerator.setups_["ili9341_begin"] = "tft.begin();";
  return "";
};

cppGenerator.forBlock["ili9341_fill_screen"] = function (block) {
  const color = block.getFieldValue("COLOR");
  ILI9341_INCLUDES();
  cppGenerator.definitions_["ili9341_obj"] ||= "Adafruit_ILI9341 tft(10, 9);";
  return `tft.fillScreen(${color});\n`;
};

cppGenerator.forBlock["ili9341_draw_pixel"] = function (block) {
  const x = cppGenerator.valueToCode(block, "X", Order.NONE) || "0";
  const y = cppGenerator.valueToCode(block, "Y", Order.NONE) || "0";
  const color = block.getFieldValue("COLOR");
  ILI9341_INCLUDES();
  cppGenerator.definitions_["ili9341_obj"] ||= "Adafruit_ILI9341 tft(10, 9);";
  return `tft.drawPixel(${x}, ${y}, ${color});\n`;
};

cppGenerator.forBlock["ili9341_print"] = function (block) {
  const text = cppGenerator.valueToCode(block, "TEXT", Order.NONE) || '""';
  const x = cppGenerator.valueToCode(block, "X", Order.NONE) || "0";
  const y = cppGenerator.valueToCode(block, "Y", Order.NONE) || "0";
  const color = block.getFieldValue("COLOR");
  ILI9341_INCLUDES();
  cppGenerator.definitions_["ili9341_obj"] ||= "Adafruit_ILI9341 tft(10, 9);";
  return `tft.setCursor(${x}, ${y});\n  tft.setTextColor(${color});\n  tft.print(${text});\n`;
};
