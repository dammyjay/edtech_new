// Real-Time Clock DS1307 extension. Confirmed via
// bindComponentsToSimulation (arduinoLab.js ~2221-2281) that this is a
// real I2C device at address 0x68 implementing the actual DS1307
// register map (BCD-encoded seconds/minutes/hours/day/date/month/year),
// matching RTClib's real rtc.begin()/rtc.now() API exactly (confirmed
// against the actual installed RTClib source) — reads return the live
// current real-world time, ticking forward in real time.

Blockly.Blocks["ds1307_setup"] = {
  init: function () {
    this.appendDummyInput().appendField("set up DS1307 real-time clock (I2C)");
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour("#AD1457");
    this.setTooltip("One-time setup — place this in setup(). Wired via I2C (A4/A5).");
  },
};

Blockly.Blocks["ds1307_read"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("clock")
      .appendField(
        new Blockly.FieldDropdown([
          ["hour", "hour"],
          ["minute", "minute"],
          ["second", "second"],
          ["day", "day"],
          ["month", "month"],
          ["year", "year"],
        ]),
        "FIELD"
      );
    this.setOutput(true, "Number");
    this.setColour("#AD1457");
    this.setTooltip("Reads one part of the current time/date from the clock.");
  },
};

cppGenerator.forBlock["ds1307_setup"] = function () {
  cppGenerator.includes_["ds1307"] = "#include <RTClib.h>";
  cppGenerator.definitions_["ds1307_obj"] = "RTC_DS1307 rtc;";
  cppGenerator.setups_["ds1307_begin"] = "rtc.begin();";
  return "";
};

cppGenerator.forBlock["ds1307_read"] = function (block) {
  const field = block.getFieldValue("FIELD");
  cppGenerator.includes_["ds1307"] = "#include <RTClib.h>";
  cppGenerator.definitions_["ds1307_obj"] ||= "RTC_DS1307 rtc;";
  return [`rtc.now().${field}()`, Order.ATOMIC];
};
