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
