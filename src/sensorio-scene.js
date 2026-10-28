// Sensorio (Field of Light): the scene dressing for Hole 4. For now a placeholder group; the glowing sphere field, the
// paths and the night look are planted here from sensorio.sphereField() (see src/maps/sensorio.js).
import * as THREE from 'three';

export function createSensorioScene(qLevel = 'med') {
  const g = new THREE.Group(); g.name = 'sensorio';
  g.userData.info = { qLevel, spheres: 0 };
  return g;
}
