// Arduino Lab.
//
// Phase 1 (services/arduinoCompileService.js) proved a real sketch compiles
// server-side to a real .hex. Phase 2 proved that .hex can be *executed*,
// for real, in the browser (avr8js). Phase 3 (the circuit-builder section
// below) replaced the old do-nothing drag/drop with real component graphics
// (@wokwi/elements) and real click-and-drag wiring between actual pins —
// but purely as a visual/data model; nothing read the wires yet. Phase 4
// (the "Peripheral wiring" section, further down) is what closes that gap:
// it walks whatever a student actually wired, maps each connection to a
// real AVR port+bit, and drives the running sketch's live GPIO state
// straight into the component's own visual property (an LED's `value`, a
// buzzer's `hasSignal`) — and the other direction too, for a pushbutton's
// clicks driving an input pin. A Serial Monitor panel shows Serial.print
// output the same way, via avr8js's USART peripheral.

const canvas = document.getElementById("circuitCanvas");

// ---------------------------------------------------------------------
// Circuit builder — component placement
// ---------------------------------------------------------------------

// Placed components live inside #canvasViewport (which the pan/zoom
// transform below is applied to), not directly in #circuitCanvas — the
// wire overlay stays a separate, untransformed sibling covering the same
// area (see "Pan & zoom" further down for why: it lets every pin/wire
// position keep using plain screen-space getBoundingClientRect() math,
// completely unaffected by whatever the current pan/zoom is).
const canvasViewport = document.getElementById("canvasViewport");
const wireOverlay = document.getElementById("wireOverlay");
const canvasHint = document.getElementById("circuitCanvasHint");
const SVG_NS = "http://www.w3.org/2000/svg";

let componentCounter = 0;
let wireCounter = 0;
const placedComponents = new Map(); // id -> { id, tag, el }
const pinCircles = new Map(); // "componentId::pinName" -> <circle>
const wires = []; // { id, from: {componentId, pin}, to: {componentId, pin} }

document.querySelectorAll(".component[draggable]").forEach((comp) => {
  comp.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("type", comp.dataset.type);
  });
});

// Filters the palette by label text as the student types — hides both
// non-matching cards and any category heading left with nothing visible
// under it (relies on each heading's matching cards being its immediate
// following siblings, which is how the palette markup is laid out).
document.getElementById("componentSearch")?.addEventListener("input", (e) => {
  const query = e.target.value.trim().toLowerCase();
  document.querySelectorAll(".component").forEach((card) => {
    const matches = !query || card.textContent.trim().toLowerCase().includes(query);
    card.hidden = !matches;
  });
  document.querySelectorAll(".component-category").forEach((heading) => {
    let sibling = heading.nextElementSibling;
    let anyVisible = false;
    while (sibling && sibling.classList.contains("component")) {
      if (!sibling.hidden) anyVisible = true;
      sibling = sibling.nextElementSibling;
    }
    heading.hidden = !anyVisible;
  });
});

canvas.addEventListener("dragover", (e) => {
  e.preventDefault();
});

canvas.addEventListener("drop", async (e) => {
  e.preventDefault();
  const tag = e.dataTransfer.getData("type");
  // The breadboard is the one draggable type that isn't a real @wokwi/
  // elements custom element (see "Breadboard" below), so it's exempt
  // from the "is the CDN bundle actually loaded" check every other tag
  // needs.
  if (!tag || (tag !== "custom-breadboard" && !customElements.get(tag))) return;

  const canvasRect = canvas.getBoundingClientRect();
  // Convert the drop's screen position into #canvasViewport's own local
  // (pre-transform) coordinate space — undo the pan, then undo the zoom.
  const localX = (e.clientX - canvasRect.left - viewPanX) / viewZoom;
  const localY = (e.clientY - canvasRect.top - viewPanY) / viewZoom;
  recordHistory(); // before the change — undo goes back to "not placed yet"
  await placeComponent(tag, localX, localY);
  scheduleAutoSave();
});

// ---------------------------------------------------------------------
// Breadboard
// ---------------------------------------------------------------------
//
// @wokwi/elements has no breadboard at all — every other part in this
// lab is one of theirs, this is the one thing drawn and modeled from
// scratch. It's built as "just another placed component": a plain <div>
// holding a hand-built SVG, given a `.pinInfo` array exactly like a real
// wokwi element's, so the entire existing pin/wire/render machinery above
// needs zero special-casing to treat its 420 holes as clickable pins.
// The one thing that IS genuinely new: a hole's `node` — several holes
// share one electrical node (a whole power rail; 5 holes in one column),
// which is what makes this a real breadboard instead of 420 unrelated
// pins. See "Connectivity" further down for how that's resolved.
const BB_COLS = 30;
const BB_COL_SPACING = 20;
const BB_LEFT_MARGIN = 30;
const BB_WIDTH = BB_LEFT_MARGIN * 2 + (BB_COLS - 1) * BB_COL_SPACING;
const BB_HEIGHT = 300;
const BB_ROW_Y = {
  railTopPlus: 20, railTopMinus: 36,
  a: 64, b: 80, c: 96, d: 112, e: 128,
  f: 158, g: 174, h: 190, i: 206, j: 222,
  railBottomPlus: 252, railBottomMinus: 268,
};

function buildBreadboardPinInfo() {
  const pins = [];
  for (let n = 0; n < BB_COLS; n++) {
    const x = BB_LEFT_MARGIN + n * BB_COL_SPACING;
    pins.push({ name: `railTP-${n}`, x, y: BB_ROW_Y.railTopPlus, node: "rail-top-plus" });
    pins.push({ name: `railTM-${n}`, x, y: BB_ROW_Y.railTopMinus, node: "rail-top-minus" });
    for (const row of ["a", "b", "c", "d", "e"]) {
      pins.push({ name: `${row}${n}`, x, y: BB_ROW_Y[row], node: `col-${n}-top` });
    }
    for (const row of ["f", "g", "h", "i", "j"]) {
      pins.push({ name: `${row}${n}`, x, y: BB_ROW_Y[row], node: `col-${n}-bottom` });
    }
    pins.push({ name: `railBP-${n}`, x, y: BB_ROW_Y.railBottomPlus, node: "rail-bottom-plus" });
    pins.push({ name: `railBM-${n}`, x, y: BB_ROW_Y.railBottomMinus, node: "rail-bottom-minus" });
  }
  return pins;
}

