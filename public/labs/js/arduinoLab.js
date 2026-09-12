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

// Dragging a part from the palette onto the canvas — deliberately built
// on Pointer Events (fires uniformly for mouse, touch, and pen) instead
// of the native HTML5 Drag and Drop API (dragstart/dragover/drop): that
// API has no touch support at all on iOS Safari and is inconsistent
// elsewhere on mobile, which is exactly why the whole lab was unusable
// by touch — this one implementation covers both input types instead of
// needing two separate code paths.
let paletteDragState = null; // { tag, ghost }

document.querySelectorAll(".component[data-type]").forEach((card) => {
  card.addEventListener("pointerdown", (e) => {
    if (e.button !== undefined && e.button !== 0) return; // left mouse button only; every touch/pen contact reports button 0
    const tag = card.dataset.type;
    if (!tag) return;
    e.preventDefault();

    // A floating copy of the card follows the pointer so there's a clear
    // "carrying this part" visual on touch, where there's no native
    // drag ghost image the way desktop drag-and-drop provides for free.
    const ghost = card.cloneNode(true);
    ghost.classList.add("palette-drag-ghost");
    ghost.style.width = card.offsetWidth + "px";
    document.body.appendChild(ghost);
    positionGhost(ghost, e.clientX, e.clientY);

    paletteDragState = { tag, ghost };
    lastPaletteDragY = e.clientY;
    paletteAutoScrollInterval = setInterval(runPaletteAutoScrollTick, 16);
    document.addEventListener("pointermove", onPaletteDragMove);
    document.addEventListener("pointerup", onPaletteDragEnd);
  });
});

function positionGhost(ghost, clientX, clientY) {
  ghost.style.left = clientX - ghost.offsetWidth / 2 + "px";
  ghost.style.top = clientY - ghost.offsetHeight / 2 + "px";
}

// How close to the top/bottom viewport edge a drag needs to get before
// the page auto-scrolls — without this, on a short/mobile viewport
// where the palette and the canvas aren't both visible at once (very
// possible once scrolled: found via testing that they genuinely can't
// fit together on a real tablet-height screen), a card and its drop
// target could never both be reachable within one continuous touch
// gesture — there's no other way to scroll mid-drag.
const AUTOSCROLL_EDGE_PX = 70;
const AUTOSCROLL_SPEED = 14;
let paletteAutoScrollInterval = null;
let lastPaletteDragY = null;

function onPaletteDragMove(e) {
  if (!paletteDragState) return;
  positionGhost(paletteDragState.ghost, e.clientX, e.clientY);
  lastPaletteDragY = e.clientY;
}

// Runs on a fixed interval (not per pointermove) so holding the finger
// steady near an edge keeps scrolling — a real finger held still, or a
// simulated one at the exact same coordinate, generates no further
// pointermove events at all, so tying this to pointermove alone would
// only scroll while the finger is ALSO actively wiggling.
function runPaletteAutoScrollTick() {
  if (lastPaletteDragY === null) return;
  // document.body specifically — not window.scrollBy/scrollingElement,
  // which both resolve to documentElement (<html>) here. This page's
  // base stylesheet sets `overflow: auto` on BOTH html and body, and in
  // the stacked mobile layout BODY ends up as the element that actually
  // scrolls (confirmed via testing: html's own scrollHeight matched the
  // viewport exactly — nothing to scroll there — while body's didn't,
  // and setting body.scrollTop directly moved the page; scrollingElement
  // is supposed to name whichever one is real, but resolves to html
  // unconditionally in standards mode regardless of which one actually
  // has the overflow, so it isn't reliable for this specific page).
  const scroller = document.body;
  if (lastPaletteDragY < AUTOSCROLL_EDGE_PX) {
    scroller.scrollTop -= AUTOSCROLL_SPEED;
  } else if (lastPaletteDragY > window.innerHeight - AUTOSCROLL_EDGE_PX) {
    scroller.scrollTop += AUTOSCROLL_SPEED;
  }
}

async function onPaletteDragEnd(e) {
  document.removeEventListener("pointermove", onPaletteDragMove);
  document.removeEventListener("pointerup", onPaletteDragEnd);
  clearInterval(paletteAutoScrollInterval);
  paletteAutoScrollInterval = null;
  lastPaletteDragY = null;
  if (!paletteDragState) return;
  const { tag, ghost } = paletteDragState;
  paletteDragState = null;
  ghost.remove();

  const canvasRect = canvas.getBoundingClientRect();
  const droppedOnCanvas =
    e.clientX >= canvasRect.left && e.clientX <= canvasRect.right && e.clientY >= canvasRect.top && e.clientY <= canvasRect.bottom;
  if (!droppedOnCanvas) return; // released over the palette/topbar/etc — cancel, same as a native drag released outside a drop target
  // The breadboard is the one draggable type that isn't a real @wokwi/
  // elements custom element (see "Breadboard" below), so it's exempt
  // from the "is the CDN bundle actually loaded" check every other tag
  // needs.
  if (tag !== "custom-breadboard" && !customElements.get(tag)) return;

  // Convert the drop's screen position into #canvasViewport's own local
  // (pre-transform) coordinate space — undo the pan, then undo the zoom.
  const localX = (e.clientX - canvasRect.left - viewPanX) / viewZoom;
  const localY = (e.clientY - canvasRect.top - viewPanY) / viewZoom;
  recordHistory(); // before the change — undo goes back to "not placed yet"
  await placeComponent(tag, localX, localY);
  scheduleAutoSave();
}

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

