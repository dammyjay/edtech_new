console.log("looks generator loaded");

const jsGenerator = javascript.javascriptGenerator;

// =========================
// Generators for Event Blocks
// =========================

jsGenerator.forBlock["when_key_pressed"] = function (block) {
  const key = block.getFieldValue("KEY");

  const statements = jsGenerator.statementToCode(block, "DO");

  return `
registerKeyEvent("${key}", async ()=>{
${statements}
});
`;
};

jsGenerator.forBlock["when_sprite_clicked"] = function (block) {
  const statements = jsGenerator.statementToCode(block, "DO");

  return `
registerSpriteClick(async ()=>{
${statements}
});
`;
};

jsGenerator.forBlock["broadcast_message"] = function (block) {
  const msg = block.getFieldValue("MESSAGE");

  return `
broadcast("${msg}");
`;
};

jsGenerator.forBlock["when_message_received"] = function (block) {
  const msg = block.getFieldValue("MESSAGE");

  const statements = jsGenerator.statementToCode(block, "DO");

  return `
registerBroadcast(
 "${msg}",
 async ()=>{
${statements}
});
`;
};

jsGenerator.forBlock["broadcast_and_wait"] = function (block) {
  const msg = block.getFieldValue("MESSAGE");

  return `await broadcast("${msg}");\n`;
};

jsGenerator.forBlock["when_backdrop_switches"] = function (block, generator) {
  const name = block.getFieldValue("BACKDROP");

  const statements = generator.statementToCode(block, "DO");

  return `
registerBackdropSwitch("${name}", async ()=>{
${statements}
});
`;
};

jsGenerator.forBlock["when_timer_greater_than"] = function (block, generator) {
  const value = jsGenerator.valueToCode(block, "VALUE", javascript.Order.ATOMIC) || "10";

  const statements = generator.statementToCode(block, "DO");

  return `
registerTimerWatch(${value}, async ()=>{
${statements}
});
`;
};

// =========================
// Generators for Console Blocks
// =========================
jsGenerator.forBlock["print_message"] = function (block, generator) {
  const text =
    generator.valueToCode(block, "TEXT", javascript.Order.ATOMIC) || '""';

  return `logMessage(${text});\n`;
};

console.log("Generator registered:", jsGenerator.forBlock["print_message"]);

// =========================
// Generators for Motion Blocks
// =========================
jsGenerator.forBlock["move_sprite"] = function (block) {
  const steps =
    jsGenerator.valueToCode(block, "STEPS", javascript.Order.ATOMIC) || "0";

  return `moveSprite(${steps});\n`;
};

jsGenerator.forBlock["turn_sprite"] = function (block) {
  const angle =
    jsGenerator.valueToCode(block, "ANGLE", javascript.Order.ATOMIC) || "0";

  return `turnSprite(${angle});\n`;
};

jsGenerator.forBlock["point_direction"] = function (block) {
  const direction =
    jsGenerator.valueToCode(block, "DIRECTION", javascript.Order.ATOMIC) || "0";

  return `pointDirection(${direction});\n`;
};

jsGenerator.forBlock["go_to_position"] = function (block) {
  const x = jsGenerator.valueToCode(block, "X", javascript.Order.ATOMIC) || "0";

  const y = jsGenerator.valueToCode(block, "Y", javascript.Order.ATOMIC) || "0";

  return `goToPosition(${x}, ${y});\n`;
};

jsGenerator.forBlock["change_x"] = function (block) {
  const value =
    jsGenerator.valueToCode(block, "VALUE", javascript.Order.ATOMIC) || "0";

  return `changeX(${value});\n`;
};

jsGenerator.forBlock["change_y"] = function (block) {
  const value =
    jsGenerator.valueToCode(block, "VALUE", javascript.Order.ATOMIC) || "0";

  return `changeY(${value});\n`;
};

jsGenerator.forBlock["set_speed"] = function (block) {
  const speed =
    jsGenerator.valueToCode(block, "SPEED", javascript.Order.ATOMIC) || "1";

  return `setSpeed(${speed});\n`;
};

