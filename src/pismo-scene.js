// Hole 3 · Pismo set dressing: the Pismo Beach Pier at true scale from its OpenStreetMap outline (wooden deck, pilings,
// railings, lamp posts), the "PISMO BEACH" arch at the head of the pier, the town by the pier from the OSM building
// footprints, and lifeguard towers down the beach. Everything is merged / instanced into a handful of draw calls; the lamp
// heads, sign letters and windows glow at night from one shared night factor (setPismoNight, fed from applyLook).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BOUNDS, TEE, WATER_LEVEL, FAIRWAY_HALF, heightAt, fairwayDist, teeDist } from './course.js';
import { placeReal, worldToLl, toeX, shoreX, creekDist, HEADING } from './maps/pismo.js';
// OSM way 122398887 outline and the building footprints within ~460 m of the pier base (centroid, local e/n m, w/d, rot° of w from east)
import PIER_OUTLINE from './maps/pismo-pier.json';
import BUILDINGS from './maps/pismo-buildings.json';

const NIGHT = { value: 0 };
let signMat = null;
export function setPismoNight(n) { NIGHT.value = n; if (signMat) signMat.emissiveIntensity = 0.06 + n * 1.6; }

const RAD = Math.PI / 180, M_LAT = 111200, M_LON = 111200 * Math.cos(35.14 * RAD);
const HS = Math.sin(HEADING * RAD), HC = Math.cos(HEADING * RAD);
function hash(i, k = 0) { const s = Math.sin(i * 127.1 + k * 311.7 + 0.5) * 43758.5453; return s - Math.floor(s); }
const Y = new THREE.Vector3(0, 1, 0);

// a box from p to q (world points) of cross-section w x h, with a flat vertex colour and a fixed uv (non-indexed)
function beam(p, q, w, h, col, uv = [0.5, 0.5]) {
  const d = new THREE.Vector3().subVectors(q, p), L = d.length();
  const g = new THREE.BoxGeometry(w, L, h).toNonIndexed();
  g.applyMatrix4(new THREE.Matrix4().compose(p.clone().add(q).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(Y, d.normalize()), new THREE.Vector3(1, 1, 1)));
  paint(g, col, uv); return g;
}
function paint(g, col, uv) {
  const n = g.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set([col.r, col.g, col.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  if (uv) { const u = g.attributes.uv; for (let i = 0; i < n; i++) u.setXY(i, uv[0], uv[1]); }
  return g;
}

// ---------- the pier ----------
const PIER_A = placeReal(35.13880, -120.64305), PIER_B = placeReal(35.13766, -120.64665);
const PIER_LEN = Math.hypot(PIER_B.x - PIER_A.x, PIER_B.z - PIER_A.z);
const AX = (PIER_B.x - PIER_A.x) / PIER_LEN, AZ = (PIER_B.z - PIER_A.z) / PIER_LEN;   // unit along the pier (seaward)
const toTS = (x, z) => ({ t: (x - PIER_A.x) * AX + (z - PIER_A.z) * AZ, s: (x - PIER_A.x) * AZ - (z - PIER_A.z) * AX });
const fromTS = (t, s) => ({ x: PIER_A.x + AX * t + AZ * s, z: PIER_A.z + AZ * t - AX * s });
const DECK0 = heightAt(PIER_A.x, PIER_A.z) + 3.0, DECK1 = WATER_LEVEL + 6.6;
const deckY = (t) => DECK0 + (DECK1 - DECK0) * Math.min(1, Math.max(0, t / PIER_LEN));

function plankTexture() {
  const W = 256, H = 512, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d'), n = 24, ph = H / n;   // planks run across the pier (u), stacked along it (v)
  g.fillStyle = '#3b3530'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < n; i++) {
    const seam = hash(i, 3) * W;
    for (const [x0, x1] of [[0, seam], [seam, W]]) {
      const k = hash(i, x0 > 0 ? 7 : 5), l = 92 + k * 46, r = l + 8 + hash(i, 9) * 10, b = l - 10 - hash(i, 11) * 8;
      g.fillStyle = `rgb(${r | 0},${(l * 0.97) | 0},${b | 0})`; g.fillRect(x0 + 1, i * ph + 1, x1 - x0 - 2, ph - 2.5);
      for (let k2 = 0; k2 < 5; k2++) { g.fillStyle = `rgba(40,34,28,${0.08 + hash(i * 7 + k2, 13) * 0.1})`; g.fillRect(x0, i * ph + 2 + hash(i, k2) * (ph - 5), x1 - x0, 1); }
    }
    g.fillStyle = 'rgba(30,26,22,0.6)'; g.fillRect(seam - 1, i * ph, 2, ph);
  }
  const tex = new THREE.CanvasTexture(cv); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}

// [smin, smax] of the outline across the pier at along-distance t
function crossAt(P, t) {
  let lo = 1e9, hi = -1e9;
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    if ((a.t - t) * (b.t - t) > 0 || a.t === b.t) continue;
    const s = a.s + (b.s - a.s) * (t - a.t) / (b.t - a.t); lo = Math.min(lo, s); hi = Math.max(hi, s);
  }
  return [lo, hi];
}

