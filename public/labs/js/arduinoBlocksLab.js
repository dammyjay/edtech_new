// Arduino Lab "Blocks" mode bootstrap. Loaded after arduinoLab.js (which
// owns the Monaco `codeEditor` instance, as a bare top-level `let` — not
// `window.codeEditor` — shared across <script> tags via the classic-script
// global lexical scope, same convention blocklyLab.js uses for its own
// `workspace` variable). This file is the ONLY place that knows about
// Blockly; arduinoLab.js integrates with it purely through the small
// window.ArduinoBlocksLab bridge at the bottom.

const CORE_TOOLBOX_CATEGORIES = [
  {
    kind: "category",
    name: "Setup / Loop",
    colour: "#5C6BC0",
    contents: [
      { kind: "block", type: "arduino_setup" },
      { kind: "block", type: "arduino_loop" },
    ],
  },
  {
    kind: "category",
    name: "Pins",
    colour: "#E65100",
    contents: [
      { kind: "block", type: "pin_mode" },
      { kind: "block", type: "digital_write" },
      { kind: "block", type: "digital_read" },
      {
        kind: "block",
        type: "analog_write",
        inputs: { VALUE: { shadow: { type: "math_number", fields: { NUM: 128 } } } },
      },
      { kind: "block", type: "analog_read" },
      {
        kind: "block",
        type: "arduino_delay",
        inputs: { MS: { shadow: { type: "math_number", fields: { NUM: 1000 } } } },
      },
    ],
  },
  {
    kind: "category",
    name: "Serial",
    colour: "#6D4C41",
    contents: [
      { kind: "block", type: "serial_begin" },
      {
        kind: "block",
        type: "serial_print",
        inputs: { VALUE: { shadow: { type: "text", fields: { TEXT: "hello" } } } },
      },
    ],
  },
  {
    kind: "category",
    name: "Logic",
    colour: "#5C81A6",
    contents: [
      { kind: "block", type: "controls_if" },
      { kind: "block", type: "logic_compare" },
      { kind: "block", type: "logic_operation" },
      { kind: "block", type: "logic_negate" },
      { kind: "block", type: "logic_boolean" },
    ],
  },
  {
    kind: "category",
    name: "Loops",
    colour: "#5CA65C",
    contents: [
      {
        kind: "block",
        type: "controls_repeat_ext",
        inputs: { TIMES: { shadow: { type: "math_number", fields: { NUM: 10 } } } },
      },
      { kind: "block", type: "controls_whileUntil" },
    ],
  },
  {
    kind: "category",
    name: "Math",
    colour: "#5C68A6",
    contents: [
      { kind: "block", type: "math_arithmetic" },
      { kind: "block", type: "math_number" },
    ],
  },
  {
    kind: "category",
    name: "Text",
    colour: "#A65C81",
    contents: [
      { kind: "block", type: "text" },
      {
        kind: "block",
        type: "text_join",
        inputs: {
          ADD0: { shadow: { type: "text", fields: { TEXT: "Hello" } } },
          ADD1: { shadow: { type: "text", fields: { TEXT: "World" } } },
        },
      },
      {
        kind: "block",
        type: "text_length",
        inputs: { VALUE: { shadow: { type: "text", fields: { TEXT: "hello" } } } },
      },
      {
        kind: "block",
        type: "text_isEmpty",
        inputs: { VALUE: { shadow: { type: "text", fields: { TEXT: "" } } } },
      },
      {
        kind: "block",
        type: "text_indexOf",
        inputs: {
          VALUE: { shadow: { type: "text", fields: { TEXT: "hello" } } },
          FIND: { shadow: { type: "text", fields: { TEXT: "l" } } },
        },
      },
      {
        kind: "block",
        type: "text_charAt",
        inputs: { VALUE: { shadow: { type: "text", fields: { TEXT: "hello" } } } },
      },
      {
        kind: "block",
        type: "text_getSubstring",
        inputs: { STRING: { shadow: { type: "text", fields: { TEXT: "hello" } } } },
      },
      {
        kind: "block",
        type: "text_changeCase",
        inputs: { TEXT: { shadow: { type: "text", fields: { TEXT: "hello" } } } },
      },
      {
        kind: "block",
        type: "text_trim",
        inputs: { TEXT: { shadow: { type: "text", fields: { TEXT: "  hello  " } } } },
      },
    ],
  },
  { kind: "category", name: "Variables", colour: "#A65C81", custom: "VARIABLE" },
];

