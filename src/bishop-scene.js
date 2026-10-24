// Everything that is specific to the Bishop Peak map: the real-elevation backdrop (Bishop Peak, Cerro San Luis, the Nine
// Sisters fading into haze), Bishop's rock outcrops, the white "M", the Madonna Inn, and the dry-grass / chaparral /
// oak scatter. Heights come from the active map's heightAt (baked Terrarium tiles under a hand-shaped hole).
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { BOUNDS, GREEN, TEE, HEADING, heightAt, surfaceAt, bunkerDist, fbm } from './course.js';
import { LM, pondDist, sightK, enToWorld, elevAt, baseY } from './maps/bishop.js';
import { fbm3, GLSL_NOISE } from './noise.js';
import { rng, swayMaterial, scatter, clump, mergeTree, nearPlay, posOnly } from './vegetation.js';

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const RAD = Math.PI / 180;
// a little self-illumination (a fraction of the albedo) so a shaded, distant landmark still reads in its own colours
const selfLit = (mat, k) => { mat.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `outgoingLight += diffuseColor.rgb * ${k.toFixed(2)};\n#include <opaque_fragment>`); }; return mat; };
const toNonIndexed = (g) => { g = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k); return g; };
// world rotation that turns a model's +z toward a compass bearing
const faceBearing = (b) => { const a = (b - HEADING) * RAD; return Math.atan2(Math.sin(a), -Math.cos(a)); };
// the valley haze sits low: thin it over the high ground (Bishop's crown) so the summit rock keeps its own darker, warm
// colour at 1-2 km instead of fading to a pale blue-white dome. Needs a world-position varying vWP.
const PEAK_FOG = `#ifdef USE_FOG
  float fogFactor = (1.0 - exp(- fogDensity * fogDensity * vFogDepth * vFogDepth)) * (1.0 - PEAK_K * smoothstep(PEAK_Y0, PEAK_Y1, vWP.y));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
#endif`.replace('PEAK_K', '0.8').replace('PEAK_Y0', '260.0').replace('PEAK_Y1', '420.0');

// ---------- the backdrop: the real landscape around the hole, two vertex-coloured meshes ----------
// NEAR: a rectangle round the hole and the morros it looks at (Cerro San Luis ahead, Bishop and Chumash Peak to the
// right) on a separable grid that is finest over the peaks (16-24 m) and coarse (70 m) elsewhere; the cells under the
// playable terrain are left out. FAR: a coarse warped square out to ~14 km (the rest of the Nine Sisters, the Irish
// Hills, the Santa Lucia foothills) with the near rectangle cut out; where its cells overlap the near mesh their inner
// corners are tucked just under it, so the two meet without cracks.
export const NEAR_RECT = { minX: -4000, maxX: 2200, minZ: -5400, maxZ: 1200 };
// fine over Cerro San Luis / the M (x -950..100, z -1850..-800) and Bishop / Chumash (x -3000..-1250, z -4900..-3100)
const BANDS_X = [[-950, 100, 16], [-3000, -1250, 24]], BANDS_Z = [[-1850, -800, 18], [-4900, -3100, 24]];
function axis(a, b, bands, coarse, k) {
  const out = [a]; let v = a;
  while (v < b - 1) {
    let s = coarse * k;
    for (const [lo, hi, f] of bands) { const d = Math.max(lo - v, v - hi, 0); s = Math.min(s, lerp(f * k, coarse * k, sstep(0, 350, d))); }
    v = Math.min(b, v + s); if (b - v < s * 0.4) v = b; out.push(v);
  }
  return out;
}
const bsearch = (arr, v) => { let lo = 0, hi = arr.length - 2; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (arr[m] <= v) lo = m; else hi = m - 1; } return lo; };

