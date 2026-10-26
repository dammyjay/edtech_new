// Sound — real audio clips attached to a sprite (admin-curated and/or
// student-uploaded, see sprite.sounds[] in blocklyLab.js). See
// engine.js's SOUND section for playback.

function spriteSoundDropdown() {
  const sprite = window.currentSprite;
  const sounds = sprite && sprite.sounds && sprite.sounds.length ? sprite.sounds : [{ name: "No sounds yet" }];
  return sounds.map((s) => [s.name, s.name]);
}

Blockly.Blocks["start_sound"] = {
  init() {
    this.setTooltip("Starts playing the chosen sound without waiting for it to finish.");
    this.appendDummyInput()
      .appendField("Start Sound")
      .appendField(new Blockly.FieldDropdown(spriteSoundDropdown), "SOUND");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#CF63CF");
  },
};

Blockly.Blocks["play_sound_until_done"] = {
  init() {
    this.setTooltip("Plays the chosen sound and waits until it finishes before continuing.");
    this.appendDummyInput()
      .appendField("Play Sound")
      .appendField(new Blockly.FieldDropdown(spriteSoundDropdown), "SOUND")
      .appendField("Until Done");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#CF63CF");
  },
};

Blockly.Blocks["stop_all_sounds"] = {
  init() {
    this.setTooltip("Stops every sound that's currently playing.");
    this.appendDummyInput().appendField("Stop All Sounds");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#CF63CF");
  },
};

Blockly.Blocks["change_volume"] = {
  init() {
    this.setTooltip("Changes the volume by the given amount.");
    this.appendValueInput("VALUE").appendField("Change Volume By");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#CF63CF");
  },
};

Blockly.Blocks["set_volume"] = {
  init() {
    this.setTooltip("Sets the volume as a percentage.");
    this.appendValueInput("VALUE").appendField("Set Volume To");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#CF63CF");
  },
};

Blockly.Blocks["volume_reporter"] = {
  init() {
    this.setTooltip("Reports the current volume.");
    this.appendDummyInput().appendField("volume");

    this.setOutput(true, "Number");

    this.setColour("#CF63CF");
  },
};

Blockly.Blocks["set_sound_effect"] = {
  init() {
    this.setTooltip("Sets the pitch or pan (left/right balance) effect to a value.");
    this.appendValueInput("VALUE")
      .appendField("Set")
      .appendField(
        new Blockly.FieldDropdown([
          ["Pitch", "pitch"],
          ["Pan", "pan"],
        ]),
        "EFFECT",
      )
      .appendField("Effect To");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#CF63CF");
  },
};

Blockly.Blocks["change_sound_effect"] = {
  init() {
    this.setTooltip("Changes the pitch or pan (left/right balance) effect by the given amount.");
    this.appendValueInput("VALUE")
      .appendField("Change")
      .appendField(
        new Blockly.FieldDropdown([
          ["Pitch", "pitch"],
          ["Pan", "pan"],
        ]),
        "EFFECT",
      )
      .appendField("Effect By");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#CF63CF");
  },
};

Blockly.Blocks["clear_sound_effects"] = {
  init() {
    this.setTooltip("Removes every sound effect (pitch, pan).");
    this.appendDummyInput().appendField("Clear Sound Effects");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#CF63CF");
  },
};
