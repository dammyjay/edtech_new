// IR Receiver extension. Confirmed via bindComponentsToSimulation
// (arduinoLab.js ~2720-2775) that this implements the real NEC protocol,
// and confirmed against the actual installed "IRremote" library source
// (v4.7.1) that its real API is IrReceiver.begin(pin, feedback) /
// IrReceiver.decode() / IrReceiver.decodedIRData.command /
// IrReceiver.resume() — IrReceiver is a global object the library itself
// provides, not something this extension declares. Offered as building
// blocks (not an auto-generated decode+if+resume flow) matching the
// "thin sugar over a real, more advanced API" approach used for the
// rotary encoder/dialer above.

Blockly.Blocks["ir_receiver_setup"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("set up IR receiver on pin")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "PIN");
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour("#AD1457");
    this.setTooltip("One-time setup — place this in setup().");
  },
};

Blockly.Blocks["ir_received"] = {
  init: function () {
    this.appendDummyInput().appendField("IR code received");
    this.setOutput(true, "Boolean");
    this.setColour("#AD1457");
    this.setTooltip("True if a new IR code has arrived. Call 'resume IR receiver' after reading it to listen for the next one.");
  },
};

Blockly.Blocks["ir_command"] = {
  init: function () {
    this.appendDummyInput().appendField("IR command code");
    this.setOutput(true, "Number");
    this.setColour("#AD1457");
    this.setTooltip("The last received IR command byte. Only valid right after 'IR code received' is true.");
  },
};

Blockly.Blocks["ir_resume"] = {
  init: function () {
    this.appendDummyInput().appendField("resume IR receiver");
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour("#AD1457");
    this.setTooltip("Call this after handling a received code, so the receiver is ready for the next one.");
  },
};

cppGenerator.forBlock["ir_receiver_setup"] = function (block) {
  const pin = normalizePin(block.getFieldValue("PIN"));
  cppGenerator.includes_["ir"] = "#include <IRremote.hpp>";
  cppGenerator.setups_["ir_begin"] = `IrReceiver.begin(${pin}, DISABLE_LED_FEEDBACK);`;
  return "";
};

cppGenerator.forBlock["ir_received"] = function () {
  cppGenerator.includes_["ir"] = "#include <IRremote.hpp>";
  return ["IrReceiver.decode()", Order.ATOMIC];
};

cppGenerator.forBlock["ir_command"] = function () {
  cppGenerator.includes_["ir"] = "#include <IRremote.hpp>";
  return ["IrReceiver.decodedIRData.command", Order.ATOMIC];
};

cppGenerator.forBlock["ir_resume"] = function () {
  cppGenerator.includes_["ir"] = "#include <IRremote.hpp>";
  return "IrReceiver.resume();\n";
};