jsGenerator.forBlock["glide_to"] = function (block) {
  const sec = jsGenerator.valueToCode(block, "SECONDS", 0);

  const x = jsGenerator.valueToCode(block, "X", 0);

  const y = jsGenerator.valueToCode(block, "Y", 0);

  return `await glideTo(${sec},${x},${y});\n`;
};

jsGenerator.forBlock["turn_sprite_ccw"] = function (block) {
  const angle =
    jsGenerator.valueToCode(block, "ANGLE", javascript.Order.ATOMIC) || "0";

  return `turnSprite(-(${angle}));\n`;
};

jsGenerator.forBlock["set_x"] = function (block) {
  const value =
    jsGenerator.valueToCode(block, "VALUE", javascript.Order.ATOMIC) || "0";

  return `setX(${value});\n`;
};

jsGenerator.forBlock["set_y"] = function (block) {
  const value =
    jsGenerator.valueToCode(block, "VALUE", javascript.Order.ATOMIC) || "0";

  return `setY(${value});\n`;
};

jsGenerator.forBlock["if_on_edge_bounce"] = function () {
  return `ifOnEdgeBounce();\n`;
};

jsGenerator.forBlock["set_rotation_style"] = function (block) {
  const style = block.getFieldValue("STYLE");

  return `setRotationStyle("${style}");\n`;
};

jsGenerator.forBlock["sprite_direction"] = function () {
  return ["getRuntimeSprite().rotation", javascript.Order.MEMBER];
};

// =========================
// Generators for Looks Blocks
// =========================

jsGenerator.forBlock["say_text"] = function (block) {
  const text =
    jsGenerator.valueToCode(block, "TEXT", javascript.Order.ATOMIC) || '""';

  return `sayText(${text});\n`;
};

jsGenerator.forBlock["say_for_seconds"] = function (block) {
  const text = jsGenerator.valueToCode(block, "TEXT", 0) || '""';

  const sec = jsGenerator.valueToCode(block, "SECONDS", 0) || "2";

  return `
await sayForSeconds(${text},${sec});
`;
};

jsGenerator.forBlock["set_background_image"] = function (block) {
  const image = block.getFieldValue("IMAGE");

  return `
setBackgroundImage("${image}");
`;
};

jsGenerator.forBlock["next_background"] = function () {
  return `nextBackground();\n`;
};

jsGenerator.forBlock["previous_background"] = function () {
  return `previousBackground();\n`;
};

jsGenerator.forBlock["random_background"] = function () {
  return `randomBackground();\n`;
};

jsGenerator.forBlock["change_background"] = function (block) {
  const color = block.getFieldValue("COLOR");

  return `changeBackground("${color}");\n`;
};

jsGenerator.forBlock["add_sprite"] = function (block) {
  const sprite = block.getFieldValue("SPRITE");

  const x = jsGenerator.valueToCode(block, "X", javascript.Order.ATOMIC) || "0";

  const y = jsGenerator.valueToCode(block, "Y", javascript.Order.ATOMIC) || "0";

  return `
addSprite("${sprite}", ${x}, ${y});
`;
};

jsGenerator.forBlock["set_sprite"] = function (block) {
  const sprite = block.getFieldValue("SPRITE");

  return `setSprite("${sprite}");\n`;
};

jsGenerator.forBlock["hide_sprite"] = function () {
  return `hideSprite();\n`;
};

jsGenerator.forBlock["show_sprite"] = function () {
  return `showSprite();\n`;
};

jsGenerator.forBlock["set_sprite_size"] = function (block) {
  const size =
    jsGenerator.valueToCode(block, "SIZE", javascript.Order.ATOMIC) || "100";

  return `setSpriteSize(${size});\n`;
};

jsGenerator.forBlock["change_size_by"] = function (block) {
  const value = jsGenerator.valueToCode(block, "SIZE", 0) || "10";

  return `
changeSpriteSizeBy(${value});
`;
};

jsGenerator.forBlock["think_text"] = function (block) {
  const text =
    jsGenerator.valueToCode(block, "TEXT", javascript.Order.ATOMIC) || '""';

  return `thinkText(${text});\n`;
};

