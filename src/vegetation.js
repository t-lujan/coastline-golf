// Instanced, wind-swayed grass and Monterey cypress (sway in the vertex shader).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { heightAt, surfaceAt, fairwayDist, greenDist, sandiness, teeDist, FAIRWAY_HALF } from './course.js';

export const windUniforms = { uTime: { value: 0 }, uWind: { value: new THREE.Vector2(1, 0) }, uGust: { value: 0.5 } };

function swayMaterial(mat, strength, heightScale, flatNormal = false) {
  mat.onBeforeCompile = (sh) => {
    if (flatNormal) sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', 'vec3 normal = normalize( vNormal ); vec3 nonPerturbedNormal = normal;');
    sh.uniforms.uTime = windUniforms.uTime; sh.uniforms.uWind = windUniforms.uWind; sh.uniforms.uGust = windUniforms.uGust;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime, uGust; uniform vec2 uWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 ip = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float hk = clamp(position.y / ${heightScale.toFixed(2)}, 0.0, 1.5); hk *= hk;
        float wave = sin(uTime * 1.7 + ip.x * 0.21 + ip.z * 0.17) * 0.5 + sin(uTime * 3.1 + ip.x * 0.7) * 0.25;
        float gust = 0.55 + 0.45 * sin(uTime * 0.6 + ip.x * 0.03 - ip.z * 0.02);
        vec3 wl = inverse(mat3(instanceMatrix)) * vec3(uWind.x, 0.0, uWind.y);
        transformed.xz += (wl.xz * (0.35 + wave * 0.35) * gust * uGust + vec2(wave, wave * 0.6) * 0.12) * hk * ${strength.toFixed(2)};
        transformed.y -= length(wl.xz) * hk * 0.08 * gust * uGust * ${strength.toFixed(2)};`);
  };
  return mat;
}

export function createGrass(count) {
  // a tuft: three bent blades fanned around the root, normals pointing up so tufts light like the turf below
  const P = [], N = [], C = [];
  for (let b = 0; b < 3; b++) {
    const a = b * 2.1 + 0.3, ca = Math.cos(a), sa = Math.sin(a), lean = 0.18 + b * 0.06, w = 0.055;
    const pts = [[-w, 0, 0], [w, 0, 0], [-w * 0.55, 0.55, lean * 0.45], [w * 0.55, 0.55, lean * 0.45], [0, 1 - b * 0.12, lean]];
    const R = ([x, y, z]) => [x * ca + z * sa + ca * 0.03, y, -x * sa + z * ca - sa * 0.03];
    const tri = [[0, 1, 2], [1, 3, 2], [2, 3, 4]];
    for (const t of tri) for (const i of t) { P.push(...R(pts[i])); N.push(0, 1, 0); const k = pts[i][1]; C.push(...[0.6 + k * 0.85, 0.6 + k * 0.8, 0.6 + k * 0.55]); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  const mat = swayMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), 1.0, 1.0, true);
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
  let n = 0, tries = 0;
  while (n < count && tries < count * 30) {
    tries++;
    const x = -125 + Math.random() * 250, z = -215 + Math.random() * 470;
    const fd = fairwayDist(x, z);
    if (fd < FAIRWAY_HALF + 1.2 || greenDist(x, z) < 3.5 || teeDist(x, z) < 2) continue;
    const surf = surfaceAt(x, z); if (surf === 'water' || surf === 'green') continue;
    const sd = sandiness(x, z), dune = sd > 0.45;
    if (dune && Math.random() > 0.55) continue;
    if (!dune && surf === 'sand') continue;
    // denser near the playing corridor where the camera lives
    if (Math.random() > Math.max(0.12, 1 - (fd - FAIRWAY_HALF) / 60)) continue;
    const hgt = dune ? 0.55 + Math.random() * 0.7 : 0.22 + Math.random() * 0.3;
    p.set(x, heightAt(x, z) - 0.03, z); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2);
    s.set(1 + Math.random() * 0.6, hgt, 1 + Math.random() * 0.6); m.compose(p, q, s); mesh.setMatrixAt(n, m);
    c.setRGB(...(dune ? [0.66, 0.66, 0.42] : [0.36, 0.5, 0.21]).map((v) => v * (0.85 + Math.random() * 0.3)));
    mesh.setColorAt(n, c); n++;
  }
  mesh.count = n; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

function cypressGeometry() {
  const parts = [];
  const col = (g, hex) => { const c = new THREE.Color(hex), a = []; for (let i = 0; i < g.attributes.position.count; i++) a.push(c.r, c.g, c.b); g.setAttribute('color', new THREE.Float32BufferAttribute(a, 3)); return g; };
  const trunk = new THREE.CylinderGeometry(0.28, 0.5, 6.5, 6); trunk.translate(0, 3.2, 0); trunk.rotateZ(-0.12);
  parts.push(col(trunk.toNonIndexed(), '#5a4636'));
  const branch = new THREE.CylinderGeometry(0.12, 0.22, 4, 5); branch.rotateZ(1.0); branch.translate(1.6, 5.2, 0.2); parts.push(col(branch.toNonIndexed(), '#5a4636'));
  // windswept flat-topped canopy, leaning downwind (+x)
  const clumps = [[0, 6.6, 0, 3.3, 1.5, 2.8, '#2f4a2c'], [2.6, 6.9, 0.4, 2.8, 1.2, 2.3, '#365532'], [-2.2, 6.2, -0.4, 2.3, 1.1, 2.0, '#2a4428'],
    [1.2, 7.7, -0.6, 2.4, 1.0, 2.0, '#3d5d36'], [4.4, 6.4, 0.1, 1.9, 0.9, 1.7, '#30502e'], [-0.6, 5.5, 1.3, 2.0, 0.9, 1.6, '#2b4729']];
  for (const [x, y, z, sx, sy, sz, c] of clumps) {
    const g = new THREE.IcosahedronGeometry(1, 0); g.scale(sx, sy, sz); g.translate(x, y, z);
    parts.push(col(g.index ? g.toNonIndexed() : g, c));
  }
  const g = mergeGeometries(parts.map((p) => { p.deleteAttribute('uv'); return p; })); g.computeVertexNormals();
  return g;
}

export function createCypress(spots) {
  const mat = swayMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), 0.35, 8.0);
  const mesh = new THREE.InstancedMesh(cypressGeometry(), mat, spots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  spots.forEach(([x, z, sc, rot], i) => {
    p.set(x, heightAt(x, z) - 0.3, z); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot); s.setScalar(sc);
    m.compose(p, q, s); mesh.setMatrixAt(i, m);
  });
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

// hand-placed: framing the tee, along the dunes, behind/right of the green
export const CYPRESS_SPOTS = [
  [-12, 222, 1.15, -0.3], [52, 214, 1.0, 0.2], [60, 186, 0.85, 0.5], [-30, 96, 1.2, -0.2], [-42, 40, 1.05, 0.1], [-38, -20, 1.25, -0.1],
  [-34, -88, 1.0, 0.3], [40, -60, 0.95, 0.4], [46, -110, 1.2, 0.0], [34, -160, 1.05, -0.4], [58, -138, 0.9, 0.6], [62, 30, 1.0, 0.2], [70, 120, 1.1, -0.2],
];
