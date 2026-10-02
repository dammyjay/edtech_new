// C++ generators for core/blocks.js, plus fresh C++ generators for
// Blockly's built-in logic/loops/math/text/variables blocks (Blockly
// ships JS/Python/PHP/Lua/Dart generators for these but not C++ — no
// cpp.js generator exists in the Blockly package).

cppGenerator.forBlock["arduino_setup"] = function () {
  // The hat blocks are walked directly by generateFullSketch() via
  // getTopBlocks() + statementToCode() — they never appear as a nested
  // value/statement inside another block's generator, so this is never
  // actually called in practice. Defined anyway so Blockly's own
  // workspace-wide codegen sanity checks (e.g. a "preview all code" tool)
  // don't report it as missing.
  return "";
};
cppGenerator.forBlock["arduino_loop"] = cppGenerator.forBlock["arduino_setup"];

cppGenerator.forBlock["pin_mode"] = function (block) {
  const pin = normalizePin(block.getFieldValue("PIN"));
  const mode = block.getFieldValue("MODE");
  return `pinMode(${pin}, ${mode});\n`;
};

cppGenerator.forBlock["digital_write"] = function (block) {
  const pin = normalizePin(block.getFieldValue("PIN"));
  const state = block.getFieldValue("STATE");
  return `digitalWrite(${pin}, ${state});\n`;
};

cppGenerator.forBlock["digital_read"] = function (block) {
  const pin = normalizePin(block.getFieldValue("PIN"));
  return [`digitalRead(${pin})`, Order.ATOMIC];
};

cppGenerator.forBlock["analog_write"] = function (block) {
  const pin = normalizePin(block.getFieldValue("PIN"));
  const value = cppGenerator.valueToCode(block, "VALUE", Order.NONE) || "0";
  return `analogWrite(${pin}, ${value});\n`;
};

cppGenerator.forBlock["analog_read"] = function (block) {
  const pin = normalizePin(block.getFieldValue("PIN"));
  return [`analogRead(${pin})`, Order.ATOMIC];
};

cppGenerator.forBlock["arduino_delay"] = function (block) {
  const ms = cppGenerator.valueToCode(block, "MS", Order.NONE) || "0";
  return `delay(${ms});\n`;
};

cppGenerator.forBlock["serial_begin"] = function (block) {
  const baud = block.getFieldValue("BAUD");
  // No hoisting — a student placing two of these legitimately gets two
  // Serial.begin() calls, which the real compiler accepts fine.
  return `Serial.begin(${baud});\n`;
};

cppGenerator.forBlock["serial_print"] = function (block) {
  const value = cppGenerator.valueToCode(block, "VALUE", Order.NONE) || '""';
  const newline = block.getFieldValue("NEWLINE") === "TRUE";
  return `Serial.${newline ? "println" : "print"}(${value});\n`;
};

// --- Blockly's built-in blocks: fresh C++ generators ---

cppGenerator.forBlock["controls_if"] = function (block) {
  let code = "";
  let n = 0;
  do {
    const cond = cppGenerator.valueToCode(block, "IF" + n, Order.NONE) || "false";
    const branch = cppGenerator.statementToCode(block, "DO" + n);
    code += (n === 0 ? "if (" : "else if (") + cond + ") {\n" + branch + "}\n";
    n++;
  } while (block.getInput("IF" + n));
  if (block.getInput("ELSE")) {
    code += "else {\n" + cppGenerator.statementToCode(block, "ELSE") + "}\n";
  }
  return code;
};

cppGenerator.forBlock["controls_repeat_ext"] = function (block) {
  const times = cppGenerator.valueToCode(block, "TIMES", Order.NONE) || "0";
  const branch = cppGenerator.statementToCode(block, "DO");
  const i = cppGenerator.getVariableName ? "__i" : "__i"; // plain counter — this lab's intro blocks don't expose a named loop variable
  return `for (int ${i} = 0; ${i} < ${times}; ${i}++) {\n${branch}}\n`;
};

cppGenerator.forBlock["controls_whileUntil"] = function (block) {
  const until = block.getFieldValue("MODE") === "UNTIL";
  let cond = cppGenerator.valueToCode(block, "BOOL", Order.NONE) || "false";
  if (until) cond = `!(${cond})`;
  const branch = cppGenerator.statementToCode(block, "DO");
  return `while (${cond}) {\n${branch}}\n`;
};

cppGenerator.forBlock["logic_compare"] = function (block) {
  const OPERATORS = { EQ: "==", NEQ: "!=", LT: "<", LTE: "<=", GT: ">", GTE: ">=" };
  const op = OPERATORS[block.getFieldValue("OP")];
  const a = cppGenerator.valueToCode(block, "A", Order.RELATIONAL) || "0";
  const b = cppGenerator.valueToCode(block, "B", Order.RELATIONAL) || "0";
  return [`(${a} ${op} ${b})`, Order.RELATIONAL];
};