// what a patch of hillside is covered with, from its real elevation, slope, aspect and whether it sits in a draw
const COL = {
  gold0: [0.48, 0.38, 0.21], gold1: [0.62, 0.51, 0.31], green: [0.3, 0.32, 0.14], oak: [0.1, 0.13, 0.06], chap: [0.22, 0.24, 0.13],
  rock: [0.34, 0.26, 0.17], rock2: [0.43, 0.34, 0.22], lichen: [0.42, 0.32, 0.17], joint: [0.2, 0.18, 0.15], town: [0.3, 0.32, 0.22],
};
const mix3 = (c, d, t) => { c[0] += (d[0] - c[0]) * t; c[1] += (d[1] - c[1]) * t; c[2] += (d[2] - c[2]) * t; };
export function landColor(x, z, out) {
  const e = 22, h = heightAt(x, z), hx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e), hz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
  const slope = Math.hypot(hx, hz), elev = elevAt(x, z);
  // a draw (concave ground) collects water: oaks; a nose or ridge sheds it: grass
  const ring = (heightAt(x + 60, z) + heightAt(x - 60, z) + heightAt(x, z + 60) + heightAt(x, z - 60)) / 4, curv = (ring - h) / 60;
  // north-facing slopes stay cooler and carry the oak woodland (world -z points at bearing HEADING)
  const nb = HEADING * RAD, north = slope > 0.05 ? (hx * Math.sin(nb) + hz * Math.cos(nb)) / slope : 0;   // downhill . north
  const n1 = fbm(x * 0.0016, z * 0.0016), n2 = fbm(x * 0.0035 + 5, z * 0.0035 - 3), n3 = fbm(x * 0.012, z * 0.012);
  out[0] = COL.gold0[0]; out[1] = COL.gold0[1]; out[2] = COL.gold0[2];
  mix3(out, COL.gold1, Math.min(1, n2 * 0.9 + n3 * 0.3));
  mix3(out, COL.green, sstep(0.55, 0.75, n1 + Math.max(0, curv) * 2) * 0.4 * (1 - sstep(90, 200, elev)));       // late-season green in the swales
  // patchy, crisp-edged woodland (not an olive wash): a draw / north-face tendency broken up by noise
  const oak = sstep(0.6, 0.68, n2 * 0.55 + n3 * 0.3 + Math.max(0, curv) * 7 + north * 0.3 * sstep(0.08, 0.25, slope) - 0.1) * sstep(52, 75, elev) * (1 - sstep(340, 420, elev)) * (1 - sstep(0.9, 1.3, slope));
  mix3(out, COL.oak, oak * 0.7);
  // chaparral: patchy on the steep upper slopes and north faces everywhere; the morros (Bishop, Chumash) wear a nearly
  // continuous dark coat of it above the grassy lower slopes
  const rb0 = Math.hypot(x - LM.bishop.x, z - LM.bishop.z), rch0 = Math.hypot(x - LM.chumash.x, z - LM.chumash.z), morro = 1 - sstep(700, 1100, Math.min(rb0, rch0));
  const chap = Math.max(sstep(0.66, 0.72, slope * 0.7 + n2 * 0.45 + north * 0.15 + (n3 - 0.5) * 0.25) * sstep(130, 200, elev),
    morro * sstep(170, 230, elev + n2 * 60) * sstep(0.35, 0.5, n2 + n3 * 0.3 + north * 0.2));
  mix3(out, COL.chap, chap * (1 - oak) * 0.9);
  // the valley floor out toward town: street trees and roofs, a muted mottle
  const r = Math.hypot(x, z); mix3(out, COL.town, sstep(1400, 2400, r) * (1 - sstep(70, 95, elev)) * (1 - sstep(0.12, 0.25, slope)) * 0.6 * sstep(0.35, 0.6, n3));
  // grey rock: Bishop Peak's crown and upper south / east faces, a little on Cerro San Luis and Chumash near their tops
  const rb = Math.hypot(x - LM.bishop.x, z - LM.bishop.z), rc = Math.hypot(x - LM.cerro.x, z - LM.cerro.z), rch = Math.hypot(x - LM.chumash.x, z - LM.chumash.z);
  const rockB = Math.min(1, sstep(320, 400, elev + n3 * 40) * sstep(0.2, 0.55, slope + n2 * 0.3) + sstep(250, 330, elev + n3 * 50) * sstep(0.6, 0.9, slope + n2 * 0.3) * 0.8) * (1 - sstep(380, 620, rb));
  const rockO = (sstep(330, 380, elev) * (1 - sstep(150, 300, rc)) + sstep(320, 370, elev) * (1 - sstep(150, 300, rch))) * sstep(0.45, 0.8, slope + n3 * 0.3) * 0.6;
  // weathered granite: pale where the slabs are bare, darker in the joints and lichen, so the crown reads as broken rock
  const rk = [COL.rock[0], COL.rock[1], COL.rock[2]]; mix3(rk, COL.rock2, sstep(0.35, 0.7, n3 * 0.7 + n2 * 0.5 - 0.1));
  mix3(rk, COL.lichen, sstep(0.55, 0.8, n2 * 0.8 - n3 * 0.4 + 0.3) * 0.45); mix3(rk, COL.joint, sstep(0.25, 0.05, n3 * 0.7 + n2 * 0.5 - 0.1) * 0.6);
  mix3(out, rk, Math.min(0.95, rockB + rockO));
  return h;
}

