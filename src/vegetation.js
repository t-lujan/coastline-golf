// Instanced, wind-swayed vegetation and coastal scatter: dune grass tufts, wildflowers, ice plant,
// beach rocks, driftwood, coastal scrub and the Morro Bay tree mix (Monterey pine, eucalyptus,
// coast live oak, a few windswept cypress). Sway lives in the vertex shader.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { heightAt, surfaceAt, fairwayDist, greenDist, bunkerDist, wasteDist, sandiness, duneSand, teeDist, inland, fbm, FAIRWAY_HALF, HEADING, ROCK, BOUNDS, TEE, GREEN } from './course.js';
import { fbm3, rimUniforms, tameUniforms, GLSL_RIM_DECL, GLSL_RIM, GLSL_NOISE } from './noise.js';

export const windUniforms = { uTime: { value: 0 }, uWind: { value: new THREE.Vector2(1, 0) }, uGust: { value: 0.5 } };
// uLeafGlow: light scattered through the canopy (keeps backlit crowns from going black); uRagged: 0..1 leafy cut-out edges
export const leafUniforms = { uLeafGlow: { value: new THREE.Color(0, 0, 0) }, uRagged: { value: 1 } };

// deterministic random so the course is the same every visit
export function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function swayMaterial(mat, strength, heightScale, { flatNormal = false, rim = false, foliage = false, holes = 0, ragged = true } = {}) {
  mat.onBeforeCompile = (sh) => {
    if (rim) { Object.assign(sh.uniforms, rimUniforms); sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\n${GLSL_RIM_DECL}`); }
    if (foliage) {
      // leaves: world-space clump breakup and bump so tufts read as foliage, not blobs; bark: vertical furrows
      Object.assign(sh.uniforms, tameUniforms, leafUniforms);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vFP;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvFP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\n${GLSL_NOISE}\nvarying vec3 vFP; uniform float uTame, uAerial, uRagged; uniform vec3 uLeafGlow;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          float isLeaf = ${foliage === 'all' ? '1.0' : 'step(diffuseColor.r * 1.15, diffuseColor.g)'};
          float lf = smoothstep(0.25, 0.75, cgN3(vFP * 1.3) * 0.6 + cgN3(vFP * 3.7) * 0.4);
          float furrow = cgN3(vec3(vFP.x * 7.0, vFP.y * 0.8, vFP.z * 7.0));
          float speck = cgN3(vFP * 7.5) * 0.6 + cgN3(vFP * 17.0) * 0.4;                    // leaf clusters inside a tuft
          diffuseColor.rgb *= mix(0.62 + furrow * 0.55, (0.72 + lf * 0.5) * (0.6 + speck * 0.75), isLeaf);
          vec3 leafTint = diffuseColor.rgb / max(diffuseColor.g, 0.002) * 0.6;`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          ${foliage === 'all' || !ragged ? '' : `// leafy silhouettes: cut the tuft edges away with noise so crowns read as foliage, not smooth stones
          { float vd = length(vViewPosition), edge = 1.0 - abs(dot(normal, normalize(vViewPosition)));
            float cutN = cgN3(vFP * 3.1) * 0.55 + cgN3(vFP * 8.3) * 0.45, far = smoothstep(50.0, 180.0, vd);
            if (isLeaf > 0.5 && uRagged > 0.5) {
              if (edge > 0.2 + cutN * 0.8 + far * 0.8) discard;                                  // ragged fringe
              if (cutN < ${(holes * 0.3).toFixed(2)} * (1.0 - far) * (1.0 - edge * 0.5)) discard;  // sky gaps through sparse crowns
            } }`}
          normal = cgBump(normal, -vViewPosition, (cgN3(vFP * 1.3) * 0.5 + cgN3(vFP * 3.7) * 0.2) * isLeaf, 0.5);`)
        .replace('#include <opaque_fragment>', `
          // a low warm sun keeps needles green instead of turning them orange
          outgoingLight += diffuseColor.rgb * uLeafGlow * isLeaf * (0.6 + 0.4 * lf);   // light scattered through the canopy
          { float lum = dot(outgoingLight, vec3(0.3, 0.59, 0.11)); outgoingLight = mix(outgoingLight, lum * vec3(0.9, 1.07, 0.88), uTame * 0.5 * isLeaf); }
          ${rim ? `// backlit leaves glow yellow-green (light through needles), bark gets the plain rim
          { float rimD = dot(normal, normalize(vViewPosition)); float rimF = pow(1.0 - clamp(rimD, 0.0, 1.0), 2.5) * smoothstep(-0.3, 0.1, rimD);
            outgoingLight += uRimCol * rimF * uRimK * mix(vec3(1.0), leafTint, isLeaf); }` : ''}
          #ifdef USE_FOG
            outgoingLight = mix(outgoingLight, fogColor, smoothstep(30.0, 650.0, vFogDepth) * uAerial);   // aerial perspective
          #endif
          #include <opaque_fragment>`);
    } else if (rim) sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `${GLSL_RIM}\n#include <opaque_fragment>`);
    if (flatNormal) sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', 'vec3 normal = normalize( vNormal ); vec3 nonPerturbedNormal = normal;');
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
export function createGrass(count, fringe = 0) {
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
  const mesh = new THREE.InstancedMesh(geo, swayMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), 1.0, 1.0, { flatNormal: true }), count + fringe);
  const rand = rng(11);
  const tuft = (R, x, z, p, q, s, c, dune) => {
    const near = dune ? Math.min(1, 0.55 + greenDist(x, z) / 70) : 1;
    const hgt = dune ? (0.35 + R() * R() * 0.9) * near : 0.26 + R() * 0.32;
    // a clump spreads around its centre: offset each tuft a little and lean it at its own angle
    const jx = dune ? (R() - 0.5) * 1.6 : 0, jz = dune ? (R() - 0.5) * 1.6 : 0;
    p.set(x + jx, heightAt(x + jx, z + jz) - 0.03, z + jz);
    q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, R() * 6.28);
    if (dune) { const la = R() * 6.28, lean = R() * 0.38; q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(Math.cos(la), 0, Math.sin(la)), lean)); }
    s.set((dune ? 0.7 + R() * 1.0 : 1 + R() * 0.7) * (dune ? 0.6 + hgt * 0.6 : 1), hgt, (dune ? 0.7 + R() * 1.0 : 1 + R() * 0.7) * (dune ? 0.6 + hgt * 0.6 : 1));
    const k = 0.8 + R() * 0.4, dry = fbm(x * 0.02, z * 0.02) > 0.58 ? 1 : 0;
    if (dune) { const st = R() * 0.7 + (fbm(x * 0.04 - 5, z * 0.04) - 0.4); c.setRGB(lerp(0.2, 0.37, st) * k, lerp(0.25, 0.33, st) * k, lerp(0.13, 0.15, st) * k); }
    else if (dry) c.setRGB(0.3 * k, 0.26 * k, 0.1 * k); else c.setRGB(0.12 * k, 0.24 * k, 0.05 * k);
    return { color: true };
  };
  // the first `fringe` tufts ring the green: a short, even fringe just off the collar, then fescue and dune-grass clumps
  // on the rough and the dune behind it, so the putting surface sits in a frame instead of on bare ground
  let placed = 0;
  scatter(mesh, count + fringe, rand, (R, p, q, s, c) => {
    if (placed < fringe) {
      const a = R() * 6.28, gd = 1.7 + Math.pow(R(), 1.6) * 16, x = GREEN.x + Math.cos(a) * (GREEN.rx + gd), z = GREEN.z + Math.sin(a) * (GREEN.rz + gd);
      const surf = surfaceAt(x, z); if (surf === 'water' || surf === 'green' || (surf === 'sand' || surf === 'waste') && sandiness(x, z) < 0.45) return null;
      if (fairwayDist(x, z) - FAIRWAY_HALF < 1 || bunkerDist(x, z) < 1.2 || inland(x, z) < 12) return null;
      const dune = sandiness(x, z) > 0.45 || gd > 6 && fbm(x * 0.09 + 31, z * 0.09 - 7) > 0.55;
      if (dune && R() < 0.35) return null;
      placed++; return tuft(R, x, z, p, q, s, c, dune);
    }
    const x = -140 + R() * 280, z = -200 + R() * 450;
    const np = nearPlay(x, z); if (np < 1.2) return null;
    const surf = surfaceAt(x, z); if (surf === 'water' || surf === 'green') return null;
    const sd = sandiness(x, z), dune = sd > 0.45, d = inland(x, z);
    if (d < 13) return null;
    if (dune) {
      // dune grass grows in clumps with bare sand between (never a row along the strip), sparse and low near the green
      const patch = fbm(x * 0.09 + 31, z * 0.09 - 7), gd = greenDist(x, z);
      if (patch < 0.5 || R() > (patch - 0.5) * 3.2) return null;
      if (gd < 40 && R() > 0.25 + gd / 60) return null;
    }
    if (!dune && (surf === 'sand' || surf === 'waste')) return null;
    if (R() > Math.max(0.1, 1 - np / 55)) return null;
    return tuft(R, x, z, p, q, s, c, dune);
  });
  mesh.userData.always = Math.min(placed, mesh.count);   // the green's fringe is kept at every density
  return mesh;
}