let blocksWorkspace = null;
let activeExtensionIds = [];
let currentMode = "blocks"; // "blocks" | "text"
let lastGeneratedCode = "";
let regenTimer = null;
const loadedExtensionScripts = {};

function buildToolbox() {
  return {
    kind: "categoryToolbox",
    contents: [
      ...CORE_TOOLBOX_CATEGORIES,
      ...activeExtensionIds
        .map((id) => window.ARDUINO_BLOCK_EXTENSIONS[id])
        .filter(Boolean)
        .map(buildExtensionCategory),
    ],
  };
}

function buildExtensionCategory(ext) {
  return {
    kind: "category",
    name: ext.toolboxCategoryName,
    colour: "#00878F",
    contents: ext.blockTypes.map((type) => ({ kind: "block", type })),
  };
}

function seedHatBlocksIfEmpty(workspace) {
  if (workspace.getAllBlocks(false).length > 0) return;
  const setup = workspace.newBlock("arduino_setup");
  setup.initSvg();
  setup.render();
  setup.moveBy(40, 30);
  const loop = workspace.newBlock("arduino_loop");
  loop.initSvg();
  loop.render();
  loop.moveBy(40, 170);
}

function initBlocksWorkspace() {
  const container = document.getElementById("arduinoBlocksEditor");
  if (!container || typeof Blockly === "undefined") return;

  blocksWorkspace = Blockly.inject(container, {
    toolbox: buildToolbox(),
    trashcan: true,
    grid: { spacing: 20, length: 3, colour: "#e0e0e0", snap: true },
    zoom: { controls: true, wheel: true, startScale: 0.9, maxScale: 3, minScale: 0.3, scaleSpeed: 1.2 },
  });

  seedHatBlocksIfEmpty(blocksWorkspace);
  blocksWorkspace.addChangeListener(onWorkspaceChanged);

  // Blockly measures its container on inject; if the tab/panel wasn't
  // visible yet (e.g. Text mode was last active) it can size to 0.
  // Resizing once after layout settles avoids a collapsed-looking canvas.
  setTimeout(() => Blockly.svgResize(blocksWorkspace), 50);

  regenerateCodeFromBlocks();
}

function onWorkspaceChanged(event) {
  if (event.isUiEvent) return;
  clearTimeout(regenTimer);
  regenTimer = setTimeout(regenerateCodeFromBlocks, 300);
}

function regenerateCodeFromBlocks() {
  if (!blocksWorkspace || typeof codeEditor === "undefined" || !codeEditor) return;
  const code = generateFullSketch(blocksWorkspace);
  lastGeneratedCode = code;
  codeEditor.setValue(code);
  if (typeof scheduleAutoSave === "function") scheduleAutoSave();
}

// ---------- Mode toggle ----------

function setModeButtonsActive() {
  const blocksBtn = document.getElementById("modeBlocksBtn");
  const textBtn = document.getElementById("modeTextBtn");
  const addExtBtn = document.getElementById("addExtensionBtn");
  if (blocksBtn) blocksBtn.classList.toggle("code-mode-btn--active", currentMode === "blocks");
  if (textBtn) textBtn.classList.toggle("code-mode-btn--active", currentMode === "text");
  if (addExtBtn) addExtBtn.hidden = currentMode !== "blocks";
  const blocksDiv = document.getElementById("arduinoBlocksEditor");
  const textDiv = document.getElementById("arduinoCodeEditor");
  if (blocksDiv) blocksDiv.hidden = currentMode !== "blocks";
  if (textDiv) textDiv.hidden = currentMode !== "text";
  if (currentMode === "blocks" && blocksWorkspace) {
    setTimeout(() => Blockly.svgResize(blocksWorkspace), 0);
  }
}

async function switchToTextMode() {
  currentMode = "text";
  setModeButtonsActive();
}