cppGenerator.forBlock["logic_operation"] = function (block) {
  const op = block.getFieldValue("OP") === "AND" ? "&&" : "||";
  const order = op === "&&" ? Order.LOGICAL_AND : Order.LOGICAL_OR;
  const a = cppGenerator.valueToCode(block, "A", order) || "false";
  const b = cppGenerator.valueToCode(block, "B", order) || "false";
  return [`(${a} ${op} ${b})`, order];
};

cppGenerator.forBlock["logic_negate"] = function (block) {
  const value = cppGenerator.valueToCode(block, "BOOL", Order.UNARY) || "false";
  return [`!(${value})`, Order.UNARY];
};

cppGenerator.forBlock["logic_boolean"] = function (block) {
  return [block.getFieldValue("BOOL") === "TRUE" ? "true" : "false", Order.ATOMIC];
};

cppGenerator.forBlock["math_arithmetic"] = function (block) {
  const OPERATORS = { ADD: "+", MINUS: "-", MULTIPLY: "*", DIVIDE: "/" };
  const op = block.getFieldValue("OP");
  const a = cppGenerator.valueToCode(block, "A", Order.ADDITIVE) || "0";
  const b = cppGenerator.valueToCode(block, "B", Order.ADDITIVE) || "0";
  if (op === "POWER") return [`pow(${a}, ${b})`, Order.ATOMIC]; // C++ has no ** operator; pow() needs no extra #include on AVR
  return [`(${a} ${OPERATORS[op]} ${b})`, Order.ADDITIVE];
};

cppGenerator.forBlock["math_number"] = function (block) {
  return [String(block.getFieldValue("NUM")), Order.ATOMIC];
};

cppGenerator.forBlock["text"] = function (block) {
  const text = block.getFieldValue("TEXT") || "";
  return [JSON.stringify(text), Order.ATOMIC];
};

// --- Text operation blocks (Blockly built-ins, verified field/input names
// against the real installed blockly@13.3.0 blocks_compressed.js — e.g.
// text_join's inputs are "ADD0".."ADD{itemCount_-1}" read off block.itemCount_
// directly, not a field; text_getSubstring's base input is "STRING" while
// text_changeCase/text_trim use "TEXT" and text_length/isEmpty/indexOf/
// charAt use "VALUE" — these differ block to block and were easy to get
// wrong by assumption).
//
// Values are generated as Arduino's String class throughout (wrapping a
// plain text-literal's const-char* in String(...) wherever a String method
// is called on it), since AVR has no std::string and String is what every
// other string-consuming API in this lab (Serial.print, LCD .print(), the
// String/const-char* comparison operators) already accepts directly.
//
// text_append is deliberately NOT implemented: it would need a text-typed
// variable to append onto, but every Blockly variable in this lab is
// hoisted as a plain global `int` (see variables_set below) — a student's
// "append to X" block would generate `X += "...";` against a variable
// declared `int X;`, which doesn't compile. Supporting it properly means
// making the variable system type-aware (declare String vs int depending
// on what's first assigned to it), which is a real, separate change, not
// a one-line fix — left out of this pass rather than shipped half-working.
//
// oneBasedIndex: Blockly's workspace defaults to 1-based indices for the
// "# from start"/"# from end" fields shown in the UI (confirmed in the
// real blockly_compressed.js: `oneBasedIndex` defaults to true unless a
// workspace explicitly overrides it, which this lab's Blockly.inject(...)
// call does not) — charAt/getSubstring's AT fields and indexOf's reported
// position all follow that same 1-based convention here, matching what a
// student actually sees in the block's own field labels.

// Each helper takes its string argument BY VALUE (one copy) specifically
// so the block's VALUE/TEXT input expression is only ever evaluated once
// in the generated code — important since that expression could itself be
// a function call with side effects (a sensor read, etc.), and duplicating
// it (e.g. calling String(value) twice to get both .length() and
// .charAt()) would silently call it twice.
const TEXT_CHARAT_HELPER =
  "char textCharAt(String s, int mode, int at) {\n" +
  "  int idx;\n" +
  "  if (mode == 0) idx = 0;                      // FIRST\n" +
  "  else if (mode == 1) idx = s.length() - 1;     // LAST\n" +
  "  else if (mode == 2) idx = at - 1;              // FROM_START (1-based)\n" +
  "  else if (mode == 3) idx = s.length() - at;      // FROM_END (1-based)\n" +
  "  else idx = random(s.length());                 // RANDOM\n" +
  "  if (idx < 0) idx = 0;\n" +
  "  if ((unsigned int)idx >= s.length()) idx = s.length() - 1;\n" +
  "  return s.charAt(idx);\n" +
  "}";

