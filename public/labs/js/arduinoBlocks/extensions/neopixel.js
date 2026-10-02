// NeoPixel extension — covers all 3 catalog entries that share the exact
// same binding (wokwi-neopixel, wokwi-neopixel-matrix, wokwi-led-ring; see
// bindWS2812Strip, arduinoLab.js ~1655-1702): a real WS2812 one-wire
// bit-bang protocol, 24 bits/pixel in GRB order, which is exactly what
// the Adafruit_NeoPixel library's real setPixelColor()/show() produce.
// v1 limitation: one strip object ("strip"), matching the single-object
// precedent set by servo.js/lcd1602.js.

Blockly.Blocks["neopixel_attach"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("set up NeoPixel strip of")
      .appendField(new Blockly.FieldNumber(8, 1, 256, 1), "COUNT")
      .appendField("pixels on pin")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "PIN");
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour("#6A1B9A");
    this.setTooltip("One-time setup — place this in setup(). Works for a single NeoPixel, a matrix, or a ring — just set the pixel count to match.");
  },
};

Blockly.Blocks["neopixel_set_pixel"] = {
  init: function () {
    this.appendValueInput("INDEX").setCheck("Number").appendField("set NeoPixel");
    this.appendValueInput("R").setCheck("Number").appendField("to R");
    this.appendValueInput("G").setCheck("Number").appendField("G");
    this.appendValueInput("B").setCheck("Number").appendField("B");
    this.setInputsInline(true);
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour("#6A1B9A");
    this.setTooltip("Sets one pixel's color (index starts at 0, each channel 0-255). Call 'show NeoPixel changes' after to actually display it.");
  },
};

Blockly.Blocks["neopixel_show"] = {
  init: function () {
    this.appendDummyInput().appendField("show NeoPixel changes");
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour("#6A1B9A");
    this.setTooltip("Pushes all pending setPixelColor changes out to the strip.");
  },
};

cppGenerator.forBlock["neopixel_attach"] = function (block) {
  const count = block.getFieldValue("COUNT");
  const pin = normalizePin(block.getFieldValue("PIN"));
  cppGenerator.includes_["neopixel"] = "#include <Adafruit_NeoPixel.h>";
  cppGenerator.definitions_["neopixel_obj"] = `Adafruit_NeoPixel strip(${count}, ${pin}, NEO_GRB + NEO_KHZ800);`;
  cppGenerator.setups_["neopixel_begin"] = "strip.begin();";
  return "";
};

cppGenerator.forBlock["neopixel_set_pixel"] = function (block) {
  const index = cppGenerator.valueToCode(block, "INDEX", Order.NONE) || "0";
  const r = cppGenerator.valueToCode(block, "R", Order.NONE) || "0";
  const g = cppGenerator.valueToCode(block, "G", Order.NONE) || "0";
  const b = cppGenerator.valueToCode(block, "B", Order.NONE) || "0";
  cppGenerator.includes_["neopixel"] = "#include <Adafruit_NeoPixel.h>";
  cppGenerator.definitions_["neopixel_obj"] ||= "Adafruit_NeoPixel strip(8, 6, NEO_GRB + NEO_KHZ800);";
  return `strip.setPixelColor(${index}, ${r}, ${g}, ${b});\n`;
};

cppGenerator.forBlock["neopixel_show"] = function () {
  cppGenerator.includes_["neopixel"] = "#include <Adafruit_NeoPixel.h>";
  cppGenerator.definitions_["neopixel_obj"] ||= "Adafruit_NeoPixel strip(8, 6, NEO_GRB + NEO_KHZ800);";
  return "strip.show();\n";
};