function buildBreadboardSvg(pins) {
  const holes = pins.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="1.6" fill="#8a8370"/>`).join("");
  const railX1 = BB_LEFT_MARGIN - 15;
  const railX2 = BB_WIDTH - BB_LEFT_MARGIN + 15;
  return `<svg width="${BB_WIDTH}" height="${BB_HEIGHT}" viewBox="0 0 ${BB_WIDTH} ${BB_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="${BB_WIDTH}" height="${BB_HEIGHT}" rx="8" fill="#f0ead8" stroke="#c9c0a0" stroke-width="1.5"/>
    <line x1="${railX1}" y1="${BB_ROW_Y.railTopPlus}" x2="${railX2}" y2="${BB_ROW_Y.railTopPlus}" stroke="#d9534f" stroke-width="2"/>
    <line x1="${railX1}" y1="${BB_ROW_Y.railTopMinus}" x2="${railX2}" y2="${BB_ROW_Y.railTopMinus}" stroke="#337ab7" stroke-width="2"/>
    <line x1="${railX1}" y1="${BB_ROW_Y.railBottomPlus}" x2="${railX2}" y2="${BB_ROW_Y.railBottomPlus}" stroke="#d9534f" stroke-width="2"/>
    <line x1="${railX1}" y1="${BB_ROW_Y.railBottomMinus}" x2="${railX2}" y2="${BB_ROW_Y.railBottomMinus}" stroke="#337ab7" stroke-width="2"/>
    <line x1="0" y1="${BB_HEIGHT / 2}" x2="${BB_WIDTH}" y2="${BB_HEIGHT / 2}" stroke="#c9c0a0" stroke-width="1" stroke-dasharray="4,3"/>
    ${holes}
  </svg>`;
}

// A plain div standing in for a Lit custom element — gets the same
// `.pinInfo` and `.updateComplete` shape placeComponent() already expects
// from every real @wokwi/elements part, so it slots into that function
// (and everything downstream of it) without a special code path.
function createBreadboardElement() {
  const el = document.createElement("div");
  el.innerHTML = buildBreadboardSvg(buildBreadboardPinInfo());
  el.style.width = BB_WIDTH + "px";
  el.style.height = BB_HEIGHT + "px";
  el.style.lineHeight = "0"; // an inline-block wrapping an <svg> otherwise leaves a few px of text-baseline gap
  el.pinInfo = buildBreadboardPinInfo();
  el.updateComplete = Promise.resolve();
  return el;
}

// `explicitId` is only passed when rebuilding a circuit from a saved
// snapshot (restoreCircuit, below — used by both project load and
// undo/redo) — keeping the same ids across a rebuild is what lets the
// snapshot's wires (which reference componentId) still resolve
// correctly, instead of needing an old-id -> new-id remap step.
async function placeComponent(tag, x, y, explicitId) {
  const el = tag === "custom-breadboard" ? createBreadboardElement() : document.createElement(tag);
  el.classList.add("placed-component");
  el.style.position = "absolute";
  el.style.left = x + "px";
  el.style.top = y + "px";

  let id;
  if (explicitId) {
    id = explicitId;
    const num = parseInt(String(explicitId).replace(/\D/g, ""), 10);
    if (!isNaN(num)) componentCounter = Math.max(componentCounter, num);
  } else {
    id = "comp-" + ++componentCounter;
  }
  el.dataset.componentId = id;
  canvasViewport.appendChild(el);

  // Lit components render asynchronously — pinInfo itself doesn't need
  // this (it's a plain getter off property defaults), but
  // getBoundingClientRect() below does: before first render a freshly
  // created custom element can report a zero-size box.
  if (el.updateComplete) await el.updateComplete;

  const comp = { id, tag, el };
  placedComponents.set(id, comp);
  attachComponentDrag(el, id);
  renderPins(id);
  trySnapToBreadboard(id);
  redrawWires();
  if (canvasHint) canvasHint.style.display = "none";
  return comp;
}

// ---------------------------------------------------------------------
// Pin geometry
// ---------------------------------------------------------------------

// Every @wokwi/elements part exposes `.pinInfo` — [{name, x, y, ...}] — with
// x/y in the same CSS-pixel space the part actually renders at (verified
// against the library's own source: e.g. the Uno's SVG is authored in mm,
// pinInfo x/y match its *browser-rendered* px size at that native scale,
// not the SVG's internal viewBox). getBoundingClientRect() already
// reflects the current pan/zoom (the browser computes it post-transform),
// so elRect.left/top need no adjustment — but pin.x/pin.y are in the
// part's own *pre-scale* native units, so they need scaling by the
// current zoom to land at the right on-screen offset within that
// (now bigger-or-smaller) rendered box.
// A flipped and/or 180°-turned part's pins mirror within its own
// (unchanged) bounding box — flip mirrors x, turn mirrors both x and y.
// Both are deliberately restricted to operations that leave the box's
// reported width/height untouched (unlike an arbitrary 90°/270° turn,
// which would swap them and break this math — why "turn" here is a
// clean 180°, not free rotation), so this stays exact against
// getBoundingClientRect()'s already zoom-scaled width/height.
function orientedPinOffset(comp, pin, boxWidth, boxHeight) {
  let x = pin.x * viewZoom;
  let y = pin.y * viewZoom;
  if (comp.flipped) x = boxWidth - x;
  if (comp.rotated180) {
    x = boxWidth - x;
    y = boxHeight - y;
  }
  return { x, y };
}

function getPinCanvasPos(componentId, pinName) {
  const comp = placedComponents.get(componentId);
  if (!comp || !comp.el.pinInfo) return null;
  const pin = comp.el.pinInfo.find((p) => p.name === pinName);
  if (!pin) return null;

  const elRect = comp.el.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();
  const offset = orientedPinOffset(comp, pin, elRect.width, elRect.height);
  return {
    x: elRect.left - canvasRect.left + offset.x,
    y: elRect.top - canvasRect.top + offset.y,
  };
}

// Same position math as getPinCanvasPos, but reads getBoundingClientRect()
// ONCE per component instead of once per pin — the breadboard alone has
// 420 of them, and this runs on every pan/zoom tick and every drag move,
// so 420 redundant layout reads per frame was worth avoiding.
function renderPins(componentId) {
  const comp = placedComponents.get(componentId);
  if (!comp || !comp.el.pinInfo) return;

  const elRect = comp.el.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();
  const isHole = comp.tag === "custom-breadboard";

  for (const pin of comp.el.pinInfo) {
    const offset = orientedPinOffset(comp, pin, elRect.width, elRect.height);
    const x = elRect.left - canvasRect.left + offset.x;
    const y = elRect.top - canvasRect.top + offset.y;

    const key = componentId + "::" + pin.name;
    let circle = pinCircles.get(key);
    if (!circle) {
      circle = document.createElementNS(SVG_NS, "circle");
      circle.setAttribute("r", isHole ? "3" : "5");
      circle.setAttribute("class", isHole ? "wire-pin wire-pin--hole" : "wire-pin");
      circle.dataset.componentId = componentId;
      circle.dataset.pinName = pin.name;
      circle.addEventListener("mousedown", onPinMouseDown);
      circle.addEventListener("mouseenter", onPinHoverEnter);
      circle.addEventListener("mousemove", onPinHoverMove);
      circle.addEventListener("mouseleave", onPinHoverLeave);
      wireOverlay.appendChild(circle);
      pinCircles.set(key, circle);
    }
    circle.setAttribute("cx", x);
    circle.setAttribute("cy", y);
  }
}

// A small label following the cursor while hovering any pin or breadboard
// hole — the actual pin name (fixed viewport positioning, so it doesn't
// need any canvas-space math at all).
function onPinHoverEnter(e) {
  const tip = document.getElementById("pinTooltip");
  if (!tip) return;
  tip.textContent = e.target.dataset.pinName;
  tip.style.left = e.clientX + 14 + "px";
  tip.style.top = e.clientY + 14 + "px";
  tip.hidden = false;
}
function onPinHoverMove(e) {
  const tip = document.getElementById("pinTooltip");
  if (!tip || tip.hidden) return;
  tip.style.left = e.clientX + 14 + "px";
  tip.style.top = e.clientY + 14 + "px";
}
function onPinHoverLeave() {
  const tip = document.getElementById("pinTooltip");
  if (tip) tip.hidden = true;
}

// ---------------------------------------------------------------------
// Moving a placed component
// ---------------------------------------------------------------------

const DRAG_THRESHOLD_PX = 4; // below this, a mousedown+mouseup is a click (select), not a drag (move)

function attachComponentDrag(el, id) {
  el.addEventListener("mousedown", (e) => {
    // Pin circles live in the separate SVG overlay, not inside `el` — a
    // mousedown reaching here is always on the component's own body.
    // Stopped from bubbling so the canvas's own pan-drag (below) doesn't
    // also kick in for what's really a component drag.
    e.preventDefault();
    e.stopPropagation();
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const startLeft = parseFloat(el.style.left) || 0;
    const startTop = parseFloat(el.style.top) || 0;
    let dragged = false;

    function onMove(ev) {
      if (!dragged && Math.hypot(ev.clientX - startClientX, ev.clientY - startClientY) < DRAG_THRESHOLD_PX) return;
      if (!dragged) recordHistory(); // once per drag gesture, before the first real move — undo reverts the whole drag, not one pixel at a time
      dragged = true;
      // Mouse movement is in real screen pixels; el.style.left/top are in
      // #canvasViewport's local (pre-zoom) units, so the delta needs
      // dividing by the current zoom to move the part exactly as far as
      // the cursor, regardless of how zoomed in/out the view is.
      const dx = (ev.clientX - startClientX) / viewZoom;
      const dy = (ev.clientY - startClientY) / viewZoom;
      el.style.left = Math.max(0, startLeft + dx) + "px";
      el.style.top = Math.max(0, startTop + dy) + "px";
      renderPins(id);
      redrawWires();
      renderSelectionToolbar();
      renderWireToolbar();
      highlightNearbyHoles(id);
    }
    function onUp(upEvent) {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      clearHoleHighlights();
      if (dragged) {
        trySnapToBreadboard(id);
        redrawWires();
        renderSelectionToolbar();
        scheduleAutoSave();
      } else {
        selectComponent(id, upEvent.shiftKey);
      }
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
}

// ---------------------------------------------------------------------
// Selection & editing — flip, turn, duplicate, delete, LED color
// ---------------------------------------------------------------------

// Shift-click adds/removes a part from the selection (see attachComponent
// Drag's onUp); a plain click replaces it. Selecting a component always
// clears any selected wire and vice versa — the two toolbars are mutually
// exclusive, never shown together.
let selectedComponentIds = new Set();

function selectComponent(id, additive) {
  selectedWireId = null;
  if (!additive) selectedComponentIds.clear();
  if (additive && selectedComponentIds.has(id)) {
    selectedComponentIds.delete(id); // shift-clicking an already-selected part deselects just that one
  } else {
    selectedComponentIds.add(id);
  }
  applySelectionVisuals();
  renderSelectionToolbar();
  renderWireToolbar();
}

function deselectAll() {
  selectedComponentIds.clear();
  selectedWireId = null;
  applySelectionVisuals();
  renderSelectionToolbar();
  renderWireToolbar();
}

function applySelectionVisuals() {
  document.querySelectorAll(".placed-component.selected").forEach((el) => el.classList.remove("selected"));
  for (const id of selectedComponentIds) {
    const comp = placedComponents.get(id);
    if (comp) comp.el.classList.add("selected");
  }
}

// Positions the floating toolbar centered above the union of every
// selected part's bounding box, and shows the LED color row only when
// exactly one LED (the one part type with a plain, static `color`
// property) is selected on its own.
function renderSelectionToolbar() {
  const toolbar = document.getElementById("componentToolbar");
  if (!toolbar) return;
  if (selectedComponentIds.size === 0) {
    toolbar.hidden = true;
    return;
  }

  const canvasRect = canvas.getBoundingClientRect();
  let minLeft = Infinity;
  let minTop = Infinity;
  let maxRight = -Infinity;
  let maxBottom = -Infinity;
  for (const id of selectedComponentIds) {
    const comp = placedComponents.get(id);
    if (!comp) continue;
    const r = comp.el.getBoundingClientRect();
    minLeft = Math.min(minLeft, r.left - canvasRect.left);
    minTop = Math.min(minTop, r.top - canvasRect.top);
    maxRight = Math.max(maxRight, r.right - canvasRect.left);
    maxBottom = Math.max(maxBottom, r.bottom - canvasRect.top);
  }
  if (!isFinite(minLeft)) {
    toolbar.hidden = true;
    return;
  }
  toolbar.style.left = (minLeft + maxRight) / 2 + "px";
  toolbar.hidden = false;

  const colorRow = document.getElementById("componentColorRow");
  if (colorRow) {
    const soleId = selectedComponentIds.size === 1 ? [...selectedComponentIds][0] : null;
    const soleComp = soleId ? placedComponents.get(soleId) : null;
    colorRow.hidden = !(soleComp && soleComp.tag === "wokwi-led");
  }

  // A part near the top of the canvas (the default seeded LED included)
  // can leave too little room above it for the toolbar — worse now that
  // the LED color row can make it two rows tall. Rather than let it
  // render clipped underneath the fixed topbar (invisible AND
  // unclickable, since the topbar sits at a higher z-index), flip it to
  // sit below the selection instead whenever there isn't room above.
  const toolbarHeight = toolbar.offsetHeight;
  const fitsAbove = minTop - toolbarHeight - 10 >= 0;
  toolbar.classList.toggle("component-toolbar--below", !fitsAbove);
  toolbar.style.top = (fitsAbove ? minTop : maxBottom) + "px";
}

// Applies a component's current flip/turn state as a CSS transform.
// Deliberately just these two (see orientedPinOffset's comment for why
// "turn" is a clean 180° rather than free rotation) — both are
// involutions around the element's own center, so neither changes its
// reported bounding box, which is what keeps the pin math exact.
function applyComponentOrientation(comp) {
  const parts = [];
  if (comp.flipped) parts.push("scaleX(-1)");
  if (comp.rotated180) parts.push("rotate(180deg)");
  comp.el.style.transform = parts.join(" ");
}

function flipComponent(id) {
  const comp = placedComponents.get(id);
  if (!comp) return;
  comp.flipped = !comp.flipped;
  applyComponentOrientation(comp);
  renderPins(id);
  redrawWires();
}

function turnComponent(id) {
  const comp = placedComponents.get(id);
  if (!comp) return;
  comp.rotated180 = !comp.rotated180;
  applyComponentOrientation(comp);
  renderPins(id);
  redrawWires();
}

async function duplicateComponent(id) {
  const source = placedComponents.get(id);
  if (!source) return;
  const x = (parseFloat(source.el.style.left) || 0) + 24;
  const y = (parseFloat(source.el.style.top) || 0) + 24;
  const clone = await placeComponent(source.tag, x, y);
  clone.flipped = !!source.flipped;
  clone.rotated180 = !!source.rotated180;
  if (clone.flipped || clone.rotated180) {
    applyComponentOrientation(clone);
    renderPins(clone.id);
  }
  if (source.tag === "wokwi-led") clone.el.color = source.el.color; // a re-colored LED duplicates the same color, not the default red
  // A duplicate is a fresh part, not a clone of what it was wired to —
  // matches how every other design tool's "duplicate" behaves.
  trySnapToBreadboard(clone.id);
  redrawWires();
  selectComponent(clone.id);
}

function deleteComponent(id) {
  const comp = placedComponents.get(id);
  if (!comp) return;

  for (let i = wires.length - 1; i >= 0; i--) {
    if (wires[i].from.componentId === id || wires[i].to.componentId === id) {
      if (wires[i].id === selectedWireId) selectedWireId = null;
      wires.splice(i, 1);
    }
  }
  // A placement can reference this id either as the plugged-in part or —
  // if this component IS the breadboard — as the hole side of the entry.
  for (const [key, holeKey] of [...breadboardPlacements.entries()]) {
    if (key.startsWith(id + "::") || holeKey.startsWith(id + "::")) breadboardPlacements.delete(key);
  }
  if (comp.el.pinInfo) {
    for (const pin of comp.el.pinInfo) {
      const key = id + "::" + pin.name;
      pinCircles.get(key)?.remove();
      pinCircles.delete(key);
    }
  }
  comp.el.remove();
  placedComponents.delete(id);
  selectedComponentIds.delete(id);
  applySelectionVisuals();
  redrawWires();
  renderWireToolbar();
  if (canvasHint && placedComponents.size === 0) canvasHint.style.display = "";
}

document.getElementById("componentToolbar")?.addEventListener("mousedown", (e) => {
  // Stop this reaching the canvas's own pan-drag listener — clicking a
  // toolbar button is not a click on empty canvas background.
  e.stopPropagation();
});
document.getElementById("componentToolbar")?.addEventListener("click", (e) => {
  const colorBtn = e.target.closest("button[data-led-color]");
  if (colorBtn) {
    // Only ever shown/actionable when exactly one LED is selected — see
    // renderSelectionToolbar's colorRow.hidden logic.
    const soleId = selectedComponentIds.size === 1 ? [...selectedComponentIds][0] : null;
    const soleComp = soleId ? placedComponents.get(soleId) : null;
    if (soleComp && soleComp.tag === "wokwi-led") {
      recordHistory();
      soleComp.el.color = colorBtn.dataset.ledColor;
      scheduleAutoSave();
    }
    return;
  }

  const btn = e.target.closest("button[data-action]");
  if (!btn || selectedComponentIds.size === 0) return;
  recordHistory(); // one undo step for the whole batch, not one per part
  const ids = [...selectedComponentIds]; // snapshot — the set mutates as each action runs
  if (btn.dataset.action === "flip") ids.forEach(flipComponent);
  else if (btn.dataset.action === "turn") ids.forEach(turnComponent);
  else if (btn.dataset.action === "duplicate") ids.forEach(duplicateComponent);
  else if (btn.dataset.action === "delete") ids.forEach(deleteComponent);
  renderSelectionToolbar();
  scheduleAutoSave();
});

// ---------------------------------------------------------------------
// Breadboard snapping
// ---------------------------------------------------------------------

const BREADBOARD_SNAP_PX = 14;
// "componentId::pin" -> "breadboardId::holeName" — a pin that's currently
// close enough to a hole to count as plugged into it. Independent per
// pin (not per component): a part's legs don't need to match the
// board's own spacing exactly, each leg just finds its own closest hole.
const breadboardPlacements = new Map();

// A single global toggle — with it off, dragging a part near the board
// never auto-plugs it in, for whenever precise free placement matters
// more than the convenience.
let snappingEnabled = true;

function findBreadboardComponent() {
  for (const comp of placedComponents.values()) {
    if (comp.tag === "custom-breadboard") return comp;
  }
  return null;
}

// Every hole's on-screen position for a given breadboard, computed once
// per call (one getBoundingClientRect(), like renderPins) rather than
// once per hole — shared by trySnapToBreadboard and the live highlight
// preview below. Goes through orientedPinOffset like every other part's
// pins do, so this stays correct even though nothing in the UI actually
// offers flipping/turning the board itself today.
function breadboardHolePositions(board) {
  const boardRect = board.el.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();
  return board.el.pinInfo.map((hole) => {
    const offset = orientedPinOffset(board, hole, boardRect.width, boardRect.height);
    return {
      hole,
      x: boardRect.left - canvasRect.left + offset.x,
      y: boardRect.top - canvasRect.top + offset.y,
    };
  });
}

// Re-checks every pin of `componentId` against the nearest hole on
// whatever breadboard is on the canvas, snapping (or un-snapping) each
// one independently. Called once at the end of a drag/placement, not on
// every mousemove — 420 holes x several pins, every frame, would be
// wasteful for something that only matters once you let go (the live
// preview below is the cheaper, read-only version of this same search).
function trySnapToBreadboard(componentId) {
  const board = findBreadboardComponent();
  if (!board || componentId === board.id) return;
  const comp = placedComponents.get(componentId);
  if (!comp || !comp.el.pinInfo) return;

  // Snapping OFF still runs this (rather than a blanket early-return): it
  // gates forming NEW connections, but a part that gets dragged away from
  // the board while it's off must still drop its now-stale placement —
  // otherwise it stays "phantom" snapped to a hole it's no longer
  // anywhere near (a stray stub line to nowhere, and a fake electrical
  // connection the connectivity graph would still union).
  const boardHoles = snappingEnabled ? breadboardHolePositions(board) : null;

  for (const pin of comp.el.pinInfo) {
    const key = componentId + "::" + pin.name;
    if (!snappingEnabled) {
      breadboardPlacements.delete(key);
      continue;
    }

    const pinPos = getPinCanvasPos(componentId, pin.name);
    if (!pinPos) continue;

    let nearest = null;
    let nearestDist = Infinity;
    for (const h of boardHoles) {
      const dist = Math.hypot(pinPos.x - h.x, pinPos.y - h.y);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = h.hole;
      }
    }

    if (nearest && nearestDist <= BREADBOARD_SNAP_PX) {
      breadboardPlacements.set(key, board.id + "::" + nearest.name);
    } else {
      breadboardPlacements.delete(key);
    }
  }
}

// The live, drag-time version of the same search — highlights whichever
// holes a part's legs would snap into if released right now, without
// actually committing anything (trySnapToBreadboard, called separately
// on drag end, does the real snap).
function highlightNearbyHoles(componentId) {
  clearHoleHighlights();
  if (!snappingEnabled) return;
  const board = findBreadboardComponent();
  if (!board || componentId === board.id) return;
  const comp = placedComponents.get(componentId);
  if (!comp || !comp.el.pinInfo) return;

  const boardHoles = breadboardHolePositions(board);

  for (const pin of comp.el.pinInfo) {
    const pinPos = getPinCanvasPos(componentId, pin.name);
    if (!pinPos) continue;
    let nearest = null;
    let nearestDist = Infinity;
    for (const h of boardHoles) {
      const dist = Math.hypot(pinPos.x - h.x, pinPos.y - h.y);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = h.hole;
      }
    }
    if (nearest && nearestDist <= BREADBOARD_SNAP_PX) {
      pinCircles.get(board.id + "::" + nearest.name)?.classList.add("wire-pin--highlight");
    }
  }
}

function clearHoleHighlights() {
  document.querySelectorAll(".wire-pin--highlight").forEach((el) => el.classList.remove("wire-pin--highlight"));
}

document.getElementById("snapToggleBtn")?.addEventListener("click", (e) => {
  snappingEnabled = !snappingEnabled;
  e.currentTarget.classList.toggle("vc-btn--active", snappingEnabled);
  e.currentTarget.title = snappingEnabled ? "Snap to breadboard: on (click to turn off)" : "Snap to breadboard: off (click to turn on)";
});

// ---------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------

let pendingWire = null; // { fromComponentId, fromPin, from: {x,y}, rubberPath }

function onPinMouseDown(e) {
  e.preventDefault();
  e.stopPropagation(); // don't also trigger the canvas's own pan-drag below
  const fromComponentId = e.target.dataset.componentId;
  const fromPin = e.target.dataset.pinName;
  const from = getPinCanvasPos(fromComponentId, fromPin);
  if (!from) return;

  const rubberPath = document.createElementNS(SVG_NS, "path");
  rubberPath.setAttribute("class", "wire-rubberband");
  wireOverlay.appendChild(rubberPath);

  pendingWire = { fromComponentId, fromPin, from, rubberPath };
  document.addEventListener("mousemove", onWireDragMove);
  document.addEventListener("mouseup", onWireDragEnd);
}

function onWireDragMove(e) {
  if (!pendingWire) return;
  const canvasRect = canvas.getBoundingClientRect();
  const to = { x: e.clientX - canvasRect.left, y: e.clientY - canvasRect.top };
  pendingWire.rubberPath.setAttribute("d", wirePath(pendingWire.from, to));
}

function onWireDragEnd(e) {
  document.removeEventListener("mousemove", onWireDragMove);
  document.removeEventListener("mouseup", onWireDragEnd);
  if (!pendingWire) return;

  pendingWire.rubberPath.remove();
  const dropTarget = document.elementFromPoint(e.clientX, e.clientY);
  if (dropTarget && dropTarget.classList.contains("wire-pin")) {
    tryAddWire(
      pendingWire.fromComponentId,
      pendingWire.fromPin,
      dropTarget.dataset.componentId,
      dropTarget.dataset.pinName
    );
  }
  pendingWire = null;
}

function tryAddWire(fromComponentId, fromPin, toComponentId, toPin) {
  if (fromComponentId === toComponentId && fromPin === toPin) return; // a pin can't wire to itself

  const isDuplicate = wires.some(
    (w) =>
      (w.from.componentId === fromComponentId && w.from.pin === fromPin &&
        w.to.componentId === toComponentId && w.to.pin === toPin) ||
      (w.from.componentId === toComponentId && w.from.pin === toPin &&
        w.to.componentId === fromComponentId && w.to.pin === fromPin)
  );
  if (isDuplicate) return;

  // Only ever a real user gesture (onWireDragEnd) at this point —
  // seedDefaultCircuit's own tryAddWire calls happen inside
  // restoreCircuit's suppressHistory window, so recordHistory()
  // correctly no-ops for those instead of polluting the undo stack with
  // the starter circuit's own wiring.
  recordHistory();
  wires.push({
    id: "wire-" + ++wireCounter,
    from: { componentId: fromComponentId, pin: fromPin },
    to: { componentId: toComponentId, pin: toPin },
    color: DEFAULT_WIRE_COLOR,
  });
  redrawWires();
  scheduleAutoSave();
}

function removeWire(wireId) {
  const idx = wires.findIndex((w) => w.id === wireId);
  if (idx !== -1) wires.splice(idx, 1);
  redrawWires();
}

// ---------------------------------------------------------------------
// Wire selection & appearance — color, routing mode
// ---------------------------------------------------------------------

const DEFAULT_WIRE_COLOR = "#e5352b";
let selectedWireId = null;
// "curved" (the original S-curve, still the default), "straight" (a
// direct line), or "orthogonal" (right-angle, like a schematic) — one
// setting for every wire on the canvas, not per-wire; switching it just
// re-renders all of them.
let wireRoutingMode = "curved";

function selectWire(id) {
  selectedWireId = id;
  selectedComponentIds.clear();
  applySelectionVisuals();
  renderSelectionToolbar();
  redrawWires(); // to apply the "selected" outline class
  renderWireToolbar();
}

function deselectWire() {
  selectedWireId = null;
  redrawWires();
  renderWireToolbar();
}

function renderWireToolbar() {
  const toolbar = document.getElementById("wireToolbar");
  if (!toolbar) return;
  const wire = selectedWireId ? wires.find((w) => w.id === selectedWireId) : null;
  if (!wire) {
    toolbar.hidden = true;
    return;
  }
  const from = getPinCanvasPos(wire.from.componentId, wire.from.pin);
  const to = getPinCanvasPos(wire.to.componentId, wire.to.pin);
  if (!from || !to) {
    toolbar.hidden = true;
    return;
  }
  toolbar.style.left = (from.x + to.x) / 2 + "px";
  const midY = (from.y + to.y) / 2;
  toolbar.hidden = false;
  // Same top-of-canvas flip as renderSelectionToolbar — a wire whose
  // midpoint sits close to the canvas top would otherwise render its
  // toolbar underneath (and unclickable behind) the fixed topbar.
  const toolbarHeight = toolbar.offsetHeight;
  const fitsAbove = midY - toolbarHeight - 10 >= 0;
  toolbar.classList.toggle("component-toolbar--below", !fitsAbove);
  toolbar.style.top = midY + "px";
}

document.getElementById("wireToolbar")?.addEventListener("mousedown", (e) => e.stopPropagation());
document.getElementById("wireToolbar")?.addEventListener("click", (e) => {
  if (!selectedWireId) return;
  const wire = wires.find((w) => w.id === selectedWireId);
  if (!wire) return;

  const colorBtn = e.target.closest("button[data-wire-color]");
  if (colorBtn) {
    recordHistory();
    wire.color = colorBtn.dataset.wireColor;
    redrawWires();
    scheduleAutoSave();
    return;
  }
  if (e.target.closest('[data-action="delete-wire"]')) {
    recordHistory();
    removeWire(selectedWireId);
    deselectWire();
    scheduleAutoSave();
  }
});

function setWireRoutingMode(mode) {
  wireRoutingMode = mode;
  document.querySelectorAll("[data-wire-mode]").forEach((btn) => {
    btn.classList.toggle("vc-btn--active", btn.dataset.wireMode === mode);
  });
  redrawWires();
}
document.querySelectorAll("[data-wire-mode]").forEach((btn) => {
  btn.addEventListener("click", () => setWireRoutingMode(btn.dataset.wireMode));
});

function redrawWires() {
  wireOverlay.querySelectorAll(".wire-path, .snap-stub").forEach((p) => p.remove());
  for (const wire of wires) {
    const from = getPinCanvasPos(wire.from.componentId, wire.from.pin);
    const to = getPinCanvasPos(wire.to.componentId, wire.to.pin);
    if (!from || !to) continue; // the component it referenced is gone

    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", wirePath(from, to));
    path.setAttribute("class", "wire-path" + (wire.id === selectedWireId ? " wire-path--selected" : ""));
    path.setAttribute("stroke", wire.color || DEFAULT_WIRE_COLOR);
    path.addEventListener("click", (e) => {
      e.stopPropagation();
      selectWire(wire.id);
    });
    // Insert before any existing child so wires always render under pins.
    wireOverlay.insertBefore(path, wireOverlay.firstChild);
  }

  // A short line from each breadboard-snapped pin to the hole it landed
  // in — the visual proof that plugging a leg in near a hole actually
  // did something, since (unlike a drawn wire) nothing else marks it.
  for (const [pointKey, holeKey] of breadboardPlacements.entries()) {
    const sep = pointKey.indexOf("::");
    const from = getPinCanvasPos(pointKey.slice(0, sep), pointKey.slice(sep + 2));
    const holeSep = holeKey.indexOf("::");
    const to = getPinCanvasPos(holeKey.slice(0, holeSep), holeKey.slice(holeSep + 2));
    if (!from || !to) continue;

    const stub = document.createElementNS(SVG_NS, "line");
    stub.setAttribute("x1", from.x);
    stub.setAttribute("y1", from.y);
    stub.setAttribute("x2", to.x);
    stub.setAttribute("y2", to.y);
    stub.setAttribute("class", "snap-stub");
    wireOverlay.insertBefore(stub, wireOverlay.firstChild);
  }
}

// The wire's visual routing — curved (a gentle S-curve, like a real
// jumper wire looping between two header pins), straight (a direct
// line), or orthogonal (right-angle, schematic-style) — set globally via
// wireRoutingMode. Also used for the rubber-band preview while dragging
// a new wire, so the preview matches what will actually be drawn.
function wirePath(from, to) {
  if (wireRoutingMode === "straight") {
    return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
  }
  if (wireRoutingMode === "orthogonal") {
    const midX = (from.x + to.x) / 2;
    return `M ${from.x} ${from.y} L ${midX} ${from.y} L ${midX} ${to.y} L ${to.x} ${to.y}`;
  }
  const bulge = Math.max(Math.abs(to.y - from.y) * 0.5, 30);
  return `M ${from.x} ${from.y} C ${from.x} ${from.y + bulge}, ${to.x} ${to.y - bulge}, ${to.x} ${to.y}`;
}

// A default starter circuit — an LED wired to pin 13/GND — so the lab
// isn't a blank canvas on first visit, and the starter sketch actually
// has something wired to run against. Called once, after both Monaco and
// the @wokwi/elements bundle are ready.
async function seedDefaultCircuit() {
  const uno = await placeComponent("wokwi-arduino-uno", 40, 40);
  const led = await placeComponent("wokwi-led", 460, 40);
  tryAddWire(led.id, "A", uno.id, "13");
  tryAddWire(led.id, "C", uno.id, "GND.1");
}

// ---------------------------------------------------------------------
// Pan & zoom
// ---------------------------------------------------------------------
//
// #canvasViewport (the div every placed component lives in) gets
// `transform: translate(viewPanX, viewPanY) scale(viewZoom)`. Everything
// that reads a pin's on-screen position (getPinCanvasPos, used by both
// pin circles and wire paths) already goes through the real DOM —
// getBoundingClientRect() — rather than tracking layout positions by
// hand, so panning is free: the browser folds the translate into the
// rect it reports automatically. Zoom needs one explicit adjustment
// (pin.x/pin.y scaled by viewZoom in getPinCanvasPos — see there), since
// pinInfo coordinates are in the part's pre-scale native units.

let viewZoom = 1;
let viewPanX = 0;
let viewPanY = 0;
const ZOOM_STEP = 1.2;
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 2.5;
const PAN_STEP = 80;

function applyViewTransform() {
  canvasViewport.style.transform = `translate(${viewPanX}px, ${viewPanY}px) scale(${viewZoom})`;
  const zoomLevelEl = document.getElementById("zoomLevel");
  if (zoomLevelEl) zoomLevelEl.textContent = Math.round(viewZoom * 100) + "%";
  // Every pin/wire on screen depends on the transform that was just
  // changed — cheap enough to just refresh all of them at this scale
  // (a handful of parts in a teaching circuit, not hundreds).
  for (const id of placedComponents.keys()) renderPins(id);
  redrawWires();
  renderSelectionToolbar();
  renderWireToolbar();
}

function setZoom(next) {
  viewZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
  applyViewTransform();
}

function resetView() {
  viewZoom = 1;
  viewPanX = 0;
  viewPanY = 0;
  applyViewTransform();
}

document.getElementById("zoomInBtn")?.addEventListener("click", () => setZoom(viewZoom * ZOOM_STEP));
document.getElementById("zoomOutBtn")?.addEventListener("click", () => setZoom(viewZoom / ZOOM_STEP));
document.getElementById("viewResetBtn")?.addEventListener("click", resetView);
// Same convention as click-drag panning below (content follows the
// gesture) so the pad and dragging never feel like they disagree —
// pressing "right" moves the circuit right, exactly like dragging right.
document.querySelectorAll("[data-pan]").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.dataset.pan === "up") viewPanY -= PAN_STEP;
    if (btn.dataset.pan === "down") viewPanY += PAN_STEP;
    if (btn.dataset.pan === "left") viewPanX -= PAN_STEP;
    if (btn.dataset.pan === "right") viewPanX += PAN_STEP;
    applyViewTransform();
  });
});

// Click-and-drag panning on empty canvas background — the standard
// gesture for a pannable canvas, alongside the explicit pad above.
// Component drags and pin drags both stopPropagation() specifically so
// starting one of those never also starts a pan underneath it.
let panState = null; // { startClientX, startClientY, startPanX, startPanY }

canvas.addEventListener("mousedown", (e) => {
  if (e.target !== canvas && e.target !== canvasViewport) return; // clicked a component/pin, not empty space
  panState = { startClientX: e.clientX, startClientY: e.clientY, startPanX: viewPanX, startPanY: viewPanY, moved: false };
  canvas.classList.add("panning");
  document.addEventListener("mousemove", onCanvasPanMove);
  document.addEventListener("mouseup", onCanvasPanUp);
});

function onCanvasPanMove(e) {
  if (!panState) return;
  if (!panState.moved && Math.hypot(e.clientX - panState.startClientX, e.clientY - panState.startClientY) >= DRAG_THRESHOLD_PX) {
    panState.moved = true;
  }
  viewPanX = panState.startPanX + (e.clientX - panState.startClientX);
  viewPanY = panState.startPanY + (e.clientY - panState.startClientY);
  applyViewTransform();
}

function onCanvasPanUp() {
  // A mousedown+mouseup on empty canvas with no real movement in between
  // is a plain click — deselect, same as clicking empty space in any
  // other design tool, rather than leaving a toolbar stuck open.
  if (panState && !panState.moved) deselectAll();
  panState = null;
  canvas.classList.remove("panning");
  document.removeEventListener("mousemove", onCanvasPanMove);
  document.removeEventListener("mouseup", onCanvasPanUp);
}

// Mouse-wheel gestures: plain scroll pans (this is exactly what a
// trackpad's two-finger scroll already sends as wheel deltaX/deltaY, so
// this alone covers trackpad panning too), Ctrl/Cmd+scroll zooms — the
// same split Figma/Google Maps/most modern canvas tools use, and it means
// a plain mouse wheel doesn't fight a laptop's own pinch-to-zoom-the-page
// gesture (which arrives as a Ctrl+wheel event).
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      setZoom(viewZoom * (e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP));
    } else {
      viewPanX -= e.deltaX;
      viewPanY -= e.deltaY;
      applyViewTransform();
    }
  },
  { passive: false }
);

// `const`/`let` at a classic script's top level don't become window
// properties (only `function` declarations do), so this is the one place
// the circuit's live state is deliberately exposed — Phase 5 (saving
// project_data: {code, components, wires}) needs to reach in from outside
// this file too, not just this file's own click handlers.
window.arduinoLab = {
  placedComponents, wires, placeComponent, getPinCanvasPos, breadboardPlacements,
  // `let`-declared state can't be exported as a live property (reassigning
  // the variable wouldn't update an already-copied value on this object),
  // so these are read on demand instead.
  getSelectedComponentIds: () => selectedComponentIds,
  getSelectedWireId: () => selectedWireId,
  getWireRoutingMode: () => wireRoutingMode,
  getSnappingEnabled: () => snappingEnabled,
  getCurrentProjectId: () => currentProjectId,
};

// ---------------------------------------------------------------------
// Peripheral wiring — binding avr8js's live GPIO state to whatever's
// actually wired on the canvas
// ---------------------------------------------------------------------

// The Uno's fixed silkscreen-pin -> physical AVR port/bit mapping — the
// one piece of hardware knowledge avr8js and @wokwi/elements don't give
// you for free (avr8js only knows ports B/C/D; @wokwi/elements' pinInfo
// only knows silkscreen names like "13" or "A0"). Standard, unchanging
// ATmega328P-on-an-Uno wiring, not something to compute.
const PIN_TO_PORT = {
  0: { port: "D", bit: 0 }, 1: { port: "D", bit: 1 }, 2: { port: "D", bit: 2 }, 3: { port: "D", bit: 3 },
  4: { port: "D", bit: 4 }, 5: { port: "D", bit: 5 }, 6: { port: "D", bit: 6 }, 7: { port: "D", bit: 7 },
  8: { port: "B", bit: 0 }, 9: { port: "B", bit: 1 }, 10: { port: "B", bit: 2 }, 11: { port: "B", bit: 3 },
  12: { port: "B", bit: 4 }, 13: { port: "B", bit: 5 },
  A0: { port: "C", bit: 0 }, A1: { port: "C", bit: 1 }, A2: { port: "C", bit: 2 },
  A3: { port: "C", bit: 3 }, A4: { port: "C", bit: 4 }, A5: { port: "C", bit: 5 },
};

// The Uno's analog pins double as ADC channels 0-5, in the same order —
// avr8js's AVRADC (below) is fed a live voltage per channel index, not
// per pin name.
const ANALOG_CHANNEL = { A0: 0, A1: 1, A2: 2, A3: 3, A4: 4, A5: 5 };

// Arduino's Servo library doesn't use the hardware PWM registers at all —
// it bit-bangs a precise HIGH pulse every ~20ms whose *width* (in
// microseconds) encodes the angle, using these exact constants
// (Servo.h's MIN_PULSE_WIDTH/MAX_PULSE_WIDTH). So a servo's angle can be
// read the same way an LED's on/off state is: watching the same GPIO pin,
// just timing it instead of just reading it.
const SERVO_MIN_PULSE_US = 544;
const SERVO_MAX_PULSE_US = 2400;

function findArduinoComponent() {
  for (const comp of placedComponents.values()) {
    if (comp.tag === "wokwi-arduino-uno") return comp;
  }
  return null;
}

// Resolves ALL electrical connectivity for one run: explicit wires, plus
// breadboard rows — holes sharing a node are the same electrical point
// even with no wire drawn between them, which is the entire reason a
// breadboard is useful — plus whatever's been snapped into the board by
// drag-and-drop. A union-find over every "componentId::pin" and
// "breadboardId::holeName" seen: three passes of union() (wires; holes
// sharing a node; snapped placements), then a shared find() answers
// "are these two points connected" for the rest of this run. Rebuilt
// fresh right before each Run — wires/placements can change between
// runs — and built ONCE per run, not once per component checked.
function buildConnectivity() {
  const parent = new Map();
  function find(x) {
    if (!parent.has(x)) parent.set(x, x);
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root);
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur);
      parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  for (const wire of wires) {
    union(wire.from.componentId + "::" + wire.from.pin, wire.to.componentId + "::" + wire.to.pin);
  }
  for (const comp of placedComponents.values()) {
    if (comp.tag !== "custom-breadboard" || !comp.el.pinInfo) continue;
    const firstHoleForNode = new Map();
    for (const hole of comp.el.pinInfo) {
      const holeKey = comp.id + "::" + hole.name;
      if (firstHoleForNode.has(hole.node)) {
        union(holeKey, firstHoleForNode.get(hole.node));
      } else {
        firstHoleForNode.set(hole.node, holeKey);
      }
    }
  }
  for (const [pointKey, holeKey] of breadboardPlacements.entries()) {
    union(pointKey, holeKey);
  }

  return { find };
}

// Every pin of `comp` electrically connected (directly, or via wires and/
// or a breadboard's shared rows) to a pin of `uno` — {ownPin, arduinoPin}
// for each. O(component pins x Uno pins) `find()` calls, both small, so
// this is cheap even called once per placed component.
function findArduinoConnections(comp, uno, find) {
  if (!comp.el.pinInfo || !uno.el.pinInfo) return [];
  const hits = [];
  for (const ownPin of comp.el.pinInfo) {
    const ownRoot = find(comp.id + "::" + ownPin.name);
    for (const unoPin of uno.el.pinInfo) {
      if (find(uno.id + "::" + unoPin.name) === ownRoot) {
        hits.push({ ownPin: ownPin.name, arduinoPin: unoPin.name });
      }
    }
  }
  return hits;
}

// Wires up every non-Arduino placed component against the just-started
// simulation and returns a cleanup function. Re-run fresh on every Run
// click (see runSketch) — components/wires can change between runs.
//
// `cpu` is only needed for the servo's pulse-width timing; `adc` is only
// needed for the two analog parts (null-checked so a sketch that never
// places one doesn't need either).
function bindComponentsToSimulation(cpu, ports, PinState, adc) {
  const uno = findArduinoComponent();
  const boundVisuals = []; // {el, prop, resetValue} — restored on stop
  const eventListeners = []; // {el, type, handler} — removed on stop

  if (!uno) return () => {}; // nothing to bind without a board on the canvas
  const { find } = buildConnectivity();

  for (const comp of placedComponents.values()) {
    if (comp.id === uno.id || comp.tag === "custom-breadboard") continue;
    const connections = findArduinoConnections(comp, uno, find);
    if (!connections.length) continue;

    if (comp.tag === "wokwi-led" || comp.tag === "wokwi-buzzer") {
      const prop = comp.tag === "wokwi-led" ? "value" : "hasSignal";
      for (const { arduinoPin } of connections) {
        const loc = PIN_TO_PORT[arduinoPin];
        if (!loc || !ports[loc.port]) continue; // e.g. wired to GND — nothing to listen to
        const port = ports[loc.port];
        const listener = () => {
          comp.el[prop] = port.pinState(loc.bit) === PinState.High;
        };
        port.addListener(listener);
        comp.el[prop] = port.pinState(loc.bit) === PinState.High; // set the initial state — addListener only fires on change
        boundVisuals.push({ el: comp.el, prop, resetValue: false });
      }
    } else if (comp.tag === "wokwi-rgb-led") {
      // Each color channel is its own pin/leg — treated as plain digital
      // on/off for now (a real digitalWrite(HIGH/LOW) per color, the
      // common intro-level way this part gets used); true analogWrite()
      // PWM brightness per channel is a natural fast-follow.
      const PIN_TO_PROP = { R: "ledRed", G: "ledGreen", B: "ledBlue" };
      for (const { ownPin, arduinoPin } of connections) {
        const prop = PIN_TO_PROP[ownPin];
        if (!prop) continue; // COM is the shared reference leg, not driven
        const loc = PIN_TO_PORT[arduinoPin];
        if (!loc || !ports[loc.port]) continue;
        const port = ports[loc.port];
        const listener = () => {
          comp.el[prop] = port.pinState(loc.bit) === PinState.High ? 1 : 0;
        };
        port.addListener(listener);
        comp.el[prop] = port.pinState(loc.bit) === PinState.High ? 1 : 0;
        boundVisuals.push({ el: comp.el, prop, resetValue: 0 });
      }
    } else if (comp.tag === "wokwi-servo") {
      for (const { arduinoPin } of connections) {
        const loc = PIN_TO_PORT[arduinoPin];
        if (!loc || !ports[loc.port]) continue;
        const port = ports[loc.port];
        let risingAtCycle = null;
        const listener = () => {
          const isHigh = port.pinState(loc.bit) === PinState.High;
          if (isHigh) {
            risingAtCycle = cpu.cycles;
            return;
          }
          if (risingAtCycle === null) return;
          const pulseUs = ((cpu.cycles - risingAtCycle) / CPU_HZ) * 1_000_000;
          risingAtCycle = null;
          const span = SERVO_MAX_PULSE_US - SERVO_MIN_PULSE_US;
          const angle = ((pulseUs - SERVO_MIN_PULSE_US) / span) * 180;
          comp.el.angle = Math.max(0, Math.min(180, angle));
        };
        port.addListener(listener);
        boundVisuals.push({ el: comp.el, prop: "angle", resetValue: 0 });
      }
    } else if (comp.tag === "wokwi-pushbutton") {
      for (const { arduinoPin } of connections) {
        const loc = PIN_TO_PORT[arduinoPin];
        if (!loc || !ports[loc.port]) continue; // the leg wired to GND, not the signal leg
        const port = ports[loc.port];
        // Idle HIGH, matching the standard pinMode(pin, INPUT_PULLUP) this
        // wiring implies — pressed pulls it LOW, exactly like a real button.
        port.setPin(loc.bit, true);
        const onPress = () => port.setPin(loc.bit, false);
        const onRelease = () => port.setPin(loc.bit, true);
        comp.el.addEventListener("button-press", onPress);
        comp.el.addEventListener("button-release", onRelease);
        eventListeners.push({ el: comp.el, type: "button-press", handler: onPress });
        eventListeners.push({ el: comp.el, type: "button-release", handler: onRelease });
      }
    } else if (comp.tag === "wokwi-slide-switch") {
      for (const { arduinoPin } of connections) {
        const loc = PIN_TO_PORT[arduinoPin];
        if (!loc || !ports[loc.port]) continue;
        const port = ports[loc.port];
        const applyState = () => port.setPin(loc.bit, !!comp.el.value);
        applyState();
        comp.el.addEventListener("input", applyState);
        eventListeners.push({ el: comp.el, type: "input", handler: applyState });
      }
    } else if (comp.tag === "wokwi-potentiometer") {
      if (!adc) continue;
      for (const { ownPin, arduinoPin } of connections) {
        if (ownPin !== "SIG") continue; // GND/VCC legs carry no signal of their own
        const channel = ANALOG_CHANNEL[arduinoPin];
        if (channel === undefined) continue; // wired to a non-analog pin — nothing we can feed
        const applyValue = () => {
          const range = comp.el.max - comp.el.min || 1;
          adc.channelValues[channel] = ((comp.el.value - comp.el.min) / range) * 5;
        };
        applyValue();
        comp.el.addEventListener("input", applyValue);
        eventListeners.push({ el: comp.el, type: "input", handler: applyValue });
      }
    } else if (comp.tag === "wokwi-photoresistor-sensor") {
      if (!adc) continue;
      for (const { ownPin, arduinoPin } of connections) {
        if (ownPin !== "AO") continue;
        const channel = ANALOG_CHANNEL[arduinoPin];
        if (channel === undefined) continue;
        // This part has no built-in interactive "light level" control
        // (unlike the potentiometer's draggable knob) — a fixed mid-range
        // reading is still a real ADC round-trip end to end, just not
        // adjustable by the student yet.
        adc.channelValues[channel] = 2.5;
      }
    }
  }

  return function unbind() {
    for (const { el, prop, resetValue } of boundVisuals) el[prop] = resetValue;
    for (const { el, type, handler } of eventListeners) el.removeEventListener(type, handler);
  };
}

// ---------------------------------------------------------------------
// Serial Monitor
// ---------------------------------------------------------------------

const MAX_SERIAL_LINES = 500; // a runaway loop shouldn't grow this panel forever

function clearSerialOutput() {
  const output = document.getElementById("serialOutput");
  if (output) output.innerHTML = '<span class="serial-placeholder">Waiting for Serial output…</span>';
  const dot = document.querySelector(".serial-dot");
  if (dot) dot.classList.remove("connected");
}

function appendSerialLine(text) {
  const output = document.getElementById("serialOutput");
  if (!output) return;
  const placeholder = output.querySelector(".serial-placeholder");
  if (placeholder) placeholder.remove();
  const dot = document.querySelector(".serial-dot");
  if (dot) dot.classList.add("connected");

  const line = document.createElement("div");
  line.textContent = text;
  output.appendChild(line);
  while (output.children.length > MAX_SERIAL_LINES) output.removeChild(output.firstChild);
  output.scrollTop = output.scrollHeight;
}

// ---------------------------------------------------------------------
// Toast — brief feedback for actions with no other visible result
// (copy/download), so "did that actually do anything?" has an answer.
// ---------------------------------------------------------------------

let toastTimer = null;
function showToast(message) {
  const toast = document.getElementById("labToast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2200);
}

// ---------------------------------------------------------------------
// Circuit copy / download / code export
// ---------------------------------------------------------------------

// The whole canvas as plain data: every placed part (its type, position,
// and flip/turn state — but not its live simulation state, which only
// exists while Running), every wire, and every breadboard placement.
// Doesn't include the code (Export .ino covers that separately) since a
// circuit and a sketch are useful to share independently of each other.
function serializeCircuit() {
  return {
    components: [...placedComponents.values()].map((c) => ({
      id: c.id,
      tag: c.tag,
      x: parseFloat(c.el.style.left) || 0,
      y: parseFloat(c.el.style.top) || 0,
      flipped: !!c.flipped,
      rotated180: !!c.rotated180,
      // Only ever meaningful for an LED, but harmless (just unused) to
      // write for anything else — keeps this one line instead of a
      // per-tag branch, and restoreCircuit already guards on tag anyway.
      color: c.el.color,
    })),
    wires: wires.map((w) => ({ id: w.id, from: w.from, to: w.to, color: w.color })),
    breadboardPlacements: [...breadboardPlacements.entries()],
  };
}

// Rebuilds the whole canvas from a serializeCircuit()-shaped snapshot —
// the one shared path behind project load, Save's autosave round-trip,
// and undo/redo (all three just need "make the canvas match this exact
// state"). Passing `id` through to placeComponent keeps every wire's
// componentId references valid across the rebuild instead of needing an
// old-id -> new-id remap.
async function restoreCircuit(snapshot) {
  suppressHistory = true;
  try {
    for (const comp of placedComponents.values()) comp.el.remove();
    placedComponents.clear();
    pinCircles.forEach((c) => c.remove());
    pinCircles.clear();
    wires.length = 0;
    breadboardPlacements.clear();
    selectedComponentIds.clear();
    selectedWireId = null;

    if (!snapshot || !snapshot.components || snapshot.components.length === 0) {
      // Nothing saved yet (a brand-new project, or an explicit "clear
      // everything" via undo past the start) — fall back to the same
      // starter circuit a first-ever visit gets.
      await seedDefaultCircuit();
    } else {
      for (const c of snapshot.components) {
        const comp = await placeComponent(c.tag, c.x, c.y, c.id);
        comp.flipped = !!c.flipped;
        comp.rotated180 = !!c.rotated180;
        if (comp.flipped || comp.rotated180) {
          applyComponentOrientation(comp);
          renderPins(comp.id);
        }
        if (c.tag === "wokwi-led" && c.color) comp.el.color = c.color;
      }
      for (const [key, holeKey] of snapshot.breadboardPlacements || []) {
        breadboardPlacements.set(key, holeKey);
      }
      for (const w of snapshot.wires || []) {
        wires.push({
          id: w.id || "wire-" + ++wireCounter,
          from: w.from,
          to: w.to,
          color: w.color || DEFAULT_WIRE_COLOR,
        });
        const num = parseInt(String(w.id || "").replace(/\D/g, ""), 10);
        if (!isNaN(num)) wireCounter = Math.max(wireCounter, num);
      }
    }

    redrawWires();
    applySelectionVisuals();
    renderSelectionToolbar();
    renderWireToolbar();
    if (canvasHint) canvasHint.style.display = placedComponents.size ? "none" : "";
  } finally {
    suppressHistory = false;
  }
}

// ---------------------------------------------------------------------
// Project persistence — autosave + reload. Reuses the exact same
// lab-type-agnostic endpoints (/labs/project/init, /labs/project/save)
// Web Lab and Blockly Lab already save through — no backend change
// needed. project_data holds { code, circuit: serializeCircuit() } so
// reopening the lab (or a crash/network drop mid-edit) restores both the
// sketch and the exact canvas, not just one or the other.
// ---------------------------------------------------------------------

let currentProjectId = null;
let autoSaveEnabled = false; // stays false until the very first load finishes — never autosave over a project we haven't actually loaded yet
let saveTimer = null;
let hasUnsavedChanges = false;

function setSaveStatus(text) {
  const el = document.getElementById("saveStatus");
  if (el) el.textContent = text;
}

// Debounced, like every other lab's autosave — a burst of edits (typing,
// several quick clicks) coalesces into one save a couple seconds after
// things go quiet, instead of a request per keystroke.
function scheduleAutoSave() {
  if (!autoSaveEnabled) return;
  hasUnsavedChanges = true;
  setSaveStatus("Saving…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveProject(false), 2000);
}

async function saveProject(manual) {
  if (!currentProjectId) return;
  const payload = {
    projectId: currentProjectId,
    projectData: {
      code: codeEditor ? codeEditor.getValue() : STARTER_SKETCH,
      circuit: serializeCircuit(),
    },
  };

  try {
    // OfflineSync (public/labs/js/offlineSync.js, the same script Web Lab
    // and Blockly Lab already load) queues this in localStorage and
    // replays it once connectivity is back, instead of just failing, if
    // the fetch can't reach the server at all — falls back to a plain
    // fetch if that script somehow didn't load.
    const data = window.OfflineSync
      ? await window.OfflineSync.saveOrQueue("/labs/project/save", payload, `arduino:${currentProjectId}`)
      : await (
          await fetch("/labs/project/save", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        ).json();

    hasUnsavedChanges = !!data.queued; // still "unsaved" from the server's point of view until it actually syncs
    setSaveStatus(data.queued ? "Saved offline — will sync" : data.success ? "Saved" : "Save failed");
    if (manual) {
      if (data.queued) showToast("📡 Offline — saved locally, will sync when back online");
      else if (data.success) showToast("💾 Project saved!");
      else showToast("Couldn't save — try again.");
    }
  } catch (err) {
    console.error("ARDUINO SAVE ERROR:", err);
    setSaveStatus("Save failed");
    if (manual) showToast("Couldn't save — try again.");
  }
}

// Loads (or creates, on a first-ever visit) this student's freeform
// Arduino project and rebuilds both the code editor and the canvas from
// it — the reload half of "don't lose progress": whatever was last
// autosaved (at most ~2s of edits behind) is exactly what comes back.
async function initArduinoProject() {
  try {
    const res = await fetch("/labs/project/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ labType: "arduino" }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message || "init failed");

    currentProjectId = data.project.id;
    const saved = data.project.project_data || {};
    if (codeEditor) codeEditor.setValue(saved.code || STARTER_SKETCH);
    await restoreCircuit(saved.circuit || null);
    setSaveStatus(saved.circuit ? "Loaded" : "Ready");
  } catch (err) {
    console.error("ARDUINO PROJECT INIT ERROR:", err);
    showToast("Couldn't load your saved project — starting fresh.");
    if (codeEditor) codeEditor.setValue(STARTER_SKETCH);
    await restoreCircuit(null);
    setSaveStatus("Ready");
  } finally {
    // Only ever flips on once, after the load above (success or fallback)
    // has actually finished settling the editor/canvas — otherwise
    // restoreCircuit's own DOM churn while loading could itself trigger
    // a premature autosave that overwrites what we just loaded with a
    // half-built canvas.
    autoSaveEnabled = true;
  }
}

// A student closing the tab mid-edit, before the ~2s autosave debounce
// has actually fired, is exactly the "network/device stops abruptly"
// case this is for — a native confirm dialog is the one thing that can
// still catch that window (nothing here can force a synchronous save on
// unload).
window.addEventListener("beforeunload", (e) => {
  if (!hasUnsavedChanges) return;
  e.preventDefault();
  e.returnValue = "";
});

// ---------------------------------------------------------------------
// Undo / redo — the circuit (canvas) side. The code editor has its own,
// separate undo/redo (Monaco's built-in Ctrl+Z/Ctrl+Y edit stack) — the
// two are deliberately independent, the same way most design tools keep
// "undo a shape edit" and "undo a text edit" as different stacks, so one
// never accidentally reverts the other.
//
// Snapshot-based rather than diff-based: serializeCircuit()/
// restoreCircuit() already exist for Save, and a full snapshot per step
// is cheap enough at this scale (a handful of parts in a teaching
// circuit, not hundreds — the same reasoning already used elsewhere in
// this file for redrawing every pin on every pan/zoom tick).
// ---------------------------------------------------------------------

const MAX_HISTORY = 50;
let undoStack = [];
let redoStack = [];
// Set around restoreCircuit's own body so loading a project, undoing,
// or redoing never records a *new* history entry for the rebuild it
// just performed — only real user edits should push onto the stack.
let suppressHistory = false;

function recordHistory() {
  if (suppressHistory) return;
  undoStack.push(serializeCircuit());
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack = []; // any new edit invalidates whatever redo history existed
  updateUndoRedoButtons();
}

async function undoCircuit() {
  if (!undoStack.length) return;
  const prev = undoStack.pop();
  redoStack.push(serializeCircuit());
  await restoreCircuit(prev);
  updateUndoRedoButtons();
  scheduleAutoSave();
}

async function redoCircuit() {
  if (!redoStack.length) return;
  const next = redoStack.pop();
  undoStack.push(serializeCircuit());
  await restoreCircuit(next);
  updateUndoRedoButtons();
  scheduleAutoSave();
}

function updateUndoRedoButtons() {
  const undoBtn = document.getElementById("undoBtn");
  const redoBtn = document.getElementById("redoBtn");
  if (undoBtn) undoBtn.disabled = undoStack.length === 0;
  if (redoBtn) redoBtn.disabled = redoStack.length === 0;
}

document.getElementById("undoBtn")?.addEventListener("click", undoCircuit);
document.getElementById("redoBtn")?.addEventListener("click", redoCircuit);

// Ctrl/Cmd+Z and Ctrl/Cmd+Y (or Shift+Z) drive the CIRCUIT's undo/redo —
// but only when focus isn't inside the code editor, so Monaco's own
// undo/redo keeps working exactly as a student would expect while
// they're actually typing code, instead of this document-level listener
// stealing the keystroke.
document.addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();
  if (key !== "z" && key !== "y") return;
  if (!(e.ctrlKey || e.metaKey)) return;
  const codeEditorEl = document.getElementById("arduinoCodeEditor");
  if (codeEditorEl && document.activeElement && codeEditorEl.contains(document.activeElement)) return;
  e.preventDefault();
  if (key === "y" || (key === "z" && e.shiftKey)) redoCircuit();
  else undoCircuit();
});

function downloadTextFile(filename, text, mimeType) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function copyCircuit() {
  const json = JSON.stringify(serializeCircuit(), null, 2);
  showToast((await copyTextToClipboard(json)) ? "Circuit copied to clipboard" : "Couldn't copy — clipboard access was blocked");
}

// Some browsers (older ones, locked-down/managed ones, and some automated
// contexts) block the async Clipboard API outright even with permission
// nominally granted — the classic execCommand fallback still works there,
// since it rides the same real user-gesture click this is always called
// from.
async function copyTextToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand("copy");
      textarea.remove();
      return ok;
    } catch (fallbackErr) {
      return false;
    }
  }
}

function downloadCircuit() {
  downloadTextFile("circuit.json", JSON.stringify(serializeCircuit(), null, 2), "application/json");
  showToast("Circuit downloaded");
}

function exportIno() {
  if (!codeEditor) return;
  downloadTextFile("sketch.ino", codeEditor.getValue(), "text/plain");
  showToast("sketch.ino downloaded");
}

document.getElementById("copyCircuitBtn")?.addEventListener("click", copyCircuit);
document.getElementById("downloadCircuitBtn")?.addEventListener("click", downloadCircuit);
document.getElementById("exportInoBtn")?.addEventListener("click", exportIno);

// ---------------------------------------------------------------------
// Image export (SVG/PNG/JPG/PDF) + copy-image-to-clipboard
// ---------------------------------------------------------------------
//
// Every placed part is a Shadow-DOM Lit web component (@wokwi/elements),
// and the standard "screenshot a DOM node" library this pulls in
// (html2canvas) is known to render an open shadow root as a blank box —
// it walks the light DOM only. Fixed here by recursively flattening
// every shadow root into ordinary light-DOM children first (inlining any
// adoptedStyleSheets — Lit's default, constructed-stylesheet style
// injection — as an explicit <style> tag, since those aren't part of the
// DOM tree at all and a plain clone would silently drop them), then
// handing html2canvas a shadow-free clone it can walk normally.
//
// This deliberately does NOT use the other classic technique — serialize
// the flattened tree into an SVG <foreignObject>, then Image+drawImage it
// onto a canvas — for the RASTER path: that traps the canvas as
// permanently "tainted" (toBlob/toDataURL/getImageData all throw
// SecurityError) in Chrome the instant a foreignObject-bearing SVG is
// drawn into it, even from a same-origin blob: URL with zero external
// references — a deliberate, undocumented-until-you-hit-it browser
// security policy specific to foreignObject, discovered empirically
// while building this (the very failure mode flagged as a risk to verify
// before committing to an approach). html2canvas never uses that trick —
// it manually repaints each element with canvas primitives — so its
// output stays exportable. The foreignObject+serializer approach is
// still used, but only for the SVG-file download below, where the
// output is plain text and a canvas is never involved.

// Recursively clones `node`, replacing any shadow root along the way
// with its real rendered content as plain children — the "flatten" both
// the html2canvas raster path and the SVG-file text path rely on.
//
// A custom element's clone can't just be `node.cloneNode(false)`, tag and
// all: once reattached to the document, a fresh <wokwi-led> (etc.) clone
// re-runs its OWN constructor/connectedCallback and builds a brand-new,
// empty shadow root of its own (Lit's normal element lifecycle) — which
// silently shadows whatever light-DOM children get appended here,
// rendering as nothing (discovered empirically: every flattened part
// measured 0x0 until this was in place). Swapping the outer tag for a
// plain, non-custom <div> avoids re-triggering that lifecycle entirely,
// carrying over the original's attributes so its inline position/size
// styles (set by placeComponent/renderPins) still apply.
let flattenHostCounter = 0;
function flattenShadowDom(node) {
  if (node.nodeType !== Node.ELEMENT_NODE) return node.cloneNode(false);

  const root = node.shadowRoot;
  const isCustomElement = node.tagName.includes("-");
  const clone = isCustomElement ? document.createElement("div") : node.cloneNode(false);
  if (isCustomElement) {
    for (const attr of node.attributes) clone.setAttribute(attr.name, attr.value);
  }

  if (root) {
    // The extracted CSS's `:host { ... }` rules used to size/display the
    // real custom element itself — meaningless text once flattened into
    // a plain div with no shadow root of its own, so a naive copy would
    // silently drop that sizing. Give the wrapper a unique class and
    // rewrite `:host` to target it directly instead.
    const hostClass = "flattened-host-" + ++flattenHostCounter;
    clone.classList.add(hostClass);
    for (const sheet of root.adoptedStyleSheets || []) {
      const styleEl = document.createElement("style");
      try {
        styleEl.textContent = [...sheet.cssRules]
          .map((r) => r.cssText)
          .join("\n")
          .replace(/:host\b/g, "." + hostClass);
      } catch (err) {
        // A cross-origin constructed sheet would throw reading cssRules —
        // never the case for anything this app creates, but harmless to
        // just skip rather than fail the whole export over it.
      }
      clone.appendChild(styleEl);
    }
    for (const child of root.childNodes) clone.appendChild(flattenShadowDom(child));
  } else {
    for (const child of node.childNodes) clone.appendChild(flattenShadowDom(child));
  }
  return clone;
}

// Shared crop/layout step for both export paths: temporarily resets
// pan/zoom to identity (so every position below is plain, unscaled
// screen pixels), measures the circuit's own bounding box (not the whole
// pannable canvas), and returns everything needed to place both the
// flattened components and the cloned wires into that cropped frame.
// Restores whatever pan/zoom the student had before returning.
async function measureCircuitForExport() {
  if (!placedComponents.size) return null;

  const savedZoom = viewZoom, savedPanX = viewPanX, savedPanY = viewPanY;
  viewZoom = 1;
  viewPanX = 0;
  viewPanY = 0;
  applyViewTransform();
  // Two rAFs: one for the transform reset to actually paint, one more so
  // every getBoundingClientRect() below reflects that painted layout —
  // a single rAF was observed to sometimes still read stale rects.
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  try {
    const PAD = 24;
    const canvasRect = canvas.getBoundingClientRect();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const comp of placedComponents.values()) {
      const r = comp.el.getBoundingClientRect();
      minX = Math.min(minX, r.left - canvasRect.left);
      minY = Math.min(minY, r.top - canvasRect.top);
      maxX = Math.max(maxX, r.right - canvasRect.left);
      maxY = Math.max(maxY, r.bottom - canvasRect.top);
    }
    minX -= PAD; minY -= PAD; maxX += PAD; maxY += PAD;
    const width = Math.max(1, Math.ceil(maxX - minX));
    const height = Math.max(1, Math.ceil(maxY - minY));

    const components = [...placedComponents.values()].map((comp) => {
      const r = comp.el.getBoundingClientRect();
      return { comp, left: r.left - canvasRect.left - minX, top: r.top - canvasRect.top - minY };
    });

    return { width, height, minX, minY, components };
  } finally {
    viewZoom = savedZoom;
    viewPanX = savedPanX;
    viewPanY = savedPanY;
    applyViewTransform();
  }
}

// Builds one self-contained SVG string of the current circuit — wires
// (drawn the same way they are live, minus the UI-only pin dots and
// rubber-band preview) under the flattened, shadow-DOM-inlined parts.
// Pure text output, downloaded as-is — never drawn into a canvas, so the
// foreignObject-taint issue above doesn't apply to this path at all.
async function captureCircuitSvg() {
  const layout = await measureCircuitForExport();
  if (!layout) return null;
  const { width, height, minX, minY, components } = layout;

  // Wires render above components live (.wire-overlay's z-index) — same
  // stacking here. Pin dots, hole highlights, and the rubber-band
  // preview are UI-only, not part of "a picture of my circuit".
  const wireLayer = document.createElementNS(SVG_NS, "g");
  wireLayer.setAttribute("transform", `translate(${-minX}, ${-minY})`);
  wireOverlay.querySelectorAll(".wire-path, .snap-stub").forEach((el) => {
    wireLayer.appendChild(el.cloneNode(true));
  });

  const compWrapper = document.createElement("div");
  compWrapper.style.position = "relative";
  compWrapper.style.width = width + "px";
  compWrapper.style.height = height + "px";
  for (const { comp, left, top } of components) {
    const flat = flattenShadowDom(comp.el);
    flat.style.position = "absolute";
    flat.style.left = left + "px";
    flat.style.top = top + "px";
    flat.style.margin = "0";
    compWrapper.appendChild(flat);
  }

  // XMLSerializer already writes compWrapper's own xmlns="...xhtml" (it's
  // a real HTML-namespaced element, serialized standalone) — an explicit
  // one here would double up into an invalid "attribute xmlns redefined"
  // document (hit this empirically before removing it).
  const serializer = new XMLSerializer();
  const svgMarkup =
    `<svg xmlns="${SVG_NS}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="100%" height="100%" fill="#e9ebee"/>` +
    `<foreignObject x="0" y="0" width="${width}" height="${height}">` +
    serializer.serializeToString(compWrapper) +
    `</foreignObject>` +
    serializer.serializeToString(wireLayer) +
    `</svg>`;

  return { svgMarkup, width, height };
}

