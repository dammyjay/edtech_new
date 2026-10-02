// Core Arduino block definitions — always present, not behind an
// extension. Old-style Blockly.Blocks["type"] = { init(){...} } convention,
// matching this codebase's existing blockly/blocks/*.js precedent.

const ARDUINO_PIN_OPTIONS = [
  ...["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13"].map((p) => [p, p]),
  ...["A0", "A1", "A2", "A3", "A4", "A5"].map((p) => [p, p]),
];

// Real Arduino silently falls back to a plain digital write on a
// non-PWM-capable pin (standard arduino-cli/avr-gcc core behavior) — so
// this is just a sane default list to steer students toward working
// examples, not an enforced restriction. The full ARDUINO_PIN_OPTIONS
// list is still accepted.
const PWM_PIN_OPTIONS = ["3", "5", "6", "9", "10", "11"].map((p) => [p, p]);

Blockly.Blocks["arduino_setup"] = {
  init: function () {
    this.appendDummyInput().appendField("⚙️ setup");
    this.appendStatementInput("DO");
    this.setDeletable(false);
    this.setMovable(false);
    this.setColour("#5C6BC0");
    this.setTooltip("Code here runs once when the board powers on.");
  },
};

Blockly.Blocks["arduino_loop"] = {
  init: function () {
    this.appendDummyInput().appendField("🔁 loop");
    this.appendStatementInput("DO");
    this.setDeletable(false);
    this.setMovable(false);
    this.setColour("#5C6BC0");
    this.setTooltip("Code here runs forever, over and over.");
  },
};

Blockly.Blocks["pin_mode"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("set pin")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "PIN")
      .appendField("mode")
      .appendField(
        new Blockly.FieldDropdown([
          ["OUTPUT", "OUTPUT"],
          ["INPUT", "INPUT"],
          ["INPUT_PULLUP", "INPUT_PULLUP"],
        ]),
        "MODE"
      );
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour("#E65100");
    this.setTooltip("Sets whether a pin reads input or drives output.");
  },
};

Blockly.Blocks["digital_write"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("digital write pin")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "PIN")
      .appendField("to")
      .appendField(
        new Blockly.FieldDropdown([
          ["HIGH", "HIGH"],
          ["LOW", "LOW"],
        ]),
        "STATE"
      );
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour("#E65100");
    this.setTooltip("Sets a digital pin fully on (HIGH) or off (LOW).");
  },
};

Blockly.Blocks["digital_read"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("digital read pin")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "PIN");
    this.setOutput(true, "Number");
    this.setColour("#E65100");
    this.setTooltip("Reads a digital pin: HIGH (1) or LOW (0).");
  },
};

Blockly.Blocks["analog_write"] = {
  init: function () {
    this.appendValueInput("VALUE")
      .setCheck("Number")
      .appendField("analog write pin")
      .appendField(new Blockly.FieldDropdown(PWM_PIN_OPTIONS), "PIN")
      .appendField("value");
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour("#E65100");
    this.setTooltip("Writes a PWM value (0-255) to a PWM-capable pin.");
  },
};

Blockly.Blocks["analog_read"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("analog read pin")
      .appendField(
        new Blockly.FieldDropdown(["A0", "A1", "A2", "A3", "A4", "A5"].map((p) => [p, p])),
        "PIN"
      );
    this.setOutput(true, "Number");
    this.setColour("#E65100");
    this.setTooltip("Reads an analog pin: 0-1023.");
  },
};

Blockly.Blocks["arduino_delay"] = {
  init: function () {
    this.appendValueInput("MS").setCheck("Number").appendField("delay");
    this.appendDummyInput().appendField("ms");
    this.setInputsInline(true);
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour("#6D4C41");
    this.setTooltip("Pauses the program for the given number of milliseconds.");
  },
};

Blockly.Blocks["serial_begin"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("start Serial at")
      .appendField(
        new Blockly.FieldDropdown([
          ["9600", "9600"],
          ["19200", "19200"],
          ["38400", "38400"],
          ["57600", "57600"],
          ["115200", "115200"],
        ]),
        "BAUD"
      )
      .appendField("baud");
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour("#6D4C41");
    this.setTooltip("Opens the Serial Monitor connection — place this in setup.");
  },
};

Blockly.Blocks["serial_print"] = {
  init: function () {
    this.appendValueInput("VALUE").appendField("Serial print");
    this.appendDummyInput()
      .appendField("then")
      .appendField(
        new Blockly.FieldDropdown([
          ["new line", "TRUE"],
          ["no new line", "FALSE"],
        ]),
        "NEWLINE"
      );
    this.setInputsInline(true);
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour("#6D4C41");
    this.setTooltip("Prints a value to the Serial Monitor.");
  },
};
