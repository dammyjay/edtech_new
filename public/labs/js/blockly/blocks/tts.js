// Text to Speech — uses the browser's own SpeechSynthesis API (no API
// key/external service needed). See engine.js's TEXT TO SPEECH section.

Blockly.Blocks["tts_speak"] = {
  init() {
    this.appendValueInput("TEXT").appendField("Speak");

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#774B9E");
  },
};

Blockly.Blocks["tts_set_voice"] = {
  init() {
    this.appendDummyInput()
      .appendField("Set Voice To")
      .appendField(
        new Blockly.FieldDropdown(() => {
          // Dynamic — speechSynthesis.getVoices() is often empty until the
          // browser's 'voiceschanged' event fires, so fall back to a
          // single "Default" entry rather than showing nothing.
          const voices = window.speechSynthesis ? speechSynthesis.getVoices() : [];
          if (!voices.length) return [["Default", ""]];
          return voices.map((v) => [`${v.name} (${v.lang})`, v.name]);
        }),
        "VOICE",
      );

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#774B9E");
  },
};

Blockly.Blocks["tts_set_language"] = {
  init() {
    this.appendDummyInput()
      .appendField("Set Language To")
      .appendField(
        new Blockly.FieldDropdown([
          ["English (US)", "en-US"],
          ["English (UK)", "en-GB"],
          ["Spanish", "es-ES"],
          ["French", "fr-FR"],
          ["German", "de-DE"],
          ["Italian", "it-IT"],
          ["Portuguese", "pt-BR"],
          ["Chinese (Mandarin)", "zh-CN"],
          ["Japanese", "ja-JP"],
          ["Korean", "ko-KR"],
          ["Russian", "ru-RU"],
          ["Arabic", "ar-SA"],
          ["Hindi", "hi-IN"],
        ]),
        "LANGUAGE",
      );

    this.setPreviousStatement(true);
    this.setNextStatement(true);

    this.setColour("#774B9E");
  },
};