function createPier(level) {
  const pts = PIER_OUTLINE.slice(0, -1).map(([la, lo]) => placeReal(la, lo)), P = pts.map((p) => toTS(p.x, p.z));
  // deck: the outline extruded 0.45 m thick, sloped with the deck line, planks via uv in pier coordinates
  const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, -p.z)));
  let deck = new THREE.ExtrudeGeometry(shape, { depth: 0.45, bevelEnabled: false }).rotateX(-Math.PI / 2);
  { const p = deck.attributes.position, uv = deck.attributes.uv;
    for (let i = 0; i < p.count; i++) { const q = toTS(p.getX(i), p.getZ(i)); p.setY(i, p.getY(i) - 0.45 + deckY(q.t)); uv.setXY(i, q.s / 4.2, q.t / 3.6); }
    deck.computeVertexNormals(); }
  paint(deck, new THREE.Color(1, 1, 1), null);
  const parts = [deck], rail = new THREE.Color(0.62, 0.6, 0.56), beamC = new THREE.Color(0.42, 0.39, 0.36);
  const V = (t, s, dy) => { const w = fromTS(t, s); return new THREE.Vector3(w.x, deckY(t) + dy, w.z); };
  // railings along every outline edge except the landward end: posts every ~2.4 m, a top and a mid rail
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length]; if (a.t < 0.5 && b.t < 0.5) continue;
    const L = Math.hypot(b.t - a.t, b.s - a.s); if (L < 0.3) continue;
    parts.push(beam(V(a.t, a.s, 1.08), V(b.t, b.s, 1.08), 0.16, 0.12, rail), beam(V(a.t, a.s, 0.55), V(b.t, b.s, 0.55), 0.08, 0.1, rail));
    const n = Math.max(1, Math.round(L / 2.4));
    for (let k = 0; k < n; k++) { const f = k / n, t = a.t + (b.t - a.t) * f, s = a.s + (b.s - a.s) * f; parts.push(beam(V(t, s, 0), V(t, s, 1.14), 0.14, 0.14, rail)); }
  }
  // pile caps: a transverse timber under the deck at every piling row
  const rows = [];
  for (let t = 3; t < PIER_LEN + 6; t += 6) { const [s0, s1] = crossAt(P, t); if (s1 - s0 > 2) rows.push({ t, s0, s1 }); }
  for (const r of rows) parts.push(beam(V(r.t, r.s0 + 0.2, -0.75), V(r.t, r.s1 - 0.2, -0.75), 0.45, 0.4, beamC));
  // stringers along the deck underside
  for (const s of [-1.6, 2.0, 5.6]) parts.push(beam(V(-1, s, -0.62), V(PIER_LEN, s, -0.62), 0.3, 0.3, beamC));
  const geo = mergeGeometries(parts);
  const mat = new THREE.MeshLambertMaterial({ map: plankTexture(), vertexColors: true });
  const deckMesh = new THREE.Mesh(geo, mat); deckMesh.receiveShadow = true;

  // pilings (pairs/triples per row, more under the bump-outs and the T-head) and X-bracing, one instanced mesh
  const cyl = new THREE.CylinderGeometry(1, 1, 1, level === 'low' ? 6 : 8, 1, true).translate(0, 0.5, 0);
  const inst = [], m = new THREE.Matrix4(), q = new THREE.Quaternion();
  const put = (p, top, r) => { const d = new THREE.Vector3().subVectors(top, p), L = d.length(); q.setFromUnitVectors(Y, d.normalize()); inst.push(m.clone().compose(p, q, new THREE.Vector3(r, L, r))); };
  rows.forEach((r, ri) => {
    const w = r.s1 - r.s0 - 1.2, n = level === 'low' ? 2 : Math.min(7, Math.max(3, Math.round(w / 3.4) + 1)), piles = [];
    for (let k = 0; k < n; k++) {
      const s = r.s0 + 0.6 + w * k / (n - 1), c = fromTS(r.t, s), g = heightAt(c.x, c.z);
      const bot = new THREE.Vector3(c.x, g - 1.5, c.z), top = new THREE.Vector3(c.x, deckY(r.t) - 0.9, c.z);
      put(bot, top, r.t > 120 ? 0.26 : 0.2); piles.push({ c, g, top: top.y });
    }
    // X-braces between the outer piles where there is room under the deck (every other row at med, none at low)
    const a = piles[0], b = piles[piles.length - 1], lowY = Math.max(a.g, b.g, WATER_LEVEL - 0.5) + 0.6;
    if (level !== 'low' && ri % 2 === 0 && a.top - lowY > 2) {
      put(new THREE.Vector3(a.c.x, lowY, a.c.z), new THREE.Vector3(b.c.x, a.top - 0.2, b.c.z), 0.09);
      put(new THREE.Vector3(b.c.x, lowY, b.c.z), new THREE.Vector3(a.c.x, a.top - 0.2, a.c.z), 0.09);
    }
  });
  const pileMat = new THREE.MeshLambertMaterial({ color: 0x5d5650 });
  const piles = new THREE.InstancedMesh(cyl, pileMat, inst.length);
  inst.forEach((mm, i) => piles.setMatrixAt(i, mm));

  // lamp posts every ~15 m on both sides; the lantern heads glow at night (aGlow), no real lights
  const post = paint(new THREE.CylinderGeometry(0.06, 0.08, 4.2, 6, 1, false).translate(0, 2.1, 0).toNonIndexed(), new THREE.Color(0.16, 0.19, 0.18), null);
  const arm = paint(new THREE.BoxGeometry(0.06, 0.06, 0.55).translate(0, 4.1, -0.25).toNonIndexed(), new THREE.Color(0.16, 0.19, 0.18), null);
  const head = paint(new THREE.CylinderGeometry(0.16, 0.22, 0.42, 6).translate(0, 3.8, -0.5).toNonIndexed(), new THREE.Color(1, 0.94, 0.8), null);
  const cap = paint(new THREE.ConeGeometry(0.3, 0.22, 6).translate(0, 4.12, -0.5).toNonIndexed(), new THREE.Color(0.16, 0.19, 0.18), null);
  for (const g of [post, arm, cap]) g.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count), 1));
  head.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(head.attributes.position.count).fill(1), 1));
  const lampGeo = mergeGeometries([post, arm, head, cap]);
  const lampMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  lampMat.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = NIGHT;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight;\nvarying float vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.8, 0.5) * vGlow * (0.05 + uNight * 2.6);');
  };
  const lampsAt = [];
  for (let t = 9; t < PIER_LEN - 2; t += 15) for (const side of [0, 1]) {
    const [s0, s1] = crossAt(P, t), s = side ? s1 - 0.35 : s0 + 0.35; lampsAt.push({ t, s, side });
  }
  const lamps = new THREE.InstancedMesh(lampGeo, lampMat, lampsAt.length);
  lampsAt.forEach((l, i) => {
    const c = fromTS(l.t, l.s), yaw = Math.atan2(-AZ, AX);   // arm reaches inboard over the deck
    q.setFromAxisAngle(Y, yaw + (l.side ? Math.PI : 0));
    lamps.setMatrixAt(i, m.compose(new THREE.Vector3(c.x, deckY(l.t), c.z), q, new THREE.Vector3(1, 1, 1)));
  });
  const grp = new THREE.Group(); grp.add(deckMesh, piles, lamps); grp.name = 'pier';
  const end = (t) => { const c = fromTS(t, 0), g = heightAt(c.x, c.z); return { x: c.x, z: c.z, deck: deckY(t), ground: g, aboveGround: deckY(t) - Math.max(g, WATER_LEVEL), ...worldToLl(c.x, c.z) }; };
  grp.userData.info = { ends: [end(0), end(PIER_LEN)], length: PIER_LEN, piles: inst.length, lamps: lampsAt.length };
  return grp;
}

