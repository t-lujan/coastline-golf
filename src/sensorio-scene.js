// Sensorio (Field of Light): the scene dressing for Hole 4. Tens of thousands of small glowing orbs over the rolling hills
// (one instanced mesh of stemmed orbs for the near field, one additive point layer for the dense far glow), the pale
// walking paths draped on the ground, and the small visitor buildings. Colours drift slowly in a wave across the field.
import * as THREE from 'three';
import { heightAt, enToWorld, sphereField, teeDist, greenDist, fairwayDist, FAIRWAY_HALF, GREEN, TEE } from './maps/sensorio.js';

// OSM footways (local east/north metres from the site centre)
const PATHS = [
  [[28.9, -95.6], [56.6, -91.9], [85.0, -82.2], [105.5, -71.6], [119.9, -62.6], [128.7, -54.3], [136.4, -43.7], [142.9, -30.3], [148.2, -16.7], [149.7, -1.5], [152.6, -0.0], [157.6, 4.2], [163.0, 8.8], [166.9, 17.3], [170.3, 29.7], [170.8, 38.3], [167.4, 45.7], [162.6, 51.8], [156.2, 53.8], [148.3, 52.4], [144.8, 50.4], [141.1, 44.1], [138.7, 31.2], [137.4, 18.5], [136.4, 4.2], [142.6, -1.5], [149.7, -1.5]],
  [[144.8, 50.4], [143.2, 52.2], [139.2, 54.2], [138.1, 55.9], [137.8, 59.7], [140.2, 62.2], [142.1, 65.4], [147.1, 73.4], [149.0, 80.0], [148.2, 90.0], [145.1, 101.1], [139.0, 109.0], [129.5, 117.5], [116.0, 128.3], [100.6, 139.2], [88.5, 145.9], [73.1, 149.6], [57.8, 149.1], [44.1, 144.4], [36.1, 139.9], [33.0, 138.7], [28.8, 138.8], [19.4, 139.8], [11.5, 142.9], [6.9, 147.1], [2.2, 155.4], [-1.0, 160.8], [-5.6, 163.2], [-13.7, 163.4], [-19.6, 163.4], [-36.2, 167.1], [-41.2, 169.7], [-53.4, 176.1], [-60.8, 182.6], [-69.3, 194.1], [-73.0, 200.9], [-76.4, 209.2], [-81.5, 214.1], [-90.6, 217.1], [-98.8, 215.2], [-107.5, 210.3], [-111.5, 204.9], [-113.7, 196.4], [-111.9, 190.0], [-109.7, 184.5], [-107.3, 181.8], [-99.1, 175.6], [-91.8, 172.9], [-87.0, 170.8], [-81.4, 165.8], [-76.3, 157.6], [-73.4, 147.0], [-69.9, 137.3], [-66.4, 131.0], [-62.5, 123.3], [-58.2, 116.0], [-54.2, 112.2], [-51.6, 111.2], [-49.3, 101.3], [-42.8, 86.7], [-41.3, 80.8], [-34.9, 75.7], [-31.0, 72.2], [-26.2, 70.1], [-21.5, 70.8], [-18.6, 72.5], [-15.5, 76.2], [-13.7, 81.8], [-12.5, 90.6], [-9.4, 97.8], [2.3, 94.1], [18.0, 89.3], [58.8, 86.7], [108.2, 86.1], [112.3, 84.0], [117.0, 79.3], [124.1, 69.4], [131.6, 66.7], [142.1, 65.4], [152.3, 67.6], [161.0, 72.1], [167.8, 78.1]],
  [[33.0, 138.7], [30.4, 136.4], [24.9, 133.3], [18.9, 132.0], [16.0, 132.0], [-2.5, 134.8], [-9.5, 135.1], [-21.1, 133.9], [-32.7, 129.9], [-39.9, 125.2], [-43.3, 119.6], [-47.2, 113.6], [-51.6, 111.2]],
  [[-19.6, 163.4], [-21.9, 161.7], [-30.8, 160.8], [-47.4, 160.6], [-56.9, 162.1], [-67.9, 166.3], [-80.1, 170.7], [-87.0, 170.8]],
  [[-143.9, 209.6], [-140.2, 209.6], [-136.4, 209.2], [-134.0, 207.2], [-132.5, 203.8], [-129.0, 186.8], [-126.1, 183.2], [-121.3, 178.8], [-117.9, 178.0], [-114.7, 178.2], [-107.3, 181.8]],
  [[-9.4, 97.8], [-17.0, 100.1], [-23.6, 105.4]],
];
const BUILDINGS = [[[129.1, 7.2], [109.6, 1.9], [115.5, -19.6], [135.0, -14.3]], [[106.3, -12.4], [99.6, -14.0], [108.2, -43.2], [114.6, -41.2]]];

