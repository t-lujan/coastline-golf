// Hole 3 · Pismo dune planting and backdrop. The shared coastal instancers (vegetation.js) are rebuilt with Pismo spots:
// European beach grass tufts along the back of the beach and in the Oceano foredunes, ice plant carpets on the dune faces
// and coastal dune scrub (silver dune lupine, mock heather) on the back dunes, all kept off the corridor. The backdrop is
// one merged mesh: the hills behind Pismo Beach, Ontario Ridge, the Shell Beach bluffs, the Irish Hills and Arroyo Grande
// hills, the Nipomo Mesa, the Pismo Dunes Preserve and the Guadalupe dune line, at true bearings with compressed distances.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { BOUNDS, FAIRWAY_HALF, GREEN, heightAt, surfaceAt, fairwayDist, greenDist, teeDist, bunkerDist, fbm } from './course.js';
import { scatter, rng } from './vegetation.js';
import { toeX, shoreX, creekDist, HEADING, SITE } from './maps/pismo.js';

// clearances (m): plants keep off the fairway and its fringe, the tee and the green
export const CLEAR = { fairway: FAIRWAY_HALF + 3, tee: 6, green: 6 };
const clearOfPlay = (x, z, r = 0) => fairwayDist(x, z) >= CLEAR.fairway + r && teeDist(x, z) >= CLEAR.tee + r && greenDist(x, z) >= CLEAR.green + r && bunkerDist(x, z) > 2 + r;
const inBounds = (x, z) => x > BOUNDS.minX + 60 && x < BOUNDS.maxX - 60 && z > BOUNDS.minZ + 60 && z < BOUNDS.maxZ - 60;
// t: metres inland of the dune / town toe (< 0 out on the beach); s: metres down the beach from the pier
const site = (x, z) => ({ t: toeX(z) - x, s: -z, sea: shoreX(z) - x });
const ok = (x, z, r) => inBounds(x, z) && clearOfPlay(x, z, r) && creekDist(x, z) > 3 && surfaceAt(x, z) !== 'water';
const dune = (s) => s > 175;   // the foredunes south of the creek (the town stands north of it)

const stats = {};
function record(kind, mesh) {
  const n = mesh.count, a = mesh.instanceMatrix.array; let fw = 1e9, tee = 1e9, gr = 1e9, beach = 0;
  for (let i = 0; i < n; i++) { const x = a[i * 16 + 12], z = a[i * 16 + 14]; fw = Math.min(fw, fairwayDist(x, z)); tee = Math.min(tee, teeDist(x, z)); gr = Math.min(gr, greenDist(x, z)); if (toeX(z) - x < -14) beach++; }
  stats[kind] = { count: n, minFairway: +fw.toFixed(2), minTee: +tee.toFixed(2), minGreen: +gr.toFixed(2), onOpenBeach: beach };
}

// beach grass: tufted clumps, grey-green with straw tips, along the back of the beach and in the foredunes
export function plantGrass(mesh, count) {
  const R = rng(311);
  scatter(mesh, count, R, (R, p, q, s, c) => {
    const x = -330 + R() * 360, z = 60 - R() * 800, { t, s: sd } = site(x, z);
    if (t < -12 || t > 160 || sd < 40) return null;
    if (!dune(sd) && t > 4) return null;                       // the town: only a fringe at the back of the beach
    const patch = fbm(x * 0.07 + 31, z * 0.07 - 7);
    if (patch < 0.44 || R() > (patch - 0.4) * 2.6 * (t < 0 ? 0.6 : 1) * (t > 90 ? 0.5 : 1)) return null;
    const jx = (R() - 0.5) * 1.4, jz = (R() - 0.5) * 1.4, X = x + jx, Z = z + jz;
    if (!ok(X, Z, 0.6)) return null;
    const hgt = 0.45 + R() * R() * 0.7;
    p.set(X, heightAt(X, Z) - 0.04, Z);
    const la = R() * 6.28;
    q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, R() * 6.28).premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(Math.cos(la), 0, Math.sin(la)), R() * 0.32));
    const w = (0.7 + R() * 0.8) * (0.6 + hgt * 0.6); s.set(w, hgt, w);
    const st = R() * 0.6 + (fbm(x * 0.04 - 5, z * 0.04) - 0.4), k = 0.85 + R() * 0.3;
    c.setRGB((0.30 + 0.16 * st) * k, (0.33 + 0.1 * st) * k, (0.23 + 0.03 * st) * k);
    return { color: true };
  });
  mesh.userData.always = 0; record('grass', mesh); return mesh;
}