async function switchToBlocksMode() {
  const textNow = typeof codeEditor !== "undefined" && codeEditor ? codeEditor.getValue() : "";
  const textWasEdited = currentMode === "text" && textNow !== lastGeneratedCode;
  if (textWasEdited) {
    const ok = window.showConfirm
      ? await window.showConfirm(
          "Switching to Blocks mode will replace your code with what the blocks produce — any manual text edits you made will be lost. Continue?",
          { confirmText: "Switch to Blocks", cancelText: "Stay in Text" }
        )
      : confirm("Switching to Blocks mode will overwrite your manual text edits. Continue?");
    if (!ok) return;
  }
  currentMode = "blocks";
  setModeButtonsActive();
  regenerateCodeFromBlocks();
}

// ---------- Add Extension ----------

function loadScript(url) {
  if (loadedExtensionScripts[url]) return loadedExtensionScripts[url];
  loadedExtensionScripts[url] = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = url;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return loadedExtensionScripts[url];
}

function renderExtensionGrid() {
  const grid = document.getElementById("extensionGrid");
  if (!grid) return;
  grid.innerHTML = "";
  const placed = typeof placedComponents !== "undefined" && placedComponents ? placedComponents : new Map();
  Object.values(window.ARDUINO_BLOCK_EXTENSIONS).forEach((ext) => {
    const active = activeExtensionIds.includes(ext.id);
    let onCanvas = false;
    try {
      onCanvas = [...placed.values()].some((c) => c.tag === ext.componentTag);
    } catch (e) {
      // placedComponents shape not available yet — the hint is a nicety, never fatal.
    }
    const card = document.createElement("div");
    card.className = "extension-card" + (active ? " extension-card--active" : "");
    card.innerHTML =
      `<div class="extension-card-icon">${ext.icon || "🔌"}</div><div>${ext.label}</div>` +
      (onCanvas && !active ? `<div class="extension-card-hint">on your canvas</div>` : "");
    card.addEventListener("click", () => (active ? removeExtension(ext.id) : addExtension(ext.id)));
    grid.appendChild(card);
  });
}

async function addExtension(id) {
  const ext = window.ARDUINO_BLOCK_EXTENSIONS[id];
  if (!ext || activeExtensionIds.includes(id)) return;
  await loadScript(ext.scriptUrl);
  activeExtensionIds.push(id);
  blocksWorkspace.updateToolbox(buildToolbox());
  renderExtensionGrid();
  if (typeof scheduleAutoSave === "function") scheduleAutoSave();
}

function removeExtension(id) {
  activeExtensionIds = activeExtensionIds.filter((x) => x !== id);
  blocksWorkspace.updateToolbox(buildToolbox());
  renderExtensionGrid();
  if (typeof scheduleAutoSave === "function") scheduleAutoSave();
  // Blocks of this extension's types are deliberately left on the
  // workspace — Blockly renders any block whose type is no longer
  // registered as a flat "undefined block" warning placeholder rather
  // than throwing, both at render time and on a later
  // serialization.workspaces.load() of a saved/imported project.
}

function openExtensionModal() {
  renderExtensionGrid();
  const modal = document.getElementById("extensionModal");
  if (modal) modal.hidden = false;
}

function closeExtensionModal() {
  const modal = document.getElementById("extensionModal");
  if (modal) modal.hidden = true;
}

// ---------- Export / Import ----------

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function exportBlocksProject() {
  if (!blocksWorkspace) return;
  const payload = {
    formatVersion: 1,
    extensions: activeExtensionIds,
    workspace: Blockly.serialization.workspaces.save(blocksWorkspace),
  };
  if (typeof downloadTextFile === "function") {
    downloadTextFile("blocks-project.json", JSON.stringify(payload, null, 2), "application/json");
  }
  if (typeof showToast === "function") showToast("Block project downloaded");
}