function segD(px, pz, a, b) {
  const vx = b.x - a.x, vz = b.z - a.z, t = Math.max(0, Math.min(1, ((px - a.x) * vx + (pz - a.z) * vz) / (vx * vx + vz * vz)));
  return Math.hypot(px - a.x - vx * t, pz - a.z - vz * t);
}

// the shared colour drift: a hue in the pink/magenta/violet/blue/cyan band that rolls across the field as a slow wave
const PALETTE = /* glsl */`
  uniform float uTime;
  vec3 hsv(float h, float s, float v){ vec3 k = clamp(abs(mod(h * 6. + vec3(0., 4., 2.), 6.) - 3.) - 1., 0., 1.); return v * mix(vec3(1.), k, s); }
  vec3 orbCol(vec3 wp, float ph, float kind){
    float w = sin(wp.x * 0.018 + wp.z * 0.011 - uTime * 0.35) * 0.5 + 0.5;
    float h = 0.5 + 0.45 * fract(ph + w * 0.55 + uTime * 0.012);          // 0.5 cyan .. 0.95 pink
    vec3 c = hsv(h, 0.9, 1.0);
    c = mix(c, vec3(1.0, 0.62, 0.25), step(0.93, kind));                  // a few warm amber
    c = mix(c, vec3(0.92, 0.94, 1.0), step(0.86, kind) * step(kind, 0.93)); // and some white
    return c * (0.8 + 0.35 * sin(uTime * 1.3 + ph * 40.0));
  }`;

