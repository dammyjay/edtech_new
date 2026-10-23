// Music — synthesized notes/drums (Web Audio oscillators + filtered noise
// bursts), not real sampled instruments. See engine.js's MUSIC section.

Blockly.Blocks["play_drum"] = {
  init() {
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
    this.appendValueInput("BEATS").appendField("Rest For");

    this.appendDummyInput().appendField("Beats");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#4C97FF");
  },
};

Blockly.Blocks["play_note"] = {
  init() {
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
    this.appendValueInput("VALUE").appendField("Change Tempo By");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#4C97FF");
  },
};

Blockly.Blocks["set_tempo"] = {
  init() {
    this.appendValueInput("VALUE").appendField("Set Tempo To");

    this.appendDummyInput().appendField("BPM");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#4C97FF");
  },
};

Blockly.Blocks["tempo_reporter"] = {
  init() {
    this.appendDummyInput().appendField("tempo");

    this.setOutput(true, "Number");

    this.setColour("#4C97FF");
  },
};
