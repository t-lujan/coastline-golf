// Sensorio (Field of Light): the scene dressing for Hole 4. Tens of thousands of small glowing orbs over the rolling hills
// (one instanced mesh of stemmed orbs for the near field, one additive point layer for the dense far glow), the pale
// walking paths draped on the ground, and the small visitor buildings. Colours drift slowly in a wave across the field.
import * as THREE from 'three';
import { heightAt, enToWorld, sphereField, teeDist, greenDist, fairwayDist, FAIRWAY_HALF, GREEN, TEE, PLATFORM, STAIR, stairDist } from './maps/sensorio.js';

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

// the raised tee's walk: from the stair foot 40 m on, turning toward the nearest OSM footway point
function stairPath(paths) {
  const B = PLATFORM.back, fx = STAIR.x0 + B.dx * STAIR.len, fz = STAIR.z0 + B.dz * STAIR.len;
  let best = null, bd = 1e9; for (const p of paths) for (const c of p) { const d = Math.hypot(c.x - fx, c.z - fz); if (d < bd) { bd = d; best = c; } }
  const mx = fx + B.dx * 12, mz = fz + B.dz * 12;
  const dx = best.x - mx, dz = best.z - mz, l = Math.hypot(dx, dz) || 1, r = Math.min(28, l);
  return [{ x: fx + B.dx * 0.6, z: fz + B.dz * 0.6 }, { x: mx, z: mz }, { x: mx + dx / l * r, z: mz + dz / l * r }];
}
// boxes pushed into one non-indexed buffer with per-box colour (top faces lit, sides shaded): the tee platform's parts
function boxes(list) {
  const v = [], c = [];
  for (const { x0, x1, y0, y1, z0, z1, col } of list) {
    const P = (i) => [i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0];
    for (const [f, sh] of [[[2, 6, 7, 3], 1], [[0, 1, 5, 4], 0.4], [[0, 4, 6, 2], 0.7], [[1, 3, 7, 5], 0.7], [[0, 2, 3, 1], 0.8], [[4, 5, 7, 6], 0.8]]) {
      for (const i of [f[0], f[1], f[2], f[0], f[2], f[3]]) { v.push(...P(i)); c.push(col.r * sh, col.g * sh, col.b * sh); }
    }
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true }));
}
// the raised tee: stone retaining wall (block-coursed faces + capstone lip), stairs down the back, and a railing on the sides
// and back (the front edge stays open for the view to the green); three draw calls
export function buildTeePlatform(group) {
  const { x, z, w, d, top, wallH, back } = PLATFORM, foot = top - wallH, rnd = (k) => { const s = Math.sin(k * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  const stone = new THREE.Color(0x4a4038), wall = [];
  // the four faces in 0.5 m courses of ~1.2 m blocks, alternate courses offset half a block, each block a shade apart
  const faces = [[x - w, x + w, z + d, 0, 1], [x - w, x + w, z - d, 0, -1], [z - d, z + d, x + w, 1, 1], [z - d, z + d, x - w, 1, -1]];
  faces.forEach(([a, b, at, side, sg], fi) => {
    for (let r = 0; r < wallH / 0.5; r++) {
      const y0 = foot - 0.4 + r * 0.5, y1 = foot + (r + 1) * 0.5, n = Math.ceil((b - a) / 1.2);
      for (let k = -1; k < n; k++) {
        const s0 = Math.max(a, a + (k + (r % 2) * 0.5) * 1.2), s1 = Math.min(b, a + (k + 1 + (r % 2) * 0.5) * 1.2); if (s1 <= s0) continue;
        const t = 0.82 + 0.3 * rnd(fi * 1000 + r * 50 + k), col = stone.clone().multiplyScalar(t), o0 = at + sg * 0.02, o1 = at + sg * 0.3;
        const [p0, p1] = [Math.min(o0, o1), Math.max(o0, o1)];
        wall.push(side ? { x0: p0, x1: p1, y0, y1, z0: s0 + 0.02, z1: s1 - 0.02, col } : { x0: s0 + 0.02, x1: s1 - 0.02, y0, y1, z0: p0, z1: p1, col });
      }
    }
  });
  const cap = stone.clone().multiplyScalar(1.25);
  wall.push({ x0: x - w - 0.4, x1: x + w + 0.4, y0: top - 0.05, y1: top + 0.06, z0: z + d - 0.1, z1: z + d + 0.4, col: cap }, { x0: x - w - 0.4, x1: x + w + 0.4, y0: top - 0.05, y1: top + 0.06, z0: z - d - 0.4, z1: z - d + 0.1, col: cap },
    { x0: x + w - 0.1, x1: x + w + 0.4, y0: top - 0.05, y1: top + 0.06, z0: z - d, z1: z + d, col: cap }, { x0: x - w - 0.4, x1: x - w + 0.1, y0: top - 0.05, y1: top + 0.06, z0: z - d, z1: z + d, col: cap });
  const wallMesh = boxes(wall); wallMesh.name = 'teeWall';
  // stairs: one slab per step, run along `back` (the deck sits square to the world axes and `back` is ~+z)
  const pale = new THREE.Color(0xb8ae9c), st = [];
  for (let i = 0; i < STAIR.steps; i++) {
    const cx = STAIR.x0 + back.dx * (i + 0.5) * 0.32, cz = STAIR.z0 + back.dz * (i + 0.5) * 0.32, y1 = top - (i + 1) * 0.18 + 0.06;
    st.push({ x0: cx - STAIR.half, x1: cx + STAIR.half, y0: Math.min(y1 - 0.3, heightAt(cx, cz) - 0.4), y1, z0: cz - 0.17, z1: cz + 0.17, col: pale.clone().multiplyScalar(0.9 + 0.15 * rnd(i)) });
  }
  const stairMesh = boxes(st); stairMesh.name = 'teeStairs';
  // railing: posts every 2 m and a top rail on both sides and the back (gap at the stair head)
  const metal = new THREE.Color(0x2a2a30), rl = [], ph = 1.05, pw = 0.035;
  const post = (px, pz) => rl.push({ x0: px - pw, x1: px + pw, y0: top, y1: top + ph, z0: pz - pw, z1: pz + pw, col: metal });
  const rail = (ax, az, bx, bz) => rl.push({ x0: Math.min(ax, bx) - 0.03, x1: Math.max(ax, bx) + 0.03, y0: top + ph - 0.05, y1: top + ph + 0.02, z0: Math.min(az, bz) - 0.03, z1: Math.max(az, bz) + 0.03, col: metal });
  const bz = z + d * Math.sign(back.dz || 1) - 0.15 * Math.sign(back.dz || 1), fz = z - d * Math.sign(back.dz || 1);
  for (const sx of [x - w + 0.15, x + w - 0.15]) { for (let t = 0; t <= 2 * d + 1e-6; t += 2) post(sx, Math.min(fz, bz) + t * (Math.abs(bz - fz) / (2 * d))); rail(sx, fz, sx, bz); }
  const gap = STAIR.half + 0.15;
  for (let t = 0; t <= 2 * w + 1e-6; t += 2) { const px = x - w + 0.15 + t * ((2 * w - 0.3) / (2 * w)); if (Math.abs(px - STAIR.x0) > gap) post(px, bz); }
  post(STAIR.x0 - gap, bz); post(STAIR.x0 + gap, bz);
  rail(x - w + 0.15, bz, STAIR.x0 - gap, bz); rail(STAIR.x0 + gap, bz, x + w - 0.15, bz);
  const railMesh = boxes(rl); railMesh.name = 'teeRail';
  group.add(wallMesh, stairMesh, railMesh);
  group.userData.tee = { tris: [wallMesh, stairMesh, railMesh].map((m) => m.geometry.attributes.position.count / 3) };
}

export function createSensorioScene(qLevel = 'med') {
  const g = new THREE.Group(); g.name = 'sensorio';
  const uTime = { value: 0 };
  const nOrb = qLevel === 'low' ? 1100 : qLevel === 'high' ? 6000 : 2600, nPt = qLevel === 'low' ? 14000 : qLevel === 'high' ? 50000 : 32000, nNear = qLevel === 'low' ? 5000 : qLevel === 'high' ? 18000 : 12000;
  const paths = PATHS.map((p) => p.map(([e, n]) => enToWorld(e, n)));
  paths.push(stairPath(paths));
  const pathDist = (x, z) => { let d = 1e9; for (const p of paths) for (let i = 0; i < p.length - 1; i++) d = Math.min(d, segD(x, z, p[i], p[i + 1])); return d; };
  // a spot is clear for an orb when the field wants one there and it is off the tee, green (+ collar), apron and paths
  const clear = (x, z) => teeDist(x, z) > 5 && greenDist(x, z) > 4.5 && fairwayDist(x, z) > FAIRWAY_HALF + 2 && pathDist(x, z) > 2.6 && stairDist(x, z) > STAIR.half + 2;
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

  g.userData.info = { qLevel, orbs, points, onGreen, onPath, paths: PATHS.length };
  buildTeePlatform(g);
  g.userData.update = (t) => { uTime.value = t; pts.material.uniforms.uScale.value = spill.material.uniforms.uScale.value = 420 * (window.innerHeight / 844); };
  return g;
}