jsGenerator.forBlock["think_for_seconds"] = function (block) {
  const text = jsGenerator.valueToCode(block, "TEXT", 0) || '""';
  const sec = jsGenerator.valueToCode(block, "SECONDS", 0) || "2";

  return `await thinkForSeconds(${text},${sec});\n`;
};

jsGenerator.forBlock["change_graphic_effect"] = function (block) {
  const effect = block.getFieldValue("EFFECT");
  const value = jsGenerator.valueToCode(block, "VALUE", 0) || "25";

  return `changeGraphicEffect("${effect}", ${value});\n`;
};

jsGenerator.forBlock["set_graphic_effect"] = function (block) {
  const effect = block.getFieldValue("EFFECT");
  const value = jsGenerator.valueToCode(block, "VALUE", 0) || "0";

  return `setGraphicEffect("${effect}", ${value});\n`;
};

jsGenerator.forBlock["clear_graphic_effects"] = function () {
  return `clearGraphicEffects();\n`;
};

jsGenerator.forBlock["go_to_layer"] = function (block) {
  const layer = block.getFieldValue("LAYER");

  return `goToLayer("${layer}");\n`;
};

jsGenerator.forBlock["go_layers"] = function (block) {
  const direction = block.getFieldValue("DIRECTION");
  const value = jsGenerator.valueToCode(block, "VALUE", 0) || "1";

  return `goLayers("${direction}", ${value});\n`;
};

jsGenerator.forBlock["costume_reporter"] = function () {
  return ["getCostumeName()", javascript.Order.FUNCTION_CALL];
};

jsGenerator.forBlock["backdrop_reporter"] = function () {
  return ["getBackdropName()", javascript.Order.FUNCTION_CALL];
};

jsGenerator.forBlock["size_reporter"] = function () {
  return ["getSpriteSize()", javascript.Order.FUNCTION_CALL];
};

jsGenerator.forBlock["switch_costume_to"] = function (block) {
  const name = block.getFieldValue("NAME");

  return `switchCostumeTo(${JSON.stringify(name)});\n`;
};

jsGenerator.forBlock["next_costume"] = function () {
  return `nextCostume();\n`;
};

// =========================
// Generators for Sensors Blocks
// =========================
jsGenerator.forBlock["random_number"] = function (block) {
  const min =
    jsGenerator.valueToCode(block, "MIN", javascript.Order.ATOMIC) || "1";

  const max =
    jsGenerator.valueToCode(block, "MAX", javascript.Order.ATOMIC) || "10";

  const code = `Math.floor(Math.random() * (${max} - ${min} + 1)) + ${min}`;

  return [code, javascript.Order.FUNCTION_CALL];
};

jsGenerator.forBlock["touching_edge"] = function () {
  return ["touchingEdge()", javascript.Order.FUNCTION_CALL];
};

jsGenerator.forBlock["when_touching_edge"] = function (block, generator) {
  const statements = generator.statementToCode(block, "DO");

  return `
if(touchingEdge()){
${statements}
}
`;
};

jsGenerator.forBlock["touching_sprite"] = function () {
  return ["touchingSprite()", javascript.Order.FUNCTION_CALL];
};

jsGenerator.forBlock["touching_mouse"] = function () {
  return ["touchingMouse()", javascript.Order.FUNCTION_CALL];
};

jsGenerator.forBlock["mouse_x"] = function () {
  return ["mouseX", javascript.Order.ATOMIC];
};

jsGenerator.forBlock["mouse_y"] = function () {
  return ["mouseY", javascript.Order.ATOMIC];
};

jsGenerator.forBlock["key_pressed"] = function (block) {
  const key = block.getFieldValue("KEY");

  return [`isKeyPressed("${key}")`, javascript.Order.FUNCTION_CALL];
};

jsGenerator.forBlock["sprite_x_position"] = function () {
  return ["getRuntimeSprite().x", javascript.Order.MEMBER];
};

jsGenerator.forBlock["sprite_y_position"] = function () {
  return ["getRuntimeSprite().y", javascript.Order.MEMBER];
};

jsGenerator.forBlock["ask_and_wait"] = function (block) {
  const question = block.getFieldValue("QUESTION");

  return `
    await askAndWait(${JSON.stringify(question)});
  `;
};

