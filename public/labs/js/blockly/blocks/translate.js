// Translate — a free, no-API-key translation service (MyMemory) called
// through a small server-side proxy (routes/labRoutes.js's
// POST /labs/translate) so the daily quota is shared/cached server-side
// instead of calling a third-party endpoint straight from the browser.
// Like Sound's "play until done" and Sensing's "ask and wait", the actual
// network call is a blocking COMMAND block; a separate reporter reads the
// cached result — this codebase has no async reporter blocks (see
// ask_and_wait/answer in sensors.js for the same split).

Blockly.Blocks["translate_and_wait"] = {
  init() {
    this.setTooltip("Translates the given text (from English) to the chosen language, and waits for the result — read it afterward with the Translation Result block.");
    this.appendValueInput("TEXT").appendField("Translate");
    this.appendDummyInput()
      .appendField("to")
      .appendField(
        new Blockly.FieldDropdown([
          ["Spanish", "es"],
          ["French", "fr"],
          ["German", "de"],
          ["Italian", "it"],
          ["Portuguese", "pt"],
          ["Chinese (Mandarin)", "zh"],
          ["Arabic", "ar"],
          ["Hausa", "ha"],
          ["Yoruba", "yo"],
          ["Igbo", "ig"],
          ["Swahili", "sw"],
        ]),
        "LANGUAGE",
      );

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#4B9E8B");
  },
};

Blockly.Blocks["translation_result"] = {
  init() {
    this.setTooltip("Reports the text from the most recent Translate block.");
    this.appendDummyInput().appendField("Translation Result");

    this.setOutput(true, "String");

    this.setColour("#4B9E8B");
  },
};

Blockly.Blocks["viewer_language"] = {
  init() {
    this.setTooltip("Reports the language the student's own browser/device is set to — an approximation of their preferred language, not necessarily the project's language.");
    this.appendDummyInput().appendField("Viewer Language");

    this.setOutput(true, "String");

    this.setColour("#4B9E8B");
  },
};