// ---------- the "PISMO BEACH" arch at the head of the pier ----------
const SIGN = placeReal(35.13874, -120.64283);
function createSign() {
  const W = 1024, H = 320, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ecv = document.createElement('canvas'); ecv.width = W; ecv.height = H;
  const g = cv.getContext('2d'), e = ecv.getContext('2d');
  // v 0..0.2 (bottom 64 px): solid stucco for the posts; the panel fills the rest
  g.fillStyle = '#e8dfca'; g.fillRect(0, H - 64, W, 64); e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
  g.fillStyle = '#1d4a68'; g.fillRect(0, 0, W, H - 64);
  for (const c of [g, e]) { c.strokeStyle = c === g ? '#f4e9cf' : '#5a4a30'; c.lineWidth = 10; c.strokeRect(12, 12, W - 24, H - 64 - 24); }
  for (const c of [g, e]) {
    c.font = 'bold 168px "Trebuchet MS", "Arial Black", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineJoin = 'round'; c.lineWidth = 16; c.strokeStyle = c === g ? '#c9512c' : '#5a1c0c'; c.strokeText('PISMO BEACH', W / 2, (H - 64) / 2 + 6, W - 90);
    c.fillStyle = c === g ? '#fff4d8' : '#ffe2a8'; c.fillText('PISMO BEACH', W / 2, (H - 64) / 2 + 6, W - 90);
  }
  const tex = new THREE.CanvasTexture(cv), etex = new THREE.CanvasTexture(ecv);
  for (const t of [tex, etex]) { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; }
  const span = 15, half = span / 2, y0 = heightAt(SIGN.x, SIGN.z), base = y0 + 5.2, rise = 1.3, bh = 2.3, th = 0.35, N = 28, V0 = 64 / H;
  // local frame: across = world z (the arch spans the promenade), faces look along ±x (out to the pier / into town)
  const pos = [], uv = [], idx = [];
  const yc = (u) => base + rise * Math.sin(Math.PI * u);
  const quadStrip = (fx, flip) => {
    const o = pos.length / 3;
    for (let i = 0; i <= N; i++) { const u = i / N, z = flip ? -half + span * u : half - span * u;
      pos.push(fx, yc(u) - bh / 2, z, fx, yc(u) + bh / 2, z); uv.push(u, V0, u, 1); }
    for (let i = 0; i < N; i++) { const a = o + i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  };
  quadStrip(th / 2, false); quadStrip(-th / 2, true);
  let band = new THREE.BufferGeometry(); band.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); band.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); band.setIndex(idx);
  band = band.toNonIndexed(); band.computeVertexNormals(); band.deleteAttribute('normal'); band.computeVertexNormals();
  const parts = [band], stucco = new THREE.Color(1, 1, 1), sv = [0.5, V0 * 0.5];
  // top / bottom edges of the band
  for (let i = 0; i < N; i++) for (const sgn of [-1, 1]) {
    const u0 = i / N, u1 = (i + 1) / N, za = half - span * u0, zb = half - span * u1;
    parts.push(beam(new THREE.Vector3(0, yc(u0) + sgn * bh / 2, za), new THREE.Vector3(0, yc(u1) + sgn * bh / 2, zb), th + 0.08, 0.14, stucco, sv));
  }
  for (const z of [-half - 0.3, half + 0.3]) {
    parts.push(beam(new THREE.Vector3(0, y0 - 0.5, z), new THREE.Vector3(0, base + bh / 2 + 0.5, z), 0.9, 0.9, stucco, sv));
    parts.push(beam(new THREE.Vector3(0, base + bh / 2 + 0.5, z), new THREE.Vector3(0, base + bh / 2 + 0.9, z), 1.2, 1.2, new THREE.Color(0.75, 0.42, 0.3), sv));
  }
  for (const p of parts) if (!p.attributes.color) paint(p, stucco, null);
  const geo = mergeGeometries(parts);
  signMat = new THREE.MeshLambertMaterial({ map: tex, emissiveMap: etex, emissive: 0xffffff, emissiveIntensity: 0.06, vertexColors: true, side: THREE.FrontSide });
  const mesh = new THREE.Mesh(geo, signMat); mesh.position.set(SIGN.x, 0, SIGN.z); mesh.name = 'pismo-sign';
  // square the arch across the pier's axis
  mesh.rotation.y = Math.atan2(-AZ, AX);
  mesh.userData.info = { x: SIGN.x, z: SIGN.z, ground: y0, top: base + rise + bh / 2, ...worldToLl(SIGN.x, SIGN.z) };
  return mesh;
}

