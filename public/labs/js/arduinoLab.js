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
  await placeComponent(tag, localX, localY);
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

async function placeComponent(tag, x, y) {
  const el = tag === "custom-breadboard" ? createBreadboardElement() : document.createElement(tag);
  el.classList.add("placed-component");
  el.style.position = "absolute";
  el.style.left = x + "px";
  el.style.top = y + "px";

  const id = "comp-" + ++componentCounter;
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
      wireOverlay.appendChild(circle);
      pinCircles.set(key, circle);
    }
    circle.setAttribute("cx", x);
    circle.setAttribute("cy", y);
  }
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
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      if (dragged) {
        trySnapToBreadboard(id);
        redrawWires();
        renderSelectionToolbar();
      } else {
        selectComponent(id);
      }
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
}

// ---------------------------------------------------------------------
// Selection & editing — flip, turn, duplicate, delete
// ---------------------------------------------------------------------

let selectedComponentId = null;

function selectComponent(id) {
  selectedComponentId = id;
  document.querySelectorAll(".placed-component.selected").forEach((el) => el.classList.remove("selected"));
  const comp = placedComponents.get(id);
  if (comp) comp.el.classList.add("selected");
  renderSelectionToolbar();
}

function deselectComponent() {
  selectedComponentId = null;
  document.querySelectorAll(".placed-component.selected").forEach((el) => el.classList.remove("selected"));
  renderSelectionToolbar();
}

// Positions the floating flip/turn/duplicate/delete toolbar centered
// above whichever component is currently selected (or hides it).
function renderSelectionToolbar() {
  const toolbar = document.getElementById("componentToolbar");
  if (!toolbar) return;
  const comp = selectedComponentId ? placedComponents.get(selectedComponentId) : null;
  if (!comp) {
    toolbar.hidden = true;
    return;
  }
  const elRect = comp.el.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();
  toolbar.style.left = elRect.left - canvasRect.left + elRect.width / 2 + "px";
  toolbar.style.top = elRect.top - canvasRect.top + "px";
  toolbar.hidden = false;
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
    if (wires[i].from.componentId === id || wires[i].to.componentId === id) wires.splice(i, 1);
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
  if (selectedComponentId === id) deselectComponent();
  redrawWires();
  if (canvasHint && placedComponents.size === 0) canvasHint.style.display = "";
}

document.getElementById("componentToolbar")?.addEventListener("mousedown", (e) => {
  // Stop this reaching the canvas's own pan-drag listener — clicking a
  // toolbar button is not a click on empty canvas background.
  e.stopPropagation();
});
document.getElementById("componentToolbar")?.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn || !selectedComponentId) return;
  const id = selectedComponentId;
  if (btn.dataset.action === "flip") flipComponent(id);
  else if (btn.dataset.action === "turn") turnComponent(id);
  else if (btn.dataset.action === "duplicate") duplicateComponent(id);
  else if (btn.dataset.action === "delete") deleteComponent(id);
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

function findBreadboardComponent() {
  for (const comp of placedComponents.values()) {
    if (comp.tag === "custom-breadboard") return comp;
  }
  return null;
}

// Re-checks every pin of `componentId` against the nearest hole on
// whatever breadboard is on the canvas, snapping (or un-snapping) each
// one independently. Called once at the end of a drag/placement, not on
// every mousemove — 420 holes x several pins, every frame, would be
// wasteful for something that only matters once you let go.
function trySnapToBreadboard(componentId) {
  const board = findBreadboardComponent();
  if (!board || componentId === board.id) return;
  const comp = placedComponents.get(componentId);
  if (!comp || !comp.el.pinInfo) return;

  const boardRect = board.el.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();
  const boardHoles = board.el.pinInfo.map((hole) => ({
    hole,
    x: boardRect.left - canvasRect.left + hole.x * viewZoom,
    y: boardRect.top - canvasRect.top + hole.y * viewZoom,
  }));

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

    const key = componentId + "::" + pin.name;
    if (nearest && nearestDist <= BREADBOARD_SNAP_PX) {
      breadboardPlacements.set(key, board.id + "::" + nearest.name);
    } else {
      breadboardPlacements.delete(key);
    }
  }
}

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

  wires.push({
    id: "wire-" + ++wireCounter,
    from: { componentId: fromComponentId, pin: fromPin },
    to: { componentId: toComponentId, pin: toPin },
  });
  redrawWires();
}

function removeWire(wireId) {
  const idx = wires.findIndex((w) => w.id === wireId);
  if (idx !== -1) wires.splice(idx, 1);
  redrawWires();
}

function redrawWires() {
  wireOverlay.querySelectorAll(".wire-path, .snap-stub").forEach((p) => p.remove());
  for (const wire of wires) {
    const from = getPinCanvasPos(wire.from.componentId, wire.from.pin);
    const to = getPinCanvasPos(wire.to.componentId, wire.to.pin);
    if (!from || !to) continue; // the component it referenced is gone

    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", wirePath(from, to));
    path.setAttribute("class", "wire-path");
    path.addEventListener("click", () => removeWire(wire.id));
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

// A gentle S-curve between two pins, like a real jumper wire looping
// between two header pins rather than a straight ruled line.
function wirePath(from, to) {
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
  // other design tool, rather than leaving the toolbar stuck open.
  if (panState && !panState.moved) deselectComponent();
  panState = null;
  canvas.classList.remove("panning");
  document.removeEventListener("mousemove", onCanvasPanMove);
  document.removeEventListener("mouseup", onCanvasPanUp);
}

// `const`/`let` at a classic script's top level don't become window
// properties (only `function` declarations do), so this is the one place
// the circuit's live state is deliberately exposed — Phase 5 (saving
// project_data: {code, components, wires}) needs to reach in from outside
// this file too, not just this file's own click handlers.
window.arduinoLab = { placedComponents, wires, placeComponent, getPinCanvasPos, breadboardPlacements };

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
    })),
    wires: wires.map((w) => ({ from: w.from, to: w.to })),
    breadboardPlacements: [...breadboardPlacements.entries()],
  };
}

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
  clearSerialOutput();
  seedDefaultCircuit();
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