// ice plant: low carpets on the dune faces, green with red/rose tints (the mesh carries the magenta/yellow flowers)
export function plantIce(mesh, count) {
  const R = rng(337);
  scatter(mesh, count, R, (R, p, q, s, c) => {
    const x = -260 + R() * 280, z = -150 - R() * 640, { t, s: sd } = site(x, z);
    if (!dune(sd) || t < -4 || t > 90) return null;
    if (fbm(x * 0.05 + 2, z * 0.05) < 0.5) return null;
    if (!ok(x, z, 2)) return null;
    p.set(x, heightAt(x, z) - 0.03, z); q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, R() * 6.28);
    const sc = 1.6 + R() * 2.0; s.set(sc, sc * 0.75, sc);
    const rose = fbm(x * 0.11 - 3, z * 0.11 + 8);
    if (rose > 0.55) c.setRGB(1, 0.62 + R() * 0.12, 0.58); else c.setRGB(0.8 + R() * 0.15, 1, 0.78);
    return { color: true };
  });
  record('ice', mesh); return mesh;
}

// coastal dune scrub: silver dune lupine and mock heather, small rounded grey-green shrubs on the back dunes
export function plantScrub(mesh, count) {
  const R = rng(353);
  scatter(mesh, count, R, (R, p, q, s, c) => {
    const x = -360 + R() * 360, z = -170 - R() * 620, { t, s: sd } = site(x, z);
    if (!dune(sd) || t < 25 || t > 320) return null;
    if (fbm(x * 0.03 + 11, z * 0.03 - 4) < 0.46) return null;
    if (!ok(x, z, 2.5)) return null;
    p.set(x, heightAt(x, z) - 0.12, z); q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, R() * 6.28);
    const sc = 0.45 + R() * 0.6; s.set(sc * (1 + R() * 0.4), sc * (0.6 + R() * 0.3), sc * (1 + R() * 0.4));
    const k = 0.88 + R() * 0.24;
    if (R() < 0.55) c.setRGB(0.50 * k, 0.55 * k, 0.48 * k);    // silver dune lupine
    else c.setRGB(0.32 * k, 0.37 * k, 0.20 * k);               // mock heather
    return { color: true };
  });
  record('scrub', mesh); return mesh;
}
export const plantStats = () => stats;

// town trees: a few cypress and eucalyptus between the buildings behind the pier (never on the beach or the dunes)
export function townTreeSpots() {
  const R = rng(97), spots = [];
  for (let k = 0; spots.length < 9 && k < 600; k++) {
    const x = -160 + R() * 140, z = 120 - R() * 230, { t } = site(x, z);
    if (t < 14 || !ok(x, z, 8) || spots.some((s) => Math.hypot(s.x - x, s.z - z) < 14)) continue;
    spots.push({ kind: R() < 0.5 ? 'cyp' : 'euc', x, z, sc: 0.75 + R() * 0.3, pri: spots.length < 6 ? 1 : 2 });
  }
  return spots;
}

