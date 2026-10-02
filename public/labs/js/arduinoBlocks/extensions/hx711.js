// Load Cell Amplifier HX711 extension. Confirmed via
// bindComponentsToSimulation (arduinoLab.js ~2546-2614) that this is a
// real 24-bit shiftIn protocol matching Rob Tillaart's HX711 library
// (confirmed against the actual installed library source) — the
// simulated reading is fixed (SIMULATED_RAW_VALUE), so read() always
// returns the same value regardless of load.

Blockly.Blocks["hx711_setup"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("set up load cell  DT pin")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "DT")
      .appendField("SCK pin")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "SCK");
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour("#AD1457");
    this.setTooltip("One-time setup — place this in setup().");
  },
};

Blockly.Blocks["hx711_read"] = {
  init: function () {
    this.appendDummyInput().appendField("load cell reading");
    this.setOutput(true, "Number");
    this.setColour("#AD1457");
    this.setTooltip("Reads the raw load cell value (blocks briefly until the sensor is ready).");
  },
};

cppGenerator.forBlock["hx711_setup"] = function (block) {
  const dt = normalizePin(block.getFieldValue("DT"));
  const sck = normalizePin(block.getFieldValue("SCK"));
  cppGenerator.includes_["hx711"] = "#include <HX711.h>";
  cppGenerator.definitions_["hx711_obj"] = "HX711 scale;";
  cppGenerator.setups_["hx711_begin"] = `scale.begin(${dt}, ${sck});`;
  return "";
};

cppGenerator.forBlock["hx711_read"] = function () {
  cppGenerator.includes_["hx711"] = "#include <HX711.h>";
  cppGenerator.definitions_["hx711_obj"] ||= "HX711 scale;";
  return ["scale.read()", Order.ATOMIC];
};