const TEXT_GETSUBSTRING_HELPER =
  "String textGetSubstring(String s, int mode1, int at1, int mode2, int at2) {\n" +
  "  int len = s.length();\n" +
  "  int start, end;\n" +
  "  if (mode1 == 0) start = 0;             // FIRST\n" +
  "  else if (mode1 == 2) start = at1 - 1;  // FROM_START (1-based)\n" +
  "  else start = len - at1;                // FROM_END (1-based)\n" +
  "  if (mode2 == 1) end = len;             // LAST\n" +
  "  else if (mode2 == 2) end = at2;        // FROM_START (1-based, inclusive -> exclusive end)\n" +
  "  else end = len - at2 + 1;              // FROM_END (1-based, inclusive -> exclusive end)\n" +
  "  if (start < 0) start = 0;\n" +
  "  if (end > len) end = len;\n" +
  "  if (start > end) start = end;\n" +
  "  return s.substring(start, end);\n" +
  "}";

// Arduino's String::toUpperCase()/toLowerCase() mutate in place and return
// void (confirmed against the real WString.h — unlike JS's non-mutating
// .toUpperCase()), so these take s BY VALUE, mutate the local copy, and
// return it — the original variable the student plugged in is untouched.
const TEXT_CASE_HELPERS =
  "String textToUpperCase(String s) { s.toUpperCase(); return s; }\n" +
  "String textToLowerCase(String s) { s.toLowerCase(); return s; }\n" +
  "String textToTitleCase(String s) {\n" +
  "  bool newWord = true;\n" +
  "  for (unsigned int i = 0; i < s.length(); i++) {\n" +
  "    char c = s.charAt(i);\n" +
  "    if (isspace(c)) { newWord = true; }\n" +
  "    else { s.setCharAt(i, newWord ? toupper(c) : tolower(c)); newWord = false; }\n" +
  "  }\n" +
  "  return s;\n" +
  "}";

// Arduino's String::trim() only trims BOTH ends (no left-only/right-only
// built in), but the block offers BOTH/LEFT/RIGHT — so this is a small
// manual scan rather than a thin wrapper, to honor all three choices
// instead of silently treating LEFT/RIGHT the same as BOTH.
const TEXT_TRIM_HELPER =
  "String textTrim(String s, bool trimLeft, bool trimRight) {\n" +
  "  int start = 0;\n" +
  "  int end = s.length();\n" +
  "  if (trimLeft) { while (start < end && isspace(s.charAt(start))) start++; }\n" +
  "  if (trimRight) { while (end > start && isspace(s.charAt(end - 1))) end--; }\n" +
  "  return s.substring(start, end);\n" +
  "}";

cppGenerator.forBlock["text_join"] = function (block) {
  const n = block.itemCount_ || 0;
  if (n === 0) return ['String("")', Order.ATOMIC];
  const parts = [];
  for (let i = 0; i < n; i++) {
    parts.push(cppGenerator.valueToCode(block, "ADD" + i, Order.NONE) || '""');
  }
  // Only the first part needs an explicit String(...) — once the chain
  // starts as a String/StringSumHelper, its own operator+ overloads
  // (confirmed in WString.h: const String&, const char*, char, int,
  // unsigned int, long, float, double) accept every later part directly.
  const code = "(String(" + parts[0] + ")" + parts.slice(1).map((p) => " + " + p).join("") + ")";
  return [code, Order.ATOMIC];
};

cppGenerator.forBlock["text_length"] = function (block) {
  const value = cppGenerator.valueToCode(block, "VALUE", Order.NONE) || '""';
  return [`String(${value}).length()`, Order.ATOMIC];
};

cppGenerator.forBlock["text_isEmpty"] = function (block) {
  const value = cppGenerator.valueToCode(block, "VALUE", Order.NONE) || '""';
  return [`(String(${value}).length() == 0)`, Order.ATOMIC];
};

cppGenerator.forBlock["text_indexOf"] = function (block) {
  const value = cppGenerator.valueToCode(block, "VALUE", Order.NONE) || '""';
  const find = cppGenerator.valueToCode(block, "FIND", Order.NONE) || '""';
  const method = block.getFieldValue("END") === "LAST" ? "lastIndexOf" : "indexOf";
  // +1 to match the 1-based position the AT fields elsewhere use; -1
  // (not found) becomes 0, which is itself a clean "not found" sentinel
  // once positions start at 1 instead of 0 (mirrors Blockly's own
  // reference JS generator, which does the same unconditional +1).
  return [`(String(${value}).${method}(String(${find})) + 1)`, Order.ATOMIC];
};