// ---------- wildflowers: orange poppies, purple lupine, yellow mustard ----------
export function createFlowers(count) {
  const stem = colorize(strip(new THREE.PlaneGeometry(0.025, 0.4).translate(0, 0.2, 0)), () => [0.25, 0.4, 0.2]);
  const hd = (x, y, z, r) => colorize(strip(new THREE.OctahedronGeometry(r * 0.8, 0).scale(0.6, 1.8, 0.6).translate(x, y, z)), () => [1, 1, 1]);
  const stem2 = stem.clone().rotateY(1.57), stem3 = stem.clone().scale(1, 0.75, 1).rotateY(0.8).translate(0.08, 0, 0.05);
  const geo = mergeGeometries([stem, stem2, stem3, hd(0, 0.42, 0, 0.085), hd(0.08, 0.31, 0.05, 0.075), hd(-0.08, 0.27, -0.06, 0.07)]);
  const mesh = new THREE.InstancedMesh(geo, swayMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), 0.9, 0.45), count);
  const rand = rng(23), cols = [[1.0, 0.34, 0.02], [1.0, 0.45, 0.04], [0.42, 0.22, 0.95], [1.0, 0.82, 0.12], [0.55, 0.3, 0.95]];
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
    if (Math.hypot((x - ROCK.x) / ROCK.rx, (z - ROCK.z) / ROCK.rz) < 1.36) return null;
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
// a lumpy foliage tuft: sunlit top, darker body, dark underside, AO toward the crown centre. Normals are pulled
// toward the centre of the tuft's branch cluster and of the whole crown (nrm: [[x, y, z, weight], ...]) so the
// canopy shades as one soft volume broken into clumps rather than a stack of flat pads.
function clump(c, rx, ry, rz, seed, pal, { detail = 1, flat = 0.8, droop = 0.7, ao = null, nrm = null, lift = 0.25, band = null } = {}) {
  const g = posOnly(new THREE.IcosahedronGeometry(1, detail));
  const p = g.attributes.position, col = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 0.7 + fbm3(x * 2.1 + seed, y * 2.1, z * 2.1, 3) * 0.6;
    const sy = y > 0 ? flat : droop;
    const X = c[0] + x * rx * k, Y = c[1] + y * ry * k * sy, Z = c[2] + z * rz * k;
    p.setXYZ(i, X, Y, Z);
    const hl = fbm3(x * 3 + seed, y * 3, z * 3, 2), top = Math.max(0, y);
    let r;
    if (band) {
      // shade by height in the whole crown (band: [bottom, top]) so overlapping tufts read as one canopy, not stacked puffs
      const gy = Math.min(1, Math.max(0, (Y - band[0]) / (band[1] - band[0])));
      const w = Math.min(1, Math.max(0, 0.12 + gy * 0.7 + top * 0.3 + (hl - 0.45) * 0.8 - (y < -0.3 ? 0.18 : 0)));
      r = w < 0.5 ? pal.under.map((u, j) => lerp(u, pal.mid[j], w * 2)) : pal.mid.map((m, j) => lerp(m, pal.top[j], w * 2 - 1));
    } else r = y > -0.25 ? pal.mid.map((m, j) => lerp(m, pal.top[j], Math.min(1, Math.max(0, top * 0.8 + (hl - 0.45) * 0.9)))) : pal.under;
    let a = 1;
    if (ao) { const d = Math.hypot(X - ao[0], (Y - ao[1]) * 1.3, Z - ao[2]) / ao[3]; a = 0.4 + 0.6 * Math.min(1, Math.max(0, d)); }
    col.push(r[0] * a, r[1] * a, r[2] * a);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const n = g.attributes.normal, v = new THREE.Vector3(), w = new THREE.Vector3();
  for (let i = 0; i < n.count; i++) {
    v.set(n.getX(i), n.getY(i), n.getZ(i));
    if (nrm) for (const [cx, cy, cz, wt] of nrm) { w.set(p.getX(i) - cx, p.getY(i) - cy, p.getZ(i) - cz).normalize(); v.addScaledVector(w, wt); }
    v.y += lift; v.normalize(); n.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}
// linear albedo; the sway shader adds leaf breakup, bark furrows and backlit translucency on top
const PAL = {
  pine: { top: [0.11, 0.2, 0.075], mid: [0.05, 0.11, 0.05], under: [0.022, 0.045, 0.03] },
  euc: { top: [0.3, 0.41, 0.33], mid: [0.15, 0.235, 0.2], under: [0.08, 0.12, 0.11] },
  oak: { top: [0.12, 0.19, 0.06], mid: [0.055, 0.105, 0.04], under: [0.02, 0.04, 0.02] },
  cyp: { top: [0.1, 0.18, 0.08], mid: [0.045, 0.1, 0.05], under: [0.05, 0.07, 0.05] },
};
const pineBark = (x, y, z) => { const n = fbm3(x * 4, y * 0.7, z * 4, 2); return [0.19 + n * 0.08, 0.12 + n * 0.05, 0.085 + n * 0.03]; };
const eucBark = (x, y, z) => {
  const n = fbm3(x * 1.3, y * 0.35, z * 1.3, 3), m = fbm3(x * 4 + 3, y * 1.2, z * 4, 2);
  let c = n > 0.56 ? [0.72, 0.68, 0.6] : n > 0.44 ? [0.56, 0.56, 0.53] : [0.64, 0.49, 0.37];   // cream, grey, tan peel
  if (y < 3.0 + m * 2) c = [0.36, 0.30, 0.25];                                                  // shaggy dark base
  return c.map((v) => v * (0.85 + m * 0.3));
};
const oakBark = (x, y, z) => { const n = fbm3(x * 3, y * 3, z * 3, 2); return [0.09 + n * 0.06, 0.08 + n * 0.05, 0.07 + n * 0.04]; };
const cypBark = [0.11, 0.08, 0.065];

function pineGeometry(seed, { H0 = 15, spread = 1, far = false } = {}) {
  // a mature coastal Monterey pine: tall bare trunk with a few broken lower limbs, one or two heavy limbs reaching
  // sideways below the crown, and an irregular, flat-topped, wind-sheared canopy (pushed downwind, +x) built from
  // overlapping needle-tuft masses on crowded upper limbs. Instances are yawed to the prevailing wind.
  const R = rng(seed), parts = [], H = H0 + R() * 2.5;
  const lx = (0.9 + R() * 0.9) * spread, lz = (R() - 0.5) * 0.7;
  const T = (y) => [Math.sin(y * 0.21 + seed) * 0.28 + lx * (y / H) ** 1.7, y, Math.cos(y * 0.17 + seed) * 0.22 + lz * (y / H) ** 1.7];
  // far: the same tree (same random sequence) with faceted tufts, fewer trunk sides and no twigs hidden in the crown
  bough(parts, [0, 0.25, 0.5, 0.75, 0.97].map((t) => { const q = T(t * H); if (t === 0) q[1] = -0.5; return q; }), 0.5 * spread + 0.05, 0.12, pineBark, far ? 5 : 7);
  // bare, broken lower limbs angled down
  for (let i = 0; i < 5; i++) { const y = H * (0.22 + R() * 0.24), a = R() * 6.28, l = 0.5 + R() * 1.0, s = T(y); if (!far) parts.push(limb(s, [s[0] + Math.cos(a) * l, y - 0.45 + R() * 0.35, s[2] + Math.sin(a) * l], 0.08, 0.02, [0.2, 0.15, 0.11], 4)); }
  const cc = T(H * 0.82), ao = [cc[0] + 0.8 * spread, cc[1] - 0.8, cc[2], 5.6 * spread];
  const crownN = [cc[0] + 0.8 * spread, cc[1] - 3.0, cc[2], 1.0];      // strong pull: the canopy shades as one mass
  const flatTop = H + 0.5, band = [H * 0.46, flatTop];
  const tuft = (c, rx, ry, rz, k, own) => {
    const top = c[1] + ry * 0.75; if (top > flatTop) { const d = top - flatTop; c[1] -= d * 0.6; ry = Math.max(rx * 0.45, ry - d * 0.5); }
    const f = far ? 1.12 : 1;
    parts.push(clump(c, rx * f, ry * f, rz * f, seed + k, PAL.pine, { detail: far ? 0 : 1, flat: 0.72, droop: 0.5, ao, nrm: [own, crownN], lift: 0.3, band }));
  };
  // limbs: two or three heavy ones low and long (some broken bare), then many short crowded ones in the upper crown
  const low = 2 + (R() < 0.5 ? 1 : 0), nl = low + 8;
  for (let i = 0; i < nl; i++) {
    const isLow = i < low, t = isLow ? i / low : (i - low) / (nl - low - 1);
    const y = isLow ? H * (0.42 + 0.08 * t) : H * (0.56 + 0.34 * t) + (R() - 0.5) * 0.6;
    const a = i * 2.39996 + seed + (R() - 0.5) * 0.7, ca = Math.cos(a), sa = Math.sin(a), wind = 1 + 0.55 * ca, s0 = T(y);
    let len = (isLow ? 4.6 + R() * 1.4 : 3.4 - t * 1.3 + R() * 0.8) * wind * spread;
    const bare = isLow && R() < 0.6;
    if (bare) len *= 0.5;
    const mid = [s0[0] + ca * len * 0.55, y + len * 0.05, s0[2] + sa * len * 0.55], end = [s0[0] + ca * len, y + len * (0.22 + R() * 0.12), s0[2] + sa * len];
    if (!far || isLow) bough(parts, [s0, mid, end], isLow ? 0.22 : 0.16, 0.045, pineBark, far ? 4 : 5);
    if (bare) continue;
    const sz = (isLow ? 0.95 : 1.05 + R() * 0.2) * spread, own = [end[0], end[1] - 0.9, end[2], 0.35];
    const n = isLow ? 2 : 3;
    for (let j = 0; j < n; j++) {
      const u = (isLow ? 0.72 : 0.4) + j / Math.max(1, n - 1) * (isLow ? 0.4 : 0.7), w = (R() - 0.5) * 1.2 * sz;
      const c = [s0[0] + ca * len * u - sa * w, lerp(y, end[1], Math.min(1, u)) + 0.35 + (R() - 0.3) * 0.5, s0[2] + sa * len * u + ca * w];
      const r = (1.1 + R() * 0.4) * sz;
      tuft(c, r * (1.15 + R() * 0.25), r * (0.72 + R() * 0.2), r * (1.0 + R() * 0.25), i * 3.7 + j * 1.3, own);
    }
  }
  // a core around the upper trunk joins the limb masses into one irregular canopy
  for (let j = 0; j < 4; j++) {
    const q = T(H * (0.62 + j * 0.08)), a = j * 2.6 + R(), o = (0.5 + R() * 0.5) * spread, r = (1.7 + R() * 0.4) * spread;
    tuft([q[0] + 0.6 * spread + Math.cos(a) * o, q[1], q[2] + Math.sin(a) * o], r * 1.15, r * 0.75, r, 60 + j, [q[0], q[1] - 1, q[2], 0.4]);
  }
  // the crown top: broad tufts at nearly one height, pushed downwind, so the tree is flat-topped and sheared
  const tp = T(H * 0.95), nt = 6 + (R() < 0.5 ? 1 : 0), ownT = [tp[0] + 0.8, tp[1] - 1.2, tp[2], 0.4];
  for (let j = 0; j < nt; j++) {
    const a = j * 2.2 + R() * 0.8, r = j ? (1.3 + R() * 1.5) * spread : 0, dx = Math.cos(a) * r * (Math.cos(a) > 0 ? 1.35 : 0.8);
    const c = [tp[0] + 0.7 * spread + dx, tp[1] - 0.25 - r * 0.2 + (R() - 0.5) * 0.3, tp[2] + Math.sin(a) * r * 0.85];
    const rr = (1.35 + R() * 0.4) * spread;
    tuft(c, rr * 1.2, rr * 0.75, rr * (1.0 + R() * 0.2), 90 + j, ownT);
  }
  return parts;
}

// a hanging bunch of long, narrow, sickle-shaped eucalyptus leaves (3 triangles each: a tapered base quad and a
// pointed tip) on a short drooping stalk from `top`. Normals point out of the bunch and the crown so the open canopy
// still shades as a soft volume; the leaves are drawn double-sided without flipping them.
function leafBunch(top, seed, { n = 7, len = 1.15, wid = 0.15, hang = 1.0, spread = 0.55, ao, cc, band } = {}) {
  const R = rng(seed), P = [], N = [], C = [], pal = PAL.euc;
  const v = (a, b, k) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k], nrm = (a) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  for (let i = 0; i < n; i++) {
    const u = (i + R() * 0.6) / n, th = i * 2.39996 + seed + R() * 0.8, out = [Math.cos(th), 0, Math.sin(th)];
    const base = [top[0] + out[0] * spread * 0.35 * u, top[1] - hang * u - R() * 0.15, top[2] + out[2] * spread * 0.35 * u];
    // upper leaves splay out, lower ones hang nearly straight down; each one curls further down toward its tip
    const L = len * (0.75 + R() * 0.5), splay = (1 - u) * 0.9 + 0.25 + R() * 0.25;
    const d1 = nrm([out[0] * splay, -1, out[2] * splay]), d2 = nrm([out[0] * splay * 0.45, -1, out[2] * splay * 0.45]);
    const mid = v(base, d1, L * 0.45), tip = v(mid, d2, L * 0.55);
    let w = nrm(cross(d1, out)); const tw = (R() - 0.5) * 1.6;
    w = nrm(v(w, out, Math.tan(tw) * 0.6));
    const W = wid * (0.8 + R() * 0.4), b0 = v(base, w, -W * 0.18), b1 = v(base, w, W * 0.18), m0 = v(mid, w, -W * 0.5), m1 = v(mid, w, W * 0.5);
    const pts = [b0, b1, m1, b0, m1, m0, m0, m1, tip];
    const k = 0.85 + R() * 0.3;
    for (let j = 0; j < 9; j++) {
      const q = pts[j];
      let n0 = nrm([q[0] - top[0], (q[1] - top[1]) * 0.4 + 0.2, q[2] - top[2]]);
      if (cc) { const c = nrm([q[0] - cc[0], q[1] - cc[1], q[2] - cc[2]]); n0 = nrm(v(n0, c, cc[3])); }
      n0 = nrm([n0[0], n0[1] + 0.3, n0[2]]);
      const gy = band ? Math.min(1, Math.max(0, (q[1] - band[0]) / (band[1] - band[0]))) : 0.5, tipK = j === 8 ? 0.15 : 0;
      const wt = Math.min(1, Math.max(0, 0.15 + gy * 0.65 + tipK + (R() - 0.5) * 0.25));
      const col = wt < 0.5 ? pal.under.map((a, m) => lerp(a, pal.mid[m], wt * 2)) : pal.mid.map((a, m) => lerp(a, pal.top[m], wt * 2 - 1));
      let a = 1; if (ao) { const dd = Math.hypot(q[0] - ao[0], (q[1] - ao[1]) * 1.3, q[2] - ao[2]) / ao[3]; a = 0.5 + 0.5 * Math.min(1, dd); }
      P.push(...q); N.push(...n0); C.push(col[0] * a * k, col[1] * a * k, col[2] * a * k);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  return g;
}

function eucGeometry(seed, { far = false } = {}) {
  // tall, pale and open: a forked trunk, long leaders, sparse blue-grey foliage hanging in drooping curtains
  const R = rng(seed), parts = [], H = 21 + R() * 5, fy = H * (0.36 + R() * 0.1);
  const lean = (R() - 0.5) * 1.4, lz = (R() - 0.5) * 0.6;
  bough(parts, [[0, -0.5, 0], [lean * 0.25, fy * 0.5, lz * 0.3], [lean, fy, lz]], 0.62, 0.42, eucBark, far ? 6 : 9);
  const cc = [lean, H * 0.72, lz, 0.5], ao = [lean, H * 0.7, lz, 5.5], band = [H * 0.45, H * 1.02];
  const nl = 2 + (R() < 0.65 ? 1 : 0);
  for (let l = 0; l < nl; l++) {
    const a = l / nl * 6.28 + R() * 0.9, sp = 2.0 + R() * 2.6, top = H * (0.84 + R() * 0.16);
    const m = [lean + Math.cos(a) * sp * 0.4, lerp(fy, top, 0.5), lz + Math.sin(a) * sp * 0.4], e = [lean + Math.cos(a) * sp, top, lz + Math.sin(a) * sp];
    bough(parts, [[lean, fy, lz], m, e], 0.4, 0.09, eucBark, far ? 4 : 7);
    const nbr = 3 + (R() * 2 | 0);
    for (let b = 0; b < nbr; b++) {
      const u = 0.3 + b / nbr * 0.65, s0 = [lerp(m[0], e[0], u * 0.6), lerp(fy, top, u), lerp(m[2], e[2], u * 0.6)], ba = a + (R() - 0.5) * 2.6, bl = 2.4 + R() * 2.6;
      const bm = [s0[0] + Math.cos(ba) * bl * 0.55, s0[1] + bl * 0.3, s0[2] + Math.sin(ba) * bl * 0.55], be = [s0[0] + Math.cos(ba) * bl, s0[1] + bl * 0.05, s0[2] + Math.sin(ba) * bl];
      bough(parts, [s0, bm, be], 0.13, 0.03, eucBark, far ? 3 : 5);
      // foliage hangs in open bunches of long sickle leaves toward the branch tips: the blue-gum "curtain"
      // (far: every third bunch, with fewer, bigger leaves, so the curtain keeps its outline at a fraction of the triangles)
      const tip = [lerp(bm[0], be[0], 0.6), lerp(bm[1], be[1], 0.6) - 0.3, lerp(bm[2], be[2], 0.6)];
      const nq = 6 + (R() * 3 | 0);
      for (let q = 0; q < nq; q++) {
        if (far && q % 3) { R(); R(); R(); continue; }
        const qa = q * 2.3 + R(), qd = q ? 0.4 + R() * 1.3 : 0;
        const c = [tip[0] + Math.cos(qa) * qd, tip[1] + 0.4 - q * 0.2 - R() * 0.4, tip[2] + Math.sin(qa) * qd];
        parts.push(leafBunch(c, seed * 31 + l * 9 + b * 3 + q, far ? { n: 4, len: 1.6, wid: 0.32, hang: 1.2, spread: 0.9, ao, cc, band } : { n: 9, len: 1.15, wid: 0.19, hang: 1.0, spread: 0.65, ao, cc, band }));
      }
      if (R() < 0.6) for (let q = 0; q < 2; q++) { const c = [lerp(s0[0], bm[0], 0.7) + (R() - 0.5) * 0.9, lerp(s0[1], bm[1], 0.7) - 0.2 - q * 0.3, lerp(s0[2], bm[2], 0.7) + (R() - 0.5) * 0.9]; if (!far) parts.push(leafBunch(c, seed * 17 + l * 5 + b * 7 + q, { n: 7, len: 1.0, wid: 0.18, hang: 0.8, spread: 0.5, ao, cc, band })); }
    }
    for (let q = 0; q < 8; q++) {
      if (far && q >= 3) { R(); R(); R(); continue; }
      const qa = q * 2.1 + R(), qd = q ? (0.5 + R() * 1.2) * (far ? 1.4 : 1) : 0;
      parts.push(leafBunch([e[0] + Math.cos(qa) * qd, e[1] + 0.4 - q * 0.2 - R() * 0.3, e[2] + Math.sin(qa) * qd], seed * 13 + l * 13 + 70 + q, far ? { n: 5, len: 1.7, wid: 0.32, hang: 1.3, spread: 1.0, ao, cc, band } : { n: 10, len: 1.25, wid: 0.19, hang: 1.2, spread: 0.75, ao, cc, band }));
    }
  }
  return parts;
}

function oakGeometry(seed, { far = false } = {}) {
  // low and wide: a short trunk, gnarled limbs that spread and dip, and a dense rounded canopy that skirts down at the edges
  const R = rng(seed), parts = [], top = [0.45, 2.0, 0];
  bough(parts, [[0, -0.4, 0], [0.3, 1.1, 0.1], top], 0.85, 0.6, oakBark, far ? 6 : 9);
  const cc = [top[0], 3.6, 0, 1.1], ao = [top[0], 4.4, 0, 5.8];
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * 6.28 + R() * 0.5, tw = (R() - 0.5) * 0.9, r = 4.6 + R() * 1.8, rise = 2.2 + R() * 1.2;
    const pts = [top];
    for (let k = 1; k <= 4; k++) { const f = k / 4, aa = a + tw * Math.sin(f * 3); pts.push([top[0] + Math.cos(aa) * r * f, top[1] + Math.sin(f * 2.4) * rise - f * f * 0.5 + (R() - 0.5) * 0.3, top[2] + Math.sin(aa) * r * f]); }
    bough(parts, pts, 0.42, 0.08, oakBark, far ? 4 : 7);
  }
  const nt = far ? 16 : 38, f = far ? 1.45 : 1;
  for (let i = 0; i < nt; i++) {
    const rr = Math.sqrt((i + 0.5) / nt), a = i * 2.39996 + R() * 0.4, r = rr * 6.4;
    const y = 6.9 - rr * rr * 3.6 + (R() - 0.5) * 0.7, s = (1.45 + (1 - rr) * 0.6 + R() * 0.55) * f;
    parts.push(clump([top[0] + Math.cos(a) * r, y, Math.sin(a) * r * 0.92], s * 1.15, s * 0.8, s * 1.1, seed + i * 2.9, PAL.oak, { detail: far ? 0 : 1, flat: 0.8, droop: 0.65, ao, nrm: [cc] }));
  }
  return parts;
}

function cypressGeometry(seed, { far = false } = {}) {
  // windswept: the trunk bows downwind (+x) and the canopy streams out flat and dense
  const R = rng(seed), parts = [];
  bough(parts, [[0, -0.4, 0], [0.4, 2.4, 0], [1.6, 4.6, 0.2], [3.4, 6.0, 0]], 0.62, 0.2, cypBark, far ? 5 : 8);
  bough(parts, [[1.0, 3.6, 0], [-0.6, 4.8, 0.5], [-2.2, 5.6, 0.9]], 0.24, 0.08, cypBark, far ? 3 : 6);
  bough(parts, [[1.8, 4.8, 0.1], [4.2, 5.8, -0.5], [6.4, 6.3, -0.8]], 0.24, 0.08, cypBark, far ? 3 : 6);
  const ao = [3, 6.3, 0, 5], cc = [2.5, 4.6, 0, 0.8];
  for (let i = 0; i < 15; i++) {
    const t = i / 14, x = -2.2 + t * 10.5 + (R() - 0.5) * 1.2, z = (R() - 0.5) * (4.2 - t * 1.6);
    const y = 6.3 + Math.sin(t * 3.0) * 0.8 + (R() - 0.5) * 0.6 - t * t * 0.9;
    const f = far ? 1.12 : 1;
    parts.push(clump([x, y, z], (2.1 - t * 0.7 + R() * 0.5) * f, (1.05 + R() * 0.3) * f, (1.8 - t * 0.5 + R() * 0.4) * f, i * 3.1 + seed, PAL.cyp, { detail: far ? 0 : 1, flat: 0.62, droop: 0.85, ao, nrm: [cc] }));
  }
  return parts;
}

function mergeTree(parts) {
  return mergeGeometries(parts.map((p) => { const q = p.index ? p.toNonIndexed() : p; for (const k of Object.keys(q.attributes)) if (!['position', 'normal', 'color'].includes(k)) q.deleteAttribute(k); return q; }));
}

// the tee camera (aimPose for the driver from the tee): hero trees are placed in its frame so they sit on the
// edges of the shot. Landscape and portrait need different spots, so the two heroes move with the aspect ratio.
function teeFrame(D, L) {
  const yaw = Math.atan2(4.2 - TEE.x, 141.5 + TEE.z), fx = Math.sin(yaw), fz = -Math.cos(yaw), cx = TEE.x - fx * 8.5, cz = TEE.z - fz * 8.5;
  return { x: cx + fx * D + fz * -L, z: cz + fz * D + fx * L };
}
const HEROES = [
  { kind: 'pine', sc: 1.15, desk: teeFrame(36, -23), port: teeFrame(34, -11) },
  { kind: 'euc', sc: 1.0, desk: teeFrame(40, 26), port: teeFrame(40, 13) },
];

function treeSpots() {
  const R = rng(91), spots = [];
  const ok = (x, z, kind, clear) => {
    if (x < BOUNDS.minX + 50 || x > BOUNDS.maxX - 50 || z < BOUNDS.minZ + 50 || z > BOUNDS.maxZ - 50) return false;
    const s = surfaceAt(x, z); if (s === 'water' || s === 'green' || s === 'tee') return false;
    if (nearPlay(x, z) < clear) return false;
    const d = inland(x, z);
    if (kind === 'cyp') return d > 16 && d < 40;
    if (kind === 'oak') return d > 20 && duneSand(x, z) < 0.65;
    return d > 28 && duneSand(x, z) < 0.5;
  };
  const clearOf = (x, z, kind, minD) => !spots.some((s) => Math.hypot(s.x - x, s.z - z) < minD * (s.kind === 'oak' || kind === 'oak' ? 1.5 : 1));
  for (const h of HEROES) spots.push({ kind: h.kind, x: h.desk.x, z: h.desk.z, sc: h.sc, pri: 0, hero: h });
  // grove: n trees scattered through a blob, clumped in pairs and threes, mixed kinds and sizes; never a grid
  const grove = (kinds, cx, cz, n, rad, { minD = 5.2, clear = 7, sc = [0.7, 1.22], pri = 1 } = {}) => {
    let placed = 0;
    for (let t = 0; placed < n && t < n * 80; t++) {
      const kind = Array.isArray(kinds) ? kinds[R() < 0.78 ? 0 : 1] : kinds;
      // half the time start a new clump, otherwise grow next to the last tree in this grove
      // crowns in a clump overlap a little, so a grove reads as a few masses with gaps rather than evenly spaced trees
      const last = placed && R() < 0.62 ? spots[spots.length - 1] : null;
      const a = R() * 6.28, r = last ? minD * (1.0 + R() * 0.35) : rad * Math.sqrt(R());
      const x = (last ? last.x : cx) + Math.cos(a) * r, z = (last ? last.z : cz) + Math.sin(a) * r * (last ? 1 : 0.75);
      if (!ok(x, z, kind, clear) || !clearOf(x, z, kind, minD)) continue;
      spots.push({ kind, x, z, sc: lerp(sc[0], sc[1], R()), pri: placed < Math.ceil(n * 0.5) ? pri : pri + 1 }); placed++;
    }
  };
  // groves framing the fairway on both sides, pines with the odd eucalyptus
  grove(['pine', 'euc'], -36, 95, 6, 26, { pri: 1 });
  grove('pine', -42, 10, 5, 24, { pri: 1 });
  grove(['pine', 'euc'], 54, 70, 5, 22, { pri: 1 });
  grove('pine', 52, -48, 4, 20, { pri: 1 });
  grove('pine', 76, 172, 3, 18, { pri: 2 });
  grove('pine', TEE.x - 12, TEE.z + 42, 5, 26, { pri: 1 });
  grove('pine', -30, 160, 2, 12, { pri: 2 });
  // blue-gum stands up on the bluff east of the course, and a few more behind the tee
  grove(['euc', 'pine'], 124, 40, 8, 30, { minD: 8, clear: 12, pri: 1 });
  grove('euc', TEE.x + 42, TEE.z - 10, 2, 8, { minD: 8, clear: 6, pri: 1 });
  grove('euc', 112, 205, 4, 18, { minD: 8, clear: 12, pri: 2 });
  grove('euc', -45, 225, 3, 15, { minD: 8, clear: 10, pri: 2 });
  // coast live oaks in the hollows and behind the green
  grove('oak', 44, -142, 2, 16, { minD: 11, clear: 8, sc: [0.9, 1.1], pri: 1 });
  grove('oak', -30, -150, 1, 10, { minD: 11, clear: 9, sc: [0.85, 1.0], pri: 2 });
  grove('oak', 82, -15, 2, 14, { minD: 11, clear: 10, pri: 1 });
  grove('oak', 84, 118, 1, 10, { minD: 11, clear: 10, pri: 2 });
  // rare windswept cypress accents near the water
  grove('cyp', -52, -70, 1, 30, { minD: 20, clear: 9, sc: [0.95, 1.2], pri: 1 });
  grove('cyp', -60, 160, 1, 30, { minD: 20, clear: 9, sc: [0.95, 1.2], pri: 1 });
  grove('cyp', 40, -170, 1, 26, { minD: 20, clear: 9, sc: [0.85, 1.0], pri: 2 });
  // nothing grows in a bunker or the waste area (filtered afterwards so the groves keep their layout)
  return spots.filter((t) => bunkerDist(t.x, t.z) > 3 && wasteDist(t.x, t.z) > 2);
}

// soft contact shadow under each crown (one instanced draw): darkens the grass where the canopy blocks the sky
function contactShadows(n) {
  const g = new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2), p = g.attributes.position, c = [];
  for (let i = 0; i < p.count; i++) { const r = Math.min(1, Math.hypot(p.getX(i), p.getZ(i))), a = (1 - r * r) ** 2; c.push(0, 0, 0, a); }
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 4)); g.deleteAttribute('uv'); g.deleteAttribute('normal');
  const mat = new THREE.MeshBasicMaterial({ color: 0x000000, vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -16 });
  const m = new THREE.InstancedMesh(g, mat, n); m.renderOrder = 1; m.frustumCulled = false;
  return m;
}
const QUALITY_PRI = { high: 9, med: 2, low: 1 };
// full-detail variants per species on each tier: every variant is a draw call plus a shadow draw, so cheaper tiers
// share fewer shapes (the hero trees at the tee are always variant 0, so they look the same on every tier)
const TREE_VARIANTS = { high: { pine: 3, euc: 2, oak: 1, cyp: 1 }, med: { pine: 2, euc: 2, oak: 1, cyp: 1 }, low: { pine: 1, euc: 1, oak: 1, cyp: 1 } };
// each species has full-detail variants for trees near the camera and one cheap far version (same silhouette,
// faceted tufts, no hidden twigs) that never casts shadows; trees swap between them by distance
const KINDS = {
  pine: { geos: [() => pineGeometry(3), () => pineGeometry(17), () => pineGeometry(41, { H0: 12.5, spread: 0.85 })], far: () => pineGeometry(17, { far: true }), h: 17, sway: 0.25, shadow: 5.5, holes: 0.5 },
  euc: { geos: [() => eucGeometry(7), () => eucGeometry(29)], far: () => eucGeometry(7, { far: true }), h: 24, sway: 0.35, shadow: 4.8, holes: 0, leaves: true },
  oak: { geos: [() => oakGeometry(11)], far: () => oakGeometry(11, { far: true }), h: 8, sway: 0.15, shadow: 7.5, holes: 0.2 },
  cyp: { geos: [() => cypressGeometry(13)], far: () => cypressGeometry(13, { far: true }), h: 8, sway: 0.2, shadow: 5.5, holes: 0.3 },
};