// The raster path: same flattened-components + cloned-wires layout as
// above, but assembled as REAL (temporarily off-screen) DOM instead of a
// serialized string, and painted with html2canvas — which repaints each
// element with canvas primitives rather than embedding markup in an SVG
// image, so the output canvas is never tainted and toBlob/toDataURL work
// normally afterward.
async function captureCircuitCanvas() {
  const layout = await measureCircuitForExport();
  if (!layout) return null;
  if (!window.html2canvas) throw new Error("html2canvas failed to load");
  const { width, height, minX, minY, components } = layout;

  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-99999px"; // off-screen, but still really laid out — html2canvas needs real layout, not display:none
  container.style.top = "0";
  container.style.width = width + "px";
  container.style.height = height + "px";
  container.style.background = "#e9ebee";
  container.style.overflow = "hidden";

  for (const { comp, left, top } of components) {
    const flat = flattenShadowDom(comp.el);
    flat.style.position = "absolute";
    flat.style.left = left + "px";
    flat.style.top = top + "px";
    flat.style.margin = "0";
    container.appendChild(flat);
  }

  // Wires as a plain nested <svg> sibling, same stacking as live
  // (.wire-overlay paints above the components).
  const wireSvg = document.createElementNS(SVG_NS, "svg");
  wireSvg.setAttribute("width", String(width));
  wireSvg.setAttribute("height", String(height));
  wireSvg.style.position = "absolute";
  wireSvg.style.left = "0";
  wireSvg.style.top = "0";
  wireSvg.style.pointerEvents = "none";
  // Cloned wire-path/snap-stub `d` coordinates are in the ORIGINAL
  // (uncropped) canvas-local space — same offset the components above
  // already got via `left`/`top`, applied here as a transform instead
  // since these are raw <path> elements, not positioned boxes.
  const wireGroup = document.createElementNS(SVG_NS, "g");
  wireGroup.setAttribute("transform", `translate(${-minX}, ${-minY})`);
  wireOverlay.querySelectorAll(".wire-path, .snap-stub").forEach((el) => {
    wireGroup.appendChild(el.cloneNode(true));
  });
  wireSvg.appendChild(wireGroup);
  container.appendChild(wireSvg);

  document.body.appendChild(container);
  try {
    return await window.html2canvas(container, {
      backgroundColor: "#e9ebee",
      scale: 2,
      width,
      height,
      windowWidth: width,
      windowHeight: height,
      // html2canvas clones the whole document by default (for accurate
      // computed styles) — the Monaco editor's own DOM is enormous and
      // irrelevant to this capture, and skipping it cuts the "document
      // clone" step from ~20s to a couple seconds in testing.
      ignoreElements: (el) => el.id === "arduinoCodeEditor",
    });
  } finally {
    container.remove();
  }
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// No execCommand equivalent exists for images — unlike copyTextToClipboard
// above, this is Async Clipboard API only, and simply fails (caught,
// reported via the caller's toast) wherever that's unavailable/blocked.
async function copyImageBlobToClipboard(blob) {
  try {
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    return true;
  } catch (err) {
    return false;
  }
}

// Downloads the circuit as the chosen format AND copies a PNG snapshot
// to the clipboard in the same action (the user asked for both: a
// format picker for the download, and every export also landing on the
// clipboard so it can be pasted straight into a doc/chat without a
// separate step). SVG is the one format that never touches a canvas
// (captureCircuitSvg is plain text) — everything else goes through
// captureCircuitCanvas (html2canvas).
async function exportCircuitImage(format) {
  if (!placedComponents.size) {
    showToast("Nothing to export yet — place a component first");
    return;
  }
  showToast("Preparing image…");

  if (format === "svg") {
    let capture;
    try {
      capture = await captureCircuitSvg();
    } catch (err) {
      console.error("IMAGE EXPORT ERROR:", err);
      showToast("Couldn't generate the image.");
      return;
    }
    if (!capture) return;
    downloadBlob("circuit.svg", new Blob([capture.svgMarkup], { type: "image/svg+xml" }));
    // Still copy a PNG raster to clipboard per "every export also copies"
    // — best-effort, a failure here doesn't undo the download.
    let copied = false;
    try {
      const canvasEl = await captureCircuitCanvas();
      const pngBlob = canvasEl ? await new Promise((resolve) => canvasEl.toBlob(resolve, "image/png")) : null;
      copied = pngBlob ? await copyImageBlobToClipboard(pngBlob) : false;
    } catch (err) {
      console.error("IMAGE EXPORT (clipboard copy) ERROR:", err);
    }
    showToast("circuit.svg downloaded" + (copied ? " + copied to clipboard" : ""));
    return;
  }

  let canvasEl;
  try {
    canvasEl = await captureCircuitCanvas();
  } catch (err) {
    console.error("IMAGE EXPORT ERROR:", err);
    showToast("Couldn't generate the image.");
    return;
  }
  if (!canvasEl) return;
  const pngBlob = await new Promise((resolve) => canvasEl.toBlob(resolve, "image/png"));

  if (format === "jpg") {
    const jpgBlob = await new Promise((resolve) => canvasEl.toBlob(resolve, "image/jpeg", 0.95));
    if (jpgBlob) downloadBlob("circuit.jpg", jpgBlob);
  } else if (format === "pdf") {
    if (window.jspdf && pngBlob) {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({
        orientation: canvasEl.width >= canvasEl.height ? "landscape" : "portrait",
        unit: "px",
        format: [canvasEl.width, canvasEl.height],
      });
      doc.addImage(canvasEl.toDataURL("image/png"), "PNG", 0, 0, canvasEl.width, canvasEl.height);
      doc.save("circuit.pdf");
    } else {
      showToast("PDF export isn't available right now.");
      return;
    }
  } else {
    // png — the default when no format matched
    if (pngBlob) downloadBlob("circuit.png", pngBlob);
  }

  // Clipboard image copy is always the PNG raster (SVG/PDF aren't valid
  // clipboard image types in any browser's Async Clipboard API), best-
  // effort — a failure here doesn't undo the download that already
  // happened, just skips the "+ copied" half of the toast.
  const copied = pngBlob ? await copyImageBlobToClipboard(pngBlob) : false;
  showToast(`circuit.${format} downloaded` + (copied ? " + copied to clipboard" : ""));
}

// Standalone "copy image" — same raster path, but only ever copies,
// never downloads (the separate ask from the format-picker export
// above: a quick way to paste the circuit into a doc/chat without a
// file ending up in Downloads at all).
async function copyCircuitImage() {
  if (!placedComponents.size) {
    showToast("Nothing to copy yet — place a component first");
    return;
  }
  let canvasEl;
  try {
    canvasEl = await captureCircuitCanvas();
  } catch (err) {
    console.error("IMAGE COPY ERROR:", err);
    showToast("Couldn't generate the image.");
    return;
  }
  if (!canvasEl) return;
  const blob = await new Promise((resolve) => canvasEl.toBlob(resolve, "image/png"));
  const ok = blob ? await copyImageBlobToClipboard(blob) : false;
  showToast(ok ? "Circuit image copied to clipboard" : "Couldn't copy — clipboard access was blocked");
}

document.getElementById("copyImageBtn")?.addEventListener("click", copyCircuitImage);
document.querySelectorAll("[data-img-format]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.getElementById("imageExportMenu")?.setAttribute("hidden", "");
    exportCircuitImage(btn.dataset.imgFormat);
  });
});
document.getElementById("exportImageBtn")?.addEventListener("click", (e) => {
  e.stopPropagation();
  document.getElementById("imageExportMenu")?.toggleAttribute("hidden");
});
document.addEventListener("click", (e) => {
  const menu = document.getElementById("imageExportMenu");
  if (menu && !menu.hidden && !menu.contains(e.target) && e.target.id !== "exportImageBtn") {
    menu.setAttribute("hidden", "");
  }
});