cppGenerator.forBlock["text_charAt"] = function (block) {
  const where = block.getFieldValue("WHERE") || "FROM_START";
  const value = cppGenerator.valueToCode(block, "VALUE", Order.NONE) || '""';
  const MODE = { FIRST: 0, LAST: 1, FROM_START: 2, FROM_END: 3, RANDOM: 4 };
  const mode = MODE[where] ?? 2;
  const at =
    where === "FROM_START" || where === "FROM_END"
      ? cppGenerator.valueToCode(block, "AT", Order.NONE) || "1"
      : "0";
  cppGenerator.definitions_["text_charAt_helper"] = TEXT_CHARAT_HELPER;
  return [`textCharAt(String(${value}), ${mode}, ${at})`, Order.ATOMIC];
};

cppGenerator.forBlock["text_getSubstring"] = function (block) {
  const value = cppGenerator.valueToCode(block, "STRING", Order.NONE) || '""';
  const MODE = { FIRST: 0, LAST: 1, FROM_START: 2, FROM_END: 3 };
  const where1 = block.getFieldValue("WHERE1") || "FROM_START";
  const where2 = block.getFieldValue("WHERE2") || "FROM_START";
  const mode1 = MODE[where1] ?? 2;
  const mode2 = MODE[where2] ?? 2;
  const at1 = where1 === "FIRST" ? "1" : cppGenerator.valueToCode(block, "AT1", Order.NONE) || "1";
  const at2 = where2 === "LAST" ? "1" : cppGenerator.valueToCode(block, "AT2", Order.NONE) || "1";
  cppGenerator.definitions_["text_getsubstring_helper"] = TEXT_GETSUBSTRING_HELPER;
  return [`textGetSubstring(String(${value}), ${mode1}, ${at1}, ${mode2}, ${at2})`, Order.ATOMIC];
};

cppGenerator.forBlock["text_changeCase"] = function (block) {
  const value = cppGenerator.valueToCode(block, "TEXT", Order.NONE) || '""';
  const caseMode = block.getFieldValue("CASE");
  cppGenerator.definitions_["text_case_helpers"] = TEXT_CASE_HELPERS;
  const fn =
    caseMode === "UPPERCASE" ? "textToUpperCase" : caseMode === "LOWERCASE" ? "textToLowerCase" : "textToTitleCase";
  return [`${fn}(String(${value}))`, Order.ATOMIC];
};

cppGenerator.forBlock["text_trim"] = function (block) {
  const value = cppGenerator.valueToCode(block, "TEXT", Order.NONE) || '""';
  const mode = block.getFieldValue("MODE");
  const left = mode === "LEFT" || mode === "BOTH" ? "true" : "false";
  const right = mode === "RIGHT" || mode === "BOTH" ? "true" : "false";
  cppGenerator.definitions_["text_trim_helper"] = TEXT_TRIM_HELPER;
  return [`textTrim(String(${value}), ${left}, ${right})`, Order.ATOMIC];
};

cppGenerator.forBlock["variables_get"] = function (block) {
  const name = cppGenerator.getVariableCName(block.getFieldValue("VAR"));
  return [name, Order.ATOMIC];
};

cppGenerator.forBlock["variables_set"] = function (block) {
  const name = cppGenerator.getVariableCName(block.getFieldValue("VAR"));
  const value = cppGenerator.valueToCode(block, "VALUE", Order.NONE) || "0";
  // Every Blockly variable is hoisted as a global `int` — covers the large
  // majority of intro-level programs this lab targets. A deliberate
  // simplification, not a bug: this is a teaching tool, not a general
  // type-inferring compiler.
  cppGenerator.definitions_["var_" + name] = `int ${name};`;
  return `${name} = ${value};\n`;
};

// Maps a Blockly variable field value (which may be a variable ID
// depending on Blockly version/workspace config, or the plain name) to a
// sanitized, unique C identifier. Cached so the same Blockly variable
// always maps to the same C name within one generation pass.
cppGenerator.variableNameCache_ = {};
cppGenerator.getVariableCName = function (varIdOrName) {
  if (cppGenerator.variableNameCache_[varIdOrName]) {
    return cppGenerator.variableNameCache_[varIdOrName];
  }
  const variable = cppGenerator.workspace_ && cppGenerator.workspace_.getVariableById
    ? cppGenerator.workspace_.getVariableById(varIdOrName)
    : null;
  const rawName = variable ? variable.name : varIdOrName;
  let safe = String(rawName).replace(/[^a-zA-Z0-9_]/g, "_");
  if (!/^[a-zA-Z_]/.test(safe)) safe = "v_" + safe;
  // De-dupe against any other variable that sanitized to the same name.
  let unique = safe;
  let n = 1;
  const used = new Set(Object.values(cppGenerator.variableNameCache_));
  while (used.has(unique)) {
    unique = safe + "_" + n++;
  }
  cppGenerator.variableNameCache_[varIdOrName] = unique;
  return unique;
};