jsGenerator.forBlock["answer"] = function () {
  return ["userAnswer", javascript.Order.ATOMIC];
};

jsGenerator.forBlock["mouse_down"] = function () {
  return ["mouseDown", javascript.Order.ATOMIC];
};

jsGenerator.forBlock["any_key_pressed"] = function () {
  return ["anyKeyPressed()", javascript.Order.FUNCTION_CALL];
};

jsGenerator.forBlock["last_key_pressed"] = function () {
  return ["lastKeyPressed", javascript.Order.ATOMIC];
};

jsGenerator.forBlock["timer"] = function () {
  return ["getTimer()", javascript.Order.FUNCTION_CALL];
};

jsGenerator.forBlock["reset_timer"] = function () {
  return `
 resetTimer();
 `;
};

jsGenerator.forBlock["show_variable_monitor"] = function (block) {
  const visible = block.getFieldValue("VISIBLE");

  return `
 setMonitorVisible(${visible === "TRUE"});
 `;
};

jsGenerator.forBlock["touching_sprite_named"] = function (block) {
  const name = block.getFieldValue("SPRITE");

  return [`touchingSpriteNamed("${name}")`, javascript.Order.FUNCTION_CALL];
};

jsGenerator.forBlock["distance_to_sprite"] = function (block) {
  const name = block.getFieldValue("SPRITE");

  return [`distanceToSprite("${name}")`, javascript.Order.FUNCTION_CALL];
};

jsGenerator.forBlock["distance_to_mouse"] = function () {
  return ["distanceToMouse()", javascript.Order.FUNCTION_CALL];
};

jsGenerator.forBlock["attribute_of_sprite"] = function (block) {
  const attribute = block.getFieldValue("ATTRIBUTE");
  const name = block.getFieldValue("SPRITE");

  return [`getAttributeOf("${name}", "${attribute}")`, javascript.Order.FUNCTION_CALL];
};

jsGenerator.forBlock["current_date_time"] = function (block) {
  const part = block.getFieldValue("PART");

  return [`currentDateTime("${part}")`, javascript.Order.FUNCTION_CALL];
};

jsGenerator.forBlock["days_since_2000"] = function () {
  return ["daysSince2000()", javascript.Order.FUNCTION_CALL];
};

jsGenerator.forBlock["username_reporter"] = function () {
  return ["getUsername()", javascript.Order.FUNCTION_CALL];
};

jsGenerator.forBlock["touching_color"] = function (block) {
  const color = block.getFieldValue("COLOR");

  return [`touchingColor("${color}")`, javascript.Order.FUNCTION_CALL];
};

jsGenerator.forBlock["set_drag_mode"] = function (block) {
  const mode = block.getFieldValue("MODE");

  return `setDragMode("${mode}");\n`;
};

// =========================
// Control Blocks Functions
// =========================
jsGenerator.forBlock["forever"] = function (block) {
  const statements = jsGenerator.statementToCode(block, "DO");

  return `
while(true){
${statements}
await wait(0.02);
}
`;
};

jsGenerator.forBlock["wait_seconds"] = function (block) {
  const seconds =
    jsGenerator.valueToCode(block, "SECONDS", javascript.Order.ATOMIC) || "1";

  return `await wait(${seconds});\n`;
};

jsGenerator.forBlock["repeat_times"] = function (block) {
  const times =
    jsGenerator.valueToCode(block, "TIMES", javascript.Order.ATOMIC) || "1";

  const statements = jsGenerator.statementToCode(block, "DO");

  return `
for(let i = 0; i < ${times}; i++){
${statements}
}
`;
};

jsGenerator.forBlock["if_block"] = function (block) {
  const condition =
    jsGenerator.valueToCode(block, "CONDITION", javascript.Order.NONE) ||
    "false";

  const statements = jsGenerator.statementToCode(block, "DO");

  return `
if(${condition}){
${statements}
}
`;
};

jsGenerator.forBlock["if_else_block"] = function (block) {
  const condition =
    jsGenerator.valueToCode(block, "CONDITION", javascript.Order.NONE) ||
    "false";

  const trueCode = jsGenerator.statementToCode(block, "TRUE");

  const falseCode = jsGenerator.statementToCode(block, "FALSE");

  return `
if(${condition}){
${trueCode}
}else{
${falseCode}
}
`;
};