export function createTrees(level = 'high') {
  const R = rng(5), spots = treeSpots().sort((a, b) => a.pri - b.pri);
  // prevailing NW wind: crowns sheared toward the south-east
  const lean = (135 - HEADING) * Math.PI / 180, dx = Math.sin(lean), dz = -Math.cos(lean), down = Math.atan2(-dz, dx);
  const g = new THREE.Group(), meshes = [], q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const blobs = contactShadows(spots.length), up = new THREE.Vector3(0, 1, 0), nv = new THREE.Vector3(), qy = new THREE.Quaternion();
  blobs.frustumCulled = false; blobs.count = 0; g.add(blobs);
  const place = (t) => {
    p.set(t.x, heightAt(t.x, t.z) - 0.25, t.z); q.setFromAxisAngle(up, t.yaw); t.matrix.compose(p, q, t.scale);
    const e = 0.6, n = nv.set(heightAt(t.x - e, t.z) - heightAt(t.x + e, t.z), 2 * e, heightAt(t.x, t.z - e) - heightAt(t.x, t.z + e)).normalize();
    q.setFromUnitVectors(up, n).multiply(qy.setFromAxisAngle(up, t.yaw));
    const r = t.sc * t.shadow; p.set(t.x, heightAt(t.x, t.z) + 0.12, t.z); s.set(r, 1, r); t.blobMatrix.compose(p, q, s);
  };
  // each tree's pose is fixed for the session, whatever tier (and so whichever shared shape) it is drawn with
  for (const t of spots) {
    t.shadow = KINDS[t.kind].shadow; t.matrix = new THREE.Matrix4(); t.blobMatrix = new THREE.Matrix4(); t.isNear = true;
    t.yaw = t.kind === 'cyp' ? down + (R() - 0.5) * 0.5 : t.kind === 'pine' ? down + (R() - 0.5) * 1.1 : R() * 6.28;
    t.scale = new THREE.Vector3(t.sc * (0.9 + R() * 0.2), t.sc * (0.85 + R() * 0.3), t.sc * (0.9 + R() * 0.2));
    place(t);
  }
  // the instanced meshes are rebuilt once whenever the tier changes; merged shapes are cached while a tier uses them
  // and disposed as soon as one doesn't, the old instance buffers are released with their meshes
  const cache = new Map(), mats = {};
  const shape = (key, make) => { if (!cache.has(key)) cache.set(key, mergeTree(make())); return cache.get(key); };
  const add = (mesh, shadow) => { mesh.castShadow = shadow; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.count = 0; g.add(mesh); meshes.push(mesh); return mesh; };
  let built = null;
  const build = (lvl) => {
    for (const mesh of meshes) { g.remove(mesh); mesh.dispose(); }
    meshes.length = 0;
    const need = new Set(), want = TREE_VARIANTS[lvl];
    for (const [kind, k] of Object.entries(KINDS)) {
      const list = spots.filter((t) => t.kind === kind); if (!list.length) continue;
      const mat = mats[kind] || (mats[kind] = swayMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, side: k.leaves ? THREE.DoubleSide : THREE.FrontSide }), k.sway, k.h, { rim: true, foliage: true, holes: k.holes, ragged: !k.leaves, flatNormal: k.leaves }));
      need.add(`${kind}:far`);
      const far = add(new THREE.InstancedMesh(shape(`${kind}:far`, k.far), mat, list.length), false);
      const nvar = Math.min(want[kind], k.geos.length);
      for (let vi = 0; vi < nvar; vi++) {
        const mine = list.filter((_, i) => i % nvar === vi); if (!mine.length) continue;
        need.add(`${kind}:${vi}`);
        const near = add(new THREE.InstancedMesh(shape(`${kind}:${vi}`, k.geos[vi]), mat, mine.length), true);
        for (const t of mine) { t.near = near; t.far = far; }
      }
    }
    for (const [key, geo] of cache) if (!need.has(key)) { geo.dispose(); cache.delete(key); }
    built = lvl; g.userData.builds = (g.userData.builds || 0) + 1;
  };
  g.userData.spots = spots;
  g.userData.stats = () => ({ level: built, meshes: meshes.length, shapes: cache.size, builds: g.userData.builds });
  // which trees are drawn, and how: the quality level drops low-priority trees, distance picks near or far meshes,
  // and trees well behind the camera are skipped (their shadows would fall out of view anyway)
  let lv = level, treeNear = 1e4;
  const refresh = (cx, cz, fx, fz) => {
    for (const mesh of meshes) mesh.count = 0;
    blobs.count = 0;
    for (const t of spots) {
      if (t.pri > QUALITY_PRI[lv]) continue;
      const ddx = t.x - cx, ddz = t.z - cz, d = Math.hypot(ddx, ddz);
      if (d > 45 && (ddx * fx + ddz * fz) < -0.3 * d) continue;
      t.isNear = !!t.hero || d < treeNear + (t.isNear ? 6 : 0);   // the tee-shot hero trees are always full detail
      const mesh = t.isNear ? t.near : t.far;
      mesh.setMatrixAt(mesh.count++, t.matrix); blobs.setMatrixAt(blobs.count++, t.blobMatrix);
    }
    for (const mesh of [...meshes, blobs]) { mesh.visible = mesh.count > 0; if (!mesh.visible) continue; mesh.instanceMatrix.clearUpdateRanges(); mesh.instanceMatrix.addUpdateRange(0, mesh.count * 16); mesh.instanceMatrix.needsUpdate = true; }
  };
  build(level);
  const view = { x: 1e9, z: 1e9, fx: 0, fz: -1 };
  g.userData.setQuality = (lvl, near) => { if (lvl !== built) build(lvl); lv = lvl; treeNear = near; refresh(view.x, view.z, view.fx, view.fz); };
  g.userData.update = (cx, cz, fx, fz) => { view.x = cx; view.z = cz; view.fx = fx; view.fz = fz; refresh(cx, cz, fx, fz); };
  let framing = null;
  g.userData.frame = (portrait) => {
    const f = portrait ? 'port' : 'desk'; if (f === framing) return; framing = f;
    for (const t of spots) if (t.hero) { t.x = t.hero[f].x; t.z = t.hero[f].z; place(t); }
    refresh(view.x, view.z, view.fx, view.fz);
  };
  g.userData.frame(false);
  return g;
}