async function importBlocksProject(file) {
  let data;
  try {
    data = JSON.parse(await readFileAsText(file));
  } catch (err) {
    if (typeof showToast === "function") showToast("That file isn't a valid block project (couldn't parse JSON).");
    return;
  }
  if (!data || typeof data !== "object" || !data.workspace) {
    if (typeof showToast === "function") showToast("That file doesn't look like a block project export.");
    return;
  }
  const ok = window.showConfirm
    ? await window.showConfirm("Import this block project? It will replace your current blocks.", { confirmText: "Import" })
    : confirm("Import this block project? It will replace your current blocks.");
  if (!ok) return;

  activeExtensionIds = [];
  for (const id of data.extensions || []) {
    if (window.ARDUINO_BLOCK_EXTENSIONS[id]) await addExtension(id);
  }

  blocksWorkspace.clear();
  try {
    Blockly.serialization.workspaces.load(data.workspace, blocksWorkspace);
  } catch (err) {
    console.error("Block project load failed:", err);
    if (typeof showToast === "function") showToast("Couldn't load that block project — it may be corrupted or from an incompatible version.");
    return;
  }
  seedHatBlocksIfEmpty(blocksWorkspace);
  regenerateCodeFromBlocks();
  if (typeof scheduleAutoSave === "function") scheduleAutoSave();
  if (typeof showToast === "function") showToast("Block project imported");
}

async function importInoFile(file) {
  const text = await readFileAsText(file);
  if (typeof codeEditor !== "undefined" && codeEditor) codeEditor.setValue(text);
  if (typeof showToast === "function") showToast(`Loaded "${file.name}"`);
  if (typeof scheduleAutoSave === "function") scheduleAutoSave();
}

// ---------- Bridge consumed by arduinoLab.js's persistence functions ----------

window.ArduinoBlocksLab = {
  getCurrentMode: () => currentMode,
  getActiveExtensionIds: () => activeExtensionIds.slice(),
  getWorkspaceJson: () => (blocksWorkspace ? Blockly.serialization.workspaces.save(blocksWorkspace) : null),
  restoreFromProject: async (extensions, workspaceJson, mode) => {
    if (!blocksWorkspace) return;
    activeExtensionIds = [];
    for (const id of extensions || []) {
      if (window.ARDUINO_BLOCK_EXTENSIONS[id]) await addExtension(id);
    }
    if (workspaceJson) {
      blocksWorkspace.clear();
      try {
        Blockly.serialization.workspaces.load(workspaceJson, blocksWorkspace);
      } catch (err) {
        console.error("Saved block workspace failed to load:", err);
      }
    }
    seedHatBlocksIfEmpty(blocksWorkspace);
    currentMode = mode === "text" ? "text" : "blocks";
    setModeButtonsActive();
    if (currentMode === "blocks") {
      // Overwrites codeEditor with the live blocks-generated code — correct
      // here since Blocks was the authoritative source last session too.
      regenerateCodeFromBlocks();
    } else {
      // Text mode was last active — arduinoLab.js's initArduinoProject
      // already set codeEditor to the saved raw text just before this runs;
      // don't silently overwrite it. Just compute what the blocks WOULD
      // generate so a later manual switch to Blocks mode has an accurate
      // "were my text edits different from the blocks?" baseline.
      lastGeneratedCode = generateFullSketch(blocksWorkspace);
    }
  },
};

// ---------- Init ----------

document.addEventListener("DOMContentLoaded", () => {
  initBlocksWorkspace();
  setModeButtonsActive();

  document.getElementById("modeTextBtn")?.addEventListener("click", switchToTextMode);
  document.getElementById("modeBlocksBtn")?.addEventListener("click", switchToBlocksMode);
  document.getElementById("addExtensionBtn")?.addEventListener("click", openExtensionModal);
  document.getElementById("closeExtensionModalBtn")?.addEventListener("click", closeExtensionModal);

  document.getElementById("exportBlocksBtn")?.addEventListener("click", exportBlocksProject);
  document.getElementById("importBlocksBtn")?.addEventListener("click", () => document.getElementById("importBlocksInput")?.click());
  document.getElementById("importInoBtn")?.addEventListener("click", () => document.getElementById("importInoInput")?.click());
  document.getElementById("importBlocksInput")?.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) importBlocksProject(file);
    e.target.value = "";
  });
  document.getElementById("importInoInput")?.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) importInoFile(file);
    e.target.value = "";
  });
});
