// Generic Three.js helpers shared by every 3D arcade game (car-racing.js,
// car-parking.js, pool.js, ...) — nothing here is specific to any one
// game's content, unlike shared/car-mesh.js.

// Recursively disposes every geometry/material under `obj` — call once
// per game on container._cleanup (scene teardown) so switching games
// repeatedly doesn't leak GPU buffers.
export function disposeObject3D(obj) {
  obj.traverse((node) => {
    if (node.geometry) node.geometry.dispose();
    if (node.material) {
      (Array.isArray(node.material) ? node.material : [node.material]).forEach((m) => m.dispose());
    }
  });
}

// Sizes a renderer to FILL whatever space its wrap element actually has
// and keeps the camera's aspect matching that — unlike a flat 2D canvas,
// a perspective camera showing MORE of the scene on a wider/taller box
// isn't a distortion, it's just a wider field of view, so there's no
// need to letterbox/pillarbox a 3D game the way ArcadeEngine.fitCanvas
// has to for the 2D ones.
//
// `minAspect` (width/height) is each game's own ORIGINAL design aspect —
// the floor, never shown narrower than that. Every game's camera was
// framed (several, like penalty-shootout's, verified numerically) to
// keep its important content — a goal's posts, a table's far pockets, a
// course's edges — just inside frame AT THAT ASPECT; on a tall/narrow
// container (common once the fullscreen stage's hint/scoreboard/controls
// take their own slice of height — a typical phone portrait can leave a
// canvas box narrower than 0.82 easily) showing LESS width than that
// would clip exactly the content the camera was tuned to keep on-screen.
// Capping the wrap element's own width via maxWidth (not just adjusting
// camera.aspect on its own, which would stretch/squish the image instead
// of actually showing more/less) keeps every game's camera framing valid
// while still letting it use the FULL available width on any roomier
// (landscape/desktop) screen.
export function fitRenderer3D(renderer, camera, wrapEl, minAspect) {
  const availW = wrapEl.clientWidth || 1;
  const availH = wrapEl.clientHeight || Math.round(availW * 0.75);
  let w = availW, h = availH;
  if (minAspect && h > 0 && w / h < minAspect) {
    w = Math.min(availW, h * minAspect);
    wrapEl.style.maxWidth = w + "px";
  } else {
    wrapEl.style.maxWidth = "";
  }
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