jsGenerator.forBlock["repeat_until"] = function (block) {
  const condition =
    jsGenerator.valueToCode(block, "CONDITION", javascript.Order.NONE) ||
    "false";

  const statements = jsGenerator.statementToCode(block, "DO");

  return `
while(!(${condition})){
${statements}
await wait(0.02);
}
`;
};

jsGenerator.forBlock["wait_until"] = function (block) {
  const condition =
    jsGenerator.valueToCode(block, "CONDITION", javascript.Order.NONE) ||
    "false";

  return `
while(!(${condition})){
await wait(0.02);
}
`;
};

jsGenerator.forBlock["stop_all"] = function () {
  return `
stopAllScripts();
return;
`;
};

jsGenerator.forBlock["when_run_clicked"] = function (block) {
  const statements = jsGenerator.statementToCode(block, "DO");

  return `
(async ()=>{
${statements}
})();
`;
};

// PEN

jsGenerator.forBlock["pen_down"] = function () {
  return `penDownFn();\n`;
};

jsGenerator.forBlock["pen_up"] = function () {
  return `penUpFn();\n`;
};

jsGenerator.forBlock["clear_pen"] = function () {
  return `clearPen();\n`;
};

jsGenerator.forBlock["set_pen_color"] = function (block) {
  const color = block.getFieldValue("COLOR");

  return `
setPenColor("${color}");
`;
};

jsGenerator.forBlock["set_pen_size"] = function (block) {
  const size = jsGenerator.valueToCode(block, "SIZE", 0) || "2";

  return `
setPenSize(${size});
`;
};

jsGenerator.forBlock["change_pen_size"] = function (block) {
  const size = jsGenerator.valueToCode(block, "VALUE", 0) || "1";

  return `changePenSizeBy(${size});\n`;
};

jsGenerator.forBlock["stamp"] = function () {
  return `stampSprite();\n`;
};

jsGenerator.forBlock["change_pen_color"] = function (block) {
  const value = jsGenerator.valueToCode(block, "VALUE", 0) || "1";

  return `changePenColorBy(${value});\n`;
};

jsGenerator.forBlock["set_pen_property"] = function (block) {
  const property = block.getFieldValue("PROPERTY");
  const value = jsGenerator.valueToCode(block, "VALUE", 0) || "0";

  return `setPenProperty("${property}", ${value});\n`;
};

jsGenerator.forBlock["change_pen_property"] = function (block) {
  const property = block.getFieldValue("PROPERTY");
  const value = jsGenerator.valueToCode(block, "VALUE", 0) || "0";

  return `changePenProperty("${property}", ${value});\n`;
};

// TEXT TO SPEECH

jsGenerator.forBlock["tts_speak"] = function (block) {
  const text = jsGenerator.valueToCode(block, "TEXT", javascript.Order.ATOMIC) || '""';

  return `await ttsSpeak(${text});\n`;
};

jsGenerator.forBlock["tts_set_voice"] = function (block) {
  const voice = block.getFieldValue("VOICE");

  return `setTtsVoice(${JSON.stringify(voice)});\n`;
};

jsGenerator.forBlock["tts_set_language"] = function (block) {
  const lang = block.getFieldValue("LANGUAGE");

  return `setTtsLanguage("${lang}");\n`;
};

// SOUND

jsGenerator.forBlock["start_sound"] = function (block) {
  const sound = block.getFieldValue("SOUND");

  return `startSound(${JSON.stringify(sound)});\n`;
};

jsGenerator.forBlock["play_sound_until_done"] = function (block) {
  const sound = block.getFieldValue("SOUND");

  return `await playSoundUntilDone(${JSON.stringify(sound)});\n`;
};

jsGenerator.forBlock["stop_all_sounds"] = function () {
  return `stopAllSounds();\n`;
};

jsGenerator.forBlock["change_volume"] = function (block) {
  const value = jsGenerator.valueToCode(block, "VALUE", 0) || "10";

  return `changeVolumeBy(${value});\n`;
};

jsGenerator.forBlock["set_volume"] = function (block) {
  const value = jsGenerator.valueToCode(block, "VALUE", 0) || "100";

  return `setVolume(${value});\n`;
};