function gridMesh(xs, zs, skip, heightFn) {
  const cols = xs.length, rows = zs.length, pos = new Float32Array(cols * rows * 3), col = new Float32Array(cols * rows * 3), H = new Float32Array(cols * rows), c = [0, 0, 0];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const k = j * cols + i, x = xs[i], z = zs[j];
    landColor(x, z, c); const h = heightFn(x, z, i, j);
    pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z; H[k] = h; col.set(c, k * 3);
  }
  const idx = [];
  for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) {
    if (skip(i, j)) continue;
    const k = j * cols + i; idx.push(k, k + cols, k + 1, k + 1, k + cols, k + cols + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(cols * rows > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1)); g.computeVertexNormals();
  return { g, H };
}
function backdropMaterial(offset) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: offset, polygonOffsetUnits: offset * 4 });
  // break the vertex colours up with world-space mottling (grass clumps, oak crowns, rock bands) so a slope a kilometre
  // away is not a smooth blur
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\n${GLSL_NOISE}\nvarying vec3 vWP;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float m1 = cgN2(vWP.xz * 0.011), m2 = cgN2(vWP.xz * 0.045 + 7.0), m3 = cgN2(vWP.xz * 0.19), gul = cgN2(vec2(vWP.x * 0.02 + vWP.z * 0.011, vWP.y * 0.09));
        float md = length(cameraPosition - vWP), near = 1.0 - smoothstep(700.0, 3000.0, md);
        // dark speckle of individual oak crowns and shrubs on the grass, strongest close up
        float dots = smoothstep(0.72, 0.86, cgN2(vWP.xz * 0.37 + 3.0) * 0.6 + cgN2(vWP.xz * 0.9) * 0.4) * near * 0.3;
        diffuseColor.rgb *= (0.84 + 0.36 * (m1 * 0.45 + m2 * 0.35 + m3 * 0.2)) * mix(1.0, 0.86 + 0.28 * gul, near) * (1.0 - dots);`)
      .replace('#include <fog_fragment>', PEAK_FOG);
  };
  return mat;
}
export function createBackdrop(level = 'med') {
  const k = level === 'high' ? 0.8 : level === 'low' ? 1.45 : 1.18;
  const R = NEAR_RECT, xs = axis(R.minX, R.maxX, BANDS_X, 70, k), zs = axis(R.minZ, R.maxZ, BANDS_Z, 55, k), cols = xs.length;
  const B = { minX: BOUNDS.minX + 25, maxX: BOUNDS.maxX - 25, minZ: BOUNDS.minZ + 25, maxZ: BOUNDS.maxZ - 25 };
  const near = gridMesh(xs, zs, (i, j) => { const cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2; return cx > B.minX && cx < B.maxX && cz > B.minZ && cz < B.maxZ; }, (x, z) => heightAt(x, z));
  const NH = near.H;
  // the height of the near mesh's own (flat) triangles at (x, z): what anything draped on the hills must follow
  const surfaceY = (x, z) => {
    const i = bsearch(xs, Math.min(R.maxX - 0.01, Math.max(R.minX, x))), j = bsearch(zs, Math.min(R.maxZ - 0.01, Math.max(R.minZ, z)));
    const u = Math.min(1, Math.max(0, (x - xs[i]) / (xs[i + 1] - xs[i]))), v = Math.min(1, Math.max(0, (z - zs[j]) / (zs[j + 1] - zs[j]))), q = j * cols + i;
    const h00 = NH[q], h10 = NH[q + 1], h01 = NH[q + cols], h11 = NH[q + cols + 1];
    return u + v <= 1 ? h00 + u * (h10 - h00) + v * (h01 - h00) : h11 + (1 - u) * (h01 - h11) + (1 - v) * (h10 - h11);
  };
  const inside = (x, z) => x > R.minX && x < R.maxX && z > R.minZ && z < R.maxZ;
  // far ring: a square warped toward the hole, ~14 km out
  const n = level === 'high' ? 84 : level === 'low' ? 52 : 68, half = 14000, cx0 = -1500, cz0 = -2500, a = 0.22;
  const warp = (u) => half * (a * u + (1 - a) * u * u * u), fx = [], fz = [];
  for (let i = 0; i <= n; i++) { fx.push(cx0 + warp(i / n * 2 - 1)); fz.push(cz0 + warp(i / n * 2 - 1)); }
  const far = gridMesh(fx, fz, (i, j) => inside(fx[i], fz[j]) && inside(fx[i + 1], fz[j]) && inside(fx[i], fz[j + 1]) && inside(fx[i + 1], fz[j + 1]),
    (x, z) => (inside(x, z) ? surfaceY(x, z) - 6 : heightAt(x, z)));
  const g = new THREE.Group();
  const mNear = new THREE.Mesh(near.g, backdropMaterial(2)), mFar = new THREE.Mesh(far.g, backdropMaterial(5));
  mNear.frustumCulled = mFar.frustumCulled = false; mNear.name = 'backdrop-near'; mFar.name = 'backdrop-far';
  g.add(mNear, mFar); g.userData.surfaceY = surfaceY; g.userData.tris = (near.g.index.count + far.g.index.count) / 3;
  return g;
}

// ---------- Bishop Peak's rocky crown: piles of big grey rock on its real summit knobs, flat-shaded, one draw call ----------
// Bishop Peak's top is a short west-east crest of two summits about 120 m apart (465 m and 462 m on the 10 m heightmap)
// with a lower east knob, a rocky spur running south-east and the climbers' faces on the south side. Each entry is a
// pile of boulders: [east, north offset from the surveyed summit (m), spread (m), boulders, size (m)]
const CROWN = [
  [25, 0, 34, 9, 30], [-80, -20, 30, 8, 27], [75, -50, 26, 6, 22], [-25, -15, 30, 5, 18], [110, -85, 22, 5, 18], [130, -150, 22, 4, 16],
  [150, -210, 20, 4, 14], [-115, -105, 22, 5, 17], [-105, -170, 20, 4, 14], [-170, -40, 20, 4, 13], [5, 85, 22, 3, 12], [60, 40, 18, 3, 12],
  [-40, -70, 24, 5, 15], [40, -100, 20, 4, 14], [-60, 60, 18, 3, 11], [200, -260, 18, 3, 11],
];
export function createBishopKnobs(detail = 1) {
  const B = LM.bishop, parts = [], crest = [], R = rng(21);
  const boulder = (x, z, size, si) => {
    let g = new THREE.IcosahedronGeometry(1, detail); g.deleteAttribute('normal'); g.deleteAttribute('uv'); g = mergeVertices(g);
    const p = g.attributes.position, col = [], yaw = R() * 6.28, cs = Math.cos(yaw), sn = Math.sin(yaw);
    const sx = size * (0.8 + R() * 0.45), sz = size * (0.7 + R() * 0.4), sy = size * (0.6 + R() * 0.35);   // never taller than wide
    const y0 = heightAt(x, z) - sy * 0.35;
    for (let i = 0; i < p.count; i++) {
      const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
      // rounded, jointed blocks: a little noise, the top squashed flatter, the base buried
      const nn = 0.72 + fbm3(vx * 1.9 + si * 3.1, vy * 1.9, vz * 1.9, 2) * 0.56, top = vy > 0.3 ? lerp(vy, 0.3 + (vy - 0.3) * 0.35, 0.8) : vy;
      const X = vx * sx * nn, Y = Math.max(-0.6, top) * sy * nn, Z = vz * sz * nn;
      const wx = x + X * cs - Z * sn, wz = z + X * sn + Z * cs, wy = y0 + Y;
      p.setXYZ(i, wx, wy, wz);
      if (vy > 0.4) crest.push(new THREE.Vector3(wx, wy, wz));
      const s = fbm3(vx * 3 + si, vy * 3, vz * 3, 2), lichen = sstep(0.55, 0.75, fbm3(vx * 5 + 7, vy * 5, vz * 5 + si, 2)), shade = vy < -0.2 ? 0.75 : 1;
      const gr = (0.29 + s * 0.16) * shade;   // warm tan-grey granite, darker in the joints underneath, orange lichen patches
      col.push(lerp(gr * 1.08, 0.44, lichen * 0.4), lerp(gr * 0.95, 0.33, lichen * 0.4), lerp(gr * 0.64, 0.14, lichen * 0.4));
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); parts.push(toNonIndexed(g));
  };
  CROWN.forEach(([de, dn, spread, n, size], ci) => {
    const c = enToWorld(de, dn);
    for (let b = 0; b < n; b++) {
      const a = R() * 6.28, r = b ? spread * Math.sqrt(R()) : 0;
      boulder(B.x + c.x + Math.cos(a) * r, B.z + c.z + Math.sin(a) * r, size * (b ? 0.55 + R() * 0.5 : 1), ci * 10 + b);
    }
  });
  // loose rock and small outcrops over the upper slopes (steepest on the south and east faces)
  for (let t = 0, placed = 0; placed < 46 && t < 3000; t++) {
    const a = R() * 6.28, r = 60 + Math.sqrt(R()) * 420, x = B.x + Math.cos(a) * r, z = B.z + Math.sin(a) * r, el = elevAt(x, z);
    if (el < 300 + R() * 40) continue;
    const e = 15, sl = Math.hypot(heightAt(x + e, z) - heightAt(x - e, z), heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
    if (sl < 0.35 && R() < 0.7) continue;
    boulder(x, z, 3 + R() * R() * 8, 300 + placed); placed++;
  }
  const geo = mergeGeometries(parts); geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;').replace('#include <fog_fragment>', PEAK_FOG);
  };
  const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.castShadow = false; m.name = 'bishop-rocks';
  m.userData.crest = crest.filter((_, i) => i % 4 === 0);
  return m;
}

// ---------- the white "M" on the east face of Cerro San Luis Obispo ----------
// Real scale (~36 m tall up the slope, ~34 m wide), laid flat on the hillside: every vertex is dropped onto the surface
// the backdrop actually draws there (surfaceY) and lifted 0.7 m, with a polygon offset on top, so it never sinks into
// or floats off the slope. The letter reads square-on from downhill along the slope's fall line.
export const M_SIZE = { h: 36, w: 34, stroke: 6.5 };
export function createCerroM(surfaceY = heightAt) {
  const { x: cx, z: cz } = LM.m, e = 30;
  const gx = (heightAt(cx + e, cz) - heightAt(cx - e, cz)) / (2 * e), gz = (heightAt(cx, cz + e) - heightAt(cx, cz - e)) / (2 * e), gl = Math.hypot(gx, gz) || 1;
  const up = { x: gx / gl, z: gz / gl }, right = { x: -up.z, z: up.x }, slope = Math.atan(gl);
  const { h: Hh, w: W, stroke: T } = M_SIZE, mid = Hh * 0.3;
  // the M as four strokes in (u, v), v up the slope, centred on the spot
  const strokes = [[[-W / 2 + T / 2, 0], [-W / 2 + T / 2, Hh]], [[W / 2 - T / 2, 0], [W / 2 - T / 2, Hh]], [[-W / 2 + T * 0.7, Hh - T * 0.3], [0, mid]], [[W / 2 - T * 0.7, Hh - T * 0.3], [0, mid]]];
  const P = [], I = [], toWorld = (u, v) => { v -= Hh / 2; const hx = cx + right.x * u + up.x * v * Math.cos(slope), hz = cz + right.z * u + up.z * v * Math.cos(slope); return [hx, surfaceY(hx, hz) + 0.7, hz]; };
  for (const [[u0, v0], [u1, v1]] of strokes) {
    const L = Math.hypot(u1 - u0, v1 - v0), tx = (u1 - u0) / L, ty = (v1 - v0) / L, nx = -ty, ny = tx, steps = Math.ceil(L / 3), base = P.length / 3;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      for (const side of [-1, 0, 1]) P.push(...toWorld(u0 + (u1 - u0) * t + nx * side * T / 2, v0 + (v1 - v0) * t + ny * side * T / 2));
      if (s) for (let c = 0; c < 2; c++) { const a = base + (s - 1) * 3 + c; I.push(a, a + 3, a + 1, a + 1, a + 3, a + 4); }
    }
  }
  // wind every triangle so it faces the sky (the strokes run in both directions)
  for (let i = 0; i < I.length; i += 3) {
    const [a, b, c] = [I[i], I[i + 1], I[i + 2]], ux = P[b * 3] - P[a * 3], uz = P[b * 3 + 2] - P[a * 3 + 2], vx = P[c * 3] - P[a * 3], vz = P[c * 3 + 2] - P[a * 3 + 2];
    if (uz * vx - ux * vz < 0) { I[i + 1] = c; I[i + 2] = b; }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(I); g.computeVertexNormals();
  const mat = selfLit(new THREE.MeshLambertMaterial({ color: 0xf2f0e8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 }), 0.35);
  const m = new THREE.Mesh(g, mat); m.name = 'cerro-m';
  m.frustumCulled = false; m.userData = { slope, up, spot: { x: cx, z: cz }, size: { ...M_SIZE }, lift: 0.7 };
  return m;
}

// ---------- the Madonna Inn: one recognisable complex, merged into a single mesh ----------
// The Swiss-chalet main building on its rough boulder ground floor (the stone came off Cerro San Luis), white walls,
// steep pink roofs with irregular cross gables, pink trim, stone chimneys and a round turret at the south end, and the
// long, low guest wing running off to the north. No interiors, no lettering.
export function createMadonnaInn(surfaceY = heightAt) {
  const parts = [], R = rng(41);
  const STONE = [0.46, 0.42, 0.38], STONE2 = [0.6, 0.55, 0.48], WALL = [0.93, 0.9, 0.86], PINK = [0.92, 0.42, 0.56], PINK2 = [0.8, 0.33, 0.47], TRIM = [0.98, 0.56, 0.68], WIN = [0.12, 0.13, 0.17], GOLD = [0.78, 0.62, 0.3];
  const put = (g, col, jitter = 0) => {
    g = toNonIndexed(g); const p = g.attributes.position, c = [];
    for (let i = 0; i < p.count; i += 3) { const j = 1 + (R() - 0.5) * jitter; for (let q = 0; q < 3; q++) c.push(col[0] * j, col[1] * j, col[2] * j); }
    g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3)); parts.push(g);
  };
  const box = (w, h, d, x, y, z, col, jit = 0) => put(new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z), col, jit);
  // rough boulder walls: a subdivided box whose faces bulge in and out stone by stone, each stone its own grey-brown
  const stoneWall = (w, h, d, x, y, z) => {
    const g = new THREE.BoxGeometry(w, h, d, Math.max(1, Math.round(w / 2.2)), Math.max(1, Math.round(h / 1.4)), Math.max(1, Math.round(d / 2.2))), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i), n = fbm3(vx * 0.9 + x, vy * 0.9, vz * 0.9 + z, 2) - 0.5;
      p.setXYZ(i, vx * (1 + (Math.abs(vx) > w / 2 - 0.01 ? n * 0.06 : 0)), vy, vz * (1 + (Math.abs(vz) > d / 2 - 0.01 ? n * 0.08 : 0)));
    }
    g.translate(x, y + h / 2, z); g.deleteAttribute('uv');
    const ng = toNonIndexed(g), q = ng.attributes.position, c = [];
    for (let i = 0; i < q.count; i += 6) { const t = R(), col = t < 0.5 ? STONE : t < 0.8 ? STONE2 : [0.38, 0.34, 0.3], j = 0.85 + R() * 0.3; for (let k = 0; k < 6 && i + k < q.count; k++) c.push(col[0] * j, col[1] * j, col[2] * j); }
    ng.setAttribute('color', new THREE.Float32BufferAttribute(c, 3)); parts.push(ng);
  };
  // a steep gable roof over a w x d footprint, ridge along x (alongX) or z, with pink bargeboards and a white gable end
  const gable = (w, d, h, x, y, z, alongX, col = PINK, over = 0.9) => {
    const hw = (alongX ? d : w) / 2 + over, hl = (alongX ? w : d) / 2 + over;
    const P = [[-hl, 0, -hw], [hl, 0, -hw], [hl, 0, hw], [-hl, 0, hw], [-hl, h, 0], [hl, h, 0]];
    const quad = (q, c) => { const g = new THREE.BufferGeometry(), v = []; for (const t of [[q[0], q[1], q[2]], [q[0], q[2], q[3]]]) for (const i of t) v.push(...P[i]); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.computeVertexNormals(); if (!alongX) g.rotateY(Math.PI / 2); g.translate(x, y, z); put(g, c, 0.08); };
    quad([0, 4, 5, 1], col); quad([3, 2, 5, 4], col.map((v) => v * 0.9));
    for (const s of [-1, 1]) {
      const ex = s * (hl - over), g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(s > 0 ? [ex, 0, -hw + over, ex, 0, hw - over, ex, h * (1 - over / hw), 0] : [ex, 0, hw - over, ex, 0, -hw + over, ex, h * (1 - over / hw), 0], 3));
      g.computeVertexNormals(); if (!alongX) g.rotateY(Math.PI / 2); g.translate(x, y, z); put(g, WALL);
      // bargeboards: two pink strips along the gable's rake
      for (const side of [-1, 1]) {
        const len = Math.hypot(hw, h), bb = new THREE.BoxGeometry(0.5, 0.45, len).rotateX(side * Math.atan2(h, hw)).translate(s * (hl - 0.2), h / 2, side * hw / 2);
        if (!alongX) bb.rotateY(Math.PI / 2); bb.translate(x, y, z); put(bb, TRIM);
      }
    }
  };
  const windows = (x0, x1, y, z, n, w = 1.3, h = 1.7) => { for (let i = 0; i < n; i++) { const x = lerp(x0, x1, (i + 0.5) / n); box(w, h, 0.25, x, y, z, WIN); box(w + 0.7, 0.3, 0.3, x, y + h, z, PINK2); } };
  const chimney = (x, z, y, h) => { stoneWall(2.2, h, 2.2, x, y, z); box(2.6, 0.5, 2.6, x, y + h, z, STONE2); };
  // main building: 62 m long, a storey of boulders under a white storey, ridge along x, facade toward +z
  stoneWall(62, 4.2, 15, 0, 0, 0); box(61.4, 4.2, 14.4, 0, 4.2, 0, WALL, 0.03); box(62.6, 0.45, 15.6, 0, 4.1, 0, TRIM);
  gable(61.4, 14.4, 9.5, 0, 8.4, 0, true);
  windows(-27, 27, 5.4, 7.25, 14); windows(-27, 27, 5.4, -7.25, 14);
  for (let i = 0; i < 8; i++) box(2.6, 2.4, 0.3, -24 + i * 6.8, 0.6, 7.6, WIN);
  // irregular cross gables on the facade: different widths, heights and depths
  for (const [x, w, d, hh, rh] of [[-21, 11, 8, 8.4, 9], [-3, 14, 10, 9.6, 10.5], [17, 9, 7, 8.4, 8.2]]) {
    stoneWall(w, 4.2, d, x, 0, 7.5 + d / 2 - 1); box(w - 0.5, hh - 4.2, d - 0.5, x, 4.2, 7.5 + d / 2 - 1, WALL, 0.03);
    gable(w - 0.5, d - 0.5, rh, x, hh, 7.5 + d / 2 - 1, false, x === -3 ? PINK : PINK2);
    windows(x - w / 2 + 2, x + w / 2 - 2, 5.6, 7.5 + d - 0.7, 2, 1.4, 2.0); box(2.4, 3.2, 0.3, x, 0.3, 7.5 + d - 0.75, GOLD);
  }
  // a dormer pair on the back slope, chimneys of the same rough stone
  for (const x of [-12, 8]) { box(4, 2.6, 3, x, 9.2, -3.6, WALL); gable(4, 3, 2.4, x, 11.8, -3.6, false, PINK2, 0.4); }
  chimney(-14, -1.5, 8.4, 9.5); chimney(6, 1.5, 8.4, 10.5); chimney(25, -2, 8.4, 8.5);
  // the round turret at the south (-x) end: boulder drum, white upper, tall pink cone
  { const tx = -34, tz = 6, r = 4.2;
    put(new THREE.CylinderGeometry(r * 1.06, r * 1.12, 5, 14, 3).translate(tx, 2.5, tz), STONE, 0.3);
    put(new THREE.CylinderGeometry(r, r, 9, 14).translate(tx, 9.5, tz), WALL, 0.03);
    put(new THREE.CylinderGeometry(r * 1.08, r * 1.08, 0.6, 14).translate(tx, 14.2, tz), TRIM);
    put(new THREE.ConeGeometry(r * 1.35, 11, 14).translate(tx, 14.5 + 5.5, tz), PINK, 0.06);
    for (let i = 0; i < 5; i++) { const a = i * 1.26 + 0.3; box(1.0, 1.7, 0.3, tx + Math.cos(a) * r, 9.5, tz + Math.sin(a) * r, WIN); } }
  // the end gable over the south end, a step down
  stoneWall(12, 4, 16, -37, 0, -4); box(11.5, 3.4, 15.5, -37, 4, -4, WALL); gable(11.5, 15.5, 7, -37, 7.4, -4, false, PINK2);
  // the long, low guest wing to the north (+x), slightly kinked, with little dormers
  for (const [x, z, len, yaw] of [[64, -3, 38, -0.08], [100, -9, 34, -0.2]]) {
    const wing = []; const keep = parts.length;
    stoneWall(len, 1.8, 10, 0, 0, 0); box(len - 0.4, 2.6, 9.6, 0, 1.8, 0, WALL, 0.03); box(len, 0.35, 10.3, 0, 4.3, 0, TRIM);
    gable(len - 0.4, 9.6, 4.6, 0, 4.4, 0, true, PINK2, 0.8);
    windows(-len / 2 + 2, len / 2 - 2, 2.1, 4.85, Math.round(len / 4.5), 1.2, 1.4);
    for (let i = 0; i < Math.floor(len / 10); i++) { const dx = -len / 2 + 6 + i * 10; box(2.6, 2, 2, dx, 6.0, 3.2, WALL); gable(2.6, 2, 1.8, dx, 8, 3.2, false, PINK, 0.3); }
    for (let i = keep; i < parts.length; i++) wing.push(parts[i]);
    for (const g of wing) g.rotateY(yaw).translate(x, 0, z);
  }
  // terrace wall and planters along the front
  stoneWall(52, 1.0, 1.2, -2, 0, 20);
  for (let i = 0; i < 6; i++) put(new THREE.IcosahedronGeometry(1.4, 0).scale(1, 0.8, 1).translate(-24 + i * 9.5, 1.6, 20.5), [0.16, 0.24, 0.09], 0.2);
  const geo = mergeGeometries(parts); geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, selfLit(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }), 0.22));
  // the true place, the facade turned east-north-east toward US-101 as in life, drawn true size: it stands ~260 m behind the tee
  const S = 1.0; m.rotation.y = faceBearing(70); m.scale.setScalar(S);
  let lo = 1e9; for (const [dx, dz] of [[-40, -10], [40, -10], [-40, 20], [40, 20], [0, 0], [100, -10]]) { const c = Math.cos(m.rotation.y), s = Math.sin(m.rotation.y); lo = Math.min(lo, surfaceY(LM.inn.x + (dx * c + dz * s) * S, LM.inn.z + (-dx * s + dz * c) * S)); }
  m.position.set(LM.inn.x, lo - 0.6, LM.inn.z);
  m.frustumCulled = false; m.name = 'madonna-inn'; m.userData.size = 140 * S;
  return m;
}

// ---------- scatter: dry golden grass, chaparral and sage scrub, granite boulders ----------
const REGION = { x0: -250, x1: 130, z0: -170, z1: 300 };
const inRegion = (R) => [REGION.x0 + R() * (REGION.x1 - REGION.x0), REGION.z0 + R() * (REGION.z1 - REGION.z0)];
export function createDryGrass(count, fringe = 0) {
  const P = [], N = [], C = [];
  for (let b = 0; b < 4; b++) {
    const a = b * 1.57 + 0.3, ca = Math.cos(a), sa = Math.sin(a), lean = 0.16 + b * 0.05, w = 0.05;
    const pts = [[-w, 0, 0], [w, 0, 0], [-w * 0.55, 0.55, lean * 0.45], [w * 0.55, 0.55, lean * 0.45], [0, 1 - b * 0.1, lean]];
    const R = ([x, y, z]) => [x * ca + z * sa + ca * 0.04, y, -x * sa + z * ca - sa * 0.04];
    for (const t of [[0, 1, 2], [1, 3, 2], [2, 3, 4]]) for (const i of t) { P.push(...R(pts[i])); N.push(0, 1, 0); const k = pts[i][1]; C.push(0.62 + k * 0.6, 0.62 + k * 0.58, 0.6 + k * 0.45); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  const mesh = new THREE.InstancedMesh(geo, swayMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), 1.0, 1.0, { flatNormal: true }), count + fringe);
  const rand = rng(11);
  const tuft = (R, x, z, p, q, s, c, tall) => {
    const hgt = tall ? 0.4 + R() * R() * 0.9 : 0.28 + R() * 0.4, jx = (R() - 0.5) * 1.4, jz = (R() - 0.5) * 1.4;
    p.set(x + jx, heightAt(x + jx, z + jz) - 0.03, z + jz);
    q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, R() * 6.28);
    const la = R() * 6.28, lean = R() * 0.34; q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(Math.cos(la), 0, Math.sin(la)), lean));
    const w = 0.9 + R() * 0.9; s.set(w, hgt, w);
    const k = 0.8 + R() * 0.4, green = fbm(x * 0.03 + 9, z * 0.03) > 0.62 ? 1 : 0;
    if (green || R() < 0.1) c.setRGB(0.25 * k, 0.31 * k, 0.11 * k); else if (R() < 0.4) c.setRGB(0.56 * k, 0.46 * k, 0.25 * k); else c.setRGB(0.74 * k, 0.63 * k, 0.37 * k);
    return { color: true };
  };
  let placed = 0;
  scatter(mesh, count + fringe, rand, (R, p, q, s, c) => {
    if (placed < fringe) {
      // a ring of grass around the green and tee so the putting surface and the box sit in a frame
      const a = R() * 6.28, gd = 1.7 + Math.pow(R(), 1.6) * 14, x = GREEN.x + Math.cos(a) * (GREEN.rx + gd), z = GREEN.z + Math.sin(a) * (GREEN.rz + gd);
      const surf = surfaceAt(x, z); if (surf === 'water' || surf === 'green' || surf === 'sand' || bunkerDist(x, z) < 1.4 || pondDist(x, z) < 1.5) return null;
      if (nearPlay(x, z) < 1) return null;
      placed++; return tuft(R, x, z, p, q, s, c, false);
    }
    const [x, z] = inRegion(R), np = nearPlay(x, z); if (np < 1.2) return null;
    const surf = surfaceAt(x, z); if (surf === 'water' || surf === 'green' || surf === 'sand' || pondDist(x, z) < 1) return null;
    if (R() > Math.max(0.12, 1 - np / 70)) return null;
    return tuft(R, x, z, p, q, s, c, np > 10);
  });
  mesh.userData.always = Math.min(placed, mesh.count);
  return mesh;
}

export function createChaparral(count) {
  const parts = [], pal = { top: [1.0, 1.0, 1.0], mid: [0.72, 0.72, 0.72], under: [0.38, 0.38, 0.38] };
  [[0, 0.42, 0, 0.5, 0.45, 0.5], [0.5, 0.3, 0.2, 0.42, 0.36, 0.4], [-0.45, 0.28, -0.25, 0.45, 0.34, 0.42], [0.1, 0.26, -0.55, 0.38, 0.3, 0.36], [-0.2, 0.25, 0.5, 0.4, 0.3, 0.38], [0.35, 0.55, -0.15, 0.32, 0.3, 0.3]]
    .forEach(([x, y, z, a, b, c], i) => parts.push(clump([x, y, z], a, b, c, i * 4.1 + 2, pal, { detail: 0, flat: 0.85, droop: 0.6, ao: [0, 0.2, 0, 1.0], nrm: [[0, 0.05, 0, 0.9]] })));
  const mesh = new THREE.InstancedMesh(mergeTree(parts), swayMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), 0.25, 1.2, { foliage: 'all' }), count);
  const rand = rng(53);
  return scatter(mesh, count, rand, (R, p, q, s, c) => {
    const [x, z] = inRegion(R), np = nearPlay(x, z); if (np < 6) return null;
    const surf = surfaceAt(x, z); if (surf === 'water' || surf === 'green' || surf === 'sand' || pondDist(x, z) < 4 || sightK(x, z) > 0.5 && R() < 0.8) return null;
    const hgt = heightAt(x, z), patch = fbm(x * 0.03 + 11, z * 0.03 - 4), rise = hgt - baseY(x, z);
    if (patch < 0.5 + (rise < 2 ? 0.12 : 0) || np < 11) return null;     // clumps on the rises and in the rough, not the valley floor
    p.set(x, hgt - 0.15, z); q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, R() * 6.28);
    const sc = 0.8 + R() * 1.0; s.set(sc * (1 + R() * 0.4), sc * (0.7 + R() * 0.4), sc * (1 + R() * 0.4));
    const k = 0.85 + R() * 0.3, w = R();
    if (w < 0.4) c.setRGB(0.17 * k, 0.21 * k, 0.1 * k);            // chaparral: dark olive
    else if (w < 0.8) c.setRGB(0.36 * k, 0.4 * k, 0.3 * k);       // sage: silvery green
    else c.setRGB(0.4 * k, 0.28 * k, 0.15 * k);                   // buckwheat gone russet
    return { color: true };
  });
}

export function createGranite(count) {
  const geo = posOnly(new THREE.DodecahedronGeometry(1, 1));
  const p = geo.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 0.7 + fbm3(x * 1.3 + 4, y * 1.3, z * 1.3, 2) * 0.6; p.setXYZ(i, x * k, y * k * 0.7, z * k); }
  geo.computeVertexNormals();
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), count);
  const rand = rng(51);
  return scatter(mesh, count, rand, (R, pp, q, s, c, e) => {
    const [x, z] = inRegion(R), np = nearPlay(x, z); if (np < 4) return null;
    const surf = surfaceAt(x, z); if (surf === 'water' || surf === 'sand' || pondDist(x, z) < 2 || sightK(x, z) > 0.6) return null;
    const hgt = heightAt(x, z);
    if (fbm(x * 0.04, z * 0.04 + 3) < 0.55 && R() > 0.12) return null;
    pp.set(x, hgt - 0.1, z); e.set(R() * 0.5, R() * 6.28, R() * 0.5); q.setFromEuler(e);
    const sc = 0.3 + R() * R() * 1.5; s.set(sc * (1 + R() * 0.6), sc, sc);
    const k = 0.4 + R() * 0.16; c.setRGB(k * 1.03, k * 0.95, k * 0.82); return { color: true };
  });
}

// ---------- distant oak woodland: dark rounded crowns in clusters, in the draws and on the cooler north-facing slopes ----------
// a broad, rounded crown, flat underneath and sunk a little into the slope: the bottom cap of an icosahedron is dropped and
// the normals point straight out from the crown's centre for a soft read. detail 0: 15 triangles (far), detail 1: 60 (mid)
function crownGeometry(detail) {
  let geo = new THREE.IcosahedronGeometry(1, detail).toNonIndexed(); geo.deleteAttribute('uv'); geo.deleteAttribute('normal');
  { const a = geo.attributes.position.array, keep = []; for (let t = 0; t < a.length; t += 9) if (a[t + 1] + a[t + 4] + a[t + 7] > -1.6) keep.push(...a.slice(t, t + 9)); geo.setAttribute('position', new THREE.Float32BufferAttribute(keep, 3)); }
  geo = mergeVertices(geo); const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 0.88 + fbm3(x * 2 + 5, y * 2, z * 2, 2) * 0.3; p.setXYZ(i, x * 1.55 * k, Math.max(y, -0.2) * 1.25 * k + 0.9, z * 1.55 * k); }
  const nrm = []; for (let i = 0; i < p.count; i++) { const v = new THREE.Vector3(p.getX(i), (p.getY(i) - 0.7) * 0.8, p.getZ(i)).normalize(); nrm.push(v.x, v.y, v.z); }
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return geo;
}
// ---------- distant oak woodland: dark rounded crowns in clusters, in the draws and on the cooler north-facing slopes ----------
// Two instanced draws: rounder "mid" crowns for the groves within ~1 km of play, cheap ones beyond.
export function createFarOaks(count, surfaceY = heightAt, midCount = 260) {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const far = new THREE.InstancedMesh(crownGeometry(0), mat, count), mid = new THREE.InstancedMesh(crownGeometry(1), mat, Math.max(1, midCount));
  const rand = rng(97), seeds = [];
  // grove centres first (draws, north slopes, the creek bottoms), then trees clustered round them
  for (let t = 0; seeds.length < count / 9 && t < count * 30; t++) {
    const R0 = NEAR_RECT, x = R0.minX + 150 + rand() * (R0.maxX - R0.minX - 300), z = R0.minZ + 150 + rand() * (R0.maxZ - R0.minZ - 300);
    if (Math.hypot(x, z) < 400 || rand() > 1.3 - Math.hypot(x + 1200, z + 2500) / 4000) continue;     // denser toward the morros the hole looks at
    const y = heightAt(x, z), el = elevAt(x, z); if (el > 380 || el < 40) continue;
    const e = 30, hx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e), hz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e), sl = Math.hypot(hx, hz);
    const ring = (heightAt(x + 70, z) + heightAt(x - 70, z) + heightAt(x, z + 70) + heightAt(x, z - 70)) / 4, curv = (ring - y) / 70;
    const nb = HEADING * RAD, north = sl > 0.05 ? (hx * Math.sin(nb) + hz * Math.cos(nb)) / sl : 0;
    const want = Math.max(0, curv) * 9 + north * 0.45 + fbm(x * 0.004 + 9, z * 0.004 + 2) * 0.6 - sl * 0.3;
    if (sl > 1.0 || sl < 0.06 || want < 0.4 || rand() > want || sightK(x, z) > 0.5) continue;
    seeds.push({ x, z, r: 25 + rand() * 60 });
  }
  const place = (lo, hi) => (R, pp, q, s, c) => {
    const g0 = seeds[Math.floor(R() * seeds.length)]; if (!g0) return null;
    const a = R() * 6.28, d = g0.r * Math.sqrt(R()), x = g0.x + Math.cos(a) * d, z = g0.z + Math.sin(a) * d * 0.8, np = nearPlay(x, z);
    if (Math.hypot(x, z) < 380 || np < lo || np > hi || sightK(x, z) > 0.5) return null;   // the low-poly crowns stay well away from play
    if (x < NEAR_RECT.minX + 20 || x > NEAR_RECT.maxX - 20 || z < NEAR_RECT.minZ + 20 || z > NEAR_RECT.maxZ - 20) return null;
    const y = surfaceY(x, z), sc = 3.2 + R() * 3.4;
    pp.set(x, y - 0.8, z); q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, R() * 6.28); s.set(sc, sc * (0.8 + R() * 0.3), sc * (0.9 + R() * 0.2));
    const k = 0.75 + R() * 0.5; c.setRGB(0.075 * k, 0.11 * k, 0.045 * k); return { color: true };
  };
  scatter(mid, midCount, rand, place(300, 950)); if (!midCount) mid.count = 0;
  scatter(far, count, rand, place(midCount ? 950 : 320, 1e9));
  g.add(mid, far); g.userData.meshes = [mid, far];
  return g;
}