// The palette is admin-curated data now (any @wokwi/elements tag can be
// added from /admin/arduino-components), not a fixed hand-authored list
// — a per-tag CSS scale rule (the old approach) would mean every newly
// added part needs a matching code change just to render at a sane size
// in its 56x44 preview box, which is exactly how the DHT22 preview
// shipped badly oversized before this existed. Measures each card's
// real part at its native (unscaled) size and sets its own inline scale
// instead — works for any tag automatically, present or future.
async function autoScalePreviews() {
  const PADDING = 6;
  for (const preview of document.querySelectorAll(".component-preview")) {
    const el = preview.firstElementChild;
    if (!el) continue;
    if (el.updateComplete) await el.updateComplete; // Lit components render asynchronously — measuring too early can catch a zero-size box
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    const availableW = preview.clientWidth - PADDING;
    const availableH = preview.clientHeight - PADDING;
    // Capped at 1 — shrink an oversized part down to fit, but never
    // magnify one that's already smaller than the box (matches every
    // hand-picked scale factor this replaces, none of which exceeded 1).
    const scale = Math.min(availableW / rect.width, availableH / rect.height, 1);
    el.style.transform = `scale(${scale})`;
  }
}
autoScalePreviews();

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
      circle.addEventListener("pointerdown", onPinPointerDown);
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
// need any canvas-space math at all). Also triggered from a touch tap
// (onPinPointerDown), which has no real "hover" to key off — see the
// auto-hide timer this variable tracks there.
let pinTooltipTouchTimer;
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
  el.addEventListener("pointerdown", (e) => {
    // Pin circles live in the separate SVG overlay, not inside `el` — a
    // pointerdown reaching here is always on the component's own body.
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
      // Pointer movement is in real screen pixels; el.style.left/top are
      // in #canvasViewport's local (pre-zoom) units, so the delta needs
      // dividing by the current zoom to move the part exactly as far as
      // the cursor/finger, regardless of how zoomed in/out the view is.
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
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
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
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
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
  redrawWires(); // a selected wire's thicker "selected" stroke otherwise lingers until the next unrelated redraw
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

  const soleId = selectedComponentIds.size === 1 ? [...selectedComponentIds][0] : null;
  const soleComp = soleId ? placedComponents.get(soleId) : null;

  const colorRow = document.getElementById("componentColorRow");
  if (colorRow) {
    colorRow.hidden = !(soleComp && soleComp.tag === "wokwi-led");
  }

  const sensorRow = document.getElementById("componentSensorRow");
  if (sensorRow) {
    const isNoUiSensor = !!(soleComp && NO_UI_SENSOR_TAGS.includes(soleComp.tag));
    sensorRow.hidden = !isNoUiSensor;
    if (isNoUiSensor) {
      const triggered = !!soleComp.sensorTriggered;
      sensorRow.classList.toggle("sensor-row--triggered", triggered);
      const btn = sensorRow.querySelector("button");
      if (btn) btn.textContent = triggered ? "⚡ Triggered — click to reset" : "◯ Idle — click to trigger";
    }
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
  if (NO_UI_SENSOR_TAGS.includes(source.tag)) clone.sensorTriggered = source.sensorTriggered;
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

document.getElementById("componentToolbar")?.addEventListener("pointerdown", (e) => {
  // Stop this reaching the canvas's own pan-drag listener — clicking/
  // tapping a toolbar button is not a click on empty canvas background.
  e.stopPropagation();
});
document.getElementById("componentToolbar")?.addEventListener("click", (e) => {
  const sensorBtn = e.target.closest("button[data-sensor-toggle]");
  if (sensorBtn) {
    const soleId = selectedComponentIds.size === 1 ? [...selectedComponentIds][0] : null;
    const soleComp = soleId ? placedComponents.get(soleId) : null;
    if (soleComp && NO_UI_SENSOR_TAGS.includes(soleComp.tag)) {
      recordHistory();
      soleComp.sensorTriggered = !soleComp.sensorTriggered;
      // Same event-driven shape every other input device binding already
      // uses (slide-switch's "input", pushbutton's "button-press") — lets
      // bindComponentsToSimulation react live without polling.
      soleComp.el.dispatchEvent(new CustomEvent("sensor-value-change"));
      renderSelectionToolbar();
      scheduleAutoSave();
    }
    return;
  }
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

function onPinPointerDown(e) {
  e.preventDefault();
  e.stopPropagation(); // don't also trigger the canvas's own pan-drag below
  // Touch has no hover state to show the pin-name tooltip the way mouse
  // hover does below — a tap briefly peeks it instead, auto-hiding so it
  // doesn't just sit there through the drag that (usually) follows.
  if (e.pointerType === "touch") {
    onPinHoverEnter(e);
    clearTimeout(pinTooltipTouchTimer);
    pinTooltipTouchTimer = setTimeout(onPinHoverLeave, 1500);
  }

  const fromComponentId = e.target.dataset.componentId;
  const fromPin = e.target.dataset.pinName;
  const from = getPinCanvasPos(fromComponentId, fromPin);
  if (!from) return;

  const rubberPath = document.createElementNS(SVG_NS, "path");
  rubberPath.setAttribute("class", "wire-rubberband");
  wireOverlay.appendChild(rubberPath);

  pendingWire = { fromComponentId, fromPin, from, rubberPath };
  document.addEventListener("pointermove", onWireDragMove);
  document.addEventListener("pointerup", onWireDragEnd);
}

function onWireDragMove(e) {
  if (!pendingWire) return;
  const canvasRect = canvas.getBoundingClientRect();
  const to = { x: e.clientX - canvasRect.left, y: e.clientY - canvasRect.top };
  pendingWire.rubberPath.setAttribute("d", wirePath(pendingWire.from, to));
}

function onWireDragEnd(e) {
  document.removeEventListener("pointermove", onWireDragMove);
  document.removeEventListener("pointerup", onWireDragEnd);
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
    waypoints: [], // user-added bend points for manual routing — see "Wire waypoints" below
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

document.getElementById("wireToolbar")?.addEventListener("pointerdown", (e) => e.stopPropagation());
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
  wireOverlay.querySelectorAll(".wire-path, .snap-stub, .wire-node").forEach((p) => p.remove());
  for (const wire of wires) {
    const from = getPinCanvasPos(wire.from.componentId, wire.from.pin);
    const to = getPinCanvasPos(wire.to.componentId, wire.to.pin);
    if (!from || !to) continue; // the component it referenced is gone

    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", wirePath(from, to, wire.waypoints));
    path.setAttribute("class", "wire-path" + (wire.id === selectedWireId ? " wire-path--selected" : ""));
    path.setAttribute("stroke", wire.color || DEFAULT_WIRE_COLOR);
    path.addEventListener("click", (e) => {
      e.stopPropagation();
      selectWire(wire.id);
    });
    // Double-click/double-tap anywhere along the wire adds a bend point
    // there, letting the routing be dragged around an obstacle instead
    // of being stuck with whichever global curved/straight/orthogonal
    // mode is active — see "Wire waypoints" below. Uses the ONE shared
    // detector instance (defined once, not per redraw) so its "saw one
    // tap" memory survives the redraw the first tap's own click-to-
    // select triggers, right before the second tap arrives.
    path.addEventListener("pointerup", (e) => detectWirePathDoubleTap(e, wire));
    // Insert before any existing child so wires always render under pins.
    wireOverlay.insertBefore(path, wireOverlay.firstChild);

    // Bend-point handles — only for the selected wire, so an unselected
    // circuit's overlay doesn't get cluttered with every wire's nodes.
    if (wire.id === selectedWireId && wire.waypoints) {
      for (let i = 0; i < wire.waypoints.length; i++) {
        wireOverlay.appendChild(createWireNodeHandle(wire, i));
      }
    }
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
// wireRoutingMode, UNLESS the wire has user-added waypoints, in which
// case it's routed as straight segments through every point in order
// (from -> each waypoint -> to) instead — manual routing means exact
// control, not "curved except where you added a bend". Also used for
// the rubber-band preview while dragging a new wire (no waypoints yet),
// so the preview matches what will actually be drawn.
function wirePath(from, to, waypoints) {
  if (waypoints && waypoints.length) {
    const points = [from, ...waypoints.map((wp) => canvasLocalToScreen(wp.x, wp.y)), to];
    return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  }
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

// ---------------------------------------------------------------------
// Wire waypoints — user-added bend points for manual routing, dragged
// around a component instead of being stuck with the global curved/
// straight/orthogonal routing mode. Stored in the SAME "canvasViewport-
// local, pre pan/zoom" units placed components use (comp.el.style.left/
// top) — NOT the screen-pixel units wire paths themselves are drawn in —
// so a waypoint stays visually put on the circuit as you pan and zoom,
// exactly like every placed part already does. The two helpers below
// convert between the two spaces; the formulas mirror the canvas drop
// handler (screen -> local) and getPinCanvasPos (local -> screen, via
// each pin's own already-transformed elRect).
// ---------------------------------------------------------------------

// dblclick's synthetic double-click from a touch tap is unreliable —
// some browsers never fire it from touch at all. This hand-rolls double-
// tap/double-click detection directly off pointerup timing and position
// instead, working identically for mouse and touch: returns a pointerup
// listener that calls `handler(event)` only on the SECOND tap of a pair
// landing close together in time and space.
function createDoubleTapDetector(handler) {
  let lastTime = 0;
  let lastX = 0;
  let lastY = 0;
  // Extra args (e.g. which wire was tapped) are threaded through to the
  // handler so the CALLER doesn't need its own closure per element —
  // matters here specifically because redrawWires() fully recreates
  // every wire-path element (and thus any listener closure attached to
  // it) on every redraw, including the one triggered by the first tap's
  // own click-to-select — a per-element detector instance would lose
  // its "saw one tap" memory before the second tap ever arrived. Using
  // ONE shared, module-scope detector instance (below) for all wires
  // keeps that memory alive across the redraw in between.
  return (e, ...args) => {
    const now = Date.now();
    const isDouble = now - lastTime < 400 && Math.hypot(e.clientX - lastX, e.clientY - lastY) < 20;
    lastTime = isDouble ? 0 : now; // reset so a triple-tap doesn't chain into a second "double"
    lastX = e.clientX;
    lastY = e.clientY;
    if (isDouble) handler(e, ...args);
  };
}

// One shared instance (not created fresh per wire/per redraw) — see the
// comment above for why that matters here specifically.
const detectWirePathDoubleTap = createDoubleTapDetector((e, wire) => {
  e.stopPropagation();
  addWireWaypoint(wire, e);
});

// A stationary tap on a wire-node handle currently doesn't itself
// trigger a redraw (unlike tapping a wire, which also selects it), so
// this one wouldn't strictly need to be shared/module-scope to survive
// to a second tap — kept that way anyway for consistency with the one
// above, and so it stays correct if that ever changes.
const detectWireNodeDoubleTap = createDoubleTapDetector((e, wire, index) => {
  removeWireWaypoint(wire, index);
});

function canvasLocalToScreen(localX, localY) {
  return { x: viewPanX + localX * viewZoom, y: viewPanY + localY * viewZoom };
}

function screenToCanvasLocal(screenX, screenY) {
  return { x: (screenX - viewPanX) / viewZoom, y: (screenY - viewPanY) / viewZoom };
}

// Inserts a new bend point at the double-clicked position, in the
// correct order along the wire — found by checking which consecutive
// pair of existing points (from/waypoints/to) the click landed closest
// to, so adding a node partway along a long wire doesn't scramble the
// routing order.
function addWireWaypoint(wire, mouseEvent) {
  const from = getPinCanvasPos(wire.from.componentId, wire.from.pin);
  const to = getPinCanvasPos(wire.to.componentId, wire.to.pin);
  if (!from || !to) return;

  const canvasRect = canvas.getBoundingClientRect();
  const clickScreen = { x: mouseEvent.clientX - canvasRect.left, y: mouseEvent.clientY - canvasRect.top };

  const existingScreen = (wire.waypoints || []).map((wp) => canvasLocalToScreen(wp.x, wp.y));
  const orderedPoints = [from, ...existingScreen, to];

  // Distance from a point to a line SEGMENT (not the infinite line) —
  // picks the nearest segment the click could plausibly belong to.
  function distToSegment(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
    const projX = a.x + t * dx, projY = a.y + t * dy;
    return Math.hypot(p.x - projX, p.y - projY);
  }

  let bestSegment = 0;
  let bestDist = Infinity;
  for (let i = 0; i < orderedPoints.length - 1; i++) {
    const d = distToSegment(clickScreen, orderedPoints[i], orderedPoints[i + 1]);
    if (d < bestDist) {
      bestDist = d;
      bestSegment = i;
    }
  }

  recordHistory();
  if (!wire.waypoints) wire.waypoints = [];
  wire.waypoints.splice(bestSegment, 0, screenToCanvasLocal(clickScreen.x, clickScreen.y));
  redrawWires();
  scheduleAutoSave();
}

function removeWireWaypoint(wire, index) {
  recordHistory();
  wire.waypoints.splice(index, 1);
  redrawWires();
  scheduleAutoSave();
}

// A small draggable handle circle at one waypoint — single-drag to
// reroute, double-click to remove. Not reusing the pin-circle machinery
// (renderPins/pinCircles) since these aren't electrical connection
// points, just routing control points.
function createWireNodeHandle(wire, index) {
  const wp = wire.waypoints[index];
  const screen = canvasLocalToScreen(wp.x, wp.y);
  const handle = document.createElementNS(SVG_NS, "circle");
  handle.setAttribute("cx", screen.x);
  handle.setAttribute("cy", screen.y);
  handle.setAttribute("r", 5);
  handle.setAttribute("class", "wire-node");

  // Drag-to-move and double-tap-to-remove share one pointerdown/up flow
  // (rather than a separate dblclick listener, which doesn't reliably
  // fire from a touch tap) — a plain tap (no drag) checks the shared
  // double-tap detector; an actual drag moves the point instead.
  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    let dragged = false;
    const onMove = (moveEvent) => {
      // recordHistory() lazily on the first real move only — same
      // convention as attachComponentDrag: one undo step per whole drag
      // gesture, capturing the state as it was BEFORE this move started.
      if (!dragged) recordHistory();
      dragged = true;
      const canvasRect = canvas.getBoundingClientRect();
      const local = screenToCanvasLocal(moveEvent.clientX - canvasRect.left, moveEvent.clientY - canvasRect.top);
      wire.waypoints[index] = local;
      redrawWires();
      renderWireToolbar();
    };
    const onUp = (upEvent) => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      if (dragged) scheduleAutoSave();
      else detectWireNodeDoubleTap(upEvent, wire, index);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  });

  return handle;
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

canvas.addEventListener("pointerdown", (e) => {
  if (e.target !== canvas && e.target !== canvasViewport) return; // touched a component/pin, not empty space
  panState = { startClientX: e.clientX, startClientY: e.clientY, startPanX: viewPanX, startPanY: viewPanY, moved: false };
  canvas.classList.add("panning");
  document.addEventListener("pointermove", onCanvasPanMove);
  document.addEventListener("pointerup", onCanvasPanUp);
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
  // A pointerdown+pointerup on empty canvas with no real movement in
  // between is a plain click/tap — deselect, same as clicking empty
  // space in any other design tool, rather than leaving a toolbar stuck
  // open.
  if (panState && !panState.moved) deselectAll();
  panState = null;
  canvas.classList.remove("panning");
  document.removeEventListener("pointermove", onCanvasPanMove);
  document.removeEventListener("pointerup", onCanvasPanUp);
}

// The above only covers a click/tap landing on EMPTY CANVAS background —
// clicking anywhere else on the page (the component palette, the code
// editor, the topbar, the serial monitor) never reached it at all, so
// the selection toolbar stayed stuck open no matter where else you
// clicked. This is the actual "click outside closes it" behavior,
// covering the rest of the page in one place rather than wiring a
// deselect call into every other clickable panel individually.
document.addEventListener("pointerdown", (e) => {
  if (canvas.contains(e.target)) return; // canvas has its own handling above (including toolbars, which live inside it)
  if (selectedComponentIds.size === 0 && !selectedWireId) return;
  deselectAll();
});

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

// These seven parts expose ZERO interactive control in @wokwi/elements at
// all — confirmed against each one's actual source (PIRMotionSensorElement,
// FlameSensorElement, GasSensorElement, SmallSoundSensorElement,
// BigSoundSensorElement, HeartBeatSensorElement, TiltSwitchElement): pure
// static SVG, no reactive properties, no click handlers, nothing. The
// selection toolbar's "Idle / Triggered" toggle (componentSensorRow in
// editor.ejs, wired up in renderSelectionToolbar/the toolbar click handler
// below) is a control this app adds itself for exactly these tags, so a
// student can still test their code against both states even though the
// underlying part gives them no way to change its reading.
const NO_UI_SENSOR_TAGS = [
  "wokwi-pir-motion-sensor",
  "wokwi-flame-sensor",
  "wokwi-gas-sensor",
  "wokwi-small-sound-sensor",
  "wokwi-big-sound-sensor",
  "wokwi-heart-beat-sensor",
  "wokwi-tilt-switch",
];

// Both boards are the same ATmega328P chip with identical Arduino
// silkscreen pin names ("0"-"13", "A0"-"A5") — confirmed directly against
// @wokwi/elements' ArduinoNanoElement pinInfo, not assumed — so every
// binding below already works for a Nano-only circuit for free once it's
// recognized here as "the board" at all.
const BOARD_TAGS = ["wokwi-arduino-uno", "wokwi-arduino-nano"];

function findArduinoComponent() {
  for (const comp of placedComponents.values()) {
    if (BOARD_TAGS.includes(comp.tag)) return comp;
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
// needed for the analog parts; `i2cDevices` is the shared registry any
// I2C part (SSD1306/DS1307/MPU6050) pushes its own {address, onConnect,
// onWrite, onRead} device object into — see the AVRTWI eventHandler set
// up in runSketch, which dispatches real Wire.h traffic to whichever
// entry here matches the address the sketch actually addressed.
function bindComponentsToSimulation(cpu, ports, PinState, adc, i2cDevices) {
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
    } else if (comp.tag === "wokwi-pushbutton" || comp.tag === "wokwi-pushbutton-6mm") {
      // The 6mm tactile button dispatches the exact same button-press/
      // button-release events as the full-size pushbutton (confirmed
      // against @wokwi/elements' Pushbutton6mmElement source) — same
      // binding, just a second tag recognized by it.
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
    } else if (comp.tag === "wokwi-potentiometer" || comp.tag === "wokwi-slide-potentiometer") {
      // The slide variant exposes the identical SIG/min/max/value contract
      // and fires the same "input" event (confirmed against
      // @wokwi/elements' SlidePotentiometerElement source) — a drop-in
      // second tag for the exact same binding.
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
    } else if (comp.tag === "wokwi-photoresistor-sensor" || comp.tag === "wokwi-ntc-temperature-sensor") {
      // Neither part has an interactive "light level"/"temperature"
      // control on the element itself (unlike the potentiometer's
      // draggable knob) — a fixed mid-range reading is still a real ADC
      // round-trip end to end, just not adjustable by the student yet.
      if (!adc) continue;
      const pinName = comp.tag === "wokwi-photoresistor-sensor" ? "AO" : "OUT";
      for (const { ownPin, arduinoPin } of connections) {
        if (ownPin !== pinName) continue;
        const channel = ANALOG_CHANNEL[arduinoPin];
        if (channel === undefined) continue;
        adc.channelValues[channel] = 2.5;
      }
    } else if (comp.tag === "wokwi-analog-joystick") {
      // VERT/HORZ are analog axes (xValue/yValue, -1..1, "input" event);
      // SEL is a plain digital pushbutton — identical button-press/
      // button-release contract to the standalone pushbutton above.
      // Confirmed against @wokwi/elements' AnalogJoystickElement source.
      if (adc) {
        for (const { ownPin, arduinoPin } of connections) {
          const axisProp = ownPin === "VERT" ? "yValue" : ownPin === "HORZ" ? "xValue" : null;
          if (!axisProp) continue;
          const channel = ANALOG_CHANNEL[arduinoPin];
          if (channel === undefined) continue;
          const applyValue = () => {
            adc.channelValues[channel] = ((comp.el[axisProp] + 1) / 2) * 5;
          };
          applyValue();
          comp.el.addEventListener("input", applyValue);
          eventListeners.push({ el: comp.el, type: "input", handler: applyValue });
        }
      }
      for (const { ownPin, arduinoPin } of connections) {
        if (ownPin !== "SEL") continue;
        const loc = PIN_TO_PORT[arduinoPin];
        if (!loc || !ports[loc.port]) continue;
        const port = ports[loc.port];
        port.setPin(loc.bit, true);
        const onPress = () => port.setPin(loc.bit, false);
        const onRelease = () => port.setPin(loc.bit, true);
        comp.el.addEventListener("button-press", onPress);
        comp.el.addEventListener("button-release", onRelease);
        eventListeners.push({ el: comp.el, type: "button-press", handler: onPress });
        eventListeners.push({ el: comp.el, type: "button-release", handler: onRelease });
      }
    } else if (comp.tag === "wokwi-dip-switch-8") {
      // Eight independent switches, pin-named "1a".."8a" paired with
      // "1b".."8b" (confirmed against @wokwi/elements' DipSwitch8Element
      // source). Same simplified model as the single slide switch above —
      // each switch directly drives its own "Na" leg's digital level, not
      // full continuity through to whatever "Nb" is wired to (this app
      // doesn't model wire continuity *through* a component anywhere
      // else either). Re-applied to all bound legs on any single toggle,
      // since one "switch-change" event doesn't say which pin listeners
      // to skip.
      const bound = [];
      for (const { ownPin, arduinoPin } of connections) {
        const match = /^(\d)a$/.exec(ownPin);
        if (!match) continue; // the "Nb" legs carry no signal of their own
        const loc = PIN_TO_PORT[arduinoPin];
        if (!loc || !ports[loc.port]) continue;
        bound.push({ index: Number(match[1]) - 1, port: ports[loc.port], bit: loc.bit });
      }
      if (bound.length) {
        const applyAll = () => {
          for (const { index, port, bit } of bound) port.setPin(bit, !!comp.el.values[index]);
        };
        applyAll();
        comp.el.addEventListener("switch-change", applyAll);
        eventListeners.push({ el: comp.el, type: "switch-change", handler: applyAll });
      }
    } else if (comp.tag === "wokwi-led-bar-graph") {
      // Ten independent LEDs, each with its own anode pin A1-A10 (paired
      // cathode legs C1-C10 carry no signal of their own) — same
      // pin-per-property idea as the RGB LED above, just ten of them.
      // `values` is a Lit array property: mutating an index in place
      // doesn't trigger a re-render, only reassigning the array does, so
      // every listener below writes a fresh array back.
      const values = comp.el.values.slice();
      let touched = false;
      for (const { ownPin, arduinoPin } of connections) {
        const match = /^A(\d+)$/.exec(ownPin);
        if (!match) continue;
        const index = Number(match[1]) - 1;
        if (index < 0 || index >= values.length) continue;
        const loc = PIN_TO_PORT[arduinoPin];
        if (!loc || !ports[loc.port]) continue;
        const port = ports[loc.port];
        touched = true;
        const listener = () => {
          values[index] = port.pinState(loc.bit) === PinState.High ? 1 : 0;
          comp.el.values = values.slice();
        };
        port.addListener(listener);
        values[index] = port.pinState(loc.bit) === PinState.High ? 1 : 0;
      }
      if (touched) {
        comp.el.values = values.slice();
        boundVisuals.push({ el: comp.el, prop: "values", resetValue: values.map(() => 0) });
      }
    } else if (comp.tag === "wokwi-7segment") {
      // Segment pins A-G plus the decimal point, in the same order as the
      // `values` array (confirmed against @wokwi/elements'
      // SevenSegmentElement source — the default single-digit pinout;
      // the multi-digit variants' per-digit multiplexing isn't modeled).
      const SEGMENT_INDEX = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, DP: 7 };
      const values = comp.el.values.slice();
      let touched = false;
      for (const { ownPin, arduinoPin } of connections) {
        const index = SEGMENT_INDEX[ownPin];
        if (index === undefined) continue; // the COM legs carry no signal of their own
        const loc = PIN_TO_PORT[arduinoPin];
        if (!loc || !ports[loc.port]) continue;
        const port = ports[loc.port];
        touched = true;
        const listener = () => {
          values[index] = port.pinState(loc.bit) === PinState.High ? 1 : 0;
          comp.el.values = values.slice();
        };
        port.addListener(listener);
        values[index] = port.pinState(loc.bit) === PinState.High ? 1 : 0;
      }
      if (touched) {
        comp.el.values = values.slice();
        boundVisuals.push({ el: comp.el, prop: "values", resetValue: values.map(() => 0) });
      }
    } else if (comp.tag === "wokwi-hc-sr04") {
      // Real single-wire-per-pin ultrasonic protocol: the sketch pulses
      // TRIG high for >=10us, and the sensor replies with an ECHO pulse
      // whose WIDTH (not level) encodes distance — duration_us ≈
      // distance_cm * 58 (round trip at the speed of sound), the exact
      // formula every real HC-SR04 tutorial's code already assumes. No
      // interactive "distance" control exists on this part at all
      // (confirmed against @wokwi/elements' HCSR04Element source — pure
      // SVG, zero reactive properties), so — same honest simplification
      // as the photoresistor/NTC above — a fixed simulated distance still
      // produces a real, correctly-timed echo a sketch can measure.
      const SIMULATED_DISTANCE_CM = 50;
      const ECHO_START_DELAY_US = 150; // a real sensor takes a short beat before the echo starts
      const ECHO_DURATION_US = SIMULATED_DISTANCE_CM * 58;
      let trigLoc = null, echoLoc = null;
      for (const { ownPin, arduinoPin } of connections) {
        const loc = PIN_TO_PORT[arduinoPin];
        if (!loc || !ports[loc.port]) continue;
        if (ownPin === "TRIG") trigLoc = loc;
        else if (ownPin === "ECHO") echoLoc = loc;
      }
      if (trigLoc && echoLoc) {
        const trigPort = ports[trigLoc.port];
        const echoPort = ports[echoLoc.port];
        let risingAtCycle = null;
        const listener = () => {
          const isHigh = trigPort.pinState(trigLoc.bit) === PinState.High;
          if (isHigh) {
            risingAtCycle = cpu.cycles;
            return;
          }
          if (risingAtCycle === null) return;
          const pulseUs = ((cpu.cycles - risingAtCycle) / CPU_HZ) * 1_000_000;
          risingAtCycle = null;
          if (pulseUs < 10) return; // too short to be a real trigger
          scheduleAt(cpu, ECHO_START_DELAY_US, () => {
            echoPort.setPin(echoLoc.bit, true);
            scheduleAt(cpu, ECHO_DURATION_US, () => echoPort.setPin(echoLoc.bit, false));
          });
        };
        trigPort.addListener(listener);
        echoPort.setPin(echoLoc.bit, false); // idle low
      }
    } else if (comp.tag === "wokwi-ky-040") {
      // Real quadrature output: rotating one detent walks CLK/DT through
      // the actual 4-phase Gray-code sequence a real encoder produces.
      // Confirmed against @wokwi/elements' KY040Element source that its
      // arrow clicks dispatch a single discrete "rotate-cw"/"rotate-ccw"
      // event per detent (not continuous motion), so stepping through the
      // sequence once per event is the correct model, not a shortcut. SW
      // is a plain digital pushbutton — identical button-press/
      // button-release contract to the standalone pushbutton above.
      const PHASE_US = 500; // per-quarter-step timing, fast but readable by any polling loop
      let clkLoc = null, dtLoc = null;
      for (const { ownPin, arduinoPin } of connections) {
        const loc = PIN_TO_PORT[arduinoPin];
        if (!loc || !ports[loc.port]) continue;
        if (ownPin === "CLK") clkLoc = loc;
        else if (ownPin === "DT") dtLoc = loc;
      }
      if (clkLoc && dtLoc) {
        const clkPort = ports[clkLoc.port];
        const dtPort = ports[dtLoc.port];
        clkPort.setPin(clkLoc.bit, true); // idle HIGH
        dtPort.setPin(dtLoc.bit, true);
        const runSequence = (phases) => {
          phases.forEach(([clk, dt], i) => {
            scheduleAt(cpu, PHASE_US * (i + 1), () => {
              clkPort.setPin(clkLoc.bit, clk);
              dtPort.setPin(dtLoc.bit, dt);
            });
          });
        };
        const onCw = () => runSequence([[false, true], [false, false], [true, false], [true, true]]);
        const onCcw = () => runSequence([[true, false], [false, false], [false, true], [true, true]]);
        comp.el.addEventListener("rotate-cw", onCw);
        comp.el.addEventListener("rotate-ccw", onCcw);
        eventListeners.push({ el: comp.el, type: "rotate-cw", handler: onCw });
        eventListeners.push({ el: comp.el, type: "rotate-ccw", handler: onCcw });
      }
      for (const { ownPin, arduinoPin } of connections) {
        if (ownPin !== "SW") continue;
        const loc = PIN_TO_PORT[arduinoPin];
        if (!loc || !ports[loc.port]) continue;
        const port = ports[loc.port];
        port.setPin(loc.bit, true);
        const onPress = () => port.setPin(loc.bit, false);
        const onRelease = () => port.setPin(loc.bit, true);
        comp.el.addEventListener("button-press", onPress);
        comp.el.addEventListener("button-release", onRelease);
        eventListeners.push({ el: comp.el, type: "button-press", handler: onPress });
        eventListeners.push({ el: comp.el, type: "button-release", handler: onRelease });
      }
    } else if (comp.tag === "wokwi-membrane-keypad") {
      // Real matrix-scan protocol: the Keypad library (curated in
      // BUILTIN_LIBRARIES, arduinoCompileService.js) drives one ROW pin
      // LOW at a time while reading COLUMN pins (pulled HIGH via
      // INPUT_PULLUP) — a pressed key at that row/column briefly bridges
      // them, pulling its column LOW. Recomputed on every row-pin change
      // AND on every press/release, since either can flip what a column
      // should currently read. Adapts to either the 3- or 4-column pinout
      // automatically, since rowLocs/colLocs only ever contain whatever's
      // actually wired.
      const rowLocs = {};
      const colLocs = {};
      for (const { ownPin, arduinoPin } of connections) {
        const loc = PIN_TO_PORT[arduinoPin];
        if (!loc || !ports[loc.port]) continue;
        const rowMatch = /^R(\d+)$/.exec(ownPin);
        const colMatch = /^C(\d+)$/.exec(ownPin);
        if (rowMatch) rowLocs[Number(rowMatch[1]) - 1] = loc;
        else if (colMatch) colLocs[Number(colMatch[1]) - 1] = loc;
      }
      if (Object.keys(rowLocs).length && Object.keys(colLocs).length) {
        const recompute = () => {
          for (const [colIndexStr, colLoc] of Object.entries(colLocs)) {
            const colIndex = Number(colIndexStr);
            const colPort = ports[colLoc.port];
            let shouldBeLow = false;
            for (const key of comp.el.pressedKeys) {
              const { row, column } = comp.el.keyIndex(key);
              if (column !== colIndex) continue;
              const rowLoc = rowLocs[row];
              if (!rowLoc) continue;
              if (ports[rowLoc.port].pinState(rowLoc.bit) === PinState.Low) {
                shouldBeLow = true;
                break;
              }
            }
            // Idle HIGH (pulled up), LOW only when a pressed key bridges
            // a row the sketch is actively scanning low right now.
            colPort.setPin(colLoc.bit, !shouldBeLow);
          }
        };
        recompute();
        for (const rowLoc of Object.values(rowLocs)) ports[rowLoc.port].addListener(recompute);
        comp.el.addEventListener("button-press", recompute);
        comp.el.addEventListener("button-release", recompute);
        eventListeners.push({ el: comp.el, type: "button-press", handler: recompute });
        eventListeners.push({ el: comp.el, type: "button-release", handler: recompute });
      }
    } else if (comp.tag === "wokwi-stepper-motor" || comp.tag === "wokwi-biaxial-stepper") {
      // Real 4-wire bipolar full-step decoding: watches all four coil
      // pins (A-/A+/B+/B-) and matches their live combination against the
      // standard drive sequence Arduino's own built-in Stepper.h library
      // uses internally (Stepper::stepMotor's case 0-3) — moving between
      // two ADJACENT table entries, in either direction, is one real
      // physical step. wokwi-biaxial-stepper is two steppers fused into
      // one part but @wokwi/elements only exposes ONE set of coil pins on
      // it, so driving its single `angle` the same way is the most
      // correct behavior available.
      const STEPPER_SEQUENCE = [
        { Ap: true, Am: false, Bp: true, Bm: false },
        { Ap: false, Am: true, Bp: true, Bm: false },
        { Ap: false, Am: true, Bp: false, Bm: true },
        { Ap: true, Am: false, Bp: false, Bm: true },
      ];
      const DEGREES_PER_STEP = 1.8; // standard 200-steps/rev full-step motor
      const locByPin = {};
      for (const { ownPin, arduinoPin } of connections) {
        const loc = PIN_TO_PORT[arduinoPin];
        if (loc && ports[loc.port] && ["A-", "A+", "B+", "B-"].includes(ownPin)) locByPin[ownPin] = loc;
      }
      if (locByPin["A-"] && locByPin["A+"] && locByPin["B+"] && locByPin["B-"]) {
        let lastIndex = null;
        const readState = () => ({
          Ap: ports[locByPin["A+"].port].pinState(locByPin["A+"].bit) === PinState.High,
          Am: ports[locByPin["A-"].port].pinState(locByPin["A-"].bit) === PinState.High,
          Bp: ports[locByPin["B+"].port].pinState(locByPin["B+"].bit) === PinState.High,
          Bm: ports[locByPin["B-"].port].pinState(locByPin["B-"].bit) === PinState.High,
        });
        const sameState = (a, b) => a.Ap === b.Ap && a.Am === b.Am && a.Bp === b.Bp && a.Bm === b.Bm;
        const listener = () => {
          const state = readState();
          const index = STEPPER_SEQUENCE.findIndex((s) => sameState(s, state));
          if (index === -1) return; // not a recognized drive combo — ignore
          if (lastIndex === null) {
            lastIndex = index;
            return;
          }
          if (index === lastIndex) return;
          const diff = (index - lastIndex + 4) % 4;
          if (diff === 1) comp.el.angle = (comp.el.angle + DEGREES_PER_STEP) % 360;
          else if (diff === 3) comp.el.angle = (comp.el.angle - DEGREES_PER_STEP + 360) % 360;
          // diff === 2 means two steps happened between checks —
          // direction is ambiguous, so just re-sync position without
          // guessing which way it went.
          lastIndex = index;
        };
        for (const loc of Object.values(locByPin)) ports[loc.port].addListener(listener);
        boundVisuals.push({ el: comp.el, prop: "angle", resetValue: 0 });
      }
    } else if (comp.tag === "wokwi-ks2e-m-dc5") {
      // No reactive "energized" property or visual difference exists on
      // this part in @wokwi/elements at all (confirmed against
      // KS2EMDC5Element's source — pure static SVG). Coil detection below
      // is real: COIL1/COIL2 driven HIGH energizes that relay (the
      // standard "digitalWrite(coilPin, HIGH) energizes the coil"
      // teaching pattern), surfaced via a CSS class this app adds itself
      // (.relay-energized-1/-2 in arduino.css) since the part can't show
      // it any other way.
      //
      // Known gap, not silently skipped: this app's wiring connectivity
      // (buildConnectivity, above) is computed ONCE at Run start. A real
      // energized relay changes which of NO/NC its common pin P is
      // actually connected to — a live topology change mid-run, which
      // isn't modeled here. A student gets correct, real coil on/off
      // feedback; a downstream part wired through P won't dynamically
      // re-route between NO and NC while a sketch is running.
      for (const relayNum of [1, 2]) {
        const conn = connections.find((c) => c.ownPin === `COIL${relayNum}`);
        if (!conn) continue;
        const loc = PIN_TO_PORT[conn.arduinoPin];
        if (!loc || !ports[loc.port]) continue;
        const port = ports[loc.port];
        const cssClass = `relay-energized-${relayNum}`;
        const originalClassName = comp.el.className;
        const listener = () => {
          comp.el.classList.toggle(cssClass, port.pinState(loc.bit) === PinState.High);
        };
        port.addListener(listener);
        listener();
        boundVisuals.push({ el: comp.el, prop: "className", resetValue: originalClassName });
      }
    } else if (NO_UI_SENSOR_TAGS.includes(comp.tag)) {
      // See NO_UI_SENSOR_TAGS's own comment: none of these parts expose
      // ANY interactive control in @wokwi/elements itself, so the
      // Idle/Triggered toggle in the selection toolbar (componentSensorRow)
      // is a control this app adds itself, dispatching "sensor-value-change"
      // on toggle so this binding reacts live — same event-driven shape as
      // every other input device above.
      const applyState = () => {
        const triggered = !!comp.sensorTriggered;
        for (const { ownPin, arduinoPin } of connections) {
          const loc = PIN_TO_PORT[arduinoPin];
          if (!loc || !ports[loc.port]) continue;
          const port = ports[loc.port];
          if (ownPin === "OUT" || ownPin === "DOUT") {
            // PIR/tilt (OUT) are wired active-HIGH; the multi-pin
            // modules' digital threshold pin (DOUT) is active-LOW — both
            // match their real hardware's most common convention.
            const activeHigh = ownPin === "OUT";
            port.setPin(loc.bit, activeHigh ? triggered : !triggered);
          } else if (ownPin === "AOUT" && adc) {
            const channel = ANALOG_CHANNEL[arduinoPin];
            if (channel !== undefined) adc.channelValues[channel] = triggered ? 4 : 0.5;
          }
        }
      };
      applyState();
      comp.el.addEventListener("sensor-value-change", applyState);
      eventListeners.push({ el: comp.el, type: "sensor-value-change", handler: applyState });
    } else if (comp.tag === "wokwi-ds1307" && i2cDevices) {
      // Wire.h talks to the ATmega328P's hardware TWI peripheral over its
      // FIXED SDA/SCL pins (A4/A5 on an Uno/Nano) — not bit-banged GPIO —
      // confirmed against avr8js's own twi.js source. So this only checks
      // that SDA/SCL are wired there (the same "did the student wire this
      // correctly" gate every other binding has) and registers a real
      // I2C device with the shared bus dispatcher set up in runSketch,
      // instead of touching `ports` directly.
      const wired =
        connections.some((c) => c.ownPin === "SDA" && c.arduinoPin === "A4") &&
        connections.some((c) => c.ownPin === "SCL" && c.arduinoPin === "A5");
      if (wired) {
        // A live simulated clock: RTClib's rtc.adjust(DateTime(...)) —
        // which writes all 7 time/date registers in one burst — re-anchors
        // this; rtc.now() reads it back, ticking forward in real
        // wall-clock time exactly like a battery-backed RTC chip would.
        let epochMs = Date.now();
        let anchorWallMs = performance.now();
        const currentDate = () => new Date(epochMs + (performance.now() - anchorWallMs));
        const toBCD = (n) => ((Math.floor(n / 10) << 4) | (n % 10)) & 0xff;
        const fromBCD = (b) => (b >> 4) * 10 + (b & 0x0f);
        let regPointer = 0;
        let firstWriteByte = true; // the first byte of a WRITE transaction is always the register pointer
        i2cDevices.push({
          address: 0x68,
          onConnect() {
            firstWriteByte = true;
          },
          onWrite(byte) {
            if (firstWriteByte) {
              regPointer = byte % 8;
              firstWriteByte = false;
              return true;
            }
            if (regPointer <= 6) {
              const d = currentDate();
              const parts = {
                seconds: d.getSeconds(), minutes: d.getMinutes(), hours: d.getHours(),
                day: d.getDay() + 1, date: d.getDate(), month: d.getMonth() + 1, year: d.getFullYear() % 100,
              };
              const field = ["seconds", "minutes", "hours", "day", "date", "month", "year"][regPointer];
              const mask = regPointer === 0 ? 0x7f : regPointer === 2 ? 0x3f : 0xff; // CH/12-24hr bits ignored
              parts[field] = fromBCD(byte & mask);
              epochMs = new Date(2000 + parts.year, parts.month - 1, parts.date, parts.hours, parts.minutes, parts.seconds).getTime();
              anchorWallMs = performance.now();
            }
            regPointer = (regPointer + 1) % 8;
            return true;
          },
          onRead() {
            const d = currentDate();
            const values = [
              toBCD(d.getSeconds()), toBCD(d.getMinutes()), toBCD(d.getHours()),
              toBCD(d.getDay() + 1), toBCD(d.getDate()), toBCD(d.getMonth() + 1), toBCD(d.getFullYear() % 100),
            ];
            const value = regPointer < 7 ? values[regPointer] : 0;
            regPointer = (regPointer + 1) % 8;
            return value;
          },
        });
      }
    } else if (comp.tag === "wokwi-mpu6050" && i2cDevices) {
      const wired =
        connections.some((c) => c.ownPin === "SDA" && c.arduinoPin === "A4") &&
        connections.some((c) => c.ownPin === "SCL" && c.arduinoPin === "A5");
      if (wired) {
        // No interactive "orientation"/"motion" control exists on this
        // part in @wokwi/elements at all (confirmed against
        // MPU6050Element's source — only a decorative `led1` property,
        // no accel/gyro state whatsoever). Fixed reading: level and
        // still — accel Z = +1g (16384 raw at the default +/-2g range),
        // everything else zero — same honest simplification as the
        // photoresistor/NTC above, just via real I2C register reads.
        const REGISTERS = {
          0x75: 0x68, // WHO_AM_I — libraries sanity-check this on begin()
          0x3b: 0x00, 0x3c: 0x00, // ACCEL_XOUT_H/L
          0x3d: 0x00, 0x3e: 0x00, // ACCEL_YOUT_H/L
          0x3f: 0x40, 0x40: 0x00, // ACCEL_ZOUT_H/L = 0x4000 = +1g
          0x41: 0x14, 0x42: 0x00, // TEMP_OUT_H/L — a plausible room-temperature raw value
          0x43: 0x00, 0x44: 0x00, 0x45: 0x00, 0x46: 0x00, 0x47: 0x00, 0x48: 0x00, // GYRO X/Y/Z
        };
        let regPointer = 0;
        i2cDevices.push({
          address: 0x68,
          onConnect() {},
          onWrite(byte) {
            // The only writes real libraries do are the register pointer
            // and PWR_MGMT_1's wake-up value — neither needs to change
            // any state here, just a real ACK back.
            regPointer = byte;
            return true;
          },
          onRead() {
            const value = REGISTERS[regPointer] ?? 0;
            regPointer = (regPointer + 1) & 0xff;
            return value;
          },
        });
      }
    } else if (comp.tag === "wokwi-ssd1306" && i2cDevices) {
      // Real SSD1306 command/GDDRAM protocol over I2C — confirmed against
      // @wokwi/elements' SSD1306Element source that it exposes a genuine
      // 128x64 `imageData` (a real reactive Lit property backing an
      // on-canvas <canvas>), not just a decorative shape — so this
      // renders ACTUAL pixels a sketch draws, not a placeholder. Pin
      // names on this part are "DATA"/"CLK", not "SDA"/"SCL" (confirmed
      // against its own pinInfo) — still the same fixed hardware I2C
      // pins underneath (A4/A5).
      const wired =
        connections.some((c) => c.ownPin === "DATA" && c.arduinoPin === "A4") &&
        connections.some((c) => c.ownPin === "CLK" && c.arduinoPin === "A5");
      if (wired) {
        const WIDTH = 128, HEIGHT = 64;
        const gddram = new Uint8Array((WIDTH * HEIGHT) / 8); // 8 pages x 128 columns, each byte = 8 vertical pixels (LSB = top)
        const pixels = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
        // 1-byte command parameter counts this app actually needs to
        // track — everything else not listed is treated as a 0-parameter
        // command (safe default: the vast majority of SSD1306 commands
        // are single-byte with no parameters).
        const CMD_PARAM_COUNT = { 0x81: 1, 0x20: 1, 0x21: 2, 0x22: 2, 0xd3: 1, 0xd5: 1, 0xd9: 1, 0xda: 1, 0xdb: 1, 0x8d: 1 };
        let mode = null; // "command" | "data", set by the first byte of each write transaction
        let pendingCmd = null;
        let pendingParams = [];
        let col = 0, page = 0, colStart = 0, colEnd = WIDTH - 1, pageStart = 0, pageEnd = (HEIGHT / 8) - 1;
        const paintColumn = (pageIdx, colIdx, byteVal) => {
          for (let bit = 0; bit < 8; bit++) {
            const y = pageIdx * 8 + bit;
            if (y >= HEIGHT) continue;
            const v = (byteVal >> bit) & 1 ? 255 : 0;
            const idx = (y * WIDTH + colIdx) * 4;
            pixels[idx] = v;
            pixels[idx + 1] = v;
            pixels[idx + 2] = v;
            pixels[idx + 3] = 255;
          }
        };
        const flush = () => {
          comp.el.imageData = new ImageData(pixels.slice(), WIDTH, HEIGHT);
        };
        const applyCommand = (cmd, params) => {
          if (cmd === 0x21) {
            colStart = params[0];
            colEnd = params[1];
            col = colStart;
          } else if (cmd === 0x22) {
            pageStart = params[0];
            pageEnd = params[1];
            page = pageStart;
          }
          // Contrast/clock-div/precharge/etc. are consumed but don't need
          // to change anything for a functional (not photometric) sim.
        };
        i2cDevices.push({
          address: 0x3c, // the standard fixed SSD1306 I2C address
          onConnect() {
            mode = null;
            pendingCmd = null;
          },
          onWrite(byte) {
            if (mode === null) {
              mode = byte === 0x40 ? "data" : "command";
              return true;
            }
            if (mode === "data") {
              const addr = page * WIDTH + col;
              gddram[addr] = byte;
              paintColumn(page, col, byte);
              col++;
              if (col > colEnd) {
                col = colStart;
                page = page >= pageEnd ? pageStart : page + 1;
              }
              flush();
              return true;
            }
            if (pendingCmd !== null) {
              pendingParams.push(byte);
              if (pendingParams.length >= CMD_PARAM_COUNT[pendingCmd]) {
                applyCommand(pendingCmd, pendingParams);
                pendingCmd = null;
              }
              return true;
            }
            if (byte >= 0xb0 && byte <= 0xb7) {
              page = byte - 0xb0; // page-addressing-mode page select
            } else if (byte <= 0x0f) {
              col = (col & 0xf0) | byte; // page-addressing-mode column low nibble
            } else if (byte >= 0x10 && byte <= 0x1f) {
              col = (col & 0x0f) | ((byte & 0x0f) << 4); // column high nibble
            } else if (CMD_PARAM_COUNT[byte]) {
              pendingCmd = byte;
              pendingParams = [];
            } // else: a recognized-as-unknown 0-parameter command — ignore
            return true;
          },
          onRead() {
            return 0; // this app's SSD1306 support is write-only (status/read-back isn't modeled)
          },
        });
        boundVisuals.push({ el: comp.el, prop: "imageData", resetValue: new ImageData(WIDTH, HEIGHT) });
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
      // Only meaningful for NO_UI_SENSOR_TAGS parts, same reasoning.
      sensorTriggered: !!c.sensorTriggered,
    })),
    // waypoints is cloned (not just referenced) since, unlike from/to
    // (set once at wire creation and never mutated in place), a wire's
    // waypoints array IS mutated in place while dragging a node —
    // sharing the reference would let a later drag silently rewrite an
    // undo-stack snapshot that's supposed to be frozen, breaking undo
    // for exactly the state this feature adds (found via testing: undo
    // after a waypoint drag was reverting to the SAME post-drag
    // position instead of the pre-drag one).
    wires: wires.map((w) => ({
      id: w.id,
      from: w.from,
      to: w.to,
      color: w.color,
      waypoints: (w.waypoints || []).map((wp) => ({ x: wp.x, y: wp.y })),
    })),
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
        if (NO_UI_SENSOR_TAGS.includes(c.tag)) comp.sensorTriggered = !!c.sensorTriggered;
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
          // Cloned, not referenced — the live wire otherwise ends up
          // sharing its waypoints array with whatever snapshot this
          // restore came from (a saved project's data, or an undo/redo
          // stack entry that's supposed to stay frozen), so a later
          // drag on it would silently mutate that snapshot too.
          waypoints: (w.waypoints || []).map((wp) => ({ x: wp.x, y: wp.y })),
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

// Starter sketches for the "Load Example" dropdown — each one only uses
// behavior this simulator actually implements (see bindComponentsToSimulation):
// LED/buzzer/RGB-LED channels are plain digital on/off (no analogWrite()
// brightness/PWM yet, so no example here claims dimming works), pushbutton/
// slide-switch/potentiometer readings are real, and the photoresistor
// currently always reads a fixed simulated light level (no draggable "light
// level" control the way the potentiometer has one) — noted honestly in
// its own example rather than implying it's adjustable. DHT22 has no
// simulation logic bound at all yet (visual/wireable only), so it
// deliberately has no example here.
const ARDUINO_EXAMPLES = {
  blink: {
    label: "Blink an LED",
    code: `// Wire an LED's anode (long leg) to pin 13 and its cathode to GND.

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
`,
  },
  buttonLed: {
    label: "Push Button controls an LED",
    code: `// Wire a push button between pin 2 and GND, and an LED (with its
// cathode to GND) to pin 13.
// INPUT_PULLUP means the pin reads HIGH when the button is NOT pressed,
// and LOW the moment it is — pressing it completes the circuit to GND.

const int buttonPin = 2;
const int ledPin = 13;

void setup() {
  pinMode(buttonPin, INPUT_PULLUP);
  pinMode(ledPin, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  bool pressed = digitalRead(buttonPin) == LOW;
  digitalWrite(ledPin, pressed ? HIGH : LOW);
  if (pressed) Serial.println("Button pressed — LED on");
  delay(50);
}
`,
  },
  servoSweep: {
    label: "Servo Sweep",
    code: `// Wire a servo's signal wire to pin 9 (and power/ground to 5V/GND).

#include <Servo.h>

Servo myServo;

void setup() {
  myServo.attach(9);
}

void loop() {
  for (int angle = 0; angle <= 180; angle += 5) {
    myServo.write(angle);
    delay(30);
  }
  for (int angle = 180; angle >= 0; angle -= 5) {
    myServo.write(angle);
    delay(30);
  }
}
`,
  },
  rgbCycle: {
    label: "RGB LED Color Cycle",
    code: `// Wire an RGB LED's R/G/B legs to pins 9, 10, 11 (and COM to GND for a
// common-cathode module). Each channel is a plain on/off here, so this
// cycles through the 8 colors that combination can make — not a smooth
// fade (that needs analogWrite() PWM brightness, not simulated yet).

const int redPin = 9;
const int greenPin = 10;
const int bluePin = 11;

void setColor(bool r, bool g, bool b) {
  digitalWrite(redPin, r);
  digitalWrite(greenPin, g);
  digitalWrite(bluePin, b);
}

void setup() {
  pinMode(redPin, OUTPUT);
  pinMode(greenPin, OUTPUT);
  pinMode(bluePin, OUTPUT);
}

void loop() {
  setColor(true, false, false);  // red
  delay(400);
  setColor(false, true, false);  // green
  delay(400);
  setColor(false, false, true);  // blue
  delay(400);
  setColor(true, true, false);   // yellow
  delay(400);
  setColor(false, true, true);   // cyan
  delay(400);
  setColor(true, false, true);   // magenta
  delay(400);
  setColor(true, true, true);    // white
  delay(400);
}
`,
  },
  buzzerBeep: {
    label: "Buzzer Beep Pattern",
    code: `// Wire a buzzer's signal leg to pin 8 (and its other leg to GND).

const int buzzerPin = 8;

void setup() {
  pinMode(buzzerPin, OUTPUT);
}

void loop() {
  digitalWrite(buzzerPin, HIGH);
  delay(150);
  digitalWrite(buzzerPin, LOW);
  delay(150);
  digitalWrite(buzzerPin, HIGH);
  delay(150);
  digitalWrite(buzzerPin, LOW);
  delay(700);
}
`,
  },
  switchLed: {
    label: "Slide Switch controls an LED",
    code: `// Wire a slide switch's signal leg to pin 7, and an LED (cathode to
// GND) to pin 13.

const int switchPin = 7;
const int ledPin = 13;

void setup() {
  pinMode(switchPin, INPUT);
  pinMode(ledPin, OUTPUT);
}

void loop() {
  digitalWrite(ledPin, digitalRead(switchPin));
  delay(50);
}
`,
  },
  potRead: {
    label: "Potentiometer Reading (Serial)",
    code: `// Wire a potentiometer's signal (wiper) leg to A0, and its outer legs
// to 5V and GND. Drag its knob while the sketch is running to see the
// reading actually change.

void setup() {
  Serial.begin(9600);
}

void loop() {
  int reading = analogRead(A0); // 0-1023
  Serial.print("Potentiometer: ");
  Serial.println(reading);
  delay(200);
}
`,
  },
  lightRead: {
    label: "Light Sensor Reading (Serial)",
    code: `// Wire a photoresistor's AO leg to A0 (and its other legs to 5V/GND).
// This simulated sensor currently always reports a fixed mid-range
// light level (no draggable "brightness" control yet) — the reading
// itself is real, just not adjustable in the simulator today.

void setup() {
  Serial.begin(9600);
}

void loop() {
  int reading = analogRead(A0); // 0-1023
  Serial.print("Light level: ");
  Serial.println(reading);
  delay(200);
}
`,
  },
};

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
  document.getElementById("exampleSelect")?.addEventListener("change", (e) => {
    const key = e.target.value;
    e.target.value = ""; // reset to the placeholder — this is a one-shot action, not a persistent selection
    const example = ARDUINO_EXAMPLES[key];
    if (!example) return;
    // setValue() replaces the whole model (not an edit operation), which
    // also clears Monaco's own undo history — same reason Web Lab's
    // template picker confirms before doing this.
    if (!confirm(`Load "${example.label}"? This replaces your current code (can't be undone).`)) return;
    codeEditor.setValue(example.code);
    showToast(`Loaded "${example.label}"`);
    scheduleAutoSave();
  });
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

// A handful of protocols below (ultrasonic echo timing, rotary-encoder
// detent pulses, ...) need to flip a pin at a specific point in SIMULATED
// time after some trigger — not wall-clock time, since avr8js can run
// faster or slower than real-time depending on the host. This is a tiny
// cycle-scheduled event queue, checked once per emulated instruction
// inside frame()'s loop below (cheap: an empty-array check in the common
// case), giving effectively cycle-accurate (62.5ns) scheduling — far more
// precise than the microsecond-scale timing every protocol here needs.
let scheduledEvents = []; // { atCycle, fn }
function scheduleAt(cpu, delayUs, fn) {
  scheduledEvents.push({ atCycle: cpu.cycles + (delayUs * CPU_HZ) / 1_000_000, fn });
}
function runDueScheduledEvents(cpu) {
  if (!scheduledEvents.length) return;
  for (let i = scheduledEvents.length - 1; i >= 0; i--) {
    if (cpu.cycles >= scheduledEvents[i].atCycle) {
      const { fn } = scheduledEvents.splice(i, 1)[0];
      fn();
    }
  }
}

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
  scheduledEvents = []; // a stale delayed flip from the last run must never fire under this one

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
    CPU, AVRIOPort, AVRTimer, AVRUSART, AVRADC, AVRTWI, portBConfig, portCConfig, portDConfig,
    timer0Config, timer1Config, usart0Config, adcConfig, twiConfig, avrInstruction, PinState,
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

  // Wire.h talks to the ATmega328P's dedicated hardware TWI (I2C)
  // peripheral, not bit-banged GPIO on A4/A5 — confirmed against avr8js's
  // own source (peripherals/twi.js): it exposes a clean byte-oriented
  // eventHandler (start/stop/connectToSlave/writeByte/readByte), so
  // simulating an I2C device means implementing that handler once, not
  // decoding SDA/SCL edges bit by bit. i2cDevices is populated by
  // bindComponentsToSimulation below (SSD1306/DS1307/MPU6050 register
  // themselves here); the dispatcher just routes by 7-bit address, the
  // same way a real shared I2C bus does.
  const twi = new AVRTWI(cpu, twiConfig, CPU_HZ);
  const i2cDevices = [];
  let activeI2CDevice = null;
  twi.eventHandler = {
    start() {
      twi.completeStart();
    },
    stop() {
      twi.completeStop();
    },
    connectToSlave(address, isRead) {
      activeI2CDevice = i2cDevices.find((d) => d.address === address) || null;
      activeI2CDevice?.onConnect?.(isRead);
      twi.completeConnect(!!activeI2CDevice);
    },
    writeByte(value) {
      const ack = activeI2CDevice ? activeI2CDevice.onWrite(value) !== false : false;
      twi.completeWrite(ack);
    },
    readByte() {
      twi.completeRead(activeI2CDevice ? activeI2CDevice.onRead() : 0xff);
    },
  };

  const unbindComponents = bindComponentsToSimulation(cpu, ports, PinState, adc, i2cDevices);

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
      runDueScheduledEvents(cpu);
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
  scheduledEvents = [];

  setButtonsRunning(false, false);
  setStatus("Stopped", "idle");
}