// ---------------------------------------------------------------------
// Monaco editor
// ---------------------------------------------------------------------

require.config({
  paths: {
    vs: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/vs",
  },
});

const STARTER_SKETCH = `// An LED is already wired to pin 13 (and GND) on the canvas.
// Run it and watch the LED actually blink — drag more parts on and wire
// them to other pins to see the same thing happen for those too.

void setup() {
  pinMode(13, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  digitalWrite(13, HIGH);
  Serial.println("LED ON");
  delay(500);
  digitalWrite(13, LOW);
  Serial.println("LED OFF");
  delay(500);
}
`;

let codeEditor = null;

require(["vs/editor/editor.main"], function () {
  codeEditor = monaco.editor.create(document.getElementById("arduinoCodeEditor"), {
    value: STARTER_SKETCH,
    language: "cpp",
    automaticLayout: true,
    theme: "vs-dark",
    minimap: { enabled: false },
    fontSize: 15,
    wordWrap: "on",
    autoClosingBrackets: "always",
    autoClosingQuotes: "always",
    tabSize: 2,
  });

  document.getElementById("runBtn").addEventListener("click", runSketch);
  document.getElementById("stopBtn").addEventListener("click", stopSimulation);
  document.getElementById("saveBtn")?.addEventListener("click", () => saveProject(true));
  clearSerialOutput();
  initArduinoProject();

  // Any keystroke autosaves too, same as Web Lab's code editors — not
  // just circuit edits. codeEditor.setValue() calls (initial load, undo/
  // redo doesn't touch code, so the only other one is initArduinoProject
  // itself) also fire this event, but autoSaveEnabled is still false at
  // that point, so scheduleAutoSave() correctly no-ops for it.
  codeEditor.onDidChangeModelContent(() => scheduleAutoSave());
});

