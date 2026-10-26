// Music — synthesized notes/drums (Web Audio oscillators + filtered noise
// bursts), not real sampled instruments. See engine.js's MUSIC section.

Blockly.Blocks["play_drum"] = {
  init() {
    this.setTooltip("Plays the chosen drum sound for the given number of beats.");
    this.appendValueInput("BEATS")
      .appendField("Play Drum")
      .appendField(
        new Blockly.FieldDropdown([
          ["Snare Drum", "snare"],
          ["Bass Drum", "bass drum"],
          ["Hi-Hat", "hi-hat"],
          ["Tambourine", "tambourine"],
          ["Cowbell", "cowbell"],
          ["Clap", "clap"],
        ]),
        "DRUM",
      )
      .appendField("For");

    this.appendDummyInput().appendField("Beats");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#4C97FF");
  },
};

Blockly.Blocks["music_rest"] = {
  init() {
    this.setTooltip("Pauses for the given number of beats, in silence.");
    this.appendValueInput("BEATS").appendField("Rest For");

    this.appendDummyInput().appendField("Beats");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#4C97FF");
  },
};

Blockly.Blocks["play_note"] = {
  init() {
    this.setTooltip("Plays a musical note (0-127, middle C is 60) for the given number of beats.");
    this.appendValueInput("NOTE").appendField("Play Note");

    this.appendValueInput("BEATS").appendField("For");

    this.appendDummyInput().appendField("Beats");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#4C97FF");
  },
};

Blockly.Blocks["set_instrument"] = {
  init() {
    this.setTooltip("Sets which instrument sound future notes play with.");
    this.appendDummyInput()
      .appendField("Set Instrument To")
      .appendField(
        new Blockly.FieldDropdown([
          ["Piano", "piano"],
          ["Electric Piano", "electric piano"],
          ["Guitar", "guitar"],
          ["Organ", "organ"],
          ["Marimba", "marimba"],
          ["Synth", "synth"],
        ]),
        "INSTRUMENT",
      );

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#4C97FF");
  },
};

Blockly.Blocks["change_tempo"] = {
  init() {
    this.setTooltip("Changes the tempo (speed of beats) by the given amount.");
    this.appendValueInput("VALUE").appendField("Change Tempo By");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#4C97FF");
  },
};

Blockly.Blocks["set_tempo"] = {
  init() {
    this.setTooltip("Sets the tempo in beats per minute.");
    this.appendValueInput("VALUE").appendField("Set Tempo To");

    this.appendDummyInput().appendField("BPM");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#4C97FF");
  },
};

Blockly.Blocks["tempo_reporter"] = {
  init() {
    this.setTooltip("Reports the current tempo in beats per minute.");
    this.appendDummyInput().appendField("tempo");

    this.setOutput(true, "Number");

    this.setColour("#4C97FF");
  },
};
