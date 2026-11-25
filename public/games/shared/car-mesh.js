// Shared low-poly car mesh for every 3D car-based arcade game
// (car-racing.js, car-parking.js, ...). Extracted out of car-racing.js so
// a tweak to the car model only has to happen once and stays identical
// across every game that uses it. Generic (non-car-specific) Three.js
// helpers live in ./three-helpers.js instead.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

export function makeCar(bodyColor) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.45, 2.2), new THREE.MeshLambertMaterial({ color: bodyColor }));
  body.position.y = 0.38;
  group.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.32, 1.0), new THREE.MeshLambertMaterial({ color: 0x1e293b }));
  cabin.position.set(0, 0.68, -0.15);
  group.add(cabin);
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.2, 0.2), new THREE.MeshLambertMaterial({ color: 0xf8fafc }));
  bumper.position.set(0, 0.3, 1.1);
  group.add(bumper);
  const wheelGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.24, 14);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
  [[-0.58, 0.26, 0.75], [0.58, 0.26, 0.75], [-0.58, 0.26, -0.75], [0.58, 0.26, -0.75]].forEach(([x, y, z]) => {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(x, y, z);
    group.add(wheel);
  });
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(1.5, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28 }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  group.add(shadow);
  return group;
}
