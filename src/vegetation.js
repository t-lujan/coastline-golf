// Instanced, wind-swayed vegetation and coastal scatter: dune grass tufts, wildflowers, ice plant,
// beach rocks, driftwood, coastal scrub and the Morro Bay tree mix (Monterey pine, eucalyptus,
// coast live oak, a few windswept cypress). Sway lives in the vertex shader.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { heightAt, surfaceAt, fairwayDist, greenDist, sandiness, teeDist, inland, fbm, FAIRWAY_HALF, HEADING, ROCK, BOUNDS, TEE } from './course.js';
import { fbm3, rimUniforms, GLSL_RIM_DECL, GLSL_RIM, GLSL_NOISE } from './noise.js';

export const windUniforms = { uTime: { value: 0 }, uWind: { value: new THREE.Vector2(1, 0) }, uGust: { value: 0.5 } };

// deterministic random so the course is the same every visit
export function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function swayMaterial(mat, strength, heightScale, { flatNormal = false, rim = false, foliage = false } = {}) {
  mat.onBeforeCompile = (sh) => {
    if (foliage) {
      // leaf-clump breakup: world-space noise darkens gaps and bumps the normal so pads read as foliage, not blobs
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vFP;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvFP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\n${GLSL_NOISE}\nvarying vec3 vFP;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          float isLeaf = step(diffuseColor.r * 1.15, diffuseColor.g);
          float lf = smoothstep(0.25, 0.75, cgN3(vFP * 1.3) * 0.6 + cgN3(vFP * 3.7) * 0.4);
          diffuseColor.rgb *= mix(1.0, 0.72 + lf * 0.5, isLeaf);`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          normal = cgBump(normal, -vViewPosition, (cgN3(vFP * 1.3) * 0.5 + cgN3(vFP * 3.7) * 0.2) * isLeaf, 0.5);`);
    }
    if (flatNormal) sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', 'vec3 normal = normalize( vNormal ); vec3 nonPerturbedNormal = normal;');
    if (rim) {
      Object.assign(sh.uniforms, rimUniforms);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\n${GLSL_RIM_DECL}`).replace('#include <opaque_fragment>', `${GLSL_RIM}\n#include <opaque_fragment>`);
    }
    sh.uniforms.uTime = windUniforms.uTime; sh.uniforms.uWind = windUniforms.uWind; sh.uniforms.uGust = windUniforms.uGust;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime, uGust; uniform vec2 uWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 ip = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float hk = clamp(position.y / ${heightScale.toFixed(2)}, 0.0, 1.5); hk *= hk;
        float wave = sin(uTime * 1.7 + ip.x * 0.21 + ip.z * 0.17) * 0.5 + sin(uTime * 3.1 + ip.x * 0.7 + position.x) * 0.25;
        float gust = 0.55 + 0.45 * sin(uTime * 0.6 + ip.x * 0.03 - ip.z * 0.02);
        vec3 wl = inverse(mat3(instanceMatrix)) * vec3(uWind.x, 0.0, uWind.y);
        transformed.xz += (wl.xz * (0.35 + wave * 0.35) * gust * uGust + vec2(wave, wave * 0.6) * 0.12) * hk * ${strength.toFixed(2)};
        transformed.y -= length(wl.xz) * hk * 0.08 * gust * uGust * ${strength.toFixed(2)};`);
  };
  return mat;
}
const colorize = (g, fn) => { const p = g.attributes.position, a = []; for (let i = 0; i < p.count; i++) a.push(...fn(p.getX(i), p.getY(i), p.getZ(i))); g.setAttribute('color', new THREE.Float32BufferAttribute(a, 3)); return g; };
const strip = (g) => { g = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k); return g; };
const posOnly = (g) => { g = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k); return mergeVertices(g); };
const nearPlay = (x, z) => Math.min(fairwayDist(x, z) - FAIRWAY_HALF, greenDist(x, z), teeDist(x, z));

function scatter(mesh, count, rand, place) {
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color(), e = new THREE.Euler();
  let n = 0, tries = 0;
  while (n < count && tries < count * 40) {
    tries++;
    const r = place(rand, p, q, s, c, e); if (!r) continue;
    m.compose(p, q, s); mesh.setMatrixAt(n, m); if (mesh.instanceColor || r.color) mesh.setColorAt(n, c); n++;
  }
  mesh.count = n; mesh.userData.max = n; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

// ---------- grass tufts ----------
export function createGrass(count) {
  const P = [], N = [], C = [];
  for (let b = 0; b < 4; b++) {
    const a = b * 1.57 + 0.3, ca = Math.cos(a), sa = Math.sin(a), lean = 0.16 + b * 0.05, w = 0.05;
    const pts = [[-w, 0, 0], [w, 0, 0], [-w * 0.55, 0.55, lean * 0.45], [w * 0.55, 0.55, lean * 0.45], [0, 1 - b * 0.1, lean]];
    const R = ([x, y, z]) => [x * ca + z * sa + ca * 0.04, y, -x * sa + z * ca - sa * 0.04];
    for (const t of [[0, 1, 2], [1, 3, 2], [2, 3, 4]]) for (const i of t) { P.push(...R(pts[i])); N.push(0, 1, 0); const k = pts[i][1]; C.push(0.55 + k * 1.05, 0.55 + k * 0.95, 0.5 + k * 0.45); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  const mesh = new THREE.InstancedMesh(geo, swayMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), 1.0, 1.0, { flatNormal: true }), count);
  const rand = rng(11);
  return scatter(mesh, count, rand, (R, p, q, s, c) => {
    const x = -140 + R() * 280, z = -200 + R() * 450;
    const np = nearPlay(x, z); if (np < 1.2) return null;
    const surf = surfaceAt(x, z); if (surf === 'water' || surf === 'green') return null;
    const sd = sandiness(x, z), dune = sd > 0.45, d = inland(x, z);
    if (d < 13) return null;
    if (dune && R() > 0.5) return null;
    if (!dune && surf === 'sand') return null;
    if (R() > Math.max(0.1, 1 - np / 55)) return null;
    const hgt = dune ? 0.5 + R() * 0.6 : 0.26 + R() * 0.32;
    p.set(x, heightAt(x, z) - 0.03, z); q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, R() * 6.28);
    s.set(1 + R() * 0.7, hgt, 1 + R() * 0.7);
    const k = 0.85 + R() * 0.3, dry = fbm(x * 0.02, z * 0.02) > 0.58 ? 1 : 0;
    if (dune) c.setRGB(0.36 * k, 0.33 * k, 0.15 * k); else if (dry) c.setRGB(0.3 * k, 0.26 * k, 0.1 * k); else c.setRGB(0.12 * k, 0.24 * k, 0.05 * k);
    return { color: true };
  });
}

// ---------- wildflowers: orange poppies, purple lupine, yellow mustard ----------
export function createFlowers(count) {
  const stem = colorize(strip(new THREE.PlaneGeometry(0.025, 0.4).translate(0, 0.2, 0)), () => [0.25, 0.4, 0.2]);
  const hd = (x, y, z, r) => colorize(strip(new THREE.IcosahedronGeometry(r, 1).scale(1, 0.65, 1).translate(x, y, z)), () => [1, 1, 1]);
  const stem2 = stem.clone().rotateY(1.57), stem3 = stem.clone().scale(1, 0.75, 1).rotateY(0.8).translate(0.08, 0, 0.05);
  const geo = mergeGeometries([stem, stem2, stem3, hd(0, 0.42, 0, 0.085), hd(0.08, 0.31, 0.05, 0.075), hd(-0.08, 0.27, -0.06, 0.07)]);
  const mesh = new THREE.InstancedMesh(geo, swayMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), 0.9, 0.45), count);
  const rand = rng(23), cols = [[1.0, 0.34, 0.02], [1.0, 0.45, 0.04], [0.42, 0.22, 0.95], [1.0, 0.82, 0.12], [0.95, 0.95, 0.9]];
  return scatter(mesh, count, rand, (R, p, q, s, c) => {
    const x = -130 + R() * 260, z = -190 + R() * 430;
    const np = nearPlay(x, z); if (np < 3 || np > 70) return null;
    if (surfaceAt(x, z) !== 'rough' || inland(x, z) < 22) return null;
    const patch = fbm(x * 0.045 + 9, z * 0.045); if (patch < 0.56) return null;
    const kind = (fbm(x * 0.012, z * 0.012 + 4) * 5 + R() * 1.2) | 0;
    const col = cols[Math.min(4, kind % 5)];
    p.set(x, heightAt(x, z) - 0.02, z); q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, R() * 6.28);
    const sc = 0.7 + R() * 0.7; s.set(sc, sc * (0.8 + R() * 0.5), sc);
    c.setRGB(col[0], col[1], col[2]); return { color: true };
  });
}

// ---------- ice plant mats on the dunes ----------
export function createIcePlant(count) {
  const parts = [];
  for (let i = 0; i < 9; i++) {
    const a = i * 0.7 + (i % 3) * 0.3, len = 0.28 + (i % 4) * 0.05;
    const leaf = new THREE.ConeGeometry(0.045, len, 3).rotateZ(-Math.PI / 2 + 0.35).translate(len / 2, 0.06, 0).rotateY(a);
    parts.push(colorize(strip(leaf), (x, y, z) => { const t = Math.min(1, Math.hypot(x, z) / 0.33); return [0.1 + t * 0.35, 0.26 - t * 0.08, 0.05]; }));
  }
  for (let i = 0; i < 4; i++) {
    const a = i * 1.7 + 0.4, r = 0.12 + (i % 2) * 0.08;
    const fl = new THREE.CircleGeometry(0.075, 7).rotateX(-Math.PI / 2 + 0.2).translate(Math.cos(a) * r, 0.13, Math.sin(a) * r);
    parts.push(colorize(strip(fl), (x, y, z) => { const d = Math.hypot(x - Math.cos(a) * r, z - Math.sin(a) * r); return d < 0.018 ? [1, 0.85, 0.2] : [0.95, 0.06, 0.48]; }));
  }
  const geo = mergeGeometries(parts); geo.computeVertexNormals();
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), count);
  const rand = rng(37);
  return scatter(mesh, count, rand, (R, p, q, s) => {
    const x = -150 + R() * 300, z = -200 + R() * 450;
    const d = inland(x, z); if (d < 13 || d > 62) return null;
    if (sandiness(x, z) < 0.4 || nearPlay(x, z) < 3) return null;
    if (fbm(x * 0.06 + 2, z * 0.06) < 0.5) return null;
    p.set(x, heightAt(x, z) - 0.02, z); q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, R() * 6.28);
    const sc = 1.6 + R() * 2.2; s.set(sc, sc * 0.8, sc); return {};
  });
}

// ---------- beach rocks and driftwood ----------
export function createBeachRocks(count) {
  const geo = posOnly(new THREE.DodecahedronGeometry(1, 1));
  const p = geo.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 0.7 + fbm3(x * 1.3 + 4, y * 1.3, z * 1.3, 2) * 0.6; p.setXYZ(i, x * k, y * k * 0.62, z * k); }
  geo.computeVertexNormals();
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xffffff }), count);
  const rand = rng(51);
  return scatter(mesh, count, rand, (R, pp, q, s, c, e) => {
    const x = -220 + R() * 340, z = -260 + R() * 500;
    const d = inland(x, z); if (d < -3 || d > 16) return null;
    if (Math.hypot((x - ROCK.x) / ROCK.rx, (z - ROCK.z) / ROCK.rz) < 1.2) return null;
    if (fbm(x * 0.05, z * 0.05 + 3) < 0.48 && R() > 0.15) return null;
    pp.set(x, heightAt(x, z) - 0.05, z); e.set(R() * 0.6, R() * 6.28, R() * 0.6); q.setFromEuler(e);
    const sc = 0.15 + R() * R() * 1.1; s.set(sc * (1 + R() * 0.6), sc, sc);
    const k = 0.13 + R() * 0.12; c.setRGB(k, k * 0.95, k * 0.88); return { color: true };
  });
}
export function createDriftwood(count) {
  const geo = mergeGeometries([
    colorize(strip(new THREE.CylinderGeometry(0.11, 0.16, 3, 6).rotateZ(Math.PI / 2)), () => [0.5, 0.45, 0.38]),
    colorize(strip(new THREE.CylinderGeometry(0.04, 0.08, 1.1, 5).rotateZ(Math.PI / 2 - 0.7).translate(0.9, 0.28, 0)), () => [0.46, 0.41, 0.35]),
  ]);
  geo.computeVertexNormals();
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }), count);
  const rand = rng(63);
  return scatter(mesh, count, rand, (R, p, q, s, c, e) => {
    const x = -200 + R() * 320, z = -230 + R() * 470;
    const d = inland(x, z); if (d < 6 || d > 15) return null;
    p.set(x, heightAt(x, z) + 0.05, z); e.set(0, R() * 6.28, R() * 0.1); q.setFromEuler(e);
    const sc = 0.6 + R() * 1.1; s.set(sc, sc, sc); return {};
  });
}

// ---------- trees: the Morro Bay mix ----------
// Monterey pine and blue-gum eucalyptus line the State Park course; coast live oaks sit in the hollows;
// a few wind-sheared Monterey cypress stand near the water; coyote brush and sage scrub fill the gaps.
const lerp = (a, b, t) => a + (b - a) * t;
function limb(a, b, r0, r1, col, seg = 7) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), len = A.distanceTo(B) + r1;
  const g = new THREE.CylinderGeometry(r1, r0, len + r0 * 0.6, seg, 2, true); g.translate(0, (len - r0 * 0.6) / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize())); g.translate(A.x, A.y, A.z);
  return colorize(strip(g), typeof col === 'function' ? col : () => col);
}
// a bent branch through several points, tapering
function bough(parts, pts, r0, r1, col, seg) {
  for (let i = 0; i < pts.length - 1; i++) parts.push(limb(pts[i], pts[i + 1], lerp(r0, r1, i / (pts.length - 1)), lerp(r0, r1, (i + 1) / (pts.length - 1)), col, seg));
}
// a lumpy foliage cluster: sunlit top, darker body, dark underside, AO toward the crown centre
function clump(c, rx, ry, rz, seed, pal, { detail = 1, flat = 0.7, droop = 1, ao = null } = {}) {
  const g = posOnly(new THREE.IcosahedronGeometry(1, detail));
  const p = g.attributes.position, col = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 0.66 + fbm3(x * 2.3 + seed, y * 2.3, z * 2.3, 3) * 0.75;
    const sy = y > 0 ? flat : droop;
    const X = c[0] + x * rx * k, Y = c[1] + y * ry * k * sy, Z = c[2] + z * rz * k;
    p.setXYZ(i, X, Y, Z);
    const hl = fbm3(x * 3 + seed, y * 3, z * 3, 2), top = Math.max(0, y);
    let r = y > -0.2 ? pal.mid.map((m, j) => lerp(m, pal.top[j], Math.min(1, top * 0.9 + (hl - 0.5) * 0.8))) : pal.under.slice();
    let a = 1;
    if (ao) { const d = Math.hypot(X - ao[0], (Y - ao[1]) * 1.4, Z - ao[2]) / ao[3]; a = 0.45 + 0.55 * Math.min(1, Math.max(0, d)); }
    col.push(r[0] * a, r[1] * a, r[2] * a);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) { const v = new THREE.Vector3(n.getX(i), n.getY(i) + 0.5, n.getZ(i)).normalize(); n.setXYZ(i, v.x, v.y, v.z); }
  return g;
}
const PAL = {
  pine: { top: [0.075, 0.15, 0.065], mid: [0.035, 0.085, 0.045], under: [0.018, 0.038, 0.028] },
  euc: { top: [0.30, 0.36, 0.30], mid: [0.17, 0.225, 0.19], under: [0.09, 0.12, 0.105] },
  oak: { top: [0.10, 0.18, 0.06], mid: [0.045, 0.095, 0.035], under: [0.02, 0.04, 0.02] },
  cyp: { top: [0.09, 0.17, 0.08], mid: [0.04, 0.095, 0.05], under: [0.10, 0.13, 0.09] },
};
const pineBark = (x, y, z) => { const n = fbm3(x * 4, y * 0.7, z * 4, 2); return [0.19 + n * 0.1, 0.095 + n * 0.045, 0.06 + n * 0.02]; };
const eucBark = (x, y, z) => {
  const n = fbm3(x * 1.3, y * 0.35, z * 1.3, 3), m = fbm3(x * 4 + 3, y * 1.2, z * 4, 2);
  let c = n > 0.56 ? [0.70, 0.66, 0.58] : n > 0.44 ? [0.56, 0.55, 0.52] : [0.64, 0.48, 0.36];   // cream, grey, tan peel
  if (y < 3.5 + m * 2) c = [0.36, 0.30, 0.25];                                                   // shaggy dark base
  return c.map((v) => v * (0.85 + m * 0.3));
};
const oakBark = (x, y, z) => { const n = fbm3(x * 3, y * 3, z * 3, 2); return [0.10 + n * 0.06, 0.085 + n * 0.05, 0.075 + n * 0.04]; };
const cypBark = [0.11, 0.08, 0.065];

function pineGeometry(seed) {
  const R = rng(seed), parts = [], H = 15 + R() * 2.5;
  const tx = (y) => Math.sin(y * 0.22 + seed) * 0.35 + y * 0.025, tz = (y) => Math.cos(y * 0.17 + seed) * 0.25;
  const trunk = [0, 0.3, 0.55, 0.8, 1].map((t) => [tx(t * H), t * H - (t === 0 ? 0.5 : 0), tz(t * H)]);
  bough(parts, trunk, 0.55, 0.1, pineBark, 8);
  // dead stubs low on the trunk
  for (let i = 0; i < 5; i++) { const y = 2.5 + R() * 4, a = R() * 6.28, l = 0.7 + R() * 1.1; parts.push(limb([tx(y), y, tz(y)], [tx(y) + Math.cos(a) * l, y - 0.2 + R() * 0.3, tz(y) + Math.sin(a) * l], 0.07, 0.025, [0.22, 0.16, 0.12], 5)); }
  const ao = [tx(H * 0.75), H * 0.72, tz(H * 0.75), 5.5];
  const nb = 14;
  for (let i = 0; i < nb; i++) {
    const t = i / (nb - 1), y = H * (0.5 + 0.46 * t) + (R() - 0.5) * 0.8, a = i * 2.39 + R() * 0.9;
    const len = (5.2 - t * 3.4) * (0.65 + R() * 0.55), up = 0.12 + R() * 0.3;
    const s0 = [tx(y), y, tz(y)], mid = [s0[0] + Math.cos(a) * len * 0.5, y + len * up * 0.3, s0[2] + Math.sin(a) * len * 0.5];
    const end = [s0[0] + Math.cos(a) * len, y + len * up, s0[2] + Math.sin(a) * len];
    bough(parts, [s0, mid, end], 0.17 - t * 0.08, 0.04, pineBark, 5);
    if (R() < 0.12 && t < 0.5) continue;                                  // a bare, broken limb
    const sz = 1.05 - t * 0.35, k = 2 + (R() < 0.5 ? 1 : 0) + (len > 3.5 ? 1 : 0);
    for (let j = 0; j < k; j++) {
      const u = j === 0 ? 1 : 0.35 + R() * 0.55, c = [lerp(s0[0], end[0], u) + (R() - 0.5) * 1.2, lerp(s0[1], end[1], u) + 0.2 + R() * 0.6, lerp(s0[2], end[2], u) + (R() - 0.5) * 1.2];
      parts.push(clump(c, (1.15 + R() * 0.5) * sz, (1.0 + R() * 0.35) * sz, (1.1 + R() * 0.5) * sz, seed + i * 3.7 + j, PAL.pine, { flat: 0.85, droop: 0.75, ao }));
    }
  }
  parts.push(clump([tx(H), H + 0.3, tz(H)], 1.5, 1.2, 1.4, seed + 99, PAL.pine, { flat: 0.85, ao }), clump([tx(H) + 0.8, H - 0.9, tz(H) - 0.6], 1.6, 1.1, 1.4, seed + 98, PAL.pine, { flat: 0.85, ao }));
  return parts;
}

function eucGeometry(seed) {
  const R = rng(seed), parts = [], H = 20 + R() * 5, fy = H * (0.32 + R() * 0.1);
  const lean = (R() - 0.5) * 1.2;
  bough(parts, [[0, -0.5, 0], [lean * 0.3, fy * 0.5, 0.2], [lean, fy, 0]], 0.7, 0.45, eucBark, 9);
  const ao = [lean, H * 0.72, 0, 7];
  const nl = 2 + (R() < 0.6 ? 1 : 0);
  for (let l = 0; l < nl; l++) {
    const a = l / nl * 6.28 + R() * 0.8, sp = 2.2 + R() * 2.5, top = H * (0.86 + R() * 0.14);
    const m = [lean + Math.cos(a) * sp * 0.45, lerp(fy, top, 0.45), Math.sin(a) * sp * 0.45], e = [lean + Math.cos(a) * sp, top, Math.sin(a) * sp];
    bough(parts, [[lean, fy, 0], m, e], 0.42, 0.1, eucBark, 7);
    // side branches that arc out and droop at the tips
    const nbr = 3 + (R() * 2 | 0);
    for (let b = 0; b < nbr; b++) {
      const u = 0.35 + b / nbr * 0.6, s0 = [lerp(m[0], e[0], u * 0.6), lerp(fy, top, u), lerp(m[2], e[2], u * 0.6)], ba = a + (R() - 0.5) * 2.4, bl = 2.6 + R() * 2.4;
      const bm = [s0[0] + Math.cos(ba) * bl * 0.55, s0[1] + bl * 0.35, s0[2] + Math.sin(ba) * bl * 0.55], be = [s0[0] + Math.cos(ba) * bl, s0[1] + bl * 0.15, s0[2] + Math.sin(ba) * bl];
      bough(parts, [s0, bm, be], 0.14, 0.035, eucBark, 5);
      for (let q = 0; q < 3; q++) {
        const u = 0.45 + q * 0.27 + R() * 0.1, cx = lerp(s0[0], be[0], u) + (R() - 0.5) * 0.8, cz = lerp(s0[2], be[2], u) + (R() - 0.5) * 0.8, cy = lerp(s0[1], bm[1], 1 - Math.abs(u - 0.55)) - 0.9 - R() * 0.6;
        parts.push(clump([cx, cy, cz], 0.85 + R() * 0.45, 1.05 + R() * 0.4, 0.8 + R() * 0.4, seed + l * 9 + b * 3 + q, PAL.euc, { detail: 2, flat: 0.55, droop: 1.7, ao }));
      }
    }
    parts.push(clump([e[0], e[1] - 0.6, e[2]], 1.2, 1.3, 1.1, seed + l * 13 + 70, PAL.euc, { flat: 0.6, droop: 1.6, ao }), clump([e[0] + 1, e[1] - 1.8, e[2] - 0.7], 1.0, 1.2, 0.9, seed + l * 13 + 71, PAL.euc, { flat: 0.6, droop: 1.6, ao }));
  }
  return parts;
}

function oakGeometry(seed) {
  const R = rng(seed), parts = [];
  bough(parts, [[0, -0.4, 0], [0.25, 1.2, 0.1], [0.4, 2.3, 0]], 0.85, 0.62, oakBark, 9);
  const ao = [0.4, 4.6, 0, 6.5];
  for (let i = 0; i < 5; i++) {
    const a = i * 1.257 + R() * 0.6, tw = (R() - 0.5) * 0.9, r = 5.2 + R() * 1.4;
    const pts = [[0.4, 2.2, 0]];
    for (let k = 1; k <= 3; k++) { const f = k / 3, aa = a + tw * Math.sin(f * 3); pts.push([0.4 + Math.cos(aa) * r * f, 2.2 + Math.sin(f * 2.2) * (2.4 + R() * 0.8) - f * f * 0.6, Math.sin(aa) * r * f]); }
    bough(parts, pts, 0.42, 0.09, oakBark, 7);
  }
  for (let i = 0; i < 17; i++) {
    const a = R() * 6.28, r = Math.sqrt(R()) * 5.8, y = 5.2 - (r / 6.2) ** 2 * 2.6 + R() * 0.6;
    parts.push(clump([0.4 + Math.cos(a) * r, y, Math.sin(a) * r * 0.9], 2.4 + R() * 0.9, 1.4 + R() * 0.5, 2.2 + R() * 0.8, seed + i * 2.9, PAL.oak, { detail: 2, flat: 0.75, droop: 0.7, ao }));
  }
  return parts;
}

function cypressGeometry(seed) {
  // windswept: the trunk bows downwind (+x) and the canopy streams out flat and dense
  const R = rng(seed), parts = [];
  bough(parts, [[0, -0.4, 0], [0.4, 2.4, 0], [1.6, 4.6, 0.2], [3.4, 6.0, 0]], 0.62, 0.2, cypBark, 8);
  bough(parts, [[1.0, 3.6, 0], [-0.6, 4.8, 0.5], [-2.2, 5.6, 0.9]], 0.24, 0.08, cypBark, 6);
  bough(parts, [[1.8, 4.8, 0.1], [4.2, 5.8, -0.5], [6.4, 6.3, -0.8]], 0.24, 0.08, cypBark, 6);
  const ao = [3, 6.3, 0, 5];
  for (let i = 0; i < 13; i++) {
    const t = i / 12, x = -2.2 + t * 10.5 + (R() - 0.5) * 1.2, z = (R() - 0.5) * (4.2 - t * 1.6);
    const y = 6.3 + Math.sin(t * 3.0) * 0.8 + (R() - 0.5) * 0.6 - t * t * 0.9;
    parts.push(clump([x, y, z], 2.4 - t * 0.8 + R() * 0.5, 1.15 + R() * 0.3, 2.0 - t * 0.5 + R() * 0.4, i * 3.1, PAL.cyp, { detail: 2, flat: 0.6, droop: 0.9, ao }));
  }
  return parts;
}

function mergeTree(parts) {
  return mergeGeometries(parts.map((p) => { const q = p.index ? p.toNonIndexed() : p; for (const k of Object.keys(q.attributes)) if (!['position', 'normal', 'color'].includes(k)) q.deleteAttribute(k); return q; }));
}

function treeSpots() {
  const R = rng(91), spots = [];
  const ok = (x, z, kind, clear) => {
    if (x < BOUNDS.minX + 50 || x > BOUNDS.maxX - 50 || z < BOUNDS.minZ + 50 || z > BOUNDS.maxZ - 50) return false;
    const s = surfaceAt(x, z); if (s === 'water' || s === 'green' || s === 'tee') return false;
    if (nearPlay(x, z) < clear) return false;
    const d = inland(x, z);
    if (kind === 'cyp') return d > 16 && d < 40;
    if (kind === 'oak') return d > 20 && sandiness(x, z) < 0.65;
    return d > 28 && sandiness(x, z) < 0.5;
  };
  // grove: n trees scattered in a disc, never on a grid, never closer than minD to any other tree
  const grove = (kind, cx, cz, n, rad, { minD = 8, clear = 7, sc = [0.85, 1.15], pri = 1 } = {}) => {
    let placed = 0;
    for (let t = 0; placed < n && t < n * 60; t++) {
      const a = R() * 6.28, r = rad * Math.sqrt(R()), x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r * 0.8;
      if (!ok(x, z, kind, clear)) continue;
      if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < minD * (s.kind === 'oak' || kind === 'oak' ? 1.4 : 1))) continue;
      spots.push({ kind, x, z, sc: lerp(sc[0], sc[1], R()), pri: placed === 0 ? pri : pri + 1 }); placed++;
    }
  };
  // hero pines framing the tee shot
  grove('pine', TEE.x - 15, TEE.z - 24, 1, 3, { clear: 5, sc: [1.2, 1.25], pri: 0 });
  grove('pine', TEE.x + 24, TEE.z - 28, 1, 4, { clear: 6, sc: [1.05, 1.1], pri: 0 });
  grove('euc', TEE.x + 40, TEE.z - 14, 2, 8, { minD: 8, clear: 6, sc: [0.95, 1.05], pri: 0 });
  grove('pine', TEE.x - 10, TEE.z + 40, 5, 26, { pri: 1 });
  // groves framing the fairway on both sides
  grove('pine', -34, 92, 6, 24, { pri: 1 });
  grove('pine', -40, 12, 5, 22, { pri: 1 });
  grove('pine', 52, 72, 5, 22, { pri: 1 });
  grove('pine', 50, -45, 4, 18, { pri: 1 });
  grove('pine', 74, 175, 3, 18, { pri: 2 });
  // a blue-gum stand up on the bluff east of the course, and a few more behind the tee
  grove('euc', 122, 40, 8, 28, { minD: 9, clear: 12, pri: 1 });
  grove('euc', 112, 205, 4, 18, { minD: 9, clear: 12, pri: 2 });
  grove('euc', -45, 225, 3, 15, { minD: 9, clear: 10, pri: 2 });
  // coast live oaks in the hollows and behind the green
  grove('oak', 42, -140, 2, 18, { minD: 12, clear: 8, sc: [0.9, 1.1], pri: 1 });
  grove('oak', 82, -15, 2, 14, { minD: 12, clear: 10, pri: 1 });
  grove('oak', 84, 118, 1, 10, { minD: 12, clear: 10, pri: 2 });
  // rare windswept cypress accents near the water
  grove('cyp', -52, -70, 1, 30, { minD: 20, clear: 9, sc: [0.95, 1.2], pri: 1 });
  grove('cyp', -60, 160, 1, 30, { minD: 20, clear: 9, sc: [0.95, 1.2], pri: 1 });
  grove('cyp', 40, -170, 1, 26, { minD: 20, clear: 9, sc: [0.85, 1.0], pri: 2 });
  return spots;
}

export function createTrees(quality = 'high') {
  const R = rng(5), spots = treeSpots();
  const keep = quality === 'low' ? 1 : quality === 'med' ? 2 : 9;
  const live = spots.filter((s) => s.pri <= keep);
  // prevailing NW wind: crowns sheared toward the south-east
  const lean = (135 - HEADING) * Math.PI / 180, dx = Math.sin(lean), dz = -Math.cos(lean), down = Math.atan2(-dz, dx);
  const kinds = [
    { kind: 'pine', geos: [pineGeometry(3), pineGeometry(17)], h: 17, sway: 0.25 },
    { kind: 'euc', geos: [eucGeometry(7), eucGeometry(29)], h: 24, sway: 0.35 },
    { kind: 'oak', geos: [oakGeometry(11)], h: 8, sway: 0.15 },
    { kind: 'cyp', geos: [cypressGeometry(13)], h: 8, sway: 0.2 },
  ];
  const g = new THREE.Group();
  for (const k of kinds) {
    const list = live.filter((s) => s.kind === k.kind);
    k.geos.forEach((parts, vi) => {
      const mine = list.filter((_, i) => i % k.geos.length === vi); if (!mine.length) return;
      const mat = swayMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), k.sway, k.h, { rim: true, foliage: true });
      const mesh = new THREE.InstancedMesh(mergeTree(parts), mat, mine.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
      mine.forEach((t, i) => {
        p.set(t.x, heightAt(t.x, t.z) - 0.25, t.z);
        const yaw = k.kind === 'cyp' ? down + (R() - 0.5) * 0.5 : R() * 6.28;
        q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
        s.set(t.sc * (0.9 + R() * 0.2), t.sc * (0.88 + R() * 0.24), t.sc * (0.9 + R() * 0.2)); m.compose(p, q, s); mesh.setMatrixAt(i, m);
      });
      mesh.castShadow = true; mesh.receiveShadow = true;
      g.add(mesh);
    });
  }
  g.userData.spots = live;
  return g;
}

// ---------- coyote brush and coastal sage scrub ----------
export function createShrubs(count) {
  const parts = [];
  const pal = { top: [1.0, 1.0, 1.0], mid: [0.72, 0.72, 0.72], under: [0.38, 0.38, 0.38] };
  [[0, 0.42, 0, 0.5, 0.45, 0.5], [0.5, 0.3, 0.2, 0.42, 0.36, 0.4], [-0.45, 0.28, -0.25, 0.45, 0.34, 0.42], [0.1, 0.26, -0.55, 0.38, 0.3, 0.36], [-0.2, 0.25, 0.5, 0.4, 0.3, 0.38], [0.35, 0.55, -0.15, 0.32, 0.3, 0.3]]
    .forEach(([x, y, z, a, b, c], i) => parts.push(clump([x, y, z], a, b, c, i * 4.1 + 2, pal, { flat: 0.85, droop: 0.6, ao: [0, 0.2, 0, 1.0] })));
  const mesh = new THREE.InstancedMesh(mergeTree(parts), swayMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), 0.25, 1.2, { foliage: true }), count);
  const rand = rng(53);
  return scatter(mesh, count, rand, (R, p, q, s, c) => {
    const x = -150 + R() * 330, z = -210 + R() * 470;
    const d = inland(x, z); if (d < 15) return null;
    const np = nearPlay(x, z); if (np < 5) return null;
    const surf = surfaceAt(x, z); if (surf === 'water' || surf === 'green') return null;
    const sd = sandiness(x, z), dune = sd > 0.3 && d < 64;
    const patch = fbm(x * 0.03 + 11, z * 0.03 - 4);
    if (!dune && (patch < 0.52 || np < 10)) return null;
    if (dune && patch < 0.38) return null;
    p.set(x, heightAt(x, z) - 0.15, z); q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, R() * 6.28);
    const sc = (dune ? 0.55 : 0.75) + R() * 0.8; s.set(sc * (1 + R() * 0.4), sc * (0.7 + R() * 0.4), sc * (1 + R() * 0.4));
    const k = 0.85 + R() * 0.3, w = R();
    if (w < 0.45) c.setRGB(0.19 * k, 0.25 * k, 0.13 * k);            // coyote brush: dark olive
    else if (w < 0.88) c.setRGB(0.38 * k, 0.42 * k, 0.33 * k);      // sage: silvery grey-green
    else c.setRGB(0.36 * k, 0.24 * k, 0.15 * k);                    // buckwheat gone russet
    return { color: true };
  });
}