// ---------- the town by the pier ----------
const PALETTE = ['#f1e4cf', '#ead3b2', '#f5f0e6', '#cfe1e1', '#ebcdb9', '#d8e3cc', '#f0dca2', '#cad8e6', '#e9e0d3', '#f2d6c4'].map((c) => new THREE.Color(c));
function townMaterial() {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = NIGHT;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aRoof;\nvarying float vRoof;\nvarying vec3 vWin;\nvarying vec3 vN;\nvarying vec2 vSeed;\nvarying float vH;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vWin = position * sc; vN = normal; vRoof = aRoof; vSeed = instanceMatrix[3].xz; vH = sc.y;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        uniform float uNight; varying float vRoof; varying vec3 vWin; varying vec3 vN; varying vec2 vSeed; varying float vH;
        float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float rk = h21(vSeed * 0.37);
        vec3 roofC = rk < 0.35 ? vec3(0.50, 0.29, 0.21) : rk < 0.7 ? vec3(0.33, 0.31, 0.30) : vec3(0.46, 0.43, 0.39);
        diffuseColor.rgb = mix(diffuseColor.rgb, roofC * (0.85 + 0.3 * h21(vSeed)), vRoof);
        float wall = (1.0 - vRoof) * step(abs(vN.y), 0.5);
        float hx = abs(vN.x) > 0.5 ? vWin.z : vWin.x, fy = (vWin.y - 1.4) / 3.3;
        float col = fract(hx / 3.1 + 0.25), row = fract(fy);
        float win = wall * step(0.25, col) * step(col, 0.72) * step(0.3, row) * step(row, 0.78) * step(0.0, fy) * step(vWin.y, vH - 0.9);
        vec2 cell = vec2(floor(hx / 3.1 + 0.25), floor(fy)) + vSeed;
        float lit = step(0.45, h21(cell));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.13, 0.16, 0.19), win * 0.85);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(1.0, 0.74, 0.42) * win * lit * uNight * 1.3;`);
  };
  return mat;
}
function unitBuilding(hip) {
  // walls: unit box 0..1 high; roof: hip (ridge along x) or flat with a dark top and a low parapet
  const walls = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0).toNonIndexed(), parts = [walls];
  if (!hip) {
    // tint the top face as roof
    const n = walls.attributes.normal, r = new Float32Array(walls.attributes.position.count);
    for (let i = 0; i < r.length; i++) r[i] = n.getY(i) > 0.5 ? 1 : 0;
    walls.setAttribute('aRoof', new THREE.BufferAttribute(r, 1));
    const par = new THREE.BoxGeometry(0.97, 0.04, 0.97).translate(0, 1.02, 0).toNonIndexed();
    par.setAttribute('aRoof', new THREE.BufferAttribute(new Float32Array(par.attributes.position.count).fill(1), 1)); parts.push(par);
  } else {
    walls.setAttribute('aRoof', new THREE.BufferAttribute(new Float32Array(walls.attributes.position.count), 1));
    const o = 0.53, k = 1 + 0.13, rx = 0.22;
    const v = [[-o, 1, -o], [o, 1, -o], [o, 1, o], [-o, 1, o], [-rx, k, 0], [rx, k, 0]];
    const f = [[3, 2, 5], [3, 5, 4], [1, 0, 4], [1, 4, 5], [2, 1, 5], [0, 3, 4], [0, 1, 2], [0, 2, 3]];
    const p = []; for (const t of f) for (const i of t) p.push(...v[i]);
    const roof = new THREE.BufferGeometry(); roof.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); roof.computeVertexNormals();
    roof.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(p.length / 3 * 2), 2));
    roof.setAttribute('aRoof', new THREE.BufferAttribute(new Float32Array(p.length / 3).fill(1), 1)); parts.push(roof);
  }
  for (const g of parts) paint(g, new THREE.Color(1, 1, 1), null);
  return mergeGeometries(parts);
}
function footprint(b) {
  const p = placeReal(b.lat, b.lon), r = b.rot * RAD, e = Math.cos(r), n = Math.sin(r);
  const a = e * HS + n * HC, c = e * HC - n * HS, ux = c, uz = -a;     // world direction of the footprint's w axis
  const corners = [];
  for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) corners.push({ x: p.x + (ux * i * b.w + uz * j * b.d) / 2, z: p.z + (uz * i * b.w - ux * j * b.d) / 2 });
  return { p, yaw: Math.atan2(-uz, ux), corners };
}
function createTown() {
  const keep = [], kept = [], ft = (x, z) => fairwayDist(x, z);
  let minFw = 1e9;
  const list = BUILDINGS.map((b, i) => ({ b, i, area: b.w * b.d })).sort((u, v) => v.area - u.area);
  for (const { b, i } of list) {
    if (Math.hypot(b.e, b.n) > 450 || b.w < 3 || b.d < 3) continue;
    const real = { a: b.e * HS + b.n * HC };
    const F = footprint(b), { p } = F;
    if (p.x < BOUNDS.minX + 60 || p.x > BOUNDS.maxX - 60 || p.z < BOUNDS.minZ + 60 || p.z > BOUNDS.maxZ - 60) continue;
    let ok = true, fw = 1e9;
    for (const c of [p, ...F.corners]) {
      const d = ft(c.x, c.z); fw = Math.min(fw, d);
      if (d < FAIRWAY_HALF + 12 || teeDist(c.x, c.z) < 12 || c.x > toeX(c.z) - 2 || creekDist(c.x, c.z) < 4 || Math.hypot(c.x - SIGN.x, c.z - SIGN.z) < 12) { ok = false; break; }
    }
    if (!ok) continue;
    // past the true-scale zone the along-shore squeeze would stack footprints: keep the bigger one where they collide
    const rad = 0.5 * Math.min(b.w, b.d);
    if (real.a > 60 && kept.some((k) => Math.hypot(k.x - p.x, k.z - p.z) < 0.9 * (k.rad + rad))) continue;
    kept.push({ x: p.x, z: p.z, rad });
    let lo = 1e9, hi = -1e9; for (const c of F.corners) { const h = heightAt(c.x, c.z); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    const lv = b.levels ? +b.levels : b.w * b.d > 800 ? 2 : hash(i, 1) < 0.42 ? 1 : 2;
    const vespera = Math.hypot(b.lat - 35.13827, (b.lon + 120.64211) * 0.82) < 0.0003;
    const H = vespera ? 12 : lv === 1 ? 4.2 + hash(i, 2) * 1.3 : lv * 3.3 + 0.6 + hash(i, 2) * 0.8;
    keep.push({ b, i, F, base: lo - 0.6, top: hi + H, hip: b.w * b.d < 700 && !vespera && hash(i, 4) < 0.55 });
    minFw = Math.min(minFw, fw);
  }
  const mat = townMaterial(), grp = new THREE.Group(); grp.name = 'town';
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
  for (const hip of [false, true]) {
    const L = keep.filter((k) => k.hip === hip); if (!L.length) continue;
    const im = new THREE.InstancedMesh(unitBuilding(hip), mat, L.length);
    L.forEach((k, j) => {
      q.setFromAxisAngle(Y, k.F.yaw);
      im.setMatrixAt(j, m.compose(new THREE.Vector3(k.F.p.x, k.base, k.F.p.z), q, new THREE.Vector3(k.b.w, k.top - k.base, k.b.d)));
      im.setColorAt(j, c.copy(PALETTE[Math.floor(hash(k.i, 6) * PALETTE.length)]).multiplyScalar(0.9 + 0.12 * hash(k.i, 8)));
    });
    im.receiveShadow = true; grp.add(im);
  }
  grp.userData.info = { count: keep.length, minFairwayDist: minFw };
  return grp;
}

// ---------- lifeguard towers at the compressed creek / Grand Ave / Pier Ave marks ----------
function createTowers() {
  const white = new THREE.Color(0.93, 0.93, 0.9), blue = new THREE.Color(0.42, 0.64, 0.78), wood = new THREE.Color(0.5, 0.46, 0.4), V = (x, y, z) => new THREE.Vector3(x, y, z);
  const parts = [];
  for (const [x, z] of [[-1.1, -1.1], [1.1, -1.1], [1.1, 1.1], [-1.1, 1.1]]) parts.push(beam(V(x, -0.5, z), V(x, 2.6, z), 0.16, 0.16, wood));
  parts.push(beam(V(0, 2.55, -1.5), V(0, 2.55, 1.5), 3.0, 0.16, white));              // platform
  parts.push(paint(new THREE.BoxGeometry(2.0, 1.9, 2.0).translate(-0.3, 3.6, 0).toNonIndexed(), blue, null));   // hut
  parts.push(paint(new THREE.BoxGeometry(0.05, 0.7, 1.6).translate(0.72, 3.9, 0).toNonIndexed(), new THREE.Color(0.12, 0.14, 0.16), null)); // window to the sea
  parts.push(paint(new THREE.BoxGeometry(2.6, 0.14, 2.5).translate(-0.3, 4.6, 0).toNonIndexed(), white, null));  // roof
  for (const z of [-1.45, 1.45]) parts.push(beam(V(0.8, 3.5, z), V(1.45, 3.5, z), 0.06, 0.06, white), beam(V(1.45, 2.6, z), V(1.45, 3.5, z), 0.06, 0.06, white));
  parts.push(beam(V(1.45, 3.5, -1.45), V(1.45, 3.5, 1.45), 0.06, 0.06, white));
  parts.push(beam(V(-3.6, 0, 0), V(-1.5, 2.55, 0), 0.9, 0.08, wood));                 // ramp up from the landward side
  for (const g of parts) g.deleteAttribute('uv');
  const geo = mergeGeometries(parts);
  const marks = [[35.12867, -120.63924, 26], [35.1221, -120.6345, 0], [35.1056, -120.6305, 12]], at = [];
  for (const [la, lo, dz] of marks) {
    const p = placeReal(la, lo), z = p.z + dz; let x = shoreX(z) - 32;
    while (fairwayDist(x, z) < FAIRWAY_HALF + 14 && x < shoreX(z) - 12) x += 2;
    at.push({ x, z, y: heightAt(x, z) });
  }
  const im = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }), at.length), m = new THREE.Matrix4();
  at.forEach((p, i) => im.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z)));
  im.name = 'lifeguard-towers'; im.userData.at = at;
  return im;
}

export function createPismoScene(level = 'med') {
  const grp = new THREE.Group(), pier = createPier(level), sign = createSign(), town = createTown(), towers = createTowers();
  grp.add(pier, sign, town, towers);
  let tris = 0;
  grp.traverse((o) => { if (o.isMesh) { const g = o.geometry, n = (g.index ? g.index.count : g.attributes.position.count) / 3; tris += n * (o.isInstancedMesh ? o.count : 1); } });
  grp.userData.info = { pierEnds: pier.userData.info.ends, pierLength: pier.userData.info.length, piles: pier.userData.info.piles, lamps: pier.userData.info.lamps,
    signPos: sign.userData.info, buildingCount: town.userData.info.count, minBuildingFairwayDist: town.userData.info.minFairwayDist, towers: towers.userData.at, tris, meshes: 0 };
  grp.traverse((o) => { if (o.isMesh) grp.userData.info.meshes++; });
  return grp;
}
