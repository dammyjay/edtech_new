// Heart Rate Sensor extension — pure sugar over digital_read. Confirmed
// via bindComponentsToSimulation (arduinoLab.js, NO_UI_SENSOR_TAGS branch
// ~2193-2220) that only the OUT/DOUT pin role is recognized (no analog
// output modeled), driven by this app's own selection-toolbar toggle.

Blockly.Blocks["heart_rate_pulse_detected"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("heartbeat pulse detected on pin")
      .appendField(new Blockly.FieldDropdown(ARDUINO_PIN_OPTIONS), "PIN");
    this.setOutput(true, "Boolean");
    this.setColour("#2E7D32");
    this.setTooltip("True during a detected pulse. Use the component's own toolbar toggle (click it on the canvas) to test both states.");
  },
};

cppGenerator.forBlock["heart_rate_pulse_detected"] = function (block) {
  const pin = normalizePin(block.getFieldValue("PIN"));
  return [`(digitalRead(${pin}) == HIGH)`, Order.RELATIONAL];
};