jsGenerator.forBlock["volume_reporter"] = function () {
  return ["getVolume()", javascript.Order.FUNCTION_CALL];
};

jsGenerator.forBlock["set_sound_effect"] = function (block) {
  const effect = block.getFieldValue("EFFECT");
  const value = jsGenerator.valueToCode(block, "VALUE", 0) || "0";

  return `setSoundEffect("${effect}", ${value});\n`;
};

jsGenerator.forBlock["change_sound_effect"] = function (block) {
  const effect = block.getFieldValue("EFFECT");
  const value = jsGenerator.valueToCode(block, "VALUE", 0) || "10";

  return `changeSoundEffect("${effect}", ${value});\n`;
};

jsGenerator.forBlock["clear_sound_effects"] = function () {
  return `clearSoundEffects();\n`;
};

// MUSIC

jsGenerator.forBlock["play_drum"] = function (block) {
  const drum = block.getFieldValue("DRUM");
  const beats = jsGenerator.valueToCode(block, "BEATS", 0) || "0.25";

  return `await playDrum("${drum}", ${beats});\n`;
};

jsGenerator.forBlock["music_rest"] = function (block) {
  const beats = jsGenerator.valueToCode(block, "BEATS", 0) || "0.25";

  return `await musicRest(${beats});\n`;
};

jsGenerator.forBlock["play_note"] = function (block) {
  const note = jsGenerator.valueToCode(block, "NOTE", 0) || "60";
  const beats = jsGenerator.valueToCode(block, "BEATS", 0) || "0.5";

  return `await playNote(${note}, ${beats});\n`;
};

jsGenerator.forBlock["set_instrument"] = function (block) {
  const instrument = block.getFieldValue("INSTRUMENT");

  return `setInstrument("${instrument}");\n`;
};

jsGenerator.forBlock["change_tempo"] = function (block) {
  const value = jsGenerator.valueToCode(block, "VALUE", 0) || "20";

  return `changeTempoBy(${value});\n`;
};

jsGenerator.forBlock["set_tempo"] = function (block) {
  const value = jsGenerator.valueToCode(block, "VALUE", 0) || "60";

  return `setTempo(${value});\n`;
};

jsGenerator.forBlock["tempo_reporter"] = function () {
  return ["getTempo()", javascript.Order.FUNCTION_CALL];
};

// VIDEO SENSING

jsGenerator.forBlock["turn_video"] = function (block) {
  const state = block.getFieldValue("STATE");

  return `turnVideo("${state}");\n`;
};

jsGenerator.forBlock["set_video_transparency"] = function (block) {
  const value = jsGenerator.valueToCode(block, "VALUE", 0) || "50";

  return `setVideoTransparency(${value});\n`;
};

jsGenerator.forBlock["video_sensing_reporter"] = function (block) {
  const attribute = block.getFieldValue("ATTRIBUTE");
  const target = block.getFieldValue("TARGET");

  if (attribute === "direction") {
    return [`getVideoDirection("${target}")`, javascript.Order.FUNCTION_CALL];
  }
  return [`getVideoMotion("${target}")`, javascript.Order.FUNCTION_CALL];
};

jsGenerator.forBlock["when_video_motion_greater_than"] = function (block, generator) {
  const value = jsGenerator.valueToCode(block, "VALUE", javascript.Order.ATOMIC) || "10";

  const statements = generator.statementToCode(block, "DO");

  return `
registerVideoMotionWatch(${value}, async ()=>{
${statements}
});
`;
};

// TRANSLATE

jsGenerator.forBlock["translate_and_wait"] = function (block) {
  const text = jsGenerator.valueToCode(block, "TEXT", javascript.Order.ATOMIC) || '""';
  const language = block.getFieldValue("LANGUAGE");

  return `await translateAndWait(${text}, "${language}");\n`;
};

jsGenerator.forBlock["translation_result"] = function () {
  return ["lastTranslation", javascript.Order.ATOMIC];
};

jsGenerator.forBlock["viewer_language"] = function () {
  return ["getViewerLanguage()", javascript.Order.FUNCTION_CALL];
};