// ---------- distance LOD for instanced scatter ----------
// The full set of instances is kept on the CPU; update() packs the ones worth drawing (near the camera at full density,
// thinning out between `near` and `far`, nothing well behind the camera) into the front of the GPU buffers.
export function lodScatter(mesh) {
  const n = mesh.userData.max, src = mesh.instanceMatrix.array.slice(0, n * 16), col = mesh.instanceColor ? mesh.instanceColor.array.slice(0, n * 3) : null;
  const R = rng(n * 7 + 3), keep = new Float32Array(n);
  for (let i = 0; i < n; i++) keep[i] = i < (mesh.userData.always || 0) ? 0 : R();   // a stable per-instance threshold: the same tufts stay as density drops
  const dst = mesh.instanceMatrix.array, dcol = col && mesh.instanceColor.array;
  mesh.userData.lod = (cx, cz, fx, fz, frac, near, far) => {
    let c = 0;
    const span = Math.max(1, far - near);
    for (let i = 0; i < n; i++) {
      const k = keep[i]; if (k >= frac) continue;
      const o = i * 16, dx = src[o + 12] - cx, dz = src[o + 14] - cz, d2 = dx * dx + dz * dz;
      if (d2 > far * far) continue;
      const d = Math.sqrt(d2);
      if (d > near && k >= frac * (1 - (d - near) / span)) continue;
      if (d > 14 && dx * fx + dz * fz < -0.35 * d) continue;
      dst.set(src.subarray(o, o + 16), c * 16); if (col) dcol.set(col.subarray(i * 3, i * 3 + 3), c * 3);
      c++;
    }
    mesh.count = c; mesh.visible = c > 0; if (!c) return;
    mesh.instanceMatrix.clearUpdateRanges(); mesh.instanceMatrix.addUpdateRange(0, c * 16); mesh.instanceMatrix.needsUpdate = true;
    if (col) { mesh.instanceColor.clearUpdateRanges(); mesh.instanceColor.addUpdateRange(0, c * 3); mesh.instanceColor.needsUpdate = true; }
  };
  return mesh;
}

// ---------- coyote brush and coastal sage scrub ----------
export function createShrubs(count) {
  const parts = [];
  const pal = { top: [1.0, 1.0, 1.0], mid: [0.72, 0.72, 0.72], under: [0.38, 0.38, 0.38] };
  [[0, 0.42, 0, 0.5, 0.45, 0.5], [0.5, 0.3, 0.2, 0.42, 0.36, 0.4], [-0.45, 0.28, -0.25, 0.45, 0.34, 0.42], [0.1, 0.26, -0.55, 0.38, 0.3, 0.36], [-0.2, 0.25, 0.5, 0.4, 0.3, 0.38], [0.35, 0.55, -0.15, 0.32, 0.3, 0.3]]
    .forEach(([x, y, z, a, b, c], i) => parts.push(clump([x, y, z], a, b, c, i * 4.1 + 2, pal, { detail: 0, flat: 0.85, droop: 0.6, ao: [0, 0.2, 0, 1.0], nrm: [[0, 0.05, 0, 0.9]] })));
  const mesh = new THREE.InstancedMesh(mergeTree(parts), swayMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), 0.25, 1.2, { foliage: 'all' }), count);
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