// ---------- backdrop ----------
const RAD = Math.PI / 180, M_LAT = 111200, M_LON = 111200 * Math.cos(35.14 * RAD), HS = Math.sin(HEADING * RAD), HC = Math.cos(HEADING * RAD);
const GREEN_LL = { lat: 35.1040, lon: -120.6292 };
// [lat, lon, height m, along-strike radius m, across radius m, strike bearing°, from ('pier' | 'green'), tone: 0 hills, 1 dunes]
const FEATURES = [
  [35.150, -120.635, 46, 700, 380, 120, 'pier', 0],     // Pismo Heights
  [35.158, -120.608, 132, 1100, 520, 130, 'pier', 0],   // the hills 2-3 km NE
  [35.170, -120.625, 110, 900, 450, 120, 'pier', 0],
  [35.180, -120.680, 150, 1400, 520, 135, 'pier', 0],   // Ontario Ridge, climbing to the NW
  [35.195, -120.705, 300, 1600, 650, 135, 'pier', 0],
  [35.155, -120.665, 28, 900, 260, 150, 'pier', 0],     // Shell Beach bluffs
  [35.210, -120.760, 375, 2400, 1100, 120, 'pier', 0],  // Irish Hills behind Avila
  [35.130, -120.570, 74, 1400, 600, 160, 'pier', 0],    // Arroyo Grande hills
  [35.060, -120.560, 93, 2600, 1400, 150, 'green', 0],  // Nipomo Mesa
  [35.096, -120.623, 25, 650, 260, 150, 'green', 1],    // Pismo Dunes Preserve crest
  [35.070, -120.615, 32, 1300, 380, 165, 'green', 1],   // the dunes of the SVRA
  [35.030, -120.625, 40, 2200, 500, 170, 'green', 1],   // Guadalupe dune line
  [34.990, -120.630, 40, 2400, 500, 172, 'green', 1],
  [34.930, -120.620, 171, 2600, 1100, 110, 'green', 0], // Point Sal ridge, far south
];
// compressed distance: true for the first 600 m, then squeezed so everything stands inside the haze
const squeeze = (d) => d < 600 ? d : 600 + (d - 600) * 0.32;
const SQUEEZE_R = (d) => d < 600 ? 1 : 0.55;
function placeFar(lat, lon, from) {
  const o = from === 'green' ? GREEN_LL : SITE, e = (lon - o.lon) * M_LON, n = (lat - o.lat) * M_LAT, d = Math.hypot(e, n);
  const a = e * HS + n * HC, c = e * HC - n * HS, k = squeeze(d) / Math.max(1, d);
  const ox = from === 'green' ? GREEN.x : 0, oz = from === 'green' ? GREEN.z : 0;
  return { x: ox + c * k, z: oz - a * k, d, bearing: (Math.atan2(e, n) / RAD + 360) % 360 };
}
export function createPismoBackdrop() {
  const geos = [], info = [];
  const hill = [new THREE.Color('#4f5534'), new THREE.Color('#8a7f52')], sand = [new THREE.Color('#b9ab88'), new THREE.Color('#d8ccab')], scrub = new THREE.Color('#5c6342');
  FEATURES.forEach(([lat, lon, h, ra, rc, strike, from, tone], fi) => {
    const P = placeFar(lat, lon, from), sr = SQUEEZE_R(P.d), A = ra * sr, C = rc * sr;
    // strike bearing -> world axis (world x is bearing 253°, world -z is 163°)
    const sb = strike * RAD, se = Math.sin(sb), sn = Math.cos(sb), ux = se * HC - sn * HS, uz = -(se * HS + sn * HC);
    let geo = new THREE.IcosahedronGeometry(1, 4); geo.deleteAttribute('normal'); geo.deleteAttribute('uv'); geo = mergeVertices(geo);
    const p = geo.attributes.position, col = [], pal = tone ? sand : hill;
    for (let i = 0; i < p.count; i++) {
      const vx = p.getX(i), vy = Math.max(0, p.getY(i)), vz = p.getZ(i);
      const n = fbm(vx * 2.2 + fi * 3.1, vz * 2.2 + fi), prof = tone ? Math.pow(vy, 1.4) : Math.pow(vy, 0.85);
      const lx = vx * A * (1 + (n - 0.5) * 0.3), lz = vz * C * (1 + (n - 0.5) * 0.3);
      p.setXYZ(i, P.x + lx * ux - lz * uz, prof * h * (0.85 + n * 0.3) - 3, P.z + lx * uz + lz * ux);
      const cc = pal[0].clone().lerp(pal[1], Math.min(1, prof * 0.7 + n * 0.4));
      if (!tone && fbm(vx * 6 + fi, vz * 6 - fi) > 0.55) cc.lerp(scrub, 0.5);
      if (tone && fbm(vx * 5 + fi, vz * 5) > 0.6 && prof < 0.6) cc.lerp(scrub, 0.45);
      col.push(cc.r, cc.g, cc.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geos.push(geo); info.push({ h, bearing: +P.bearing.toFixed(1), realKm: +(P.d / 1000).toFixed(2), x: Math.round(P.x), z: Math.round(P.z) });
  });
  const g = mergeGeometries(geos); g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.name = 'pismo-backdrop'; mesh.userData.features = info;
  return mesh;
}
