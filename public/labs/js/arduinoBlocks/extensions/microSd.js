// MicroSD Card Module extension. Confirmed via bindComponentsToSimulation
// (arduinoLab.js ~2958-3073) that only the real SPI init handshake
// (CMD0/CMD8/CMD55+ACMD41/CMD58, plus a valid empty FAT16 boot sector for
// block 0) is modeled — matching the real SD library's SD.begin(csPin)
// exactly (confirmed against the actual installed "SD" library source).
// File read/write is explicitly NOT modeled (every other block reads
// back all-zero), so only the init-check block is offered — a
// File-based block set would silently never actually read/write
// anything real in this simulator.

Blockly.Blocks["sd_begin"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("initialize SD card, CS pin")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "PIN");
    this.setOutput(true, "Boolean");
    this.setColour("#AD1457");
    this.setTooltip(
      "True if the SD card initialized successfully. Note: this simulator models the real SPI init handshake but not actual file storage — file open/read/write isn't simulated."
    );
  },
};

cppGenerator.forBlock["sd_begin"] = function (block) {
  const pin = normalizePin(block.getFieldValue("PIN"));
  cppGenerator.includes_["sd"] = "#include <SD.h>";
  return [`SD.begin(${pin})`, Order.ATOMIC];
};