export function createSensorioScene(qLevel = 'med') {
  const g = new THREE.Group(); g.name = 'sensorio';
  const uTime = { value: 0 };
  const nOrb = qLevel === 'low' ? 1100 : qLevel === 'high' ? 6000 : 2600, nPt = qLevel === 'low' ? 14000 : qLevel === 'high' ? 50000 : 32000, nNear = qLevel === 'low' ? 5000 : qLevel === 'high' ? 18000 : 12000;
  const paths = PATHS.map((p) => p.map(([e, n]) => enToWorld(e, n)));
  const pathDist = (x, z) => { let d = 1e9; for (const p of paths) for (let i = 0; i < p.length - 1; i++) d = Math.min(d, segD(x, z, p[i], p[i + 1])); return d; };
  // a spot is clear for an orb when the field wants one there and it is off the tee, green (+ collar), apron and paths
  const clear = (x, z) => teeDist(x, z) > 5 && greenDist(x, z) > 4.5 && fairwayDist(x, z) > FAIRWAY_HALF + 2 && pathDist(x, z) > 2.6;
  const R = { minX: -460, maxX: 460, minZ: -420, maxZ: 500 };
  const pick = (near) => {
    for (let k = 0; k < 40; k++) {
      let x, z;
      if (near) { const a = Math.random() * 6.283, r = 10 + Math.sqrt(Math.random()) * 200, cx = (TEE.x + GREEN.x) / 2, cz = (TEE.z + GREEN.z) / 2; x = cx + Math.cos(a) * r; z = cz + Math.sin(a) * r * 1.2; }
      else { x = R.minX + Math.random() * (R.maxX - R.minX); z = R.minZ + Math.random() * (R.maxZ - R.minZ); }
      if (Math.random() > sphereField(x, z) * 0.97 + 0.03 || !clear(x, z)) continue;
      return { x, z };
    }
    return null;
  };

  // near field: low-poly orbs on short stems, one instanced draw (orb verts carry glow 1, stem verts 0)
  const orb = new THREE.IcosahedronGeometry(0.2, 0); orb.translate(0, 0.85, 0);
  const stem = new THREE.CylinderGeometry(0.012, 0.012, 0.8, 3, 1, true); stem.translate(0, 0.4, 0);
  const pos = [...orb.toNonIndexed().attributes.position.array, ...stem.toNonIndexed().attributes.position.array];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const no = orb.toNonIndexed().attributes.position.count, glow = new Float32Array(pos.length / 3).fill(0).map((_, i) => (i < no ? 1 : 0));
  geo.setAttribute('aGlow', new THREE.Float32BufferAttribute(glow, 1));
  const ph = new Float32Array(nOrb * 2), mesh = new THREE.InstancedMesh(geo, null, nOrb);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  let orbs = 0, onGreen = 0, onPath = 0;
  for (let i = 0; i < nOrb; i++) {
    const at = pick(i < nOrb * 0.75); if (!at) continue;
    const sc = 0.8 + Math.random() * 0.5;
    mesh.setMatrixAt(orbs, m.compose(p.set(at.x, heightAt(at.x, at.z) - 0.05, at.z), q, s.set(sc, sc * (0.8 + Math.random() * 0.4), sc)));
    ph[orbs * 2] = Math.random(); ph[orbs * 2 + 1] = Math.random();
    if (greenDist(at.x, at.z) < 0) onGreen++; if (pathDist(at.x, at.z) < 1.25) onPath++;
    orbs++;
  }
  mesh.count = orbs;
  geo.setAttribute('aPh', new THREE.InstancedBufferAttribute(ph, 2));
  mesh.material = new THREE.ShaderMaterial({
    uniforms: { uTime }, fog: false,
    vertexShader: /* glsl */`
      attribute float aGlow; attribute vec2 aPh; varying vec3 vC;
      ${PALETTE}
      void main(){
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.);
        vC = mix(vec3(0.03, 0.03, 0.05), orbCol(wp.xyz, aPh.x, aPh.y) * 1.6, aGlow);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`varying vec3 vC; void main(){ gl_FragColor = vec4(vC, 1.); }`,
  });
  mesh.frustumCulled = false; g.add(mesh);

  // dense glow: one additive point layer (the whole field plus an extra carpet in the near field), round soft sprites sized in
  // world metres so the near orbs are big soft blooms and the far ones a fine glitter
  const nAll = nPt + nNear, pp = new Float32Array(nAll * 3), pa = new Float32Array(nAll * 2); let points = 0;
  for (let i = 0; i < nAll; i++) {
    const at = pick(i >= nPt); if (!at) continue;
    pp.set([at.x, heightAt(at.x, at.z) + 0.8, at.z], points * 3); pa.set([Math.random(), Math.random()], points * 2);
    if (greenDist(at.x, at.z) < 0) onGreen++; if (pathDist(at.x, at.z) < 1.25) onPath++;
    points++;
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(pp.subarray(0, points * 3), 3));
  pg.setAttribute('aPh', new THREE.BufferAttribute(pa.subarray(0, points * 2), 2));
  const ptMat = (size, maxPx, gain, core, drop) => new THREE.ShaderMaterial({
    uniforms: { uTime, uScale: { value: 420 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: /* glsl */`
      attribute vec2 aPh; uniform float uScale; varying vec3 vC;
      ${PALETTE}
      void main(){
        vC = orbCol(position, aPh.x, aPh.y);
        vec4 mv = viewMatrix * vec4(position - vec3(0., ${drop.toFixed(2)}, 0.), 1.); gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(uScale * ${size.toFixed(2)} / -mv.z, 1.5, ${maxPx.toFixed(1)});
        vC *= clamp(1.4 - (-mv.z) / 900.0, 0.45, 1.2);
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vC;
      void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d, d) * 4.0; if (r > 1.0) discard;
        float a = exp(-r * ${core.toFixed(1)}) + 0.22 * exp(-r * 1.6) * (1.0 - r); gl_FragColor = vec4(vC * a * ${gain.toFixed(2)}, 1.); }`,
  });
  // the orbs: a bright core with a soft halo (~0.9 m across)
  const pts = new THREE.Points(pg, ptMat(1.0, 34, 1.15, 8, 0));
  pts.frustumCulled = false; g.add(pts);
  // and the faint coloured light each one spills on the ground round it (a wide, dim second layer on the same points)
  const spill = new THREE.Points(pg, ptMat(4.0, 90, 0.06, 2, 0.7));
  spill.frustumCulled = false; g.add(spill);

  // paths: pale ~2.5 m ribbons draped on the ground, one mesh
  const pv = [], pi = [];
  for (const path of paths) {
    const pts2 = [];
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 2.5));
      for (let k = 0; k < n; k++) pts2.push({ x: a.x + (b.x - a.x) * k / n, z: a.z + (b.z - a.z) * k / n });
    }
    pts2.push(path[path.length - 1]);
    pts2.forEach((c, i) => {
      const a = pts2[Math.max(0, i - 1)], b = pts2[Math.min(pts2.length - 1, i + 1)], dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1, nx = -dz / l * 1.25, nz = dx / l * 1.25;
      const v0 = pv.length / 3;
      for (const sd of [-1, 1]) { const x = c.x + nx * sd, z = c.z + nz * sd; pv.push(x, heightAt(x, z) + 0.12, z); }
      if (i > 0) pi.push(v0 - 2, v0 - 1, v0, v0 - 1, v0 + 1, v0);
    });
  }
  const pathGeo = new THREE.BufferGeometry(); pathGeo.setAttribute('position', new THREE.Float32BufferAttribute(pv, 3)); pathGeo.setIndex(pi);
  const pathMesh = new THREE.Mesh(pathGeo, new THREE.MeshBasicMaterial({ color: 0x8a8296, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
  g.add(pathMesh);

  // the visitor buildings: dark low boxes (merged), their windows warm
  const bv = [], bc = [];
  for (const b of BUILDINGS) {
    const w = b.map(([e, n]) => enToWorld(e, n)), y0 = Math.min(...w.map((c) => heightAt(c.x, c.z))) - 0.5, y1 = y0 + 4.5;
    const wall = (a, c, warm) => {
      const col = warm ? [1.0, 0.62, 0.3] : [0.05, 0.05, 0.07];
      for (const [x, y, z] of [[a.x, y0, a.z], [c.x, y0, c.z], [c.x, y1, c.z], [a.x, y0, a.z], [c.x, y1, c.z], [a.x, y1, a.z]]) { bv.push(x, y, z); bc.push(...(y === y1 || !warm ? [0.05, 0.05, 0.07] : col)); }
    };
    for (let i = 0; i < 4; i++) wall(w[i], w[(i + 1) % 4], i % 2 === 0);
    for (const [a, c, d] of [[0, 1, 2], [0, 2, 3]]) for (const k of [a, c, d]) { bv.push(w[k].x, y1, w[k].z); bc.push(0.05, 0.05, 0.07); }
  }
  const bGeo = new THREE.BufferGeometry(); bGeo.setAttribute('position', new THREE.Float32BufferAttribute(bv, 3)); bGeo.setAttribute('color', new THREE.Float32BufferAttribute(bc, 3));
  const bMesh = new THREE.Mesh(bGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  g.add(bMesh);

  g.userData.info = { qLevel, orbs, points, onGreen, onPath, paths: paths.length };
  g.userData.update = (t) => { uTime.value = t; pts.material.uniforms.uScale.value = spill.material.uniforms.uScale.value = 420 * (window.innerHeight / 844); };
  return g;
}