// ---------------------------------------------------------------------
// Status line
// ---------------------------------------------------------------------

function setStatus(message, kind) {
  const el = document.getElementById("arduinoStatus");
  if (!el) return;
  el.textContent = message;
  el.className = "arduino-status" + (kind ? " arduino-status--" + kind : "");
}

function setButtonsRunning(isRunning, isBusy) {
  const runBtn = document.getElementById("runBtn");
  const stopBtn = document.getElementById("stopBtn");
  runBtn.disabled = isRunning || isBusy;
  stopBtn.disabled = !isRunning;
}

// ---------------------------------------------------------------------
// Intel HEX -> program memory
// ---------------------------------------------------------------------

// avr8js's CPU wants program memory as a Uint16Array (word-addressed, the
// way AVR instructions actually are). ATmega328P has 32KB of flash.
function parseIntelHex(hexString) {
  const prog = new Uint8Array(32 * 1024);
  let extendedAddr = 0;

  for (const rawLine of hexString.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith(":")) continue;

    const byteCount = parseInt(line.substr(1, 2), 16);
    const address = parseInt(line.substr(3, 4), 16);
    const recordType = parseInt(line.substr(7, 2), 16);

    if (recordType === 1) break; // end-of-file record
    if (recordType === 4) {
      extendedAddr = parseInt(line.substr(9, 4), 16) << 16;
      continue;
    }
    if (recordType !== 0) continue; // only data records matter here

    for (let i = 0; i < byteCount; i++) {
      const byte = parseInt(line.substr(9 + i * 2, 2), 16);
      prog[extendedAddr + address + i] = byte;
    }
  }

  return new Uint16Array(prog.buffer, 0, prog.length / 2);
}

