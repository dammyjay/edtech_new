// Accelerometer/Gyroscope MPU6050 extension. Confirmed via
// bindComponentsToSimulation (arduinoLab.js ~2282-2319) that this is a
// real I2C device at address 0x68 implementing the actual MPU6050
// register map (WHO_AM_I + ACCEL/GYRO/TEMP registers), matching the real
// Adafruit_MPU6050 library's begin()/getEvent() API (confirmed against
// the actual installed library source) — the simulated reading is fixed
// (level and still: accel Z=+1g, everything else 0).

Blockly.Blocks["mpu6050_setup"] = {
  init: function () {
    this.appendDummyInput().appendField("set up MPU6050 accelerometer/gyroscope (I2C)");
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour("#AD1457");
    this.setTooltip("One-time setup — place this in setup(). Wired via I2C (A4/A5).");
  },
};

Blockly.Blocks["mpu6050_read"] = {
  init: function () {
    this.appendDummyInput()
      .appendField("MPU6050")
      .appendField(
        new Blockly.FieldDropdown([
          ["accel X", "accelX"],
          ["accel Y", "accelY"],
          ["accel Z", "accelZ"],
          ["gyro X", "gyroX"],
          ["gyro Y", "gyroY"],
          ["gyro Z", "gyroZ"],
          ["temperature", "temp"],
        ]),
        "FIELD"
      );
    this.setOutput(true, "Number");
    this.setColour("#AD1457");
    this.setTooltip("Reads one value from the sensor (acceleration in m/s², gyro in rad/s, temperature in °C).");
  },
};

// Real named helper functions, not an inline lambda — matches the same
// readability decision made for the ultrasonic sensor (see its own
// comment): the generated .ino should read like code a student could
// have written themselves. All 7 are hoisted as ONE fixed definitions_
// entry whenever the extension is used at all (rather than tracking
// which specific fields appear and accumulating that across calls) — a
// deliberately simple choice: a few unused helper functions sitting in
// the generated code cost nothing (no warning, no behavior change), and
// it avoids the exact class of bug the ultrasonic fix above addressed —
// per-call mutable state on the generator that never gets cleared
// between separate generateFullSketch() runs would go stale the moment a
// block is removed and regenerated.
const MPU6050_HELPER_FUNCS = [
  "float mpu6050ReadAccelX() { sensors_event_t a, g, t; mpu.getEvent(&a, &g, &t); return a.acceleration.x; }",
  "float mpu6050ReadAccelY() { sensors_event_t a, g, t; mpu.getEvent(&a, &g, &t); return a.acceleration.y; }",
  "float mpu6050ReadAccelZ() { sensors_event_t a, g, t; mpu.getEvent(&a, &g, &t); return a.acceleration.z; }",
  "float mpu6050ReadGyroX() { sensors_event_t a, g, t; mpu.getEvent(&a, &g, &t); return g.gyro.x; }",
  "float mpu6050ReadGyroY() { sensors_event_t a, g, t; mpu.getEvent(&a, &g, &t); return g.gyro.y; }",
  "float mpu6050ReadGyroZ() { sensors_event_t a, g, t; mpu.getEvent(&a, &g, &t); return g.gyro.z; }",
  "float mpu6050ReadTemp() { sensors_event_t a, g, t; mpu.getEvent(&a, &g, &t); return t.temperature; }",
].join("\n");

const MPU6050_FIELD_CALLS = {
  accelX: "mpu6050ReadAccelX()",
  accelY: "mpu6050ReadAccelY()",
  accelZ: "mpu6050ReadAccelZ()",
  gyroX: "mpu6050ReadGyroX()",
  gyroY: "mpu6050ReadGyroY()",
  gyroZ: "mpu6050ReadGyroZ()",
  temp: "mpu6050ReadTemp()",
};

// ONE combined definitions_ entry (object + helper functions together) —
// not two separate keys — because definitions_ is emitted in sorted-key
// order and "mpu6050_funcs" sorts before "mpu6050_obj" alphabetically,
// which previously emitted the helper functions (which reference `mpu`)
// before the `mpu` object itself was declared: a real compile caught
// this ("'mpu' was not declared in this scope"). Same class of bug, same
// fix, as the ultrasonic extension's pins+helper merge.
const MPU6050_SETUP = () => {
  cppGenerator.includes_["mpu6050"] = "#include <Adafruit_MPU6050.h>";
  cppGenerator.includes_["mpu6050_sensor"] = "#include <Adafruit_Sensor.h>";
  cppGenerator.definitions_["mpu6050_obj"] = "Adafruit_MPU6050 mpu;\n" + MPU6050_HELPER_FUNCS;
};

cppGenerator.forBlock["mpu6050_setup"] = function () {
  MPU6050_SETUP();
  cppGenerator.setups_["mpu6050_begin"] = "mpu.begin();";
  return "";
};

cppGenerator.forBlock["mpu6050_read"] = function (block) {
  const field = block.getFieldValue("FIELD");
  MPU6050_SETUP();
  return [MPU6050_FIELD_CALLS[field], Order.ATOMIC];
};
