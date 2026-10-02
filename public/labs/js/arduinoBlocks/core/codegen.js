// The Arduino Blocks C++ generator. Blockly ships generators for
// JS/Python/PHP/Lua/Dart but not C++, so this is a brand-new
// Blockly.Generator instance — unrelated to, and not shared with, the
// `jsGenerator` (javascript.javascriptGenerator) the separate Blockly
// (Scratch-style) Lab uses. Loaded first among the arduinoBlocks/*
// scripts since every block/generator file below depends on
// `cppGenerator` existing already (classic <script> tags share one
// global scope on this page — same convention blockly/generators/motion.js
// already uses for `jsGenerator`).
const cppGenerator = new Blockly.Generator("Cpp");

// A minimal operator-precedence scheme — enough for correct paren
// placement via valueToCode's order comparison. Unlike Blockly's stock
// JS generator, this doesn't try to omit "redundant" parens for
// readability — generated expressions always wrap composite values. A
// few extra parens is a fair trade for a much smaller, easier-to-get-right
// generator; this is a teaching tool, not a code-style tool, and the
// existing compile pipeline doesn't care either way.
const Order = {
  ATOMIC: 0,
  UNARY: 1,
  MULTIPLICATIVE: 2,
  ADDITIVE: 3,
  RELATIONAL: 4,
  LOGICAL_AND: 5,
  LOGICAL_OR: 6,
  NONE: 99,
};

// Ardublockly's own documented pattern for hoisting #includes and global
// object declarations above setup()/loop() without duplicating them when
// multiple blocks need the same thing (e.g. two Servo blocks). Keyed by a
// caller-chosen string so two blocks asking for "the same thing" collapse
// to one line; setups_ render as the first lines inside setup(), in
// sorted-key order for stable output.
//
// includes_ and definitions_ are deliberately SEPARATE dictionaries, not
// one — #include lines must always precede every global declaration
// (Servo/LiquidCrystal types have to be known before `Servo myservo;`
// compiles), and relying on both living in one alphabetically-sorted dict
// for that ordering is fragile (it happened to work here only because
// every current key starts with "include_", which sorts first purely by
// coincidence). Keeping them as separate buckets, each always emitted in
// its own fixed position, makes that guarantee structural instead of
// accidental.
cppGenerator.includes_ = {};
cppGenerator.definitions_ = {};
cppGenerator.setups_ = {};

// Every Blockly PIN field value is already a valid Arduino pin token
// ("0".."13", "A0".."A5") — this exists as a single seam in case that
// ever needs normalizing later, so no generator has to know the raw
// field-value format.
function normalizePin(fieldValue) {
  return fieldValue;
}

// Blockly's base Generator.prototype.scrub_ is a plain no-op identity
// function — chaining a block's generated code together with whatever
// follows it (block.getNextBlock()) is NOT automatic; every real Blockly
// language generator (javascript, python, etc.) overrides scrub_ to do
// this. Missing this override is why a two-statement chain silently only
// generated the first statement's code during development of this file —
// confirmed by reading the actual installed Blockly build's
// Generator.prototype.scrub_ source live (`scrub_(a,b){return b}`).
cppGenerator.scrub_ = function (block, code, opt_thisOnly) {
  const nextBlock = block.nextConnection && block.nextConnection.targetBlock();
  if (nextBlock && !opt_thisOnly) {
    return code + cppGenerator.blockToCode(nextBlock);
  }
  return code;
};

function indent(code) {
  return code
    .split("\n")
    .filter(Boolean)
    .map((line) => "  " + line)
    .join("\n");
}

// Walks the two top-level hat blocks (arduino_setup / arduino_loop) and
// assembles a complete, real .ino file — #includes and global
// declarations hoisted above setup(), one-time setup calls hoisted to the
// top of setup() before the student's own setup-hat blocks, then the
// setup/loop statement chains themselves. If a student deletes a hat
// (shouldn't normally happen — both are setDeletable(false) — but a
// corrupted/hand-edited import could lack one), that section is just
// empty rather than throwing.
function generateFullSketch(workspace) {
  cppGenerator.includes_ = {};
  cppGenerator.definitions_ = {};
  cppGenerator.setups_ = {};
  cppGenerator.variableNameCache_ = {};
  // Captured explicitly rather than relied on from Blockly's own
  // Generator.prototype.init(workspace) (whose default behavior isn't
  // something this plan depends on) — getVariableCName() needs this to
  // resolve a variable field's ID to its real name.
  cppGenerator.workspace_ = workspace;
  cppGenerator.init(workspace);

  const topBlocks = workspace.getTopBlocks(true);
  const setupHat = topBlocks.find((b) => b.type === "arduino_setup");
  const loopHat = topBlocks.find((b) => b.type === "arduino_loop");

  const setupBody = setupHat ? cppGenerator.statementToCode(setupHat, "DO") : "";
  const loopBody = loopHat ? cppGenerator.statementToCode(loopHat, "DO") : "";

  const includes = Object.keys(cppGenerator.includes_)
    .sort()
    .map((k) => cppGenerator.includes_[k]);
  const definitions = Object.keys(cppGenerator.definitions_)
    .sort()
    .map((k) => cppGenerator.definitions_[k]);
  const setups = Object.keys(cppGenerator.setups_)
    .sort()
    .map((k) => cppGenerator.setups_[k]);

  return [
    "// Generated from Blocks — edits made in Text mode are discarded when you switch back to Blocks.",
    ...includes,
    ...definitions,
    "",
    "void setup() {",
    ...setups.map((s) => "  " + s),
    indent(setupBody),
    "}",
    "",
    "void loop() {",
    indent(loopBody),
    "}",
    "",
  ].join("\n");
}