// ---------------------------------------------------------------------
// avr8js run loop
// ---------------------------------------------------------------------

const CPU_HZ = 16_000_000; // Uno's clock speed — the sketch's delay()/millis() math assumes this.
const MAX_FRAME_WALL_MS = 12; // guard rail so one batch can never jank the page

let avr8jsLoaderPromise = null;
function loadAvr8js() {
  if (!avr8jsLoaderPromise) {
    avr8jsLoaderPromise = import("https://cdn.jsdelivr.net/npm/avr8js@0.21.1/+esm");
  }
  return avr8jsLoaderPromise;
}

let simState = null; // { cpu, startWallMs, timeoutId, unbindComponents }

async function runSketch() {
  if (!codeEditor) return;
  stopSimulation(); // a stray previous run should never keep ticking underneath a new one

  setButtonsRunning(false, true);
  setStatus("Compiling...", "busy");

  let compileResult;
  try {
    const res = await fetch("/labs/arduino/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: codeEditor.getValue() }),
    });
    compileResult = await res.json();
  } catch (err) {
    setStatus("Couldn't reach the compiler — check your connection and try again.", "error");
    setButtonsRunning(false, false);
    return;
  }

  if (!compileResult.success) {
    setStatus(compileResult.error || "Compile failed.", "error");
    setButtonsRunning(false, false);
    return;
  }

  setStatus("Starting simulator...", "busy");

  let avr8js;
  try {
    avr8js = await loadAvr8js();
  } catch (err) {
    setStatus("Couldn't load the simulator — check your connection and try again.", "error");
    setButtonsRunning(false, false);
    return;
  }

  const {
    CPU, AVRIOPort, AVRTimer, AVRUSART, AVRADC, portBConfig, portCConfig, portDConfig,
    timer0Config, timer1Config, usart0Config, adcConfig, avrInstruction, PinState,
  } = avr8js;

  const progMem = parseIntelHex(compileResult.hex);
  const cpu = new CPU(progMem);
  // All three GPIO ports — a wired component could land on any of them
  // (digital pins 0-7 = PORTD, 8-13 = PORTB, A0-A5 = PORTC).
  const ports = {
    B: new AVRIOPort(cpu, portBConfig),
    C: new AVRIOPort(cpu, portCConfig),
    D: new AVRIOPort(cpu, portDConfig),
  };
  new AVRTimer(cpu, timer0Config); // required for delay()/millis() to ever advance
  // Arduino's Servo library doesn't touch Timer0 at all — it drives its
  // pulses off Timer1's own compare-match interrupt, entirely in the
  // background regardless of what loop() is doing. Without a Timer1
  // instance those registers are just inert memory: no interrupt ever
  // fires, no pulse ever appears on the pin, and the servo binding above
  // (which times whatever pulse IS there) sees nothing to measure.
  new AVRTimer(cpu, timer1Config);
  // Feeds analogRead() a real voltage per channel — see the potentiometer/
  // photoresistor branches in bindComponentsToSimulation below, which set
  // adc.channelValues[n] instead of toggling a pin like everything else.
  const adc = new AVRADC(cpu, adcConfig);

  clearSerialOutput();
  const usart = new AVRUSART(cpu, usart0Config, CPU_HZ);
  usart.onLineTransmit = (line) => appendSerialLine(line.replace(/\r$/, "")); // Serial.println sends "\r\n"

  const unbindComponents = bindComponentsToSimulation(cpu, ports, PinState, adc);

  simState = { cpu, startWallMs: performance.now(), timeoutId: null, unbindComponents };
  setButtonsRunning(true, false);
  setStatus("Running", "running");

  // Deliberately setTimeout, not requestAnimationFrame: rAF is throttled
  // (or stopped outright) whenever the page isn't actively painting — a
  // backgrounded/inactive tab in a real browser, or any headless run —
  // which starves this loop of ticks while wall-clock time (and the
  // sketch's own delay()/millis() math) keeps moving, so the simulation
  // falls further behind every frame and never catches up. setTimeout
  // keeps ticking regardless, and every wired component already updates
  // synchronously inside its own GPIO listener (bindComponentsToSimulation
  // above), so painting isn't tied to this timer either.
  function frame() {
    if (!simState) return;
    const frameStart = performance.now();
    const elapsedSimMs = frameStart - simState.startWallMs;
    const targetCycles = elapsedSimMs * (CPU_HZ / 1000);

    // performance.now() is cheap once, not thousands of times a batch —
    // calling it on every single simulated instruction (millions/sec) was
    // the actual bottleneck here, not the AVR emulation itself: checking
    // it only every 4096 instructions restores real throughput while still
    // capping how long one batch can ever block the page.
    let sinceCheck = 0;
    while (cpu.cycles < targetCycles) {
      avrInstruction(cpu);
      cpu.tick();
      if (++sinceCheck >= 4096) {
        sinceCheck = 0;
        if (performance.now() - frameStart > MAX_FRAME_WALL_MS) break;
      }
    }

    simState.timeoutId = setTimeout(frame, 0);
  }

  simState.timeoutId = setTimeout(frame, 0);
}

function stopSimulation() {
  if (simState) {
    if (simState.timeoutId) clearTimeout(simState.timeoutId);
    if (simState.unbindComponents) simState.unbindComponents();
  }
  simState = null;

  setButtonsRunning(false, false);
  setStatus("Stopped", "idle");
}